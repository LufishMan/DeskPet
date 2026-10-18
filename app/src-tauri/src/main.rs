//! DeskPet 桌面程式（DESIGN.md §2、§10、§14）。
//!
//! 寵物住在一個和自己同尺寸的透明小視窗裡；系統匣圖示常駐，老闆鍵一鍵隱藏。
//! 引擎在背景執行緒每 10 秒取樣，前端每 15 秒用 `get_pet` 讀取狀態。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod shape;
mod ui;

use std::path::Path;
use std::sync::{Arc, Mutex};

use deskpet_core::{BodyType, Family, MoodLevel, Species, Stage};
use deskpet_runtime::{AnyError, Runtime, run_loop};
use serde::Serialize;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use ui::{AppState, PET_WINDOW, TRAY, Ui, lock};

/// 老闆鍵（§10）：用 RegisterHotKey 註冊，不監聽鍵盤
const BOSS_KEY: &str = "ctrl+alt+h";
/// WebView2 啟動參數。自訂後會取代 wry 的預設值，所以預設停用的功能要一起寫上。
/// - 完全不連網（§14.5 A）：只關背景服務還不夠，WebView2 仍會連線（實測有 DNS over HTTPS
///   探測和 Microsoft 端點），所以直接讓所有主機名稱解析失敗，並把對外連線導向不存在的
///   本機 proxy。頁面和 IPC 由 WebView2 內部攔截處理，不經過網路，不受影響。
/// - 關閉 GPU 加速：畫布只有 100×100，用軟體繪製就夠，記憶體少約 45 MB（§1 輕量）
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,DnsOverHttps \
     --host-resolver-rules=\"MAP * ~NOTFOUND\" --proxy-server=127.0.0.1:9 \
     --disable-background-networking --disable-component-update --disable-sync \
     --disable-domain-reliability --no-first-run --disable-gpu";

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
    /// 蛋紋的排列種子：egg_seed 折成 32 位元，JavaScript 的數字才能精確表示
    seed: u32,
    /// 蛋的熱量進度 0～1，只用來畫裂痕（§11.1）
    egg_progress: f64,
    /// 專注模式：前端停止主動冒泡泡（§10）
    focus: bool,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[tauri::command]
fn get_pet(state: State<'_, AppState>) -> Result<PetView, String> {
    let focus = lock(&state.ui).focus;
    let rt = lock(&state.runtime);
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
        seed: (pet.egg_seed ^ (pet.egg_seed >> 32)) as u32,
        egg_progress: if pet.stage == Stage::Egg {
            pet.stage_calories / balance.stages[Stage::Egg.index()].calories
        } else {
            0.0
        },
        focus,
    })
}

/// 前端回報目前畫面中不透明的像素，用來設定視窗形狀（點擊穿透透明區域）
#[tauri::command]
fn set_shape(window: WebviewWindow, spans: Vec<u16>) -> Result<(), String> {
    ui::set_shape(window.app_handle(), &window, &spans)
}

#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(err)
}

#[tauri::command]
fn show_menu(window: WebviewWindow) -> Result<(), String> {
    let menu = ui::build_menu(window.app_handle(), false).map_err(err)?;
    window.popup_menu(&menu).map_err(err)
}

fn create_pet_window(app: &AppHandle, data_dir: &Path, scale: u8) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, PET_WINDOW, WebviewUrl::App("index.html".into()))
        .title("DeskPet")
        .inner_size(ui::logical_size(scale).width, ui::logical_size(scale).height)
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
        .build()
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("DeskPet")
        .menu(&ui::build_menu(app, true)?)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                ui::set_user_hidden(tray.app_handle(), None);
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
                ui::set_user_hidden(app, None);
            }
        })
        .build();

    tauri::Builder::default()
        // 必須最先註冊：重複開啟時，把已經在執行的寵物叫出來，這個新程式直接結束（§15.3）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| ui::set_user_hidden(app, Some(false))))
        .plugin(shortcuts)
        .invoke_handler(tauri::generate_handler![get_pet, set_shape, start_drag, show_menu])
        .on_menu_event(|app, event| ui::on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let WindowEvent::Moved(position) = event
                && window.label() == PET_WINDOW
            {
                ui::on_moved(window.app_handle(), *position);
            }
        })
        .setup(move |app| {
            // 存檔鎖仍然保留：防止開發用的 deskpet-cli 同時寫入同一份存檔
            let (runtime, _startup) = Runtime::open(&data_dir.join("deskpet.db"))
                .map_err(|e| format!("無法開啟存檔：{e}\n\n如果正在執行開發用的 deskpet-cli，請先關閉它。"))?;
            let settings = Ui::load(&runtime);
            let scale = settings.effective_scale();
            let runtime = Arc::new(Mutex::new(runtime));
            let engine = Arc::clone(&runtime);
            app.manage(AppState { runtime, ui: Mutex::new(settings) });

            let window = create_pet_window(app.handle(), &data_dir, scale)?;
            ui::show_initially(app.handle(), &window);
            create_tray(app.handle())?;
            ui::spawn_watcher(app.handle().clone())?;
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
