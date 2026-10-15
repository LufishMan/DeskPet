//! 視窗形狀：只有寵物本身（不透明像素）接收滑鼠，透明的地方點下去會穿到後面的視窗。
//! 用 `SetWindowRgn` 設定視窗區域，不需要讀取全域游標位置（§9.2）。

/// 邏輯畫布 40×44（§2）
pub const COLS: u32 = 40;
pub const ROWS: usize = 44;

/// 驗證前端送來的遮罩：44 列，每列最多 40 位元（第 x 位元代表第 x 欄）
pub fn validate(rows: &[u64]) -> Result<(), String> {
    if rows.len() != ROWS || rows.iter().any(|r| r >> COLS != 0) {
        return Err("形狀資料格式錯誤".into());
    }
    Ok(())
}

/// 往外擴：左右 1 像素、上下 2 像素。讓邊緣比較好點，
/// 也涵蓋跳起來（上移 2 像素）和蛋晃動（左右 1 像素），這些動畫不必每格重設形狀。
fn dilate(rows: &[u64]) -> Vec<u64> {
    let full = (1u64 << COLS) - 1;
    let wide: Vec<u64> = rows.iter().map(|r| (r | r << 1 | r >> 1) & full).collect();
    (0..wide.len())
        .map(|y| {
            let lo = y.saturating_sub(2);
            let hi = (y + 2).min(wide.len() - 1);
            wide[lo..=hi].iter().fold(0, |acc, r| acc | r)
        })
        .collect()
}

/// 每一列連續的像素合成一段：(起始欄, 結束欄（不含）, 列)
fn spans(rows: &[u64]) -> Vec<(u32, u32, u32)> {
    let mut out = Vec::new();
    for (y, &row) in rows.iter().enumerate() {
        let mut x = 0;
        while x < COLS {
            if row >> x & 1 == 0 {
                x += 1;
                continue;
            }
            let start = x;
            while x < COLS && row >> x & 1 == 1 {
                x += 1;
            }
            out.push((start, x, y as u32));
        }
    }
    out
}

/// 把遮罩套到視窗上。`px` 是每個畫布像素對應的實體像素數（放大倍率 × 螢幕縮放）。
#[cfg(windows)]
pub fn apply(window: &tauri::WebviewWindow, rows: &[u64], px: f64) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, RGN_OR, SetWindowRgn};

    let spans = spans(&dilate(rows));
    if spans.is_empty() {
        // 還沒畫出任何東西：維持原本的形狀，避免視窗整個消失
        return Ok(());
    }
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
    // Windows 對有標題列樣式的視窗有最小寬度（約 136 像素），視窗可能比畫布寬。
    // 前端把畫布以整數倍放大、靠底置中（main.ts 的 layout），這裡用同樣的方式算位移。
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let dx = (inner.width as i32 - (f64::from(COLS) * px).round() as i32) / 2;
    let dy = inner.height as i32 - (ROWS as f64 * px).round() as i32;
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        for (x0, x1, y) in spans {
            let part = CreateRectRgn(
                dx + (f64::from(x0) * px).floor() as i32,
                dy + (f64::from(y) * px).floor() as i32,
                dx + (f64::from(x1) * px).ceil() as i32,
                dy + (f64::from(y + 1) * px).ceil() as i32,
            );
            CombineRgn(region, region, part, RGN_OR);
            DeleteObject(part);
        }
        // 成功後區域由系統接管，不能再釋放
        if SetWindowRgn(hwnd, region, 1) == 0 {
            DeleteObject(region);
            return Err("無法設定視窗形狀".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply(_window: &tauri::WebviewWindow, _rows: &[u64], _px: f64) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_shape() {
        assert!(validate(&[0; ROWS]).is_ok());
        assert!(validate(&[0; ROWS - 1]).is_err());
        let mut rows = [0; ROWS];
        rows[3] = 1 << COLS;
        assert!(validate(&rows).is_err());
    }

    #[test]
    fn spans_merge_runs() {
        let rows = [0b0111_0011, 0];
        assert_eq!(spans(&rows), vec![(0, 2, 0), (4, 7, 0)]);
    }

    #[test]
    fn dilate_grows_one_column_and_two_rows() {
        let mut rows = vec![0u64; 7];
        rows[3] = 1 << 5;
        let expected = [0, 0b111 << 4, 0b111 << 4, 0b111 << 4, 0b111 << 4, 0b111 << 4, 0];
        assert_eq!(dilate(&rows), expected);
        // 不會超出 40 欄
        assert_eq!(dilate(&[1 << (COLS - 1)])[0] >> COLS, 0);
    }
}
