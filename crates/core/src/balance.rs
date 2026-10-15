//! 平衡數值（`balance.toml`）。所有可調的數字都集中在這裡。

use serde::Deserialize;

const DEFAULT_TOML: &str = include_str!("../../../balance.toml");

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Balance {
    pub tick: TickRules,
    pub calories: CalorieRules,
    /// 依序為：蛋、幼年、少年、成年
    pub stages: [StageRule; 4],
    pub nap: NapRules,
    pub body: BodyRules,
    pub energy: EnergyRules,
    pub mood: MoodRules,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TickRules {
    /// 一個 tick 的長度（分鐘）
    pub minutes: u32,
    /// CPU / 記憶體取樣間隔（秒）
    pub sample_seconds: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalorieRules {
    /// 依 `cpu_below` 由小到大排列
    pub bands: Vec<CalorieBand>,
    pub standard_rate: f64,
    pub daily_cap: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalorieBand {
    pub cpu_below: f64,
    pub calories: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageRule {
    pub calories: f64,
    pub min_days: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NapRules {
    pub idle_cpu_below: f64,
    /// 連續閒置幾個 tick 後開始小睡
    pub after_ticks: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BodyRules {
    /// 最近 4 個檢查點 ratio 的權重，舊 → 新
    pub weights: [u32; 4],
    /// 加權平均 ratio 的分界：很胖｜胖｜標準｜瘦｜很瘦
    pub ratio_bounds: [f64; 4],
    pub max_hunger_penalty: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnergyRules {
    pub max: u8,
    pub grace_days: u32,
    pub penalty_every_days: u32,
    pub low_threshold: u8,
    pub low_multiplier: f64,
    pub active_day_min_ticks: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodRules {
    pub ema_minutes: f64,
    /// 壓力指數（0～1）的分界：愉悅／普通、普通／緊張、緊張／沮喪
    pub pressure_bounds: [f64; 3],
    /// 愉悅、普通、緊張、沮喪
    pub multipliers: [f64; 4],
}

impl Balance {
    pub fn from_toml(text: &str) -> Result<Self, String> {
        let balance: Balance = toml::from_str(text).map_err(|e| e.to_string())?;
        balance.validate()?;
        Ok(balance)
    }

    pub fn validate(&self) -> Result<(), String> {
        let check = |ok: bool, msg: &str| if ok { Ok(()) } else { Err(msg.to_string()) };

        check(self.tick.minutes > 0 && 1440 % self.tick.minutes == 0, "tick.minutes 必須整除 1440")?;
        check(self.tick.sample_seconds > 0, "tick.sample_seconds 必須大於 0")?;

        let bands = &self.calories.bands;
        check(!bands.is_empty(), "calories.bands 不能是空的")?;
        check(bands.windows(2).all(|w| w[0].cpu_below < w[1].cpu_below), "calories.bands 必須依 cpu_below 遞增")?;
        check(bands.iter().all(|b| b.calories > 0.0), "calories.bands 的熱量必須大於 0")?;
        check(bands.last().is_some_and(|b| b.cpu_below > 100.0), "最後一個 calories.band 的 cpu_below 必須大於 100")?;
        check(self.calories.standard_rate > 0.0, "calories.standard_rate 必須大於 0")?;
        check(self.calories.daily_cap > 0.0, "calories.daily_cap 必須大於 0")?;

        check(self.stages.iter().all(|s| s.calories > 0.0), "stages 的熱量必須大於 0")?;

        check(self.nap.idle_cpu_below >= 0.0, "nap.idle_cpu_below 不能小於 0")?;

        let body = &self.body;
        check(body.weights.iter().all(|w| *w > 0), "body.weights 必須大於 0")?;
        check(
            body.ratio_bounds[0] > 0.0 && body.ratio_bounds.windows(2).all(|w| w[0] < w[1]),
            "body.ratio_bounds 必須大於 0 且遞增",
        )?;

        let energy = &self.energy;
        check(energy.max >= 1, "energy.max 至少為 1")?;
        check(energy.low_threshold <= energy.max, "energy.low_threshold 不能大於 max")?;
        check(energy.penalty_every_days >= 1, "energy.penalty_every_days 至少為 1")?;
        check(energy.low_multiplier > 0.0, "energy.low_multiplier 必須大於 0")?;

        let mood = &self.mood;
        check(mood.ema_minutes > 0.0, "mood.ema_minutes 必須大於 0")?;
        check(
            mood.pressure_bounds.windows(2).all(|w| w[0] < w[1])
                && mood.pressure_bounds.iter().all(|b| (0.0..=1.0).contains(b)),
            "mood.pressure_bounds 必須在 0～1 之間且遞增",
        )?;
        check(mood.multipliers.iter().all(|m| *m > 0.0), "mood.multipliers 必須大於 0")?;
        Ok(())
    }

    /// 依 CPU 平均（%）查出每個 tick 的基礎熱量（§4.2）。
    pub fn calories_for(&self, cpu_percent: f64) -> f64 {
        let bands = &self.calories.bands;
        bands
            .iter()
            .find(|b| cpu_percent < b.cpu_below)
            .unwrap_or(&bands[bands.len() - 1])
            .calories
    }

    pub fn ticks_per_day(&self) -> u32 {
        1440 / self.tick.minutes
    }
}

impl Default for Balance {
    fn default() -> Self {
        Self::from_toml(DEFAULT_TOML).expect("內建的 balance.toml 有誤")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_balance_is_valid() {
        let b = Balance::default();
        assert_eq!(b.ticks_per_day(), 288);
        assert_eq!(b.stages[0].calories, 2400.0);
    }

    #[test]
    fn calorie_bands_match_design() {
        let b = Balance::default();
        assert_eq!(b.calories_for(0.0), 2.0);
        assert_eq!(b.calories_for(4.99), 2.0);
        assert_eq!(b.calories_for(5.0), 4.0);
        assert_eq!(b.calories_for(34.9), 6.0);
        assert_eq!(b.calories_for(64.9), 8.0);
        assert_eq!(b.calories_for(65.0), 10.0);
        assert_eq!(b.calories_for(100.0), 10.0);
    }

    #[test]
    fn rejects_unknown_fields_and_bad_values() {
        let good = DEFAULT_TOML;
        assert!(Balance::from_toml(&good.replace("[tick]", "[tick]\nbogus = 1")).is_err());
        assert!(Balance::from_toml(&good.replace("[0.70, 0.85, 1.20, 1.50]", "[0.70, 0.85, 1.60, 1.50]")).is_err());
    }
}
