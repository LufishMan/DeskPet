//! 把每 10 秒的取樣累積成 5 分鐘的 tick，並用實際時間差偵測休眠（DESIGN.md §2、§4.1）。

use crate::balance::Balance;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    /// Unix 秒
    pub now: i64,
    /// 這次取樣期間的整體 CPU（%），已扣掉本程式
    pub cpu_percent: f64,
    /// 本程式（含 WebView 子程序）的 CPU（%）
    pub self_percent: f64,
    /// 記憶體壓力指數 0～1
    pub pressure: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TickSummary {
    pub start: i64,
    pub end: i64,
    pub cpu_avg: f64,
    pub self_avg: f64,
    pub pressure_avg: f64,
    pub samples: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SampleOutcome {
    Pending,
    Tick(TickSummary),
    /// 和上一個樣本間隔過長（休眠）或時間倒退：丟棄未完成的 tick，從這次重新開始
    Gap { last: i64, now: i64 },
}

#[derive(Debug, Clone)]
pub struct TickAccumulator {
    tick_secs: i64,
    max_gap_secs: i64,
    start: i64,
    last: Option<i64>,
    cpu_sum: f64,
    self_sum: f64,
    pressure_sum: f64,
    samples: u32,
}

impl TickAccumulator {
    pub fn new(balance: &Balance) -> Self {
        Self {
            tick_secs: i64::from(balance.tick.minutes) * 60,
            max_gap_secs: 3 * i64::from(balance.tick.sample_seconds),
            start: 0,
            last: None,
            cpu_sum: 0.0,
            self_sum: 0.0,
            pressure_sum: 0.0,
            samples: 0,
        }
    }

    /// 丟棄未完成的 tick，例如收到即將休眠的通知時。
    pub fn reset(&mut self) {
        self.last = None;
    }

    /// 加入一個樣本。樣本只在和上一個樣本間隔正常時才計入，
    /// 所以第一個樣本和休眠後的第一個樣本只當作新的起點。
    pub fn push(&mut self, sample: &Sample) -> SampleOutcome {
        let Some(last) = self.last else {
            self.begin(sample.now);
            return SampleOutcome::Pending;
        };
        let gap = sample.now - last;
        if !(0..=self.max_gap_secs).contains(&gap) {
            self.begin(sample.now);
            return SampleOutcome::Gap { last, now: sample.now };
        }
        self.last = Some(sample.now);
        self.cpu_sum += sample.cpu_percent;
        self.self_sum += sample.self_percent;
        self.pressure_sum += sample.pressure;
        self.samples += 1;
        if sample.now - self.start < self.tick_secs {
            return SampleOutcome::Pending;
        }
        let n = f64::from(self.samples);
        let summary = TickSummary {
            start: self.start,
            end: sample.now,
            cpu_avg: self.cpu_sum / n,
            self_avg: self.self_sum / n,
            pressure_avg: self.pressure_sum / n,
            samples: self.samples,
        };
        self.begin(sample.now);
        SampleOutcome::Tick(summary)
    }

    fn begin(&mut self, now: i64) {
        self.start = now;
        self.last = Some(now);
        self.cpu_sum = 0.0;
        self.self_sum = 0.0;
        self.pressure_sum = 0.0;
        self.samples = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(now: i64, cpu: f64) -> Sample {
        Sample { now, cpu_percent: cpu, self_percent: 0.1, pressure: 0.5 }
    }

    #[test]
    fn thirty_samples_make_a_tick() {
        let mut acc = TickAccumulator::new(&Balance::default());
        assert_eq!(acc.push(&sample(1000, 99.0)), SampleOutcome::Pending); // 起點，不計入
        for i in 1..30 {
            assert_eq!(acc.push(&sample(1000 + i * 10, 20.0)), SampleOutcome::Pending);
        }
        let SampleOutcome::Tick(t) = acc.push(&sample(1300, 20.0)) else { panic!("應該產生 tick") };
        assert_eq!((t.start, t.end, t.samples), (1000, 1300, 30));
        assert!((t.cpu_avg - 20.0).abs() < 1e-9);
        // 下一個 tick 從 1300 開始
        for i in 1..30 {
            acc.push(&sample(1300 + i * 10, 10.0));
        }
        assert!(matches!(acc.push(&sample(1600, 10.0)), SampleOutcome::Tick(t) if t.start == 1300));
    }

    #[test]
    fn sleep_gap_discards_partial_tick() {
        let mut acc = TickAccumulator::new(&Balance::default());
        for i in 0..20 {
            acc.push(&sample(i * 10, 20.0));
        }
        assert_eq!(acc.push(&sample(5000, 20.0)), SampleOutcome::Gap { last: 190, now: 5000 });
        // 重新開始後要再累積滿 5 分鐘
        for i in 1..30 {
            assert_eq!(acc.push(&sample(5000 + i * 10, 20.0)), SampleOutcome::Pending);
        }
        assert!(matches!(acc.push(&sample(5300, 20.0)), SampleOutcome::Tick(t) if t.start == 5000));
    }

    #[test]
    fn clock_going_backwards_is_a_gap() {
        let mut acc = TickAccumulator::new(&Balance::default());
        acc.push(&sample(1000, 20.0));
        acc.push(&sample(1010, 20.0));
        assert!(matches!(acc.push(&sample(900, 20.0)), SampleOutcome::Gap { .. }));
    }

    #[test]
    fn reset_restarts_without_gap_event() {
        let mut acc = TickAccumulator::new(&Balance::default());
        acc.push(&sample(0, 20.0));
        acc.push(&sample(10, 20.0));
        acc.reset();
        assert_eq!(acc.push(&sample(9999, 20.0)), SampleOutcome::Pending);
    }
}
