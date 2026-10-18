// 像素格子與繪圖工具：色盤索引格、基本形狀、外框、毛的質感。所有姿勢和蛋共用。
// 格子裡存的是色盤索引，再由 render.ts 依畫風上色。

export const CLEAR = 0;
export const OUTLINE = 1;
export const BASE = 2;
export const PATTERN = 3;
export const LIGHT = 4;
export const SHADE = 5;
/** 固定色：眼睛和鼻頭的反光 */
export const SHINE = 6;
/** 固定色：舌頭、腮紅、貓鼠的鼻頭、鼠尾 */
export const PINK = 7;
/** 虹膜（依科別：貓的琥珀色、狗的褐色…） */
export const IRIS = 8;
/** 臉上的線條（眼睛、鼻子、嘴巴、鬍鬚）：一律深色，不跟著外框變色 */
export const INK = 9;

export interface Grid {
  w: number;
  h: number;
  px: Uint8Array;
}

export type Pt = readonly [number, number];
export type Mask = (current: number) => boolean;

export const anything: Mask = () => true;
export const onBase: Mask = (c) => c === BASE;
export const onFilled: Mask = (c) => c >= BASE;
export const onPattern: Mask = (c) => c === PATTERN;
export const onClear: Mask = (c) => c === CLEAR;
export const onFur: Mask = (c) => c === BASE || c === PATTERN || c === LIGHT;

export function makeGrid(w: number, h: number): Grid {
  return { w, h, px: new Uint8Array(w * h) };
}

export function at(g: Grid, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < g.w && y < g.h ? g.px[y * g.w + x] : CLEAR;
}

export function put(g: Grid, x: number, y: number, v: number): void {
  if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.px[y * g.w + x] = v;
}

/** 填滿像素中心落在橢圓內的格子 */
export function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, v: number, mask: Mask = anything): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && mask(at(g, x, y))) put(g, x, y, v);
    }
  }
}

export function triangle(g: Grid, a: Pt, b: Pt, c: Pt, v: number, mask: Mask = anything): void {
  const cross = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const total = cross(a, b, c);
  for (let y = Math.floor(Math.min(a[1], b[1], c[1])); y <= Math.ceil(Math.max(a[1], b[1], c[1])); y++) {
    for (let x = Math.floor(Math.min(a[0], b[0], c[0])); x <= Math.ceil(Math.max(a[0], b[0], c[0])); x++) {
      const p: Pt = [x + 0.5, y + 0.5];
      const w = [cross(b, c, p), cross(c, a, p), cross(a, b, p)];
      const inside = total > 0 ? w.every((n) => n >= 0) : w.every((n) => n <= 0);
      if (inside && mask(at(g, x, y))) put(g, x, y, v);
    }
  }
}

export function curve(p0: Pt, p1: Pt, p2: Pt, steps: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return points;
}

/** 1 像素寬的線 */
export function line(g: Grid, points: Pt[], v: number, mask: Mask = anything): void {
  for (const [x, y] of points) if (mask(at(g, Math.floor(x), Math.floor(y)))) put(g, Math.floor(x), Math.floor(y), v);
}

/** 在已填色區域外圍加上 1 像素外框 */
export function outline(g: Grid): void {
  const src = g.px.slice();
  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < g.w && y < g.h && src[y * g.w + x] >= BASE;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (src[y * g.w + x] !== CLEAR) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) put(g, x, y, OUTLINE);
    }
  }
}

/** 把 src 疊到 dst 上（透明格不覆蓋） */
export function stamp(dst: Grid, src: Grid): void {
  for (let i = 0; i < src.px.length; i++) if (src.px[i] !== CLEAR) dst.px[i] = src.px[i];
}

/** 把 g 裡符合條件的格子換成 v */
export function recolor(g: Grid, v: number, fn: (x: number, y: number, current: number) => boolean): void {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (fn(x, y, at(g, x, y))) put(g, x, y, v);
}

export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** 在邊緣往外長出一格。pick 決定哪些位置長 */
export function fringe(g: Grid, dirs: readonly Pt[], pick: (x: number, y: number) => boolean): void {
  const src = g.px.slice();
  const get = (x: number, y: number): number => (x >= 0 && y >= 0 && x < g.w && y < g.h ? src[y * g.w + x] : CLEAR);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = get(x, y);
      if (v < BASE) continue;
      for (const [dx, dy] of dirs) {
        if (get(x + dx, y + dy) === CLEAR && pick(x + dx, y + dy)) put(g, x + dx, y + dy, v);
      }
    }
  }
}

/** 長毛：沿著邊緣長出一排三角形的毛尖。dir 是生長方向，period 是毛尖間距，depth 是長度 */
export function tufts(g: Grid, dir: Pt, period: number, depth: number, region: (x: number, y: number) => boolean): void {
  for (let k = 0; k < depth; k++) {
    const half = (period / 2) * (1 - k / depth);
    fringe(g, [dir], (x, y) => region(x, y) && Math.abs(mod(dir[0] === 0 ? x : y, period) + 0.5 - period / 2) < half);
  }
}

/** 蓬鬆畫風：上下左右的邊緣都長出三角形的毛尖。pick 可以排除不該長毛的地方（例如臉） */
export function shag(g: Grid, u: number, pick: (x: number, y: number) => boolean = () => true): void {
  const period = Math.max(3, Math.round(2.4 * u));
  const depth = Math.max(1, Math.round(1.1 * u));
  for (const dir of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) tufts(g, dir, period, depth, pick);
}

/** 捲毛：沿著邊緣冒出一圈小圓，外框變成雲朵狀 */
export function bumps(g: Grid, r: number, every: number, pick: (x: number, y: number) => boolean = () => true): void {
  const src = g.px.slice();
  const get = (x: number, y: number): number => (x >= 0 && y >= 0 && x < g.w && y < g.h ? src[y * g.w + x] : CLEAR);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = get(x, y);
      if (v < BASE || mod(x + 2 * y, every) !== 0 || !pick(x, y)) continue;
      if (get(x - 1, y) && get(x + 1, y) && get(x, y - 1) && get(x, y + 1)) continue;
      ellipse(g, x + 0.5, y + 0.5, r, r, v, onClear);
    }
  }
}

/** 捲毛的紋理：散布的小弧線 */
export function curls(g: Grid, u: number, seed: number, skip: (x: number, y: number) => boolean): void {
  const cell = Math.max(3, Math.round(2.4 * u));
  for (let cy = 0; cy < g.h; cy += cell) {
    for (let cx = 0; cx < g.w; cx += cell) {
      const h = hash(cx, cy, seed);
      if (h % 3 === 0) continue;
      const ox = cx + ((h >>> 4) % (cell - 2));
      const oy = cy + ((h >>> 8) % (cell - 2));
      for (const [dx, dy] of [[0, 1], [1, 0], [2, 1]]) {
        if (at(g, ox + dx, oy + dy) === BASE && !skip(ox + dx, oy + dy)) put(g, ox + dx, oy + dy, PATTERN);
      }
    }
  }
}
