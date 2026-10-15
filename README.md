# DeskPet

適合上班時使用的桌面電子寵物。寵物靠電腦的 CPU 用量成長、受記憶體壓力影響心情，安靜、不出聲、可以快速隱藏。

> 開發中（M1 核心引擎完成）。設計文件：[docs/DESIGN.md](docs/DESIGN.md)

## 這個程式做什麼、不做什麼

- 只讀取**整體** CPU 和記憶體數值，以及本程式自己的用量。
- **不**列舉或開啟其他程序、**不**讀取視窗標題或內容、**不**監聽鍵盤滑鼠、**不**連網。
- 存檔只放在 `%LOCALAPPDATA%\DeskPet\`（macOS：`~/Library/Application Support/DeskPet/`）。

完整的 API 清單見 [DESIGN.md §14.2](docs/DESIGN.md)。

## 開發

需要 Rust（stable）；Windows 另需 Visual Studio Build Tools（C++ 工作負載）。
**請在專案根目錄執行 cargo**，`.cargo/config.toml` 的連結設定才會生效。

```sh
cargo test --workspace                  # 單元測試
cargo run -p deskpet-sim                # 用模擬情境驗證 balance.toml
cargo run --release -p deskpet-cli run  # 不開視窗執行引擎、收集真實數據
cargo run --release -p deskpet-cli report --days 7
```

| 路徑 | 內容 |
|---|---|
| `crates/core` | 純邏輯：養分、成長、體型、活力、心情、傳承 |
| `crates/sys` | 平台層：原生 API 取樣、休眠通知 |
| `crates/store` | SQLite 存檔 |
| `crates/sim` | 時間加速模擬器 |
| `crates/cli` | 開發用命令列 |
| `balance.toml` | 所有平衡數值 |
