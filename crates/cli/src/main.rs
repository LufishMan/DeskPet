//! DeskPet 開發用命令列（不隨正式版發佈）。
//!
//!   deskpet-cli run    [--db 路徑]            不開視窗執行引擎：取樣、結算、存檔
//!   deskpet-cli report [--db 路徑] [--days N] 用最近 N 天的真實數據產生校準報表
//!   deskpet-cli legacy continue|new [--db 路徑] 達到傳承條件後選擇延續或開新血脈
//!
//! 報表會顯示隱藏數值（體型、熱量等），只供開發校準使用。

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};

use deskpet_core::calendar::civil_from_days;
use deskpet_core::{Balance, BodyType, Event, LegacyChoice, MoodLevel, Pet, Stage};
use deskpet_runtime::{AnyError, Runtime, Update, random_seed, run_loop};
use deskpet_store::Store;
use deskpet_sys::{SelfCpuSource, local_now, unix_now};

type AnyResult<T> = Result<T, AnyError>;

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
    Ok(deskpet_runtime::default_db_path().ok_or("找不到使用者資料夾")?)
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
    let (runtime, startup) = Runtime::open(db)?;
    let local = local_now();
    if startup.new_egg {
        println!("撿到一顆新的蛋。");
    }
    print_events(&startup.events, &clock(local.minute));

    let source = match startup.self_cpu {
        SelfCpuSource::Job => "Job Object（含子程序）",
        SelfCpuSource::Process => "只有主程序",
        SelfCpuSource::Unsupported => "此平台尚未支援",
    };
    println!("存檔：{}", db.display());
    println!("DLL 搜尋路徑限制：{}・本程式 CPU 來源：{source}", if hardened { "已啟用" } else { "失敗" });
    let balance = runtime.balance();
    println!("{}", describe(runtime.pet(), balance));
    println!(
        "每 {} 秒取樣、每 {} 分鐘結算一次。按 Ctrl+C 結束（狀態每個 tick 都已存檔）。",
        balance.tick.sample_seconds, balance.tick.minutes
    );

    let runtime = Arc::new(Mutex::new(runtime));
    run_loop(&runtime, |rt, update| {
        let local = local_now();
        let time = clock(local.minute);
        match update {
            Update::Tick { summary, mood, calories, events, compacted, backup } => {
                println!(
                    "[{time}] CPU {:5.1}%（本程式 {:.2}%）・記憶體壓力 {:.2}・心情 {}・+{calories:.1} 熱量 → {}",
                    summary.cpu_avg,
                    summary.self_avg,
                    summary.pressure_avg,
                    mood.name(),
                    describe(rt.pet(), rt.balance())
                );
                print_events(&events, &time);
                if compacted > 0 {
                    println!("[{time}] 已把 {compacted} 筆超過 30 天的明細彙總成每日統計");
                }
                if let Some(path) = backup {
                    println!("[{time}] 已備份到 {}", path.display());
                }
            }
            Update::Gap { seconds } => println!("[{time}] 偵測到 {seconds} 秒的空檔（休眠），捨棄未完成的 tick"),
            Update::Suspending => println!("[{time}] 電腦即將休眠，捨棄未完成的 tick"),
            Update::Resumed { events } => {
                println!("[{time}] 電腦從休眠喚醒");
                print_events(&events, &time);
            }
            Update::Replaced => println!("[{time}] 偵測到傳承，改為照顧新的蛋：{}", describe(rt.pet(), rt.balance())),
        }
        true
    })
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
