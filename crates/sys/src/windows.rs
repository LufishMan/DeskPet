//! Windows 實作。只呼叫 DESIGN.md §14.2 列出的 API。

use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::mpsc;

use deskpet_core::calendar::days_from_civil;
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, SYSTEMTIME};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JobObjectBasicAccountingInformation, QueryInformationJobObject,
};
use windows_sys::Win32::System::LibraryLoader::{LOAD_LIBRARY_SEARCH_SYSTEM32, SetDefaultDllDirectories};
use windows_sys::Win32::System::Power::{
    DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, PowerRegisterSuspendResumeNotification, PowerUnregisterSuspendResumeNotification,
};
use windows_sys::Win32::System::SystemInformation::{GetLocalTime, GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes, GetSystemTimes};
use windows_sys::Win32::UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND};

use crate::{CpuReading, LocalTime, MemoryReading, PowerEvent, SelfCpuSource};

/// 動態載入 DLL 時只搜尋 System32（§14.3 R4）。程式一啟動就要呼叫。
/// 靜態匯入的 DLL 由連結參數 `/DEPENDENTLOADFLAG:0x800` 處理。
pub fn harden_dll_search() -> bool {
    unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) != 0 }
}

fn filetime(ft: &FILETIME) -> u64 {
    (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime)
}

fn empty_filetime() -> FILETIME {
    FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 }
}

/// 整體 CPU 時間（100 ns），所有核心加總
struct SystemTimes {
    idle: u64,
    /// kernel（含 idle）+ user
    total: u64,
}

fn system_times() -> Option<SystemTimes> {
    let (mut idle, mut kernel, mut user) = (empty_filetime(), empty_filetime(), empty_filetime());
    let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0;
    ok.then(|| SystemTimes { idle: filetime(&idle), total: filetime(&kernel) + filetime(&user) })
}

/// 本程式的 CPU 時間來源
enum SelfCpu {
    /// Job Object 的 handle（以整數保存，讓取樣器可以跨執行緒移動）
    Job(usize),
    Process,
}

impl SelfCpu {
    /// 建立 Job Object 並把自己加入。之後由本程式啟動的子程序（例如 WebView2）
    /// 會自動歸入同一個 Job，所以不需要列舉或開啟任何其他程序（§2）。
    fn init() -> Self {
        unsafe {
            let job = CreateJobObjectW(null(), null());
            if job.is_null() {
                return SelfCpu::Process;
            }
            if AssignProcessToJobObject(job, GetCurrentProcess()) != 0 {
                return SelfCpu::Job(job as usize);
            }
            CloseHandle(job);
        }
        SelfCpu::Process
    }

    /// 累計 CPU 時間（100 ns）
    fn time(&self) -> Option<u64> {
        match self {
            SelfCpu::Job(job) => {
                let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
                let ok = unsafe {
                    QueryInformationJobObject(
                        *job as HANDLE,
                        JobObjectBasicAccountingInformation,
                        (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast::<c_void>(),
                        size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                        null_mut(),
                    )
                } != 0;
                ok.then(|| (info.TotalUserTime + info.TotalKernelTime) as u64)
            }
            SelfCpu::Process => {
                let (mut created, mut exited, mut kernel, mut user) =
                    (empty_filetime(), empty_filetime(), empty_filetime(), empty_filetime());
                let ok =
                    unsafe { GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user) } != 0;
                ok.then(|| filetime(&kernel) + filetime(&user))
            }
        }
    }
}

pub struct SystemSampler {
    self_cpu: SelfCpu,
    previous: Option<(SystemTimes, u64)>,
}

impl SystemSampler {
    pub fn new() -> Self {
        Self { self_cpu: SelfCpu::init(), previous: None }
    }

    pub fn self_cpu_source(&self) -> SelfCpuSource {
        match self.self_cpu {
            SelfCpu::Job(_) => SelfCpuSource::Job,
            SelfCpu::Process => SelfCpuSource::Process,
        }
    }

    /// 回傳和上一次呼叫之間的平均；第一次呼叫只建立基準，回傳 `None`。
    pub fn sample_cpu(&mut self) -> Option<CpuReading> {
        let now = (system_times()?, self.self_cpu.time()?);
        let previous = self.previous.replace(now);
        let (prev_sys, prev_self) = previous?;
        let (sys, own) = self.previous.as_ref()?;
        let total = sys.total.checked_sub(prev_sys.total)?;
        if total == 0 {
            return None;
        }
        let idle = sys.idle.saturating_sub(prev_sys.idle).min(total);
        let own = own.saturating_sub(prev_self);
        Some(CpuReading {
            busy_percent: (total - idle) as f64 / total as f64 * 100.0,
            self_percent: (own as f64 / total as f64 * 100.0).min(100.0),
        })
    }
}

impl Default for SystemSampler {
    fn default() -> Self {
        Self::new()
    }
}

pub fn memory() -> Option<MemoryReading> {
    let mut status: MEMORYSTATUSEX = unsafe { zeroed() };
    status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    let commit_load = if status.ullTotalPageFile > 0 {
        1.0 - status.ullAvailPageFile as f64 / status.ullTotalPageFile as f64
    } else {
        0.0
    };
    Some(MemoryReading { physical_load: f64::from(status.dwMemoryLoad) / 100.0, commit_load })
}

pub fn local_now() -> LocalTime {
    let mut t: SYSTEMTIME = unsafe { zeroed() };
    unsafe { GetLocalTime(&mut t) };
    LocalTime {
        day: days_from_civil(i32::from(t.wYear), u32::from(t.wMonth), u32::from(t.wDay)),
        minute: u32::from(t.wHour) * 60 + u32::from(t.wMinute),
    }
}

/// 睡眠 / 喚醒通知的訂閱；drop 時取消訂閱。
pub struct PowerSubscription {
    handle: *mut c_void,
    // 回呼期間要一直有效，所以和訂閱同生命週期
    _params: Box<DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS>,
    _sender: Box<mpsc::Sender<PowerEvent>>,
}

impl Drop for PowerSubscription {
    fn drop(&mut self) {
        unsafe { PowerUnregisterSuspendResumeNotification(self.handle as isize) };
    }
}

unsafe extern "system" fn power_callback(context: *const c_void, kind: u32, _setting: *const c_void) -> u32 {
    // 喚醒時一律會送出 PBT_APMRESUMEAUTOMATIC，所以只看它，避免重複
    let event = match kind {
        PBT_APMSUSPEND => Some(PowerEvent::Suspend),
        PBT_APMRESUMEAUTOMATIC => Some(PowerEvent::Resume),
        _ => None,
    };
    if let Some(event) = event {
        let sender = unsafe { &*context.cast::<mpsc::Sender<PowerEvent>>() };
        let _ = sender.send(event);
    }
    0
}

/// 訂閱睡眠 / 喚醒通知（不需要視窗，§2）。
pub fn subscribe_power() -> Option<(PowerSubscription, mpsc::Receiver<PowerEvent>)> {
    let (tx, rx) = mpsc::channel();
    let sender = Box::new(tx);
    let mut params = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
        Callback: Some(power_callback),
        Context: (&*sender as *const mpsc::Sender<PowerEvent>).cast_mut().cast::<c_void>(),
    });
    let mut handle = null_mut();
    let status = unsafe {
        PowerRegisterSuspendResumeNotification(
            DEVICE_NOTIFY_CALLBACK,
            (&mut *params as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS).cast::<c_void>(),
            &mut handle,
        )
    };
    (status == 0).then(|| (PowerSubscription { handle, _params: params, _sender: sender }, rx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_and_memory_readings_are_sane() {
        let mut sampler = SystemSampler::new();
        assert!(sampler.sample_cpu().is_none());
        std::thread::sleep(std::time::Duration::from_millis(300));
        let cpu = sampler.sample_cpu().expect("第二次取樣應該有值");
        assert!((0.0..=100.0).contains(&cpu.busy_percent), "{cpu:?}");
        assert!(cpu.self_percent <= cpu.busy_percent + 1.0, "{cpu:?}");
        let mem = memory().expect("記憶體讀取失敗");
        assert!((0.0..=1.0).contains(&mem.physical_load) && (0.0..=1.0).contains(&mem.commit_load));
    }

    #[test]
    fn local_day_is_after_2026() {
        assert!(local_now().day >= days_from_civil(2026, 1, 1));
    }

    #[test]
    fn power_subscription_registers_and_unregisters() {
        let (sub, _rx) = subscribe_power().expect("訂閱失敗");
        drop(sub);
    }
}
