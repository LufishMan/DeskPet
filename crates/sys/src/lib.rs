//! DeskPet 平台層（DESIGN.md §2、§14.2）。
//!
//! 只讀取整體 CPU、整體記憶體和本程式自己的用量；不列舉、不開啟其他程序，
//! 不讀取視窗、鍵盤或滑鼠。Windows 以外的平台目前只有退而求其次的實作。

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{SystemSampler, harden_dll_search, local_now, memory, subscribe_power, PowerSubscription};

#[cfg(not(windows))]
mod fallback;
#[cfg(not(windows))]
pub use fallback::{SystemSampler, harden_dll_search, local_now, memory, subscribe_power, PowerSubscription};

/// 一次 CPU 取樣（與上一次取樣之間的平均）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CpuReading {
    /// 整體 CPU 使用率（%）
    pub busy_percent: f64,
    /// 本程式（含子程序）佔整體 CPU 的比例（%）
    pub self_percent: f64,
}

impl CpuReading {
    /// 扣掉本程式之後的整體 CPU（%），作為養分來源（§4.1）
    pub fn adjusted(&self) -> f64 {
        (self.busy_percent - self.self_percent).max(0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryReading {
    /// 實體記憶體負載 0～1（Windows 的 dwMemoryLoad，不含可回收的快取）
    pub physical_load: f64,
    /// 已認可記憶體（commit charge）佔上限的比例 0～1
    pub commit_load: f64,
}

impl MemoryReading {
    /// 心情用的記憶體壓力指數 0～1（§7）；分界在 balance.toml 校準
    pub fn pressure(&self) -> f64 {
        self.physical_load.max(self.commit_load).clamp(0.0, 1.0)
    }
}

/// 本程式自己的 CPU 用量從哪裡來
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfCpuSource {
    /// Job Object：包含 WebView 等子程序
    Job,
    /// 只有主程序
    Process,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerEvent {
    Suspend,
    Resume,
}

/// 當地時間
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalTime {
    /// 當地日曆日的序號（自 1970-01-01 起算）
    pub day: i32,
    /// 當天第幾分鐘
    pub minute: u32,
}

pub fn unix_now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// 存檔資料夾（§14.5 B）。不寫在程式旁邊。
pub fn data_dir() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    };
    base.map(|b| b.join("DeskPet"))
}
