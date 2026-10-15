//! 時間加速模擬器：用固定情境驗證 balance.toml 的成長節奏（DESIGN.md §16 M1）。
//!
//! 用法：deskpet-sim [情境…] [--days N] [--seed N] [--balance 路徑] [--verbose]
//! 不指定情境時執行全部。第 0 天是週一；傳承時一律選「延續血脈」。

use std::process::ExitCode;

use deskpet_core::rng::Rng;
use deskpet_core::{Balance, BodyType, Event, Family, LegacyChoice, MoodLevel, Pet, Species, Stage, TickInput};

const WEEKDAYS: [&str; 7] = ["一", "二", "三", "四", "五", "六", "日"];

#[derive(Clone, Copy)]
enum Load {
    Office,
    Idle,
    Heavy,
    Light,
}

impl Load {
    /// 一個 tick 的 CPU 平均（%）。各負載的期望熱量：文書 5、閒置 2、重度 8、輕度 2.8。
    fn sample(self, rng: &mut Rng) -> f64 {
        let table: &[(f64, f64, f64)] = match self {
            Load::Office => &[(0.10, 0.5, 5.0), (0.40, 5.0, 15.0), (0.40, 15.0, 35.0), (0.10, 35.0, 65.0)],
            Load::Idle => &[(1.0, 0.5, 5.0)],
            Load::Heavy => &[(0.20, 15.0, 35.0), (0.60, 35.0, 65.0), (0.20, 65.0, 100.0)],
            Load::Light => &[(0.60, 0.5, 5.0), (0.40, 5.0, 15.0)],
        };
        let mut r = rng.next_f64();
        for &(weight, lo, hi) in table {
            if r < weight {
                return rng.range(lo, hi);
            }
            r -= weight;
        }
        let &(_, lo, hi) = table.last().unwrap();
        rng.range(lo, hi)
    }
}

struct Scenario {
    key: &'static str,
    title: &'static str,
    detail: &'static str,
    /// 這一分鐘電腦是否清醒、負載如何；`None` 代表關機或休眠
    load: fn(day: u32, minute: u32) -> Option<Load>,
}

fn workday(day: u32, minute: u32, load: Load) -> Option<Load> {
    (day % 7 < 5 && (9 * 60..17 * 60).contains(&minute)).then_some(load)
}

fn office(day: u32, minute: u32) -> Option<Load> {
    workday(day, minute, Load::Office)
}

fn always_on(day: u32, minute: u32) -> Option<Load> {
    Some(workday(day, minute, Load::Office).unwrap_or(Load::Idle))
}

fn vacation(day: u32, minute: u32) -> Option<Load> {
    if (12..=22).contains(&day) { None } else { office(day, minute) }
}

fn heavy(day: u32, minute: u32) -> Option<Load> {
    workday(day, minute, Load::Heavy)
}

fn light(day: u32, minute: u32) -> Option<Load> {
    workday(day, minute, Load::Light)
}

const SCENARIOS: &[Scenario] = &[
    Scenario { key: "office", title: "標準上班週", detail: "平日 9–17 點文書工作，其餘時間休眠", load: office },
    Scenario { key: "always-on", title: "24 小時不關機", detail: "平日 9–17 點文書工作，其餘時間開機閒置", load: always_on },
    Scenario { key: "vacation", title: "長假不在", detail: "同標準上班週，但第 12～22 天（11 天）完全不開機", load: vacation },
    Scenario { key: "heavy", title: "重度運算", detail: "平日 9–17 點高 CPU，其餘時間休眠", load: heavy },
    Scenario { key: "light", title: "輕度使用", detail: "平日 9–17 點低 CPU，其餘時間休眠", load: light },
];

/// 一代寵物的成長紀錄
struct Generation {
    generation: u32,
    family: Family,
    species: Species,
    /// 各階段的開始日
    stages: Vec<(Stage, i32)>,
    legacy_day: Option<i32>,
    /// 各階段的檢查點 ratio，以及通過該檢查點後的體型
    scores: Vec<(Stage, f64, BodyType)>,
    min_energy: u8,
    max_penalty: u8,
    full_days: u32,
    naps: u32,
    last_day_state: (u8, u8),
}

impl Generation {
    fn new(pet: &Pet, day: i32) -> Self {
        Self {
            generation: pet.generation,
            family: pet.family,
            species: pet.species,
            stages: vec![(Stage::Egg, day)],
            legacy_day: None,
            scores: Vec::new(),
            min_energy: pet.energy,
            max_penalty: 0,
            full_days: 0,
            naps: 0,
            last_day_state: (pet.energy, 0),
        }
    }

    /// 記錄事件；回傳是否達到傳承條件
    fn record(&mut self, events: &[Event], day: i32, minute: u32, verbose: bool) -> bool {
        let mut legacy = false;
        for event in events {
            let line = match event {
                Event::Checkpoint { stage, index, ratio, body } => {
                    self.scores.push((*stage, *ratio, *body));
                    Some(format!("{} 檢查點 {index}/4：ratio {ratio:.2}，體型 {}", stage.name(), body.name()))
                }
                Event::Waiting { stage } => Some(format!("{} 熱量已滿，等待最短天數", stage.name())),
                Event::Evolved { to } => {
                    self.stages.push((*to, day));
                    Some(format!("進化為{}", to.name()))
                }
                Event::LegacyReady => {
                    self.legacy_day = Some(day);
                    legacy = true;
                    Some("達到傳承條件".to_string())
                }
                Event::Full => {
                    self.full_days += 1;
                    None
                }
                Event::NapStarted => {
                    self.naps += 1;
                    None
                }
                Event::DayClosed { day: closed, energy, hunger_penalty, .. } => {
                    self.min_energy = self.min_energy.min(*energy);
                    self.max_penalty = self.max_penalty.max(*hunger_penalty);
                    let state = (*energy, *hunger_penalty);
                    let changed = state != self.last_day_state;
                    self.last_day_state = state;
                    changed.then(|| format!("第 {closed} 天結束：活力 {energy}、飢餓扣分 {hunger_penalty}"))
                }
                Event::ClockSkew => Some("時間倒退，略過".to_string()),
            };
            if let (true, Some(line)) = (verbose, line) {
                println!("    {} {:02}:{:02}  {line}", day_label(day), minute / 60, minute % 60);
            }
        }
        legacy
    }

    /// 各階段的天數；最後一個階段若還沒結束則為 `None`
    fn durations(&self) -> Vec<(Stage, i32, Option<i32>)> {
        let ends = self.stages.iter().skip(1).map(|&(_, d)| Some(d)).chain([self.legacy_day]);
        self.stages.iter().zip(ends).map(|(&(stage, start), end)| (stage, start, end.map(|e| e - start))).collect()
    }
}

fn day_label(day: i32) -> String {
    format!("第 {day:>3} 天（{}）", WEEKDAYS[day.rem_euclid(7) as usize])
}

/// 目標節奏：每個階段 7～14 天；成年到傳承 14～21 天
fn in_target(stage: Stage, days: i32) -> bool {
    match stage {
        Stage::Adult => (14..=21).contains(&days),
        _ => (7..=14).contains(&days),
    }
}

fn simulate(scenario: &Scenario, balance: &Balance, days: u32, seed: u64, verbose: bool) -> Vec<Generation> {
    let mut rng = Rng::new(seed);
    let tick_minutes = balance.tick.minutes;
    let mut pet = Pet::new_egg(balance, rng.next_u64(), None, 1, 0, 0);
    let mut generations = vec![Generation::new(&pet, 0)];

    for day in 0..days {
        for tick in 0..balance.ticks_per_day() {
            let minute = tick * tick_minutes;
            let Some(load) = (scenario.load)(day, minute) else { continue };
            let now = (i64::from(day) * 1440 + i64::from(minute)) * 60;
            let input = TickInput { now, day: day as i32, cpu_percent: load.sample(&mut rng), mood: MoodLevel::Normal };
            let events = pet.tick(balance, &input);
            if generations.last_mut().unwrap().record(&events, day as i32, minute, verbose) {
                pet = pet.next_generation(balance, LegacyChoice::Continue, rng.next_u64(), now, day as i32);
                generations.push(Generation::new(&pet, day as i32));
            }
        }
    }
    let end = days as i32;
    let events = pet.catch_up(balance, i64::from(end) * 86_400, end);
    generations.last_mut().unwrap().record(&events, end, 0, verbose);
    generations
}

fn print_generation(g: &Generation, days: u32) {
    println!("  第 {} 代：{}（{}）", g.generation, g.species.name(), g.family.name());
    let mut scores = g.scores.iter().peekable();
    for (stage, start, duration) in g.durations() {
        let mut stage_scores = Vec::new();
        let mut body = None;
        while let Some(&&(s, ratio, b)) = scores.peek() {
            if s != stage {
                break;
            }
            stage_scores.push(format!("{ratio:.2}"));
            body = Some(b);
            scores.next();
        }
        let span = match duration {
            Some(d) => format!("{d:>2} 天{}", if in_target(stage, d) { "  " } else { " ⚠" }),
            None => format!("進行中（{} 天）", days as i32 - start),
        };
        let name = format!("{}{}", stage.name(), if stage.name().chars().count() == 1 { "　" } else { "" });
        let body = match (stage, body) {
            (Stage::Egg, _) | (_, None) => "—".to_string(),
            (_, Some(b)) => b.name().to_string(),
        };
        println!("    {name}  {}  {span}  體型 {body:<4}  ratio {}", day_label(start), stage_scores.join(" "));
    }
    if let Some(day) = g.legacy_day {
        println!("    → 傳承  {}", day_label(day));
    }
    println!(
        "    活力最低 {}／飢餓扣分最高 {}／吃飽睡覺 {} 天／閒置小睡 {} 次",
        g.min_energy, g.max_penalty, g.full_days, g.naps
    );
}

struct Args {
    scenarios: Vec<String>,
    days: u32,
    seed: u64,
    balance: Option<String>,
    verbose: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args { scenarios: Vec::new(), days: 90, seed: 1, balance: None, verbose: false };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().ok_or(format!("{name} 需要一個值"));
        match arg.as_str() {
            "--days" => args.days = value("--days")?.parse().map_err(|_| "--days 必須是正整數")?,
            "--seed" => args.seed = value("--seed")?.parse().map_err(|_| "--seed 必須是整數")?,
            "--balance" => args.balance = Some(value("--balance")?),
            "--verbose" | "-v" => args.verbose = true,
            "--help" | "-h" => return Err(String::new()),
            s if s.starts_with('-') => return Err(format!("不認得的參數：{s}")),
            s => args.scenarios.push(s.to_string()),
        }
    }
    Ok(args)
}

fn usage() {
    eprintln!("用法：deskpet-sim [情境…] [--days N] [--seed N] [--balance 路徑] [--verbose]");
    eprintln!("情境：");
    for s in SCENARIOS {
        eprintln!("  {:<10} {}：{}", s.key, s.title, s.detail);
    }
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(msg) => {
            if !msg.is_empty() {
                eprintln!("{msg}");
            }
            usage();
            return ExitCode::FAILURE;
        }
    };
    let balance = match &args.balance {
        None => Balance::default(),
        Some(path) => match std::fs::read_to_string(path).map_err(|e| e.to_string()).and_then(|t| Balance::from_toml(&t)) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("無法讀取 {path}：{e}");
                return ExitCode::FAILURE;
            }
        },
    };
    let selected: Vec<&Scenario> = if args.scenarios.is_empty() {
        SCENARIOS.iter().collect()
    } else {
        let mut selected = Vec::new();
        for key in &args.scenarios {
            match SCENARIOS.iter().find(|s| s.key == key) {
                Some(s) => selected.push(s),
                None => {
                    eprintln!("沒有這個情境：{key}");
                    usage();
                    return ExitCode::FAILURE;
                }
            }
        }
        selected
    };

    let mut summary = Vec::new();
    for scenario in selected {
        println!("━━ {}（{}）━━", scenario.title, scenario.key);
        println!("  {}；模擬 {} 天，seed {}", scenario.detail, args.days, args.seed);
        let generations = simulate(scenario, &balance, args.days, args.seed, args.verbose);
        for g in &generations {
            print_generation(g, args.days);
        }
        println!();
        summary.push((scenario.title, generations));
    }

    println!("━━ 摘要：第 1 代各階段天數（蛋／幼年／少年／成年）與傳承時體型 ━━");
    for (title, generations) in &summary {
        let g = &generations[0];
        let spans: Vec<String> = g
            .durations()
            .iter()
            .map(|(stage, _, d)| match d {
                Some(d) if in_target(*stage, *d) => format!("{d}"),
                Some(d) => format!("{d}⚠"),
                None => "…".to_string(),
            })
            .collect();
        let body = g.scores.last().map_or("—", |s| s.2.name());
        println!("  {title}：{}；體型 {body}；活力最低 {}", spans.join(" / "), g.min_energy);
    }
    ExitCode::SUCCESS
}
