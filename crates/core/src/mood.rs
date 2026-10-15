//! 心情：記憶體壓力的 EMA 平滑（DESIGN.md §7）。
//!
//! 壓力指數（0～1）由平台層換算，這裡只負責平滑和分級。

use crate::balance::Balance;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MoodLevel {
    Happy,
    Normal,
    Tense,
    Depressed,
}

impl MoodLevel {
    pub fn index(self) -> usize {
        self as usize
    }

    pub fn name(self) -> &'static str {
        match self {
            MoodLevel::Happy => "愉悅",
            MoodLevel::Normal => "普通",
            MoodLevel::Tense => "緊張",
            MoodLevel::Depressed => "沮喪",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct MoodEngine {
    ema: Option<f64>,
}

impl MoodEngine {
    /// 從存檔還原
    pub fn with_ema(ema: f64) -> Self {
        Self { ema: Some(ema.clamp(0.0, 1.0)) }
    }

    /// 加入一個樣本。`dt_secs` 是距離上一個樣本的秒數；休眠後的大間隔會讓 EMA 直接接近新值。
    pub fn sample(&mut self, balance: &Balance, pressure: f64, dt_secs: f64) {
        let p = pressure.clamp(0.0, 1.0);
        self.ema = Some(match self.ema {
            None => p,
            Some(prev) => {
                let tau = balance.mood.ema_minutes * 60.0;
                let alpha = 1.0 - (-dt_secs.max(0.0) / tau).exp();
                prev + alpha * (p - prev)
            }
        });
    }

    pub fn ema(&self) -> Option<f64> {
        self.ema
    }

    pub fn level(&self, balance: &Balance) -> MoodLevel {
        let Some(ema) = self.ema else { return MoodLevel::Normal };
        let [happy, normal, tense] = balance.mood.pressure_bounds;
        if ema < happy {
            MoodLevel::Happy
        } else if ema < normal {
            MoodLevel::Normal
        } else if ema < tense {
            MoodLevel::Tense
        } else {
            MoodLevel::Depressed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ema_follows_pressure_with_ten_minute_time_constant() {
        let b = Balance::default();
        let mut m = MoodEngine::default();
        assert_eq!(m.level(&b), MoodLevel::Normal);
        m.sample(&b, 0.1, 10.0);
        assert_eq!(m.level(&b), MoodLevel::Happy);
        // 10 分鐘（一個時間常數）後大約走了 63%
        for _ in 0..60 {
            m.sample(&b, 0.9, 10.0);
        }
        let ema = m.ema().unwrap();
        assert!((ema - (0.1 + 0.8 * 0.632)).abs() < 0.01, "{ema}");
        assert_eq!(m.level(&b), MoodLevel::Normal);
        for _ in 0..360 {
            m.sample(&b, 0.9, 10.0);
        }
        assert_eq!(m.level(&b), MoodLevel::Depressed);
    }
}
