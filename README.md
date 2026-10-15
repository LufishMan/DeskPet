# DeskPet

適合上班時使用的桌面電子寵物。寵物靠電腦的 CPU 用量成長，心情隨記憶體壓力變化；預設不出聲、不彈窗，可以用快捷鍵一鍵隱藏。

> **狀態：開發中。** 核心引擎（M1）已完成，桌面視窗（M2）製作中，目前還沒有可下載的正式版。
> 設計文件：[docs/DESIGN.md](docs/DESIGN.md)

## 為什麼公開原始碼

DeskPet 不做程式碼簽章。公開原始碼是為了**讓任何人（包括公司的 IT、資安人員）都能直接檢查程式實際做了什麼**，也能自己從原始碼建置，和發佈檔比對。

這不是開源專案，著作權說明見文末。

## 做什麼、不做什麼

| 會做 | 不會做 |
|---|---|
| 讀取**整體** CPU 使用率和記憶體負載 | 列舉、開啟或讀取其他程序（包括程序名稱） |
| 讀取本程式自己（含子程序）的 CPU 用量 | 讀取其他視窗的標題或內容、截圖 |
| 接收系統的睡眠／喚醒通知 | 監聽鍵盤、滑鼠，或讀取全域游標位置 |
| 把存檔寫在自己的資料夾 | 任何網路連線（不回傳數據、不檢查更新） |
| 使用者開啟時才註冊開機自動啟動 | 寫入系統資料夾、建立服務或排程工作 |
| | 需要系統管理員或任何特殊權限 |

## 使用的 Windows API

目前程式碼實際呼叫的 API（見 [`crates/sys/src/windows.rs`](crates/sys/src/windows.rs)）：

| API | 用途 |
|---|---|
| `GetSystemTimes` | 整體 CPU 使用率 |
| `GlobalMemoryStatusEx` | 整體記憶體負載 |
| `CreateJobObjectW`、`AssignProcessToJobObject`、`QueryInformationJobObject` | 把**自己**放進 Job Object，計算自己（含子程序）的 CPU 用量，不需要開啟其他程序 |
| `GetProcessTimes(GetCurrentProcess())` | Job Object 無法使用時，改算自己主程序的用量 |
| `PowerRegisterSuspendResumeNotification` | 睡眠／喚醒通知 |
| `GetLocalTime` | 判斷日期 |
| `SetDefaultDllDirectories` | 限制只從 System32 載入 DLL（防 DLL 劫持） |

之後版本預計加入的 API：`RegisterHotKey`（隱藏快捷鍵，不使用鍵盤 hook）、`SHQueryUserNotificationState`（全螢幕或簡報時自動隱藏）、`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`（使用者開啟時才寫入的開機自動啟動）。完整清單見 [DESIGN.md §14.2](docs/DESIGN.md)。

執行檔的建置設定：C 執行階段靜態連結（不依賴 `VCRUNTIME140.dll`），並以 `/DEPENDENTLOADFLAG:0x800` 讓所有靜態匯入的 DLL 也只從 System32 載入（見 [`.cargo/config.toml`](.cargo/config.toml)）。

## 資料存放與完整移除

| 平台 | 存檔位置 |
|---|---|
| Windows | `%LOCALAPPDATA%\DeskPet\` |
| macOS | `~/Library/Application Support/DeskPet/` |

存檔內容：寵物狀態、最近 30 天每 5 分鐘一筆的 CPU／記憶體平均值（之後彙總成每日統計），以及最近 7 份每日備份。**不記錄任何程序、視窗或輸入資訊。**

完整移除：關閉程式、刪除程式檔和上面的資料夾即可。如果開啟過開機自動啟動，先在設定中關閉；或刪除登錄值 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\DeskPet`。

## 從原始碼建置

需要 Rust（stable，1.89 以上）；Windows 另需 Visual Studio Build Tools 的「使用 C++ 的桌面開發」工作負載。

**請在專案根目錄執行 cargo**，`.cargo/config.toml` 的連結設定才會生效。

```sh
cargo test --workspace                              # 單元測試
cargo run -p deskpet-sim                            # 用模擬情境驗證平衡數值
cargo run --release -p deskpet-cli run              # 開發用：不開視窗執行引擎
cargo run --release -p deskpet-cli report --days 7  # 開發用：校準報表
```

| 路徑 | 內容 |
|---|---|
| `crates/core` | 純邏輯：養分、成長、體型、活力、心情、傳承。不呼叫任何系統 API |
| `crates/sys` | 平台層：所有系統 API 呼叫都集中在這裡 |
| `crates/store` | SQLite 存檔，查詢一律參數化 |
| `crates/sim` | 時間加速模擬器 |
| `crates/cli` | 開發用命令列，不隨正式版發佈 |
| `balance.toml` | 所有平衡數值 |
| `docs/DESIGN.md` | 設計文件，含資安風險評估（§14） |

## 驗證發佈檔

正式版發佈時，Releases 頁面會附上 `SHA256SUMS` 和 minisign 簽名。**只從本 repo 的 Releases 下載**，並在執行前確認 hash 一致。

## 回報資安問題

請使用本 repo 的 **Security → Report a vulnerability** 私下回報，不要在公開 issue 中附上可被利用的細節。

## 著作權

Copyright © 2026 Lufish. All rights reserved.

原始碼公開僅供審閱，以及為了驗證而在自己的電腦上建置和執行。未經書面同意，不得修改後散佈、重新打包、再散佈，或用於其他產品。
