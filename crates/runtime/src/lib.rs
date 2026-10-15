//! DeskPet 執行期：每 10 秒取樣、每 5 分鐘結算並存檔，處理睡眠／喚醒與每日維護。
//! CLI 和桌面程式共用這個主迴圈。

use std::error::Error;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use deskpet_core::rng::Rng;
use deskpet_core::{
    Balance, Event, LegacyChoice, MoodEngine, MoodLevel, Pet, Sample, SampleOutcome, TickAccumulator, TickInput,
    TickSummary,
};
use deskpet_store::{LineageRef, Store, TickRecord};
use deskpet_sys::{PowerEvent, SelfCpuSource, SystemSampler, local_now, memory, unix_now};

pub type AnyError = Box<dyn Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, AnyError>;

/// 主迴圈回報給呼叫端的事情
#[derive(Debug)]
pub enum Update {
    /// 完成一個 tick 的結算與存檔
    Tick {
        summary: TickSummary,
        mood: MoodLevel,
        calories: f64,
        events: Vec<Event>,
        /// 每日維護：彙總掉的舊明細筆數、新的備份檔
        compacted: usize,
        backup: Option<PathBuf>,
    },
    /// 取樣間隔異常（休眠），丟棄未完成的 tick
    Gap { seconds: i64 },
    Suspending,
    Resumed { events: Vec<Event> },
    /// 存檔裡的寵物被換掉了（例如另一個指令完成了傳承）
    Replaced,
}

pub struct Runtime {
    balance: Balance,
    store: Store,
    backups: PathBuf,
    pet_id: i64,
    pet: Pet,
    sampler: SystemSampler,
    accumulator: TickAccumulator,
    mood: MoodEngine,
    last_sample: Option<i64>,
    maintained_day: Option<i32>,
    _lock: File,
}

/// 開啟時的狀況，給呼叫端顯示用
pub struct Startup {
    pub new_egg: bool,
    pub events: Vec<Event>,
    pub self_cpu: SelfCpuSource,
}

impl Runtime {
    /// 開啟存檔（沒有寵物就撿一顆新的蛋），並取得單一執行個體鎖（§15.3）。
    pub fn open(db: &Path) -> Result<(Self, Startup)> {
        let dir = db.parent().ok_or("存檔路徑沒有上層資料夾")?;
        std::fs::create_dir_all(dir)?;
        let lock = File::create(dir.join("deskpet.lock"))?;
        lock.try_lock().map_err(|_| "已經有另一個 DeskPet 在使用這份存檔")?;

        let balance = Balance::default();
        let mut store = Store::open(db)?;
        let local = local_now();
        let now = unix_now();
        let (pet_id, mut pet, new_egg) = match store.active_pet()? {
            Some((id, pet)) => (id, pet, false),
            None => {
                let pet = Pet::new_egg(&balance, random_seed(), None, 1, now, local.day);
                let id = store.create_pet(&pet, LineageRef::New, None)?;
                (id, pet, true)
            }
        };
        let events = pet.catch_up(&balance, now, local.day);
        store.save_pet(pet_id, &pet)?;

        let sampler = SystemSampler::new();
        let startup = Startup { new_egg, events, self_cpu: sampler.self_cpu_source() };
        let runtime = Self {
            accumulator: TickAccumulator::new(&balance),
            balance,
            store,
            backups: dir.join("backups"),
            pet_id,
            pet,
            sampler,
            mood: MoodEngine::default(),
            last_sample: None,
            maintained_day: None,
            _lock: lock,
        };
        Ok((runtime, startup))
    }

    pub fn balance(&self) -> &Balance {
        &self.balance
    }

    pub fn pet(&self) -> &Pet {
        &self.pet
    }

    pub fn mood(&self) -> MoodLevel {
        self.mood.level(&self.balance)
    }

    /// 取樣一次；累積滿一個 tick 時結算並存檔。
    pub fn sample(&mut self) -> Result<Option<Update>> {
        let Some(cpu) = self.sampler.sample_cpu() else { return Ok(None) };
        let now = unix_now();
        let pressure = memory().map_or(0.0, |m| m.pressure());
        let dt = self.last_sample.map_or(f64::from(self.balance.tick.sample_seconds), |t| (now - t) as f64);
        self.last_sample = Some(now);
        self.mood.sample(&self.balance, pressure, dt);

        let sample = Sample { now, cpu_percent: cpu.adjusted(), self_percent: cpu.self_percent, pressure };
        let summary = match self.accumulator.push(&sample) {
            SampleOutcome::Pending => return Ok(None),
            SampleOutcome::Gap { last, now } => return Ok(Some(Update::Gap { seconds: now - last })),
            SampleOutcome::Tick(summary) => summary,
        };

        let local = local_now();
        let mood = self.mood();
        let before = self.pet.total_calories;
        let input = TickInput { now: summary.end, day: local.day, cpu_percent: summary.cpu_avg, mood };
        let events = self.pet.tick(&self.balance, &input);
        let calories = self.pet.total_calories - before;
        let record = TickRecord {
            ts: summary.end,
            day: local.day,
            cpu_avg: summary.cpu_avg,
            self_cpu: summary.self_avg,
            mem_pressure: summary.pressure_avg,
            calories,
            counted: calories > 0.0,
        };
        self.store.record_tick(self.pet_id, &self.pet, &record, &events)?;

        let (mut compacted, mut backup) = (0, None);
        if self.maintained_day != Some(local.day) {
            self.maintained_day = Some(local.day);
            compacted = self.store.compact(local.day)?;
            backup = self.store.backup(&self.backups, local.day)?;
        }
        Ok(Some(Update::Tick { summary, mood, calories, events, compacted, backup }))
    }

    pub fn on_suspend(&mut self) -> Update {
        self.accumulator.reset();
        Update::Suspending
    }

    pub fn on_resume(&mut self) -> Result<Update> {
        let events = self.pet.catch_up(&self.balance, unix_now(), local_now().day);
        self.store.save_pet(self.pet_id, &self.pet)?;
        Ok(Update::Resumed { events })
    }

    /// 傳承（§12）：親代退休，新蛋接手。
    pub fn pass_on(&mut self, choice: LegacyChoice) -> Result<()> {
        if !self.pet.legacy_ready {
            return Err("還沒達到傳承條件".into());
        }
        let child = self.pet.next_generation(&self.balance, choice, random_seed(), unix_now(), local_now().day);
        self.pet_id = self.store.pass_on(self.pet_id, &child, choice == LegacyChoice::Continue, unix_now())?;
        self.pet = child;
        Ok(())
    }

    /// 存檔中的寵物被其他程式換掉時跟上
    fn reload_if_replaced(&mut self) -> Result<bool> {
        if !self.pet.legacy_ready {
            return Ok(false);
        }
        match self.store.active_pet()? {
            Some((id, pet)) if id != self.pet_id => {
                (self.pet_id, self.pet) = (id, pet);
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

/// 主迴圈：在目前執行緒上一直執行。等待期間不持有鎖，所以其他執行緒可以隨時讀取寵物狀態。
/// `on_update` 回傳 `false` 時結束迴圈。
pub fn run_loop(runtime: &Arc<Mutex<Runtime>>, mut on_update: impl FnMut(&Runtime, Update) -> bool) -> Result<()> {
    let seconds = runtime.lock().map_err(|_| "執行期狀態已損壞")?.balance.tick.sample_seconds;
    let interval = Duration::from_secs(u64::from(seconds));
    // 訂閱要留在這個執行緒上，迴圈結束時自動取消
    let power = deskpet_sys::subscribe_power();
    let mut next = Instant::now() + interval;

    loop {
        loop {
            let timeout = next.saturating_duration_since(Instant::now());
            let received = match &power {
                Some((_, rx)) => rx.recv_timeout(timeout),
                None => {
                    std::thread::sleep(timeout);
                    Err(RecvTimeoutError::Timeout)
                }
            };
            let update = match received {
                Ok(PowerEvent::Suspend) => runtime.lock().map_err(|_| "執行期狀態已損壞")?.on_suspend(),
                Ok(PowerEvent::Resume) => runtime.lock().map_err(|_| "執行期狀態已損壞")?.on_resume()?,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(timeout);
                    break;
                }
            };
            let rt = runtime.lock().map_err(|_| "執行期狀態已損壞")?;
            if !on_update(&rt, update) {
                return Ok(());
            }
        }
        next += interval;
        if next < Instant::now() {
            next = Instant::now() + interval;
        }

        let mut rt = runtime.lock().map_err(|_| "執行期狀態已損壞")?;
        if let Some(update) = rt.sample()?
            && !on_update(&rt, update)
        {
            return Ok(());
        }
        if rt.reload_if_replaced()? && !on_update(&rt, Update::Replaced) {
            return Ok(());
        }
    }
}

pub fn random_seed() -> u64 {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
    Rng::new(nanos ^ (u64::from(std::process::id()) << 32)).next_u64()
}

/// 預設存檔路徑（§14.5 B）
pub fn default_db_path() -> Option<PathBuf> {
    deskpet_sys::data_dir().map(|d| d.join("deskpet.db"))
}
