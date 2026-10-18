// 臉部細節：眼睛、鼻子、嘴巴、鬍鬚、腮紅。坐姿、捲睡和側面共用，眼睛畫法依畫風。

import { INK, IRIS, PINK, SHINE, curve, ellipse, line, onFur, put, triangle, type Grid } from './pixel.ts';
import type { Style } from './style.ts';
import type { Pose } from './types.ts';

/** 眼睛的半寬、半高：虹膜大眼跟著頭的大小，小眼用固定的設計單位 */
export function eyeSize(style: Style, headRx: number, headRy: number, u: number): [number, number] {
  switch (style.eyes) {
    case 'iris':
      return [Math.max(1.1 * u, headRx * 0.19), Math.max(1.3 * u, headRy * 0.24)];
    case 'dot':
      return [0.45 * u, 0.6 * u];
    case 'shine':
      return [0.6 * u, 0.85 * u];
  }
}

/** 一隻眼睛。開心是彎彎的眼，閉眼和累了是一條線 */
export function drawEye(g: Grid, x: number, y: number, rx: number, ry: number, style: Style, pose: Pose, u: number): void {
  const arc = Math.max(rx * 1.3, 0.8 * u);
  if (pose === 'happy') {
    line(g, curve([x - arc, y + ry * 0.3], [x, y - Math.max(ry, u) * 1.3], [x + arc, y + ry * 0.3], 16), INK);
    return;
  }
  if (pose === 'blink' || pose === 'sleep' || pose === 'tired') {
    line(g, curve([x - arc, y], [x, y + (pose === 'tired' ? 0.2 : 0.75) * Math.max(ry, u)], [x + arc, y], 16), INK);
    return;
  }
  const ey = pose === 'look' ? y - 0.3 * u : y;
  ellipse(g, x, ey, rx, ry, INK);
  if (style.eyes === 'iris') {
    // 虹膜在下半部、黑色瞳孔、左上一大一小兩個反光
    ellipse(g, x, ey + ry * 0.12, rx * 0.78, ry * 0.8, IRIS);
    ellipse(g, x, ey - ry * 0.05, rx * 0.52, ry * 0.64, INK);
    const r = Math.max(0.6, rx * 0.3);
    ellipse(g, x - rx * 0.32, ey - ry * 0.42, r, r, SHINE);
    put(g, Math.round(x + rx * 0.35), Math.round(ey + ry * 0.4), SHINE);
  } else if (style.eyes === 'shine') {
    put(g, Math.round(x - rx * 0.4), Math.round(ey - ry * 0.45), SHINE);
  }
}

export interface FrontFace {
  u: number;
  cx: number;
  eyeY: number;
  /** 兩眼間距的一半 */
  eyeDx: number;
  eyeRx: number;
  eyeRy: number;
  noseY: number;
  /** 粉紅小鼻子（貓、鼠）、狗和熊的黑鼻頭、袋熊的大鼻子 */
  nose: 'pink' | 'dog' | 'big';
  mouth: boolean;
  /** 鬍鬚從哪裡開始（臉頰的半寬）；沒有鬍鬚為 null */
  whiskers: number | null;
}

/** 正面的臉：坐姿和捲睡用 */
export function drawFrontFace(g: Grid, f: FrontFace, style: Style, pose: Pose): void {
  const { u, cx, noseY } = f;
  for (const side of [-1, 1]) drawEye(g, cx + side * f.eyeDx, f.eyeY, f.eyeRx, f.eyeRy, style, pose, u);
  if (pose === 'happy' || style.blush) {
    for (const side of [-1, 1]) {
      ellipse(g, cx + side * (f.eyeDx + f.eyeRx * 0.3), f.eyeY + f.eyeRy + 1.1 * u, Math.max(0.8 * u, f.eyeRx * 0.9), 0.4 * u, PINK, onFur);
    }
  }
  switch (f.nose) {
    case 'pink':
      triangle(g, [cx - 0.75 * u, noseY - 0.4 * u], [cx + 0.75 * u, noseY - 0.4 * u], [cx, noseY + 0.5 * u], PINK);
      break;
    case 'dog':
    case 'big': {
      const [rx, ry] = f.nose === 'big' ? [1.6 * u, 1.05 * u] : [1.05 * u, 0.7 * u];
      ellipse(g, cx, noseY, rx, ry, INK);
      put(g, Math.round(cx - rx * 0.35), Math.round(noseY - ry * 0.35), SHINE);
      break;
    }
  }
  const bottom = noseY + (f.nose === 'pink' ? 0.5 : f.nose === 'big' ? 1.05 : 0.7) * u;
  if (f.mouth) {
    // 鼻子下方一小段直線，再分成左右兩道弧（ω）
    const my = bottom + 0.5 * u;
    line(g, curve([cx, bottom], [cx, (bottom + my) / 2], [cx, my], 6), INK);
    for (const side of [-1, 1]) line(g, curve([cx, my], [cx + side * 0.5 * u, my + 0.8 * u], [cx + side * 1.1 * u, my + 0.1 * u], 12), INK);
    if (pose === 'happy') {
      ellipse(g, cx, my + 1 * u, 0.85 * u, 0.75 * u, INK);
      ellipse(g, cx, my + 1.1 * u, 0.55 * u, 0.5 * u, PINK);
    }
  }
  if (f.whiskers !== null) {
    for (const side of [-1, 1]) {
      for (const k of [-1, 1]) {
        const x0 = cx + side * f.whiskers * 0.55;
        const y0 = noseY + 0.4 * u + k * 0.45 * u;
        line(g, curve([x0, y0], [x0 + side * 1.4 * u, y0 + k * 0.3 * u], [cx + side * (f.whiskers + 2 * u), y0 + k * 1.1 * u], 12), INK);
      }
    }
  }
}
