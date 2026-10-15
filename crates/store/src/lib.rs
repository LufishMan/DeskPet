//! SQLite 存檔（DESIGN.md §13、§14.3 R8、§15.3）。
//!
//! 寵物的引擎狀態整個存成 JSON（`pets.state`），其餘表格給相簿和統計使用。
//! 所有查詢都是參數化的。

use std::fmt;
use std::path::{Path, PathBuf};

use deskpet_core::calendar::civil_from_days;
use deskpet_core::{Event, Pet};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

pub const SCHEMA_VERSION: i32 = 1;
/// tick 明細保留天數，之後彙總成每日統計（§14.3 R8）
pub const TICK_LOG_KEEP_DAYS: i32 = 30;
/// 每日備份保留份數（§15.3）
pub const BACKUP_KEEP: usize = 7;

const SCHEMA_V1: &str = "
CREATE TABLE lineages (
    id         INTEGER PRIMARY KEY,
    family     TEXT    NOT NULL,
    started_at INTEGER NOT NULL
);
CREATE TABLE pets (
    id         INTEGER PRIMARY KEY,
    lineage_id INTEGER NOT NULL REFERENCES lineages(id),
    parent_id  INTEGER REFERENCES pets(id),
    generation INTEGER NOT NULL,
    species    TEXT    NOT NULL,
    stage      TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    retired_at INTEGER,
    state      TEXT    NOT NULL
);
CREATE TABLE stage_log (
    pet_id     INTEGER NOT NULL REFERENCES pets(id),
    stage      TEXT    NOT NULL,
    entered_at INTEGER NOT NULL,
    PRIMARY KEY (pet_id, stage)
);
CREATE TABLE checkpoints (
    pet_id INTEGER NOT NULL REFERENCES pets(id),
    stage  TEXT    NOT NULL,
    idx    INTEGER NOT NULL,
    ts     INTEGER NOT NULL,
    ratio  REAL    NOT NULL,
    body   TEXT    NOT NULL,
    PRIMARY KEY (pet_id, stage, idx)
);
CREATE TABLE tick_log (
    pet_id       INTEGER NOT NULL REFERENCES pets(id),
    ts           INTEGER NOT NULL,
    day          INTEGER NOT NULL,
    cpu_avg      REAL    NOT NULL,
    self_cpu     REAL    NOT NULL,
    mem_pressure REAL    NOT NULL,
    calories     REAL    NOT NULL,
    counted      INTEGER NOT NULL
);
CREATE INDEX tick_log_day ON tick_log(day);
CREATE TABLE daily_stats (
    pet_id           INTEGER NOT NULL REFERENCES pets(id),
    day              INTEGER NOT NULL,
    ticks            INTEGER NOT NULL,
    calories         REAL    NOT NULL,
    avg_cpu          REAL    NOT NULL,
    avg_mem_pressure REAL    NOT NULL,
    PRIMARY KEY (pet_id, day)
);
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

#[derive(Debug)]
pub enum StoreError {
    Sql(rusqlite::Error),
    Json(serde_json::Error),
    Io(std::io::Error),
    /// 存檔是由較新版本建立的，不能用舊版開啟
    NewerSchema(i32),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Sql(e) => write!(f, "資料庫錯誤：{e}"),
            StoreError::Json(e) => write!(f, "存檔內容錯誤：{e}"),
            StoreError::Io(e) => write!(f, "檔案錯誤：{e}"),
            StoreError::NewerSchema(v) => write!(f, "存檔版本 {v} 比這個程式新（{SCHEMA_VERSION}），請改用新版程式"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sql(e)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(e: serde_json::Error) -> Self {
        StoreError::Json(e)
    }
}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// 新寵物屬於哪個血脈
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineageRef {
    New,
    Existing(i64),
}

/// 一個 tick 的紀錄（§13 TickLog）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TickRecord {
    pub ts: i64,
    pub day: i32,
    pub cpu_avg: f64,
    pub self_cpu: f64,
    pub mem_pressure: f64,
    pub calories: f64,
    pub counted: bool,
}

/// 列舉值存成和 JSON 相同的文字（例如 `"egg"`）
fn enum_text<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_value(value)?.as_str().unwrap_or_default().to_string())
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        restrict_permissions(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // WAL：執行中也能讀取（例如產生報表）
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
        let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(StoreError::NewerSchema(version));
        }
        if version < 1 {
            let tx = conn.transaction()?;
            tx.execute_batch(SCHEMA_V1)?;
            tx.pragma_update(None, "user_version", 1)?;
            tx.commit()?;
        }
        Ok(Self { conn })
    }

    /// 目前飼養中的寵物（尚未退休的最新一隻）
    pub fn active_pet(&self) -> Result<Option<(i64, Pet)>> {
        let row: Option<(i64, String)> = self
            .conn
            .query_row(
                "SELECT id, state FROM pets WHERE retired_at IS NULL ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        row.map(|(id, state)| Ok((id, serde_json::from_str(&state)?))).transpose()
    }

    pub fn create_pet(&mut self, pet: &Pet, lineage: LineageRef, parent: Option<i64>) -> Result<i64> {
        let tx = self.conn.transaction()?;
        let id = insert_pet(&tx, pet, lineage, parent)?;
        tx.commit()?;
        Ok(id)
    }

    /// 傳承：親代退休，新蛋接手（§12）。兩件事在同一個交易內完成。
    pub fn pass_on(&mut self, parent_id: i64, child: &Pet, continue_lineage: bool, now: i64) -> Result<i64> {
        let tx = self.conn.transaction()?;
        let lineage = if continue_lineage {
            LineageRef::Existing(tx.query_row("SELECT lineage_id FROM pets WHERE id = ?1", params![parent_id], |r| {
                r.get(0)
            })?)
        } else {
            LineageRef::New
        };
        tx.execute("UPDATE pets SET retired_at = ?1 WHERE id = ?2", params![now, parent_id])?;
        let id = insert_pet(&tx, child, lineage, Some(parent_id))?;
        tx.commit()?;
        Ok(id)
    }

    pub fn save_pet(&self, id: i64, pet: &Pet) -> Result<()> {
        self.conn.execute(
            "UPDATE pets SET stage = ?1, state = ?2 WHERE id = ?3",
            params![enum_text(&pet.stage)?, serde_json::to_string(pet)?, id],
        )?;
        Ok(())
    }

    /// 寫入一個 tick：寵物狀態、明細、檢查點和階段紀錄在同一個交易內完成（§2：每個 tick 寫入一次）。
    pub fn record_tick(&mut self, id: i64, pet: &Pet, tick: &TickRecord, events: &[Event]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE pets SET stage = ?1, state = ?2 WHERE id = ?3",
            params![enum_text(&pet.stage)?, serde_json::to_string(pet)?, id],
        )?;
        tx.execute(
            "INSERT INTO tick_log (pet_id, ts, day, cpu_avg, self_cpu, mem_pressure, calories, counted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, tick.ts, tick.day, tick.cpu_avg, tick.self_cpu, tick.mem_pressure, tick.calories, tick.counted],
        )?;
        for event in events {
            match event {
                Event::Checkpoint { stage, index, ratio, body } => {
                    tx.execute(
                        "INSERT OR REPLACE INTO checkpoints (pet_id, stage, idx, ts, ratio, body)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![id, enum_text(stage)?, index, tick.ts, ratio, enum_text(body)?],
                    )?;
                }
                Event::Evolved { to } => {
                    tx.execute(
                        "INSERT OR REPLACE INTO stage_log (pet_id, stage, entered_at) VALUES (?1, ?2, ?3)",
                        params![id, enum_text(to)?, tick.ts],
                    )?;
                }
                _ => {}
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// 從某一天起的 tick 明細，依時間排序
    pub fn ticks_since(&self, day: i32) -> Result<Vec<TickRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT ts, day, cpu_avg, self_cpu, mem_pressure, calories, counted
             FROM tick_log WHERE day >= ?1 ORDER BY ts",
        )?;
        let rows = stmt.query_map(params![day], |r| {
            Ok(TickRecord {
                ts: r.get(0)?,
                day: r.get(1)?,
                cpu_avg: r.get(2)?,
                self_cpu: r.get(3)?,
                mem_pressure: r.get(4)?,
                calories: r.get(5)?,
                counted: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// 把超過保留期的 tick 明細彙總成每日統計後刪除；回傳刪除的筆數。
    pub fn compact(&mut self, today: i32) -> Result<usize> {
        let cutoff = today - TICK_LOG_KEEP_DAYS;
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO daily_stats (pet_id, day, ticks, calories, avg_cpu, avg_mem_pressure)
             SELECT pet_id, day, COUNT(*), SUM(calories), AVG(cpu_avg), AVG(mem_pressure)
             FROM tick_log WHERE day < ?1 GROUP BY pet_id, day
             ON CONFLICT (pet_id, day) DO UPDATE SET
                 avg_cpu = (avg_cpu * ticks + excluded.avg_cpu * excluded.ticks) / (ticks + excluded.ticks),
                 avg_mem_pressure = (avg_mem_pressure * ticks + excluded.avg_mem_pressure * excluded.ticks)
                                    / (ticks + excluded.ticks),
                 calories = calories + excluded.calories,
                 ticks = ticks + excluded.ticks",
            params![cutoff],
        )?;
        let deleted = tx.execute("DELETE FROM tick_log WHERE day < ?1", params![cutoff])?;
        tx.commit()?;
        Ok(deleted)
    }

    /// 每天一份備份，只保留最近 [`BACKUP_KEEP`] 份。當天已經備份過就不再備份，回傳 `None`。
    pub fn backup(&self, dir: &Path, day: i32) -> Result<Option<PathBuf>> {
        std::fs::create_dir_all(dir)?;
        let (y, m, d) = civil_from_days(day);
        let path = dir.join(format!("deskpet-{y:04}-{m:02}-{d:02}.db"));
        if path.exists() {
            return Ok(None);
        }
        self.conn.execute("VACUUM INTO ?1", params![path.to_string_lossy()])?;
        restrict_permissions(&path)?;

        let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("deskpet-") && n.ends_with(".db"))
            })
            .collect();
        backups.sort();
        let excess = backups.len().saturating_sub(BACKUP_KEEP);
        for old in &backups[..excess] {
            std::fs::remove_file(old)?;
        }
        Ok(Some(path))
    }
}

fn insert_pet(tx: &rusqlite::Transaction<'_>, pet: &Pet, lineage: LineageRef, parent: Option<i64>) -> Result<i64> {
    let lineage_id = match lineage {
        LineageRef::Existing(id) => id,
        LineageRef::New => {
            tx.execute(
                "INSERT INTO lineages (family, started_at) VALUES (?1, ?2)",
                params![enum_text(&pet.family)?, pet.created_at],
            )?;
            tx.last_insert_rowid()
        }
    };
    tx.execute(
        "INSERT INTO pets (lineage_id, parent_id, generation, species, stage, created_at, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            lineage_id,
            parent,
            pet.generation,
            enum_text(&pet.species)?,
            enum_text(&pet.stage)?,
            pet.created_at,
            serde_json::to_string(pet)?
        ],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO stage_log (pet_id, stage, entered_at) VALUES (?1, ?2, ?3)",
        params![id, enum_text(&pet.stage)?, pet.created_at],
    )?;
    Ok(id)
}

/// 存檔只有本人能讀（§14.3 R8）。Windows 的 %LOCALAPPDATA% 本來就只有本人能存取。
#[cfg(unix)]
fn restrict_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use deskpet_core::{Balance, BodyType, LegacyChoice, MoodLevel, Stage, TickInput};

    fn tick(ts: i64, day: i32) -> TickRecord {
        TickRecord { ts, day, cpu_avg: 12.0, self_cpu: 0.1, mem_pressure: 0.5, calories: 4.0, counted: true }
    }

    #[test]
    fn create_save_and_reload() {
        let b = Balance::default();
        let mut store = Store::open_in_memory().unwrap();
        assert!(store.active_pet().unwrap().is_none());

        let mut pet = Pet::new_egg(&b, 5, None, 1, 100, 20_000);
        let id = store.create_pet(&pet, LineageRef::New, None).unwrap();
        let input = TickInput { now: 400, day: 20_000, cpu_percent: 12.0, mood: MoodLevel::Normal };
        let events = pet.tick(&b, &input);
        store.record_tick(id, &pet, &tick(400, 20_000), &events).unwrap();

        let (loaded_id, loaded) = store.active_pet().unwrap().unwrap();
        assert_eq!(loaded_id, id);
        assert_eq!(loaded, pet);
        assert_eq!(store.ticks_since(20_000).unwrap().len(), 1);
    }

    #[test]
    fn checkpoints_and_stages_are_logged() {
        let mut store = Store::open_in_memory().unwrap();
        let pet = Pet::new_egg(&Balance::default(), 5, None, 1, 0, 0);
        let id = store.create_pet(&pet, LineageRef::New, None).unwrap();
        let events = [
            Event::Checkpoint { stage: Stage::Egg, index: 4, ratio: 1.02, body: BodyType::Standard },
            Event::Evolved { to: Stage::Baby },
        ];
        store.record_tick(id, &pet, &tick(10, 0), &events).unwrap();
        let body: String = store
            .conn
            .query_row("SELECT body FROM checkpoints WHERE pet_id = ?1 AND idx = 4", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(body, "standard");
        let stages: i64 =
            store.conn.query_row("SELECT COUNT(*) FROM stage_log WHERE pet_id = ?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(stages, 2);
    }

    #[test]
    fn pass_on_retires_parent_and_keeps_lineage() {
        let b = Balance::default();
        let mut store = Store::open_in_memory().unwrap();
        let parent = Pet::new_egg(&b, 5, None, 1, 0, 0);
        let parent_id = store.create_pet(&parent, LineageRef::New, None).unwrap();

        let child = parent.next_generation(&b, LegacyChoice::Continue, 6, 50, 1);
        let child_id = store.pass_on(parent_id, &child, true, 50).unwrap();
        assert_eq!(store.active_pet().unwrap().unwrap().0, child_id);
        let lineages: (i64, i64) = store
            .conn
            .query_row(
                "SELECT (SELECT lineage_id FROM pets WHERE id = ?1), (SELECT lineage_id FROM pets WHERE id = ?2)",
                params![parent_id, child_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(lineages.0, lineages.1);

        let fresh = child.next_generation(&b, LegacyChoice::NewLineage, 7, 60, 2);
        let fresh_id = store.pass_on(child_id, &fresh, false, 60).unwrap();
        let count: i64 = store.conn.query_row("SELECT COUNT(*) FROM lineages", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
        assert_eq!(store.active_pet().unwrap().unwrap().0, fresh_id);
    }

    #[test]
    fn compact_moves_old_ticks_into_daily_stats() {
        let mut store = Store::open_in_memory().unwrap();
        let pet = Pet::new_egg(&Balance::default(), 5, None, 1, 0, 0);
        let id = store.create_pet(&pet, LineageRef::New, None).unwrap();
        for i in 0..3 {
            store.record_tick(id, &pet, &tick(i, 100), &[]).unwrap();
        }
        store.record_tick(id, &pet, &tick(99_999, 140), &[]).unwrap();
        assert_eq!(store.compact(140).unwrap(), 3);
        let (ticks, calories): (i64, f64) = store
            .conn
            .query_row("SELECT ticks, calories FROM daily_stats WHERE day = 100", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((ticks, calories), (3, 12.0));
        assert_eq!(store.ticks_since(0).unwrap().len(), 1);
    }

    #[test]
    fn file_store_backups_keep_seven() {
        let dir = std::env::temp_dir().join(format!("deskpet-store-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir.join("deskpet.db")).unwrap();
        let backups = dir.join("backups");
        for day in 20_000..20_010 {
            assert!(store.backup(&backups, day).unwrap().is_some());
        }
        assert!(store.backup(&backups, 20_009).unwrap().is_none());
        assert_eq!(std::fs::read_dir(&backups).unwrap().count(), BACKUP_KEEP);
        drop(store);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_newer_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1).unwrap();
        assert!(matches!(Store::init(conn), Err(StoreError::NewerSchema(_))));
    }
}
