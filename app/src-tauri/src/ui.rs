//! 視窗狀態與使用者設定（§10）：老闆鍵／全螢幕自動隱藏、大小、專注模式、位置記憶、選單。

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use deskpet_runtime::Runtime;
use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow, Wry};

use crate::shape;

pub const PET_WINDOW: &str = "pet";
pub const TRAY: &str = "main";
/// 邏輯畫布 40×44（§2）
const CANVAS: (f64, f64) = (40.0, 44.0);
/// 整數倍放大（§11.2）
const SCALES: [u8; 3] = [2, 3, 4];
const DEFAULT_SCALE: u8 = 3;
/// 專注模式：縮小並放到角落（§10）
const FOCUS_SCALE: u8 = 2;
const SCREEN_MARGIN: i32 = 24;
/// 全螢幕偵測與位置存檔的間隔
const WATCH_INTERVAL: Duration = Duration::from_secs(2);

const KEY_SCALE: &str = "scale";
const KEY_FOCUS: &str = "focus_mode";
const KEY_POSITION: &str = "window_position";

pub struct AppState {
    pub runtime: Arc<Mutex<Runtime>>,
    pub ui: Mutex<Ui>,
}

pub struct Ui {
    pub scale: u8,
    pub focus: bool,
    /// 使用者用老闆鍵或選單隱藏
    user_hidden: bool,
    /// 全螢幕或簡報時自動隱藏
    auto_hidden: bool,
    /// 前端最近一次送來的形狀，改變大小時要重新套用
    shape: Option<Vec<u64>>,
    /// 拖曳後還沒寫進存檔的位置
    pending_position: Option<(i32, i32)>,
}

impl Ui {
    pub fn load(runtime: &Runtime) -> Self {
        let scale = runtime.setting::<u8>(KEY_SCALE).ok().flatten().filter(|s| SCALES.contains(s));
        let focus = runtime.setting::<bool>(KEY_FOCUS).ok().flatten();
        Self {
            scale: scale.unwrap_or(DEFAULT_SCALE),
            focus: focus.unwrap_or(false),
            user_hidden: false,
            auto_hidden: false,
            shape: None,
            pending_position: None,
        }
    }

    pub fn effective_scale(&self) -> u8 {
        if self.focus { FOCUS_SCALE } else { self.scale }
    }
}

/// 鎖被污染（某個執行緒在持有時 panic）也繼續用，UI 狀態不會因此失去一致性
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn ui(app: &AppHandle) -> MutexGuard<'_, Ui> {
    lock(&app.state::<AppState>().inner().ui)
}

pub fn pet_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PET_WINDOW)
}

pub fn logical_size(scale: u8) -> LogicalSize<f64> {
    LogicalSize::new(CANVAS.0 * f64::from(scale), CANVAS.1 * f64::from(scale))
}

/// 視窗目前的實際大小（實體像素）。Windows 有最小寬度限制，可能比要求的大，所以一律讀實際值。
fn current_size(window: &WebviewWindow) -> (i32, i32) {
    window.outer_size().map_or((0, 0), |s| (s.width as i32, s.height as i32))
}

/// 每個畫布像素對應的實體像素數
pub fn pixel_ratio(window: &WebviewWindow, ui: &Ui) -> f64 {
    window.scale_factor().unwrap_or(1.0) * f64::from(ui.effective_scale())
}

fn persist<T: Serialize>(app: &AppHandle, key: &str, value: &T) {
    let state = app.state::<AppState>();
    let result = lock(&state.runtime).set_setting(key, value);
    if let Err(e) = result {
        eprintln!("無法儲存設定 {key}：{e}");
    }
}

fn saved_position(app: &AppHandle) -> Option<(i32, i32)> {
    let state = app.state::<AppState>();
    lock(&state.runtime).setting::<(i32, i32)>(KEY_POSITION).ok().flatten()
}

/// 寵物所在螢幕（找不到就用主螢幕）工作區域的右下角
fn corner(window: &WebviewWindow, (w, h): (i32, i32)) -> Option<PhysicalPosition<i32>> {
    let monitor = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - w - SCREEN_MARGIN,
        area.position.y + area.size.height as i32 - h,
    ))
}

/// 視窗中心是否落在某個螢幕的工作區域內（例如拔掉外接螢幕後就不在了）
fn on_screen(window: &WebviewWindow, (x, y): (i32, i32), (w, h): (i32, i32)) -> bool {
    let (cx, cy) = (x + w / 2, y + h / 2);
    window.available_monitors().is_ok_and(|monitors| {
        monitors.iter().any(|m| {
            let a = m.work_area();
            (a.position.x..a.position.x + a.size.width as i32).contains(&cx)
                && (a.position.y..a.position.y + a.size.height as i32).contains(&cy)
        })
    })
}

/// 放到記住的位置；專注模式、沒有記錄或位置已不在螢幕上時，放到右下角
fn place(app: &AppHandle, window: &WebviewWindow, focus: bool) {
    let size = current_size(window);
    let saved = if focus { None } else { saved_position(app).filter(|&p| on_screen(window, p, size)) };
    let target = saved.map(|(x, y)| PhysicalPosition::new(x, y)).or_else(|| corner(window, size));
    if let Some(position) = target {
        let _ = window.set_position(position);
    }
}

/// 建立視窗後呼叫：放到正確位置並顯示
pub fn show_initially(app: &AppHandle, window: &WebviewWindow) {
    let focus = ui(app).focus;
    place(app, window, focus);
    apply_visibility(app);
}

fn apply_visibility(app: &AppHandle) {
    let visible = {
        let ui = ui(app);
        !ui.user_hidden && !ui.auto_hidden
    };
    if let Some(window) = pet_window(app) {
        let _ = if visible { window.show() } else { window.hide() };
    }
}

/// 老闆鍵、選單、重複開啟程式時呼叫；`None` 代表切換
pub fn set_user_hidden(app: &AppHandle, hidden: Option<bool>) {
    {
        let mut ui = ui(app);
        ui.user_hidden = hidden.unwrap_or(!ui.user_hidden);
    }
    apply_visibility(app);
}

pub fn set_shape(app: &AppHandle, window: &WebviewWindow, rows: Vec<u64>) -> Result<(), String> {
    shape::validate(&rows)?;
    let px = {
        let mut ui = ui(app);
        ui.shape = Some(rows.clone());
        pixel_ratio(window, &ui)
    };
    shape::apply(window, &rows, px)
}

fn reapply_shape(app: &AppHandle, window: &WebviewWindow) {
    let (rows, px) = {
        let ui = ui(app);
        (ui.shape.clone(), pixel_ratio(window, &ui))
    };
    if let Some(rows) = rows {
        let _ = shape::apply(window, &rows, px);
    }
}

/// 改變大小，維持底部中央的位置不動
fn resize(window: &WebviewWindow, scale: u8) {
    let Ok(position) = window.outer_position() else { return };
    let (old_w, old_h) = current_size(window);
    let _ = window.set_size(logical_size(scale));
    let (w, h) = current_size(window);
    let _ = window.set_position(PhysicalPosition::new(position.x + (old_w - w) / 2, position.y + old_h - h));
}

pub fn set_scale(app: &AppHandle, scale: u8) {
    if !SCALES.contains(&scale) {
        return;
    }
    let focus = {
        let mut ui = ui(app);
        ui.scale = scale;
        ui.focus
    };
    persist(app, KEY_SCALE, &scale);
    if !focus && let Some(window) = pet_window(app) {
        resize(&window, scale);
        reapply_shape(app, &window);
    }
    refresh_tray_menu(app);
}

/// 專注模式（§10）：縮小放到角落、停止主動互動；數值照常結算
pub fn set_focus(app: &AppHandle, on: bool) {
    let Some(window) = pet_window(app) else { return };
    let scale = {
        let mut ui = ui(app);
        if ui.focus == on {
            return;
        }
        if on {
            // 記住目前的位置，結束專注模式時放回來
            if let Ok(p) = window.outer_position() {
                ui.pending_position = Some((p.x, p.y));
            }
        }
        ui.focus = on;
        ui.effective_scale()
    };
    flush_position(app);
    persist(app, KEY_FOCUS, &on);
    let _ = window.set_size(logical_size(scale));
    place(app, &window, on);
    reapply_shape(app, &window);
    refresh_tray_menu(app);
}

/// 視窗移動時呼叫；專注模式中的位置不記住
pub fn on_moved(app: &AppHandle, position: PhysicalPosition<i32>) {
    let mut ui = ui(app);
    if !ui.focus {
        ui.pending_position = Some((position.x, position.y));
    }
}

fn flush_position(app: &AppHandle) {
    let pending = ui(app).pending_position.take();
    if let Some(position) = pending {
        persist(app, KEY_POSITION, &position);
    }
}

/// 背景執行緒：偵測全螢幕、把拖曳後的位置寫進存檔（拖曳時不必每次移動都寫入）
pub fn spawn_watcher(app: AppHandle) -> std::io::Result<()> {
    std::thread::Builder::new().name("deskpet-ui".into()).spawn(move || {
        loop {
            std::thread::sleep(WATCH_INTERVAL);
            let fullscreen = deskpet_sys::fullscreen_active();
            let changed = {
                let mut ui = ui(&app);
                let changed = ui.auto_hidden != fullscreen;
                ui.auto_hidden = fullscreen;
                changed
            };
            if changed {
                apply_visibility(&app);
            }
            flush_position(&app);
        }
    })?;
    Ok(())
}

pub fn build_menu(app: &AppHandle, for_tray: bool) -> tauri::Result<Menu<Wry>> {
    let (scale, focus) = {
        let ui = ui(app);
        (ui.scale, ui.focus)
    };
    let sizes = Submenu::with_id_and_items(
        app,
        "size",
        "大小",
        !focus,
        &[
            &CheckMenuItem::with_id(app, "scale-2", "小", true, scale == 2, None::<&str>)?,
            &CheckMenuItem::with_id(app, "scale-3", "中", true, scale == 3, None::<&str>)?,
            &CheckMenuItem::with_id(app, "scale-4", "大", true, scale == 4, None::<&str>)?,
        ],
    )?;
    let (hide_id, hide_text) =
        if for_tray { ("toggle", "顯示／隱藏（Ctrl+Alt+H）") } else { ("hide", "隱藏（Ctrl+Alt+H）") };
    Menu::with_items(
        app,
        &[
            &CheckMenuItem::with_id(app, "focus", "專注模式", true, focus, None::<&str>)?,
            &sizes,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, hide_id, hide_text, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "結束 DeskPet", true, None::<&str>)?,
        ],
    )
}

fn refresh_tray_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY), build_menu(app, true)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "hide" => set_user_hidden(app, Some(true)),
        "toggle" => set_user_hidden(app, None),
        "focus" => {
            let on = !ui(app).focus;
            set_focus(app, on);
        }
        "scale-2" => set_scale(app, 2),
        "scale-3" => set_scale(app, 3),
        "scale-4" => set_scale(app, 4),
        "quit" => {
            flush_position(app);
            app.exit(0);
        }
        _ => {}
    }
}
