//! 寵物狀態與 tick 結算：養分、成長、體型、活力、傳承（DESIGN.md §4～§6、§12）。

use serde::{Deserialize, Serialize};

use crate::balance::{Balance, StageRule};
use crate::mood::MoodLevel;
use crate::species::{EggRoll, Family, Species};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Egg,
    Baby,
    Juvenile,
    Adult,
}

impl Stage {
    pub fn index(self) -> usize {
        self as usize
    }

    pub fn next(self) -> Option<Stage> {
        match self {
            Stage::Egg => Some(Stage::Baby),
            Stage::Baby => Some(Stage::Juvenile),
            Stage::Juvenile => Some(Stage::Adult),
            Stage::Adult => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Stage::Egg => "蛋",
            Stage::Baby => "幼年",
            Stage::Juvenile => "少年",
            Stage::Adult => "成年",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BodyType {
    VeryThin,
    Thin,
    Standard,
    Fat,
    VeryFat,
}

impl BodyType {
    const ALL: [BodyType; 5] = [BodyType::VeryThin, BodyType::Thin, BodyType::Standard, BodyType::Fat, BodyType::VeryFat];

    fn from_level(level: i32) -> Self {
        Self::ALL[level.clamp(0, 4) as usize]
    }

    pub fn name(self) -> &'static str {
        match self {
            BodyType::VeryThin => "很瘦",
            BodyType::Thin => "瘦",
            BodyType::Standard => "標準",
            BodyType::Fat => "胖",
            BodyType::VeryFat => "很胖",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyChoice {
    /// 延續血脈：繼承科別，世代 +1
    Continue,
    /// 開新血脈：科別隨機，世代從 1 起算
    NewLineage,
}

/// 一個 tick 的輸入。時間由呼叫端提供，核心不讀時鐘。
#[derive(Debug, Clone, Copy)]
pub struct TickInput {
    /// 實際時間（Unix 秒）
    pub now: i64,
    /// 當地日曆日的序號（例如自 1970-01-01 起算的天數）
    pub day: i32,
    /// 這個 tick 的整體 CPU 平均（%），已扣掉本程式自己的用量
    pub cpu_percent: f64,
    pub mood: MoodLevel,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// 通過隱藏檢查點；`index` 為 1～4
    Checkpoint { stage: Stage, index: u8, ratio: f64, body: BodyType },
    /// 熱量已達門檻，等待最短天數
    Waiting { stage: Stage },
    Evolved { to: Stage },
    /// 成年後達到傳承條件，等待使用者選擇
    LegacyReady,
    /// 今天的熱量達到上限，進入「吃飽睡覺」
    Full,
    /// CPU 長時間閒置，進入「閒置小睡」
    NapStarted,
    /// 一個日曆日結束
    DayClosed { day: i32, active: bool, energy: u8, hunger_penalty: u8 },
    /// 時間倒退，這個 tick 不結算（§14.3 R11）
    ClockSkew,
}

/// 寵物的完整狀態。存檔時整個序列化成 JSON；新增欄位時要加 `#[serde(default)]` 以相容舊存檔。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pet {
    pub generation: u32,
    pub egg_seed: u64,
    pub family: Family,
    pub species: Species,
    pub hue_shift: u8,
    pub rare: bool,

    pub stage: Stage,
    /// 目前階段已通過的檢查點數（0～4）
    pub checkpoints_passed: u8,
    pub stage_entered_day: i32,
    pub total_calories: f64,
    pub stage_calories: f64,
    pub daily_calories: f64,
    /// 目前結算中的日曆日
    pub current_day: i32,
    /// 目前小階段已計入的 tick 數
    pub sub_stage_ticks: u32,
    pub waiting: bool,
    pub legacy_ready: bool,

    /// 最近 4 個檢查點的 ratio，舊 → 新
    pub checkpoint_history: Vec<f64>,
    /// 連續閒置的 tick 數（閒置小睡用）
    pub idle_streak: u32,
    pub hunger_penalty: u8,
    pub energy: u8,
    /// 連續不活躍的日曆日數
    pub inactive_streak: u32,

    pub active_ticks: u64,
    pub today_active_ticks: u32,
    pub last_active_day: Option<i32>,
    pub last_tick_ts: Option<i64>,
    pub created_at: i64,
    pub hatched_at: Option<i64>,
}

impl Pet {
    pub fn new_egg(balance: &Balance, seed: u64, family: Option<Family>, generation: u32, now: i64, day: i32) -> Self {
        let roll = EggRoll::roll(seed, family);
        Self {
            generation,
            egg_seed: seed,
            family: roll.family,
            species: roll.species,
            hue_shift: roll.hue_shift,
            rare: roll.rare,
            stage: Stage::Egg,
            checkpoints_passed: 0,
            stage_entered_day: day,
            total_calories: 0.0,
            stage_calories: 0.0,
            daily_calories: 0.0,
            current_day: day,
            sub_stage_ticks: 0,
            waiting: false,
            legacy_ready: false,
            checkpoint_history: Vec::new(),
            idle_streak: 0,
            hunger_penalty: 0,
            energy: balance.energy.max,
            inactive_streak: 0,
            active_ticks: 0,
            today_active_ticks: 0,
            last_active_day: None,
            last_tick_ts: None,
            created_at: now,
            hatched_at: None,
        }
    }

    /// 傳承：產生下一顆蛋。呼叫端負責讓親代退休。
    pub fn next_generation(&self, balance: &Balance, choice: LegacyChoice, seed: u64, now: i64, day: i32) -> Pet {
        match choice {
            LegacyChoice::Continue => Pet::new_egg(balance, seed, Some(self.family), self.generation + 1, now, day),
            LegacyChoice::NewLineage => Pet::new_egg(balance, seed, None, 1, now, day),
        }
    }

    pub fn days_in_stage(&self) -> i32 {
        self.current_day - self.stage_entered_day
    }

    /// 最近 4 個檢查點 ratio 的加權平均（§5）；還沒有檢查點時為 `None`。
    /// 權重對齊最新的檢查點，不足 4 個時只用現有的。
    pub fn body_ratio(&self, balance: &Balance) -> Option<f64> {
        let history = &self.checkpoint_history;
        if history.is_empty() {
            return None;
        }
        let weights = &balance.body.weights[balance.body.weights.len() - history.len()..];
        let total: f64 = weights.iter().map(|&w| f64::from(w)).sum();
        let sum: f64 = history.iter().zip(weights).map(|(r, &w)| r * f64::from(w)).sum();
        Some(sum / total)
    }

    /// 顯示用的體型：依加權平均 ratio 對應，再扣掉飢餓扣分（§6）。
    pub fn body_type(&self, balance: &Balance) -> BodyType {
        let [very_fat, fat, standard, thin] = balance.body.ratio_bounds;
        let level = match self.body_ratio(balance) {
            None => 2,
            Some(r) if r < very_fat => 4,
            Some(r) if r < fat => 3,
            Some(r) if r <= standard => 2,
            Some(r) if r <= thin => 1,
            Some(_) => 0,
        };
        BodyType::from_level(level - i32::from(self.hunger_penalty))
    }

    /// 結算一個活躍 tick。
    pub fn tick(&mut self, balance: &Balance, input: &TickInput) -> Vec<Event> {
        let mut events = Vec::new();
        if input.day < self.current_day || self.last_tick_ts.is_some_and(|t| input.now < t) {
            events.push(Event::ClockSkew);
            return events;
        }
        self.roll_days(balance, input.now, input.day, &mut events);
        // 中間有休眠（漏了 tick）時，閒置計數重來
        let tick_secs = i64::from(balance.tick.minutes) * 60;
        if self.last_tick_ts.is_some_and(|t| input.now - t > 2 * tick_secs) {
            self.idle_streak = 0;
        }
        self.last_tick_ts = Some(input.now);
        self.active_ticks += 1;
        self.today_active_ticks += 1;
        self.try_finish_stage(balance, input.now, &mut events);

        if input.cpu_percent < balance.nap.idle_cpu_below {
            self.idle_streak += 1;
            if self.idle_streak == balance.nap.after_ticks + 1 {
                events.push(Event::NapStarted);
            }
        } else {
            self.idle_streak = 0;
        }

        // 等待期、等待傳承、吃飽睡覺、閒置小睡：不結算熱量，也不計入體型判斷
        let cap = balance.calories.daily_cap;
        if self.waiting || self.legacy_ready || self.daily_calories >= cap || self.is_napping(balance) {
            return events;
        }

        let threshold = self.stage_rule(balance).calories;
        let gain = balance.calories_for(input.cpu_percent)
            * balance.mood.multipliers[input.mood.index()]
            * self.energy_multiplier(balance);
        let gain = gain.min(cap - self.daily_calories).min(threshold - self.stage_calories);
        self.daily_calories += gain;
        self.stage_calories += gain;
        self.total_calories += gain;
        self.sub_stage_ticks += 1;
        if self.daily_calories >= cap {
            events.push(Event::Full);
        }

        let quarter = threshold / 4.0;
        let reached = ((self.stage_calories / quarter + 1e-9).floor() as u8).min(4);
        while self.checkpoints_passed < reached {
            self.pass_checkpoint(balance, quarter, &mut events);
        }
        self.try_finish_stage(balance, input.now, &mut events);
        events
    }

    /// 程式啟動或從休眠喚醒時呼叫，先結算期間經過的日曆日（§6）。
    pub fn catch_up(&mut self, balance: &Balance, now: i64, day: i32) -> Vec<Event> {
        let mut events = Vec::new();
        self.roll_days(balance, now, day, &mut events);
        events
    }

    pub fn is_napping(&self, balance: &Balance) -> bool {
        self.idle_streak > balance.nap.after_ticks
    }

    fn stage_rule<'a>(&self, balance: &'a Balance) -> &'a StageRule {
        &balance.stages[self.stage.index()]
    }

    fn energy_multiplier(&self, balance: &Balance) -> f64 {
        if self.energy <= balance.energy.low_threshold { balance.energy.low_multiplier } else { 1.0 }
    }

    fn roll_days(&mut self, balance: &Balance, now: i64, day: i32, events: &mut Vec<Event>) {
        if day <= self.current_day {
            return;
        }
        while self.current_day < day {
            self.close_day(balance, events);
            self.current_day += 1;
            self.today_active_ticks = 0;
            self.daily_calories = 0.0;
        }
        self.try_finish_stage(balance, now, events);
    }

    fn close_day(&mut self, balance: &Balance, events: &mut Vec<Event>) {
        let rules = &balance.energy;
        let active = self.today_active_ticks >= rules.active_day_min_ticks;
        if active {
            self.inactive_streak = 0;
            self.energy = (self.energy + 1).min(rules.max);
            self.last_active_day = Some(self.current_day);
        } else {
            self.inactive_streak += 1;
            if self.inactive_streak > rules.grace_days {
                self.energy = self.energy.saturating_sub(1).max(1);
                // 超過寬限的第 2 天起，每 penalty_every_days 天飢餓扣分 +1
                let over = self.inactive_streak - rules.grace_days;
                if over >= 2 && (over - 2).is_multiple_of(rules.penalty_every_days) {
                    self.hunger_penalty = (self.hunger_penalty + 1).min(balance.body.max_hunger_penalty);
                }
            }
        }
        events.push(Event::DayClosed {
            day: self.current_day,
            active,
            energy: self.energy,
            hunger_penalty: self.hunger_penalty,
        });
    }

    fn pass_checkpoint(&mut self, balance: &Balance, quarter: f64, events: &mut Vec<Event>) {
        let expected = quarter / balance.calories.standard_rate;
        let ratio = f64::from(self.sub_stage_ticks) / expected;
        self.checkpoint_history.push(ratio);
        if self.checkpoint_history.len() > balance.body.weights.len() {
            self.checkpoint_history.remove(0);
        }
        self.hunger_penalty = self.hunger_penalty.saturating_sub(1);
        self.sub_stage_ticks = 0;
        self.checkpoints_passed += 1;
        events.push(Event::Checkpoint {
            stage: self.stage,
            index: self.checkpoints_passed,
            ratio,
            body: self.body_type(balance),
        });
    }

    /// 熱量已滿時：天數夠就進化（或達到傳承條件），不夠就進入等待期。
    fn try_finish_stage(&mut self, balance: &Balance, now: i64, events: &mut Vec<Event>) {
        if self.checkpoints_passed < 4 || self.legacy_ready {
            return;
        }
        if self.days_in_stage() < self.stage_rule(balance).min_days as i32 {
            if !self.waiting {
                self.waiting = true;
                events.push(Event::Waiting { stage: self.stage });
            }
            return;
        }
        self.waiting = false;
        match self.stage.next() {
            Some(next) => {
                self.stage = next;
                self.stage_entered_day = self.current_day;
                self.stage_calories = 0.0;
                self.checkpoints_passed = 0;
                self.sub_stage_ticks = 0;
                if next == Stage::Baby {
                    self.hatched_at = Some(now);
                }
                events.push(Event::Evolved { to: next });
            }
            None => {
                self.legacy_ready = true;
                events.push(Event::LegacyReady);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TICK_SECS: i64 = 300;

    fn input(day: i32, tick: u32, cpu: f64) -> TickInput {
        TickInput {
            now: i64::from(day) * 86_400 + i64::from(tick) * TICK_SECS,
            day,
            cpu_percent: cpu,
            mood: MoodLevel::Normal,
        }
    }

    /// 在指定日子裡跑 `ticks` 個 tick，回傳所有事件與發生的日子
    fn run(pet: &mut Pet, b: &Balance, days: impl IntoIterator<Item = i32>, ticks: u32, cpu: f64) -> Vec<(i32, Event)> {
        let mut out = Vec::new();
        for day in days {
            for t in 0..ticks {
                out.extend(pet.tick(b, &input(day, t, cpu)).into_iter().map(|e| (day, e)));
            }
        }
        out
    }

    fn weekdays(weeks: i32) -> impl Iterator<Item = i32> {
        (0..weeks * 7).filter(|d| d % 7 < 5)
    }

    #[test]
    fn egg_waits_for_min_days_then_hatches() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        // 15–35% → 6 熱量 × 96 tick = 576 / 天，第 4 天（週五）就滿 2400
        let events = run(&mut pet, &b, weekdays(2), 96, 20.0);
        let waiting_day = events.iter().find(|(_, e)| matches!(e, Event::Waiting { .. })).unwrap().0;
        let hatch_day = events.iter().find(|(_, e)| matches!(e, Event::Evolved { to: Stage::Baby })).unwrap().0;
        assert_eq!(waiting_day, 4);
        assert_eq!(hatch_day, 7);
        assert!(pet.hatched_at.is_some());
    }

    #[test]
    fn waiting_ticks_are_not_counted() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        run(&mut pet, &b, 0..5, 96, 20.0);
        assert!(pet.waiting);
        let before = (pet.total_calories, pet.sub_stage_ticks);
        run(&mut pet, &b, 5..7, 96, 20.0);
        assert_eq!((pet.total_calories, pet.sub_stage_ticks), before);
        assert_eq!(pet.stage, Stage::Egg);
    }

    #[test]
    fn daily_cap_stops_counting() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        // >65% → 10 熱量，72 tick 就達到 720；之後的 tick 仍算活躍，但不結算
        let events = run(&mut pet, &b, [0], 288, 90.0);
        assert_eq!(pet.daily_calories, 720.0);
        assert_eq!(events.iter().filter(|(_, e)| *e == Event::Full).count(), 1);
        assert_eq!(pet.active_ticks, 288);
    }

    #[test]
    fn long_absence_drains_energy_and_body() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        run(&mut pet, &b, [0], 96, 10.0);
        // 第 1～11 天完全沒開機，第 12 天回來
        pet.catch_up(&b, 12 * 86_400, 12);
        assert_eq!(pet.inactive_streak, 11);
        assert_eq!(pet.energy, 1); // 第 5～11 天各 −1，最低 1
        assert_eq!(pet.hunger_penalty, 3); // 第 6、8、10 天
        assert_eq!(pet.body_type(&b), BodyType::VeryThin);
        // 回來後每個活躍日活力 +1
        run(&mut pet, &b, 12..15, 96, 10.0);
        pet.catch_up(&b, 15 * 86_400, 15);
        assert_eq!(pet.energy, 4);
    }

    #[test]
    fn low_energy_reduces_absorption() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        pet.energy = 2;
        run(&mut pet, &b, [0], 1, 10.0);
        assert!((pet.total_calories - 4.0 * 0.8).abs() < 1e-9);
    }

    #[test]
    fn four_day_absence_is_free() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        run(&mut pet, &b, [0], 96, 10.0);
        pet.catch_up(&b, 5 * 86_400, 5);
        assert_eq!((pet.energy, pet.hunger_penalty), (5, 0));
    }

    #[test]
    fn clock_going_backwards_is_ignored() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        run(&mut pet, &b, [3], 10, 10.0);
        let calories = pet.total_calories;
        assert_eq!(pet.tick(&b, &input(3, 0, 10.0)), vec![Event::ClockSkew]);
        assert_eq!(pet.tick(&b, &input(2, 50, 10.0)), vec![Event::ClockSkew]);
        assert_eq!(pet.total_calories, calories);
    }

    #[test]
    fn body_ratio_mapping() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        let cases: [(&[f64], u8, BodyType); 8] = [
            (&[], 0, BodyType::Standard),
            (&[0.6, 0.6, 0.6, 0.6], 0, BodyType::VeryFat),
            (&[0.8, 0.8, 0.8, 0.8], 0, BodyType::Fat),
            (&[1.0, 1.0, 1.0, 1.0], 0, BodyType::Standard),
            (&[1.3, 1.3, 1.3, 1.3], 0, BodyType::Thin),
            (&[2.0, 2.0, 2.0, 2.0], 0, BodyType::VeryThin),
            // 加權 (1×1.0 + 1×1.0 + 2×1.0 + 3×0.6) / 7 ≈ 0.83 → 胖
            (&[1.0, 1.0, 1.0, 0.6], 0, BodyType::Fat),
            (&[1.0, 1.0, 1.0, 1.0], 2, BodyType::VeryThin),
        ];
        for (history, penalty, expected) in cases {
            pet.checkpoint_history = history.to_vec();
            pet.hunger_penalty = penalty;
            assert_eq!(pet.body_type(&b), expected, "{history:?} −{penalty}");
        }
    }

    #[test]
    fn heavy_use_gets_fat_light_use_gets_thin() {
        let b = Balance::default();
        let mut heavy = Pet::new_egg(&b, 1, None, 1, 0, 0);
        run(&mut heavy, &b, weekdays(2), 96, 50.0); // 8 熱量 / tick
        assert!(heavy.body_type(&b) > BodyType::Standard);

        let mut light = Pet::new_egg(&b, 1, None, 1, 0, 0);
        run(&mut light, &b, weekdays(3), 96, 10.0); // 4 熱量 / tick → ratio 1.25
        assert_eq!(light.body_type(&b), BodyType::Thin);
    }

    #[test]
    fn long_idle_naps_without_counting() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 1, None, 1, 0, 0);
        let events = run(&mut pet, &b, [0], 96, 2.0);
        assert_eq!(events.iter().filter(|(_, e)| *e == Event::NapStarted).count(), 1);
        // 前 12 個閒置 tick 照常結算，之後小睡
        assert_eq!(pet.total_calories, 24.0);
        assert_eq!(pet.today_active_ticks, 96);
        assert!(pet.is_napping(&b));
        // 有負載的 tick 叫醒寵物
        pet.tick(&b, &input(0, 96, 20.0));
        assert!(!pet.is_napping(&b));
        assert_eq!(pet.total_calories, 30.0);
    }

    #[test]
    fn full_lifecycle_and_legacy() {
        let b = Balance::default();
        let mut pet = Pet::new_egg(&b, 7, None, 1, 0, 0);
        let events = run(&mut pet, &b, weekdays(12), 96, 10.0);
        let stages: Vec<Stage> = events
            .iter()
            .filter_map(|(_, e)| match e {
                Event::Evolved { to } => Some(*to),
                _ => None,
            })
            .collect();
        assert_eq!(stages, [Stage::Baby, Stage::Juvenile, Stage::Adult]);
        assert!(pet.legacy_ready);

        let child = pet.next_generation(&b, LegacyChoice::Continue, 99, 0, 84);
        assert_eq!((child.family, child.generation, child.stage), (pet.family, 2, Stage::Egg));
        let fresh = pet.next_generation(&b, LegacyChoice::NewLineage, 99, 0, 84);
        assert_eq!(fresh.generation, 1);
    }
}
