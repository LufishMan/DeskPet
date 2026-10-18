//! 視窗形狀：只有寵物本身（不透明像素）接收滑鼠，透明的地方點下去會穿到後面的視窗。
//! 用 `SetWindowRgn` 設定視窗區域，不需要讀取全域游標位置（§9.2）。

/// 邏輯畫布 100×100（§2，和 app/src/render.ts 的 W、H 相同）
pub const COLS: u32 = 100;
pub const ROWS: usize = 100;
/// 一列最多 50 段（像素交錯時最多就是這麼多），整張圖的上限
const MAX_SPANS: usize = ROWS * COLS as usize / 2;
/// 擴張量：左右涵蓋蛋晃動（2 像素），往上涵蓋跳起來（4 像素），往下多 1 像素讓邊緣好點
const GROW_X: u32 = 2;
const GROW_UP: usize = 4;
const GROW_DOWN: usize = 1;

/// 每一列的遮罩（第 x 位元代表第 x 欄）
type Rows = Vec<u128>;

/// 驗證前端送來的區段並轉成遮罩。格式是攤平的 [起始欄, 結束欄（不含）, 列, …]
pub fn parse(spans: &[u16]) -> Result<Rows, String> {
    let bad = || "形狀資料格式錯誤".to_string();
    let (chunks, rest) = spans.as_chunks::<3>();
    if !rest.is_empty() || chunks.len() > MAX_SPANS {
        return Err(bad());
    }
    let mut rows = vec![0u128; ROWS];
    for &[x0, x1, y] in chunks {
        let (x0, x1, y) = (u32::from(x0), u32::from(x1), usize::from(y));
        if x0 >= x1 || x1 > COLS || y >= ROWS {
            return Err(bad());
        }
        rows[y] |= ((1u128 << (x1 - x0)) - 1) << x0;
    }
    Ok(rows)
}

/// 往外擴，讓邊緣比較好點，也涵蓋跳起來和蛋晃動，這些動畫不必每格重設形狀。
fn dilate(rows: &[u128]) -> Rows {
    let full = (1u128 << COLS) - 1;
    let wide: Rows = rows
        .iter()
        .map(|&r| (1..=GROW_X).fold(r, |acc, k| acc | r << k | r >> k) & full)
        .collect();
    (0..wide.len())
        .map(|y| {
            // 第 y 列要包含原本在下面、跳起來後會移到這裡的像素
            let lo = y.saturating_sub(GROW_DOWN);
            let hi = (y + GROW_UP).min(wide.len() - 1);
            wide[lo..=hi].iter().fold(0, |acc, r| acc | r)
        })
        .collect()
}

/// 每一列連續的像素合成一段：(起始欄, 結束欄（不含）, 列)
fn spans(rows: &[u128]) -> Vec<(u32, u32, u32)> {
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
pub fn apply(window: &tauri::WebviewWindow, rows: &[u128], px: f64) -> Result<(), String> {
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
pub fn apply(_window: &tauri::WebviewWindow, _rows: &[u128], _px: f64) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_validates_spans() {
        let rows = parse(&[0, 3, 0, 98, 100, 99]).unwrap();
        assert_eq!(rows.len(), ROWS);
        assert_eq!(rows[0], 0b111);
        assert_eq!(rows[99], 0b11 << 98);
        assert!(parse(&[0, 3]).is_err(), "長度不是 3 的倍數");
        assert!(parse(&[3, 3, 0]).is_err(), "空區段");
        assert!(parse(&[0, 101, 0]).is_err(), "超出右邊");
        assert!(parse(&[0, 1, 100]).is_err(), "超出下面");
        assert!(parse(&vec![0; (MAX_SPANS + 1) * 3]).is_err(), "太多段");
    }

    #[test]
    fn spans_merge_runs() {
        let rows = [0b0111_0011, 0];
        assert_eq!(spans(&rows), vec![(0, 2, 0), (4, 7, 0)]);
    }

    #[test]
    fn dilate_covers_hop_and_wobble() {
        let mut rows = vec![0u128; 12];
        rows[6] = 1 << 10;
        let grown = dilate(&rows);
        let wide = 0b11111 << 8;
        // 往上 4 列、往下 1 列，左右各 2 欄
        let expected: Vec<u128> = (0..12).map(|y| if (2..=7).contains(&y) { wide } else { 0 }).collect();
        assert_eq!(grown, expected);
        // 不會超出 100 欄
        assert_eq!(dilate(&[1 << (COLS - 1)])[0] >> COLS, 0);
    }
}
