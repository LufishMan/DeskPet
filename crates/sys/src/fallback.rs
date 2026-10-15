//! Windows 以外的平台：目前只提供能編譯的退而求其次版本。
//! macOS（host_statistics64 等）和 Linux（/proc）的實作留待之後補上。

use std::sync::mpsc;

use crate::{CpuReading, LocalTime, MemoryReading, PowerEvent, SelfCpuSource, unix_now};

pub fn harden_dll_search() -> bool {
    true
}

#[derive(Default)]
pub struct SystemSampler;

impl SystemSampler {
    pub fn new() -> Self {
        Self
    }

    pub fn self_cpu_source(&self) -> SelfCpuSource {
        SelfCpuSource::Unsupported
    }

    pub fn sample_cpu(&mut self) -> Option<CpuReading> {
        None
    }
}

pub fn memory() -> Option<MemoryReading> {
    None
}

/// 尚未實作時區：暫時使用 UTC
pub fn local_now() -> LocalTime {
    let now = unix_now();
    LocalTime { day: now.div_euclid(86_400) as i32, minute: (now.rem_euclid(86_400) / 60) as u32 }
}

pub struct PowerSubscription;

pub fn subscribe_power() -> Option<(PowerSubscription, mpsc::Receiver<PowerEvent>)> {
    None
}
