//! DeskPet 開發用命令列（不隨正式版發佈）。
//!
//!   deskpet-cli run    [--db 路徑]            不開視窗執行引擎：取樣、結算、存檔
//!   deskpet-cli report [--db 路徑] [--days N] 用最近 N 天的真實數據產生校準報表
//!   deskpet-cli legacy continue|new [--db 路徑] 達到傳承條件後選擇延續或開新血脈
//!
//! 報表會顯示隱藏數值（體型、熱量等），只供開發校準使用。

use std::error::Error;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use deskpet_core::calendar::civil_from_days;
use deskpet_core::rng::Rng;
use deskpet_core::{
    Balance, BodyType, Event, LegacyChoice, MoodEngine, MoodLevel, Pet, Sample, SampleOutcome, Stage, TickAccumulator,
    TickInput,
};
use deskpet_store::{LineageRef, Store, TickRecord};
use deskpet_sys::{PowerEvent, SelfCpuSource, SystemSampler, local_now, memory, unix_now};

type AnyResult<T> = Result<T, Box<dyn Error>>;

fn main() -> ExitCode {
    // 動態載入 DLL 只搜尋 System32（§14.3 R4），越早越好
    let hardened = deskpet_sys::harden_dll_search();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("run") => db_path(&args[1..]).and_then(|db| run(&db, hardened)),
        Some("report") => db_path(&args[1..]).and_then(|db| report(&db, flag_value(&args[1..], "--days").unwrap_or(7))),
        Some("legacy") => db_path(&args[1..]).and_then(|db| legacy(&db, args.get(1).map(String::as_str))),
        _ => {
            eprintln!("用法：");
            eprintln!("  deskpet-cli run    [--db 路徑]");
            eprintln!("  deskpet-cli report [--db 路徑] [--days N]");
            eprintln!("  deskpet-cli legacy continue|new [--db 路徑]");
            return ExitCode::FAILURE;
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("錯誤：{e}");
            ExitCode::FAILURE
        }
    }
}

fn flag_value(args: &[String], name: &str) -> Option<i32> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok())
}

fn db_path(args: &[String]) -> AnyResult<PathBuf> {
    if let Some(i) = args.iter().position(|a| a == "--db") {
        return args.get(i + 1).map(PathBuf::from).ok_or_else(|| "--db 需要一個路徑".into());
    }
    Ok(deskpet_sys::data_dir().ok_or("找不到使用者資料夾")?.join("deskpet.db"))
}

/// 單一執行個體鎖（§15.3）：同一份存檔只能有一個程式寫入
fn acquire_lock(db: &Path) -> AnyResult<File> {
    let dir = db.parent().ok_or("存檔路徑沒有上層資料夾")?;
    std::fs::create_dir_all(dir)?;
    let file = File::create(dir.join("deskpet.lock"))?;
    file.try_lock().map_err(|_| "已經有另一個 DeskPet 在使用這份存檔")?;
    Ok(file)
}

fn random_seed() -> u64 {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
    Rng::new(nanos ^ (u64::from(std::process::id()) << 32)).next_u64()
}

fn clock(minute: u32) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

fn date(day: i32) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

fn describe(pet: &Pet, balance: &Balance) -> String {
    let stage = &balance.stages[pet.stage.index()];
    let mut flags = Vec::new();
    if pet.waiting {
        flags.push("等待期");
    }
    if pet.legacy_ready {
        flags.push("可傳承");
    }
    if pet.is_napping(balance) {
        flags.push("小睡");
    }
    if pet.daily_calories >= balance.calories.daily_cap {
        flags.push("吃飽");
    }
    format!(
        "{}（{}）{} {:.0}/{:.0} 熱量・第 {} 天・體型 {}・活力 {}{}",
        pet.species.name(),
        pet.family.name(),
        pet.stage.name(),
        pet.stage_calories,
        stage.calories,
        pet.days_in_stage(),
        pet.body_type(balance).name(),
        pet.energy,
        if flags.is_empty() { String::new() } else { format!("・{}", flags.join("、")) }
    )
}

fn print_events(events: &[Event], time: &str) {
    for event in events {
        let text = match event {
            Event::Checkpoint { stage, index, ratio, body } => {
                format!("{} 檢查點 {index}/4：ratio {ratio:.2}，體型 {}", stage.name(), body.name())
            }
            Event::Waiting { stage } => format!("{}熱量已滿，等待最短天數", stage.name()),
            Event::Evolved { to } => format!("進化為{}！", to.name()),
            Event::LegacyReady => "達到傳承條件。執行 `deskpet-cli legacy continue` 或 `legacy new` 來選擇".into(),
            Event::Full => "今天吃飽了，去睡覺".into(),
            Event::NapStarted => "電腦閒置，開始小睡".into(),
            Event::DayClosed { day, active, energy, hunger_penalty } => format!(
                "{} 結束：{}，活力 {energy}，飢餓扣分 {hunger_penalty}",
                date(*day),
                if *active { "活躍日" } else { "不活躍" }
            ),
            Event::ClockSkew => "系統時間倒退，這個 tick 不結算".into(),
        };
        println!("[{time}] ★ {text}");
    }
}

fn run(db: &Path, hardened: bool) -> AnyResult<()> {
    let _lock = acquire_lock(db)?;
    let balance = Balance::default();
    let mut store = Store::open(db)?;
    let backups = db.parent().ok_or("存檔路徑沒有上層資料夾")?.join("backups");

    let local = local_now();
    let now = unix_now();
    let (mut pet_id, mut pet) = match store.active_pet()? {
        Some(found) => found,
        None => {
            let pet = Pet::new_egg(&balance, random_seed(), None, 1, now, local.day);
            let id = store.create_pet(&pet, LineageRef::New, None)?;
            println!("撿到一顆新的蛋。");
            (id, pet)
        }
    };
    let events = pet.catch_up(&balance, now, local.day);
    store.save_pet(pet_id, &pet)?;
    print_events(&events, &clock(local.minute));

    let mut sampler = SystemSampler::new();
    let source = match sampler.self_cpu_source() {
        SelfCpuSource::Job => "Job Object（含子程序）",
        SelfCpuSource::Process => "只有主程序",
        SelfCpuSource::Unsupported => "此平台尚未支援",
    };
    let power = deskpet_sys::subscribe_power();
    println!("存檔：{}", db.display());
    println!(
        "DLL 搜尋路徑限制：{}・本程式 CPU 來源：{source}・休眠通知：{}",
        if hardened { "已啟用" } else { "失敗" },
        if power.is_some() { "已訂閱" } else { "無（只用時間差偵測）" }
    );
    println!("{}", describe(&pet, &balance));
    println!("每 {} 秒取樣、每 {} 分鐘結算一次。按 Ctrl+C 結束（狀態每個 tick 都已存檔）。", balance.tick.sample_seconds, balance.tick.minutes);

    let interval = Duration::from_secs(u64::from(balance.tick.sample_seconds));
    let mut accumulator = TickAccumulator::new(&balance);
    let mut mood = MoodEngine::default();
    let mut last_sample: Option<i64> = None;
    let mut maintained_day = None;
    let mut next = Instant::now() + interval;

    loop {
        // 等到下一次取樣；期間若收到睡眠 / 喚醒通知就先處理
        loop {
            let timeout = next.saturating_duration_since(Instant::now());
            let received = match &power {
                Some((_, rx)) => rx.recv_timeout(timeout),
                None => {
                    std::thread::sleep(timeout);
                    Err(RecvTimeoutError::Timeout)
                }
            };
            match received {
                Ok(PowerEvent::Suspend) => {
                    accumulator.reset();
                    println!("[{}] 電腦即將休眠，捨棄未完成的 tick", clock(local_now().minute));
                }
                Ok(PowerEvent::Resume) => {
                    let local = local_now();
                    println!("[{}] 電腦從休眠喚醒", clock(local.minute));
                    let events = pet.catch_up(&balance, unix_now(), local.day);
                    store.save_pet(pet_id, &pet)?;
                    print_events(&events, &clock(local.minute));
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(timeout);
                    break;
                }
            }
        }
        next += interval;
        if next < Instant::now() {
            next = Instant::now() + interval;
        }

        let Some(cpu) = sampler.sample_cpu() else { continue };
        let now = unix_now();
        let pressure = memory().map_or(0.0, |m| m.pressure());
        let dt = last_sample.map_or(f64::from(balance.tick.sample_seconds), |t| (now - t) as f64);
        last_sample = Some(now);
        mood.sample(&balance, pressure, dt);

        let sample = Sample { now, cpu_percent: cpu.adjusted(), self_percent: cpu.self_percent, pressure };
        match accumulator.push(&sample) {
            SampleOutcome::Pending => {}
            SampleOutcome::Gap { last, now } => {
                println!("[{}] 偵測到 {} 秒的空檔（休眠），捨棄未完成的 tick", clock(local_now().minute), now - last);
            }
            SampleOutcome::Tick(tick) => {
                let local = local_now();
                let level = mood.level(&balance);
                let before = pet.total_calories;
                let input = TickInput { now: tick.end, day: local.day, cpu_percent: tick.cpu_avg, mood: level };
                let events = pet.tick(&balance, &input);
                let calories = pet.total_calories - before;
                let record = TickRecord {
                    ts: tick.end,
                    day: local.day,
                    cpu_avg: tick.cpu_avg,
                    self_cpu: tick.self_avg,
                    mem_pressure: tick.pressure_avg,
                    calories,
                    counted: calories > 0.0,
                };
                store.record_tick(pet_id, &pet, &record, &events)?;
                let time = clock(local.minute);
                println!(
                    "[{time}] CPU {:5.1}%（本程式 {:.2}%）・記憶體壓力 {:.2}・心情 {}・+{calories:.1} 熱量 → {}",
                    tick.cpu_avg,
                    tick.self_avg,
                    tick.pressure_avg,
                    level.name(),
                    describe(&pet, &balance)
                );
                print_events(&events, &time);

                // 每天一次：彙總舊明細、備份
                if maintained_day != Some(local.day) {
                    maintained_day = Some(local.day);
                    let removed = store.compact(local.day)?;
                    if removed > 0 {
                        println!("[{time}] 已把 {removed} 筆超過 30 天的明細彙總成每日統計");
                    }
                    if let Some(path) = store.backup(&backups, local.day)? {
                        println!("[{time}] 已備份到 {}", path.display());
                    }
                }
            }
        }
        // 傳承由另一個指令處理；這裡只在存檔已被換掉時跟上
        if pet.legacy_ready
            && let Some((id, latest)) = store.active_pet()?
            && id != pet_id
        {
            println!("偵測到傳承，改為照顧新的蛋。");
            (pet_id, pet) = (id, latest);
        }
    }
}

fn legacy(db: &Path, choice: Option<&str>) -> AnyResult<()> {
    let choice = match choice {
        Some("continue") => LegacyChoice::Continue,
        Some("new") => LegacyChoice::NewLineage,
        _ => return Err("請指定 continue（延續血脈）或 new（開新血脈）".into()),
    };
    let balance = Balance::default();
    let mut store = Store::open(db)?;
    let (id, pet) = store.active_pet()?.ok_or("還沒有寵物")?;
    if !pet.legacy_ready {
        return Err(format!("還沒達到傳承條件：{}", describe(&pet, &balance)).into());
    }
    let local = local_now();
    let child = pet.next_generation(&balance, choice, random_seed(), unix_now(), local.day);
    store.pass_on(id, &child, choice == LegacyChoice::Continue, unix_now())?;
    println!("{} 退休了。新的蛋是第 {} 代。", pet.species.name(), child.generation);
    Ok(())
}

fn report(db: &Path, days: i32) -> AnyResult<()> {
    let balance = Balance::default();
    let store = Store::open(db)?;
    let today = local_now().day;
    let since = today - days + 1;
    let ticks = store.ticks_since(since)?;
    println!("━━ DeskPet 校準報表：{} ～ {}（{days} 天）━━", date(since), date(today));
    if let Some((_, pet)) = store.active_pet()? {
        println!("目前：{}", describe(&pet, &balance));
    }
    if ticks.is_empty() {
        println!("這段期間沒有任何 tick 紀錄。先執行 `deskpet-cli run` 收集數據。");
        return Ok(());
    }

    let n = ticks.len() as f64;
    let tick_hours = f64::from(balance.tick.minutes) / 60.0;
    let active_days = {
        let mut d: Vec<i32> = ticks.iter().map(|t| t.day).collect();
        d.dedup();
        d.len()
    };
    println!("\n活躍時間：{:.1} 小時（{} 個 tick，{active_days} 天有開機）", n * tick_hours, ticks.len());

    println!("\nCPU 分布（已扣除本程式）：");
    let mut lower = 0.0;
    let mut base_sum = 0.0;
    for band in &balance.calories.bands {
        let count = ticks.iter().filter(|t| t.cpu_avg >= lower && t.cpu_avg < band.cpu_below).count();
        base_sum += count as f64 * band.calories;
        let label = if band.cpu_below > 100.0 { format!("≥ {lower:.0}%") } else { format!("{lower:.0}–{:.0}%", band.cpu_below) };
        println!(
            "  {label:<8} {:>5.1}%  {}  （{} 熱量 / tick）",
            count as f64 / n * 100.0,
            "█".repeat((count as f64 / n * 40.0).round() as usize),
            band.calories
        );
        lower = band.cpu_below;
    }
    let base_avg = base_sum / n;
    println!("  平均基礎熱量：{base_avg:.2} / tick（標準速率 {}）", balance.calories.standard_rate);

    let counted: Vec<_> = ticks.iter().filter(|t| t.counted).collect();
    let counted_calories: f64 = counted.iter().map(|t| t.calories).sum();
    println!(
        "  實際計入：{:.1}% 的 tick（其餘為小睡、吃飽、等待期），平均 {:.2} 熱量 / 計入 tick",
        counted.len() as f64 / n * 100.0,
        if counted.is_empty() { 0.0 } else { counted_calories / counted.len() as f64 }
    );

    println!("\n記憶體壓力（心情）：");
    let bounds = balance.mood.pressure_bounds;
    let moods = [MoodLevel::Happy, MoodLevel::Normal, MoodLevel::Tense, MoodLevel::Depressed];
    for (i, mood) in moods.iter().enumerate() {
        let lo = if i == 0 { f64::MIN } else { bounds[i - 1] };
        let hi = if i == 3 { f64::MAX } else { bounds[i] };
        let count = ticks.iter().filter(|t| t.mem_pressure >= lo && t.mem_pressure < hi).count();
        println!("  {}  {:>5.1}%", mood.name(), count as f64 / n * 100.0);
    }
    let pressure_avg = ticks.iter().map(|t| t.mem_pressure).sum::<f64>() / n;
    println!("  平均壓力指數 {pressure_avg:.2}（分界 {bounds:?}）");

    let self_avg = ticks.iter().map(|t| t.self_cpu).sum::<f64>() / n;
    let self_max = ticks.iter().map(|t| t.self_cpu).fold(0.0, f64::max);
    println!("\n本程式 CPU：平均 {self_avg:.3}%、最高 {self_max:.3}%（目標平均 < 1%）");

    // 推估：用每個日曆日平均計入的熱量；從第一筆紀錄那天起算，避免把還沒開始收集的日子算進去
    let span = today - ticks[0].day + 1;
    if span < 7 {
        println!("\n⚠ 只有 {span} 天的數據，推估會不準。建議至少收集一週（含週末）。");
    }
    let per_day = counted_calories / f64::from(span);
    let ratio = if counted_calories > 0.0 {
        counted.len() as f64 / (counted_calories / balance.calories.standard_rate)
    } else {
        f64::NAN
    };
    let body = body_for_ratio(&balance, ratio);
    println!("\n推估（照這段期間的使用習慣）：每天平均 {per_day:.0} 熱量，體型約為「{}」（ratio {ratio:.2}）", body.name());
    for (stage, rule) in [Stage::Egg, Stage::Baby, Stage::Juvenile, Stage::Adult].iter().zip(&balance.stages) {
        let by_calories = if per_day > 0.0 { rule.calories / per_day } else { f64::INFINITY };
        let estimate = by_calories.max(f64::from(rule.min_days));
        let target = if *stage == Stage::Adult { 21.0 } else { 14.0 };
        println!(
            "  {:<3} 約 {estimate:>5.1} 天{}",
            stage.name(),
            if estimate > target { format!("  ⚠ 超過 {target:.0} 天") } else { String::new() }
        );
    }
    Ok(())
}

fn body_for_ratio(balance: &Balance, ratio: f64) -> BodyType {
    let [very_fat, fat, standard, thin] = balance.body.ratio_bounds;
    match ratio {
        r if r.is_nan() => BodyType::Standard,
        r if r < very_fat => BodyType::VeryFat,
        r if r < fat => BodyType::Fat,
        r if r <= standard => BodyType::Standard,
        r if r <= thin => BodyType::Thin,
        _ => BodyType::VeryThin,
    }
}
