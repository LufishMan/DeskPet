fn main() {
    // 宣告自訂指令，讓它們也受 capabilities 管控（§14.4：只開放必要的指令）
    let manifest = tauri_build::AppManifest::new().commands(&["get_pet", "set_shape", "start_drag", "show_menu"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("tauri-build 失敗");
}
