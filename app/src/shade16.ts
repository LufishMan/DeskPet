// 16-bit 上色（類 SNES）：乾淨的細線、依材質加深的外框（sel-out）、色相偏移的明暗層次、邊緣反鋸齒。
// 光從左上方來：靠左上邊緣的地方亮、靠右下邊緣的地方暗；被頭蓋住的身體有一點投影。

import type { Palette, Rgb } from './palette.ts';
import { shiftColor } from './palette.ts';
import { BASE, CLEAR, INK, IRIS, LIGHT, OUTLINE, PATTERN, PINK, SHADE, SHINE, type Grid } from './pixel.ts';

/** 毛色材質：會依光線分層 */
const MATERIAL = new Set([BASE, PATTERN, LIGHT, SHADE]);
/** 量距離時可以穿過的格子（臉上的細節不算邊緣） */
const PASS = new Set([BASE, PATTERN, LIGHT, SHADE, PINK, IRIS, SHINE, INK]);

/** 色相偏移的明暗：亮部偏暖黃，暗部偏冷紫並提高飽和度 */
function ramp(c: Rgb, tone: number): Rgb {
  switch (tone) {
    case 2:
      return shiftColor(c, 55, 6, -0.04, 0.11);
    case 1:
      return shiftColor(c, 55, 3, -0.02, 0.05);
    case -1:
      return shiftColor(c, 250, 5, 0.02, -0.08);
    case -2:
      return shiftColor(c, 255, 10, 0.04, -0.15);
    default:
      return c;
  }
}

/** 拿掉 L 形轉角多出來的外框格，讓線條保持 1 像素寬 */
function cleanCorners(src: Grid): Uint8Array {
  const px = src.px.slice();
  const get = (x: number, y: number): number => (x >= 0 && y >= 0 && x < src.w && y < src.h ? src.px[y * src.w + x] : CLEAR);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (get(x, y) !== OUTLINE) continue;
      search: for (const dx of [-1, 1]) {
        for (const dy of [-1, 1]) {
          const corner = get(x + dx, y) === OUTLINE && get(x, y + dy) === OUTLINE && get(x + dx, y + dy) === CLEAR;
          if (corner && MATERIAL.has(get(x - dx, y)) && MATERIAL.has(get(x, y - dy))) {
            px[y * src.w + x] = get(x - dx, y);
            break search;
          }
        }
      }
    }
  }
  return px;
}

export function paint16(
  g: Grid,
  palette: Palette,
  set: (x: number, y: number, color: Rgb, alpha?: number) => void,
): void {
  const { w, h } = g;
  const px = cleanCorners(g);
  const get = (x: number, y: number): number => (x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : CLEAR);
  const touchesClear = (x: number, y: number): boolean =>
    get(x - 1, y) === CLEAR || get(x + 1, y) === CLEAR || get(x, y - 1) === CLEAR || get(x, y + 1) === CLEAR;
  /** 沿某個方向走幾格才碰到邊緣，以及碰到的是什麼 */
  const march = (x: number, y: number, dx: number, dy: number): [number, number, number, number] => {
    let n = 0;
    let [cx, cy] = [x, y];
    while (PASS.has(get(cx + dx, cy + dy))) {
      cx += dx;
      cy += dy;
      n++;
    }
    return [n, get(cx + dx, cy + dy), cx + dx, cy + dy];
  };

  const colors: (Rgb | null)[] = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = get(x, y);
      if (v === CLEAR) continue;
      const base = palette[v - 1] ?? palette[0];
      if (MATERIAL.has(v)) {
        const [tl] = march(x, y, -1, -1);
        const [br] = march(x, y, 1, 1);
        const [up, hit, hx, hy] = march(x, y, 0, -1);
        const [down] = march(x, y, 0, 1);
        const t = (br + down - (tl + up)) / Math.max(1, br + down + tl + up);
        let tone = t > 0.5 ? 2 : t > 0.2 ? 1 : t < -0.62 ? -2 : t < -0.18 ? -1 : 0;
        // 正上方是別的部位（頭、耳朵）的內線：被蓋住的地方有投影
        if (hit === OUTLINE && !touchesClear(hx, hy) && up <= 2) tone = Math.min(tone, -1);
        colors[y * w + x] = ramp(base, tone);
      } else if (v === OUTLINE) {
        // 外框用旁邊材質的深色；左上受光的一側淡一點。部位之間的內線用比較淺的深色
        const around: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        const found = around.find(([dx, dy]) => MATERIAL.has(get(x + dx, y + dy)));
        if (!found) {
          colors[y * w + x] = palette[0];
          continue;
        }
        const material = palette[get(x + found[0], y + found[1]) - 1];
        if (!touchesClear(x, y)) colors[y * w + x] = shiftColor(material, 255, 10, 0.04, -0.26);
        else {
          const lit = found[0] > 0 || found[1] > 0;
          colors[y * w + x] = shiftColor(material, 260, 14, 0.06, lit ? -0.26 : -0.36);
        }
      } else if (v === INK) {
        colors[y * w + x] = shiftColor(palette[0], 260, 0, 0, -0.06);
      } else {
        colors[y * w + x] = base;
      }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colors[y * w + x];
    if (c) set(x, y, c);
  }
  // 反鋸齒：外框階梯的內角補一格半透明的外框色
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (get(x, y) !== CLEAR) continue;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (get(x + dx, y) === OUTLINE && get(x, y + dy) === OUTLINE) {
          const c = colors[y * w + x + dx];
          if (c) set(x, y, c, 110);
          break;
        }
      }
    }
  }
}
