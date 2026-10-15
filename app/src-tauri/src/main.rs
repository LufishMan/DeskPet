//! DeskPet 桌面程式（DESIGN.md §2、§10、§14）。
//!
//! 寵物住在一個和自己同尺寸的透明小視窗裡；系統匣圖示常駐，老闆鍵一鍵隱藏。
//! 引擎在背景執行緒每 10 秒取樣，前端每 15 秒用 `get_pet` 讀取狀態。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::sync::{Arc, Mutex};

use deskpet_core::{BodyType, Family, MoodLevel, Species, Stage};
use deskpet_runtime::{AnyError, Runtime, run_loop};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::ShortcutState;

const PET_WINDOW: &str = "pet";
/// 邏輯畫布 40×44（§2）
const CANVAS: (f64, f64) = (40.0, 44.0);
/// 整數倍放大（§11.2：×2／×3／×4，之後做成設定）
const SCALE: f64 = 3.0;
/// 老闆鍵（§10）：用 RegisterHotKey 註冊，不監聽鍵盤
const BOSS_KEY: &str = "ctrl+alt+h";
const SCREEN_MARGIN: i32 = 24;
/// WebView2 啟動參數。自訂後會取代 wry 的預設值，所以預設停用的功能要一起寫上。
/// - 完全不連網（§14.5 A）：只關背景服務還不夠，WebView2 仍會連線（實測有 DNS over HTTPS
///   探測和 Microsoft 端點），所以直接讓所有主機名稱解析失敗，並把對外連線導向不存在的
///   本機 proxy。頁面和 IPC 由 WebView2 內部攔截處理，不經過網路，不受影響。
/// - 關閉 GPU 加速：畫布只有 40×44，用軟體繪製就夠，記憶體少約 45 MB（§1 輕量）
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,DnsOverHttps \
     --host-resolver-rules=\"MAP * ~NOTFOUND\" --proxy-server=127.0.0.1:9 \
     --disable-background-networking --disable-component-update --disable-sync \
     --disable-domain-reliability --no-first-run --disable-gpu";

struct Shared(Arc<Mutex<Runtime>>);

/// 前端繪製需要的狀態。只給畫面需要的分類結果，不給熱量等原始數值。
#[derive(Serialize)]
struct PetView {
    family: Family,
    species: Species,
    stage: Stage,
    body: BodyType,
    mood: MoodLevel,
    energy: u8,
    sleeping: bool,
    waiting: bool,
    legacy_ready: bool,
    rare: bool,
    hue_shift: u8,
    /// 蛋的熱量進度 0～1，只用來決定要不要畫裂痕
    egg_progress: f64,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[tauri::command]
fn get_pet(shared: State<'_, Shared>) -> Result<PetView, String> {
    let rt = shared.0.lock().map_err(|_| "狀態已損壞")?;
    let (pet, balance) = (rt.pet(), rt.balance());
    Ok(PetView {
        family: pet.family,
        species: pet.species,
        stage: pet.stage,
        body: pet.body_type(balance),
        mood: rt.mood(),
        energy: pet.energy,
        sleeping: pet.is_napping(balance) || pet.daily_calories >= balance.calories.daily_cap,
        waiting: pet.waiting,
        legacy_ready: pet.legacy_ready,
        rare: pet.rare,
        hue_shift: pet.hue_shift,
        egg_progress: if pet.stage == Stage::Egg {
            pet.stage_calories / balance.stages[Stage::Egg.index()].calories
        } else {
            0.0
        },
    })
}

#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(err)
}

#[tauri::command]
fn show_menu(window: WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "hide", "隱藏（Ctrl+Alt+H）", true, None::<&str>).map_err(err)?,
            &PredefinedMenuItem::separator(app).map_err(err)?,
            &MenuItem::with_id(app, "quit", "結束 DeskPet", true, None::<&str>).map_err(err)?,
        ],
    )
    .map_err(err)?;
    window.popup_menu(&menu).map_err(err)
}

/// 顯示或隱藏寵物視窗；`visible` 為 `None` 時切換
fn set_visible(app: &AppHandle, visible: Option<bool>) {
    if let Some(window) = app.get_webview_window(PET_WINDOW) {
        let show = visible.unwrap_or_else(|| !window.is_visible().unwrap_or(true));
        let _ = if show { window.show() } else { window.hide() };
    }
}

fn create_pet_window(app: &AppHandle, data_dir: &Path) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, PET_WINDOW, WebviewUrl::App("index.html".into()))
        .title("DeskPet")
        .inner_size(CANVAS.0 * SCALE, CANVAS.1 * SCALE)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        // 系統匣圖示常駐，所以不佔工作列（§14.5 A：不隱藏自己）
        .skip_taskbar(true)
        // 安靜陪伴：不搶焦點（§1）
        .focusable(false)
        .focused(false)
        .visible(false)
        // WebView2 的使用者資料也放在自己的資料夾（§2、§14.5 A）
        .data_directory(data_dir.join("WebView2"))
        .additional_browser_args(WEBVIEW_ARGS)
        .build()?;

    // 預設放在主螢幕工作區域的右下角
    if let Some(monitor) = window.primary_monitor()? {
        let area = monitor.work_area();
        let size = window.outer_size()?;
        let x = area.position.x + area.size.width as i32 - size.width as i32 - SCREEN_MARGIN;
        let y = area.position.y + area.size.height as i32 - size.height as i32;
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    window.show()
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "toggle", "顯示／隱藏（Ctrl+Alt+H）", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "結束 DeskPet", true, None::<&str>)?,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("DeskPet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                set_visible(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn run() -> Result<(), AnyError> {
    if tauri::webview_version().is_err() {
        return Err("找不到 Microsoft Edge WebView2 Runtime。\n\n\
                    Windows 11 和已更新的 Windows 10 都內建這個元件。\
                    請透過 Windows Update 更新系統，或洽詢公司 IT 人員。"
            .into());
    }
    let data_dir = deskpet_sys::data_dir().ok_or("找不到使用者資料夾（%LOCALAPPDATA%）")?;

    let shortcuts = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcut(BOSS_KEY)?
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                set_visible(app, None);
            }
        })
        .build();

    tauri::Builder::default()
        // 必須最先註冊：重複開啟時，把已經在執行的寵物叫出來，這個新程式直接結束（§15.3）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| set_visible(app, Some(true))))
        .plugin(shortcuts)
        .invoke_handler(tauri::generate_handler![get_pet, start_drag, show_menu])
        .on_menu_event(|app, event| match event.id().as_ref() {
            "hide" => set_visible(app, Some(false)),
            "toggle" => set_visible(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .setup(move |app| {
            // 存檔鎖仍然保留：防止開發用的 deskpet-cli 同時寫入同一份存檔
            let (runtime, _startup) = Runtime::open(&data_dir.join("deskpet.db"))
                .map_err(|e| format!("無法開啟存檔：{e}\n\n如果正在執行開發用的 deskpet-cli，請先關閉它。"))?;
            let shared = Arc::new(Mutex::new(runtime));
            let engine = Arc::clone(&shared);
            app.manage(Shared(shared));
            create_pet_window(app.handle(), &data_dir)?;
            create_tray(app.handle())?;
            std::thread::Builder::new().name("deskpet-engine".into()).spawn(move || {
                if let Err(e) = run_loop(&engine, |_, _| true) {
                    eprintln!("引擎停止：{e}");
                }
            })?;
            Ok(())
        })
        .run(tauri::generate_context!())?;
    Ok(())
}

fn main() {
    // 動態載入 DLL 只搜尋 System32（§14.3 R4），越早越好
    deskpet_sys::harden_dll_search();
    if let Err(e) = run() {
        fatal(&e.to_string());
    }
}

/// 無法啟動時給使用者看得懂的訊息，而不是直接閃退（§15.1）
#[cfg(windows)]
fn fatal(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (text, caption) = (wide(message), wide("DeskPet"));
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR) };
}

#[cfg(not(windows))]
fn fatal(message: &str) {
    eprintln!("DeskPet：{message}");
}
