// 像素寵物的程序化產生器（DESIGN.md §11）。
// 輸出的是色盤索引格（0 透明、1 外框、2 底色、3 花紋、4 亮色），再由 render.ts 套上色盤。
// 同一科共用骨架（頭、身體、耳朵、尾巴），品種只換色盤、花紋和耳型。

import type { Body, Ears, Family, Pattern, Pose, Stage } from './types.ts';

export const CLEAR = 0;
export const OUTLINE = 1;
export const BASE = 2;
export const PATTERN = 3;
export const LIGHT = 4;

export interface Grid {
  w: number;
  h: number;
  px: Uint8Array;
}

type Pt = readonly [number, number];
type Mask = (current: number) => boolean;

const anything: Mask = () => true;
const onBase: Mask = (c) => c === BASE;
const onFilled: Mask = (c) => c >= BASE;

export function makeGrid(w: number, h: number): Grid {
  return { w, h, px: new Uint8Array(w * h) };
}

export function at(g: Grid, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < g.w && y < g.h ? g.px[y * g.w + x] : CLEAR;
}

function put(g: Grid, x: number, y: number, v: number): void {
  if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.px[y * g.w + x] = v;
}

/** 填滿像素中心落在橢圓內的格子 */
function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, v: number, mask: Mask = anything): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && mask(at(g, x, y))) put(g, x, y, v);
    }
  }
}

function triangle(g: Grid, a: Pt, b: Pt, c: Pt, v: number, mask: Mask = anything): void {
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

function curve(p0: Pt, p1: Pt, p2: Pt, steps: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return points;
}

/** 在已填色區域外圍加上 1 像素外框 */
function outline(g: Grid): void {
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
function stamp(dst: Grid, src: Grid): void {
  for (let i = 0; i < src.px.length; i++) if (src.px[i] !== CLEAR) dst.px[i] = src.px[i];
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 寵物 ──

type GrownStage = Exclude<Stage, 'egg'>;
type Tail = 'long' | 'wag' | 'thin' | 'none' | 'stub';

interface StageShape {
  /** 寵物本體的像素高度（§11.2：幼年 24、少年／成年 32） */
  size: number;
  head: Pt;
  body: Pt;
  ear: number;
}

const STAGES: Record<GrownStage, StageShape> = {
  baby: { size: 24, head: [6.5, 5.5], body: [4.5, 4], ear: 0.8 },
  juvenile: { size: 32, head: [7, 6], body: [5.5, 6.5], ear: 1 },
  adult: { size: 32, head: [8, 6.5], body: [7, 7.5], ear: 1.1 },
};

const BODY_WIDTH: Record<Body, number> = { very_thin: 0.72, thin: 0.86, standard: 1, fat: 1.15, very_fat: 1.3 };
const TAILS: Record<Family, Tail> = { cat: 'long', dog: 'wag', mouse: 'thin', hamster: 'none', bear: 'stub' };

/** 左右各留 4 像素給尾巴 */
const SIDE_MARGIN = 4;

export interface CreatureSpec {
  family: Family;
  stage: GrownStage;
  body: Body;
  pattern: Pattern;
  ears: Ears;
}

export interface Frame {
  pose: Pose;
  /** 呼吸起伏 */
  breathe: boolean;
  /** 尾巴擺動 −1～1 */
  tail: number;
}

interface Geometry {
  s: number;
  cx: number;
  /** 中心那一欄的像素 x */
  c: number;
  headY: number;
  hrx: number;
  hry: number;
  bodyY: number;
  brx: number;
  bry: number;
}

type Part = 'head' | 'body' | 'tail';

function applyPattern(g: Grid, part: Part, pattern: Pattern, geo: Geometry): void {
  const { s, cx, c, headY, hrx, hry, bodyY, bry } = geo;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = at(g, x, y);
      const maskable = pattern === 'mask' && part === 'head' && v === LIGHT;
      if (v !== BASE && !maskable) continue;
      let dark = false;
      switch (pattern) {
        case 'stripes':
          if (part === 'head') dark = y <= headY - hry * 0.45 && (x === c || x === c - 2 || x === c + 2);
          else if (part === 'body') dark = y % 3 === 1;
          else dark = x % 2 === 0;
          break;
        case 'points':
          if (part === 'head') dark = y < headY - hry + 0.5;
          else if (part === 'body') dark = y >= s - 2;
          else dark = true;
          break;
        case 'mask': {
          if (part === 'head') {
            const dx = (x + 0.5 - cx) / (hrx * 0.45);
            const dy = (y + 0.5 - (headY + hry * 0.35)) / (hry * 0.48);
            dark = dx * dx + dy * dy <= 1;
          } else if (part === 'body') dark = y >= s - 2;
          else dark = true;
          break;
        }
        case 'cap':
          if (part === 'head') dark = y < headY - hry * 0.1;
          else if (part === 'body') dark = y < bodyY - bry * 0.35;
          else dark = true;
          break;
        case 'dorsal':
          dark = part === 'head' && x === c && y < headY - hry * 0.2;
          break;
        case 'panda':
          if (part === 'body') dark = y < bodyY - bry * 0.3 || y >= s - 2.5;
          else dark = part === 'tail';
          break;
        case 'solid':
          break;
      }
      if (dark) put(g, x, y, PATTERN);
    }
  }
}

function drawEars(g: Grid, ears: Ears, geo: Geometry, scale: number, color: number): void {
  const { cx, headY, hrx, hry } = geo;
  for (const side of [-1, 1]) {
    switch (ears) {
      case 'pointy': {
        const a: Pt = [cx + side * (hrx - 0.6), headY - hry * 0.25];
        const b: Pt = [cx + side * hrx * 0.12, headY - hry + 0.2];
        const tip: Pt = [cx + side * hrx * 0.62, headY - hry - 3.2 * scale];
        triangle(g, a, b, tip, color);
        if (color === BASE) {
          const mid: Pt = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3];
          const shrink = (p: Pt, f: number): Pt => [mid[0] + (p[0] - mid[0]) * f, mid[1] + (p[1] - mid[1]) * f];
          triangle(g, shrink(a, 0.45), shrink(b, 0.45), shrink(tip, 0.6), LIGHT, onBase);
        }
        break;
      }
      case 'round':
        ellipse(g, cx + side * hrx * 0.68, headY - hry * 0.78, 2.4 * scale, 2.4 * scale, color);
        break;
      case 'small':
        ellipse(g, cx + side * hrx * 0.6, headY - hry * 0.85, 1.7 * scale, 1.5 * scale, color);
        break;
      case 'big':
        ellipse(g, cx + side * hrx * 0.75, headY - hry * 0.75, 3.4 * scale, 3.4 * scale, color);
        if (color === BASE) ellipse(g, cx + side * hrx * 0.75, headY - hry * 0.75, 2 * scale, 2 * scale, LIGHT);
        break;
      case 'floppy':
        break;
    }
  }
}

function thick(g: Grid, points: Pt[], r: number): void {
  for (const [x, y] of points) ellipse(g, x, y, r, r, BASE);
}

export function drawCreature(spec: CreatureSpec, frame: Frame): Grid {
  const shape = STAGES[spec.stage];
  const s = shape.size;
  const w = s + SIDE_MARGIN * 2;
  const cx = w / 2 - 0.5;
  const c = Math.floor(cx);
  const sleeping = frame.pose === 'sleep';
  const lowered = sleeping ? 2 : frame.pose === 'tired' ? 1 : 0;
  const fat = spec.body === 'very_fat' ? 2 : spec.body === 'fat' ? 1 : 0;

  const brx = shape.body[0] * BODY_WIDTH[spec.body] + (sleeping ? 1 : 0);
  const bry = shape.body[1] - (sleeping ? 1 : 0) + (frame.breathe ? 0.4 : 0) + (fat === 2 ? 0.4 : 0);
  const bodyY = s - 0.6 - bry;
  const hrx = shape.head[0] + fat * 0.35;
  const hry = shape.head[1];
  const headY = bodyY - bry - hry * 0.7 + lowered;
  const geo: Geometry = { s, cx, c, headY, hrx, hry, bodyY, brx, bry };

  // 尾巴（在身體後面；睡覺的貓把尾巴圍在身體前面）
  const back = makeGrid(w, s);
  let front: Grid | null = null;
  switch (TAILS[spec.family]) {
    case 'long':
      if (sleeping) {
        front = makeGrid(w, s);
        thick(front, curve([cx + brx * 0.6, bodyY + bry * 0.5], [cx + brx * 0.2, s - 0.8], [cx - brx * 0.55, s - 1.6], 14), 1.1);
      } else {
        const end: Pt = [cx + brx + 3.2 + frame.tail, bodyY - bry * 0.95];
        thick(back, curve([cx + brx * 0.7, bodyY + bry * 0.55], [cx + brx + 4.5, bodyY + bry * 0.9], end, 16), 1.15);
      }
      break;
    case 'wag': {
      const end: Pt = [cx + brx + 2 + frame.tail * 0.8, bodyY - bry - 0.8];
      thick(back, curve([cx + brx * 0.7, bodyY - bry * 0.05], [cx + brx + 2.2, bodyY - 0.2], end, 10), 1.2);
      break;
    }
    case 'thin':
      for (const [x, y] of curve([cx + brx * 0.7, bodyY + bry * 0.6], [cx + brx + 5, s - 0.2], [cx + brx + 6.5 + frame.tail, s - 3.5], 24)) {
        put(back, Math.floor(x), Math.floor(y), OUTLINE);
      }
      break;
    case 'stub':
      ellipse(back, cx + brx * 0.85, bodyY + bry * 0.35, 1.5, 1.5, BASE);
      break;
    case 'none':
      break;
  }
  for (const layer of front ? [back, front] : [back]) {
    applyPattern(layer, 'tail', spec.pattern, geo);
    outline(layer);
  }

  // 身體與肚子
  const bodyLayer = makeGrid(w, s);
  ellipse(bodyLayer, cx, bodyY, brx, bry, BASE);
  ellipse(bodyLayer, cx, bodyY + bry * 0.3, brx * 0.55, bry * 0.6, LIGHT, onBase);
  applyPattern(bodyLayer, 'body', spec.pattern, geo);
  outline(bodyLayer);
  if (!sleeping) {
    put(bodyLayer, c, s - 1, OUTLINE);
    put(bodyLayer, c, s - 2, OUTLINE);
  }

  // 頭、耳朵、口鼻
  const head = makeGrid(w, s);
  const darkEars = spec.pattern !== 'solid' && spec.pattern !== 'stripes' && spec.pattern !== 'dorsal';
  drawEars(head, spec.ears, geo, shape.ear * (sleeping ? 0.8 : 1), darkEars ? PATTERN : BASE);
  ellipse(head, cx, headY, hrx, hry, BASE);
  ellipse(head, cx, headY + hry * 0.45, hrx * 0.42, hry * 0.36, LIGHT, onBase);
  const eyeY = Math.round(headY - 0.3);
  const eyeDx = Math.max(2, Math.round(hrx * 0.42));
  if (spec.pattern === 'panda') {
    for (const side of [-1, 1]) ellipse(head, c + side * eyeDx + 0.5, eyeY + 0.3, 1.6, 2, PATTERN, onFilled);
  }
  applyPattern(head, 'head', spec.pattern, geo);
  outline(head);

  // 垂耳蓋在頭上
  let floppy: Grid | null = null;
  if (spec.ears === 'floppy') {
    floppy = makeGrid(w, s);
    for (const side of [-1, 1]) ellipse(floppy, cx + side * (hrx - 0.2), headY - hry * 0.15 + (sleeping ? 1 : 0), 1.9, 3.8, PATTERN);
    outline(floppy);
  }

  const out = makeGrid(w, s);
  for (const layer of [back, bodyLayer, head, floppy, front]) if (layer) stamp(out, layer);

  // 五官
  const eye = spec.pattern === 'panda' ? LIGHT : OUTLINE;
  for (const side of [-1, 1]) {
    const ex = c + side * eyeDx;
    switch (frame.pose) {
      case 'idle':
        put(out, ex, eyeY - 1, eye);
        put(out, ex, eyeY, eye);
        break;
      case 'look':
        put(out, ex, eyeY - 2, eye);
        put(out, ex, eyeY - 1, eye);
        break;
      case 'happy':
        put(out, ex - 1, eyeY, eye);
        put(out, ex, eyeY - 1, eye);
        put(out, ex + 1, eyeY, eye);
        break;
      case 'blink':
      case 'sleep':
      case 'tired':
        put(out, ex, eyeY, eye);
        put(out, ex + side, eyeY, eye);
        break;
    }
  }
  const noseY = Math.round(headY + hry * 0.3);
  put(out, c, noseY, OUTLINE);
  put(out, c - 1, noseY + 1, OUTLINE);
  put(out, c + 1, noseY + 1, OUTLINE);
  return out;
}

// ── 蛋（§3.1：紋路類型暗示科別） ──

type EggPattern = 'stripes' | 'patches' | 'freckles' | 'split' | 'dark';
const EGG_PATTERN: Record<Family, EggPattern> = {
  cat: 'stripes',
  dog: 'patches',
  mouse: 'freckles',
  hamster: 'split',
  bear: 'dark',
};
const CRACK: readonly Pt[] = [[7, 10], [8, 9], [9, 10], [10, 11], [11, 10], [12, 9], [13, 10], [14, 11], [15, 10]];

export const EGG_SIZE = 24;

export function drawEgg(family: Family, seed: number, cracked: boolean): Grid {
  const g = makeGrid(EGG_SIZE, EGG_SIZE);
  const cx = 11.5;
  const cy = 13.2;
  ellipse(g, cx, cy, 7.6, 9.6, BASE);
  const random = mulberry32(seed);
  const each = (fn: (x: number, y: number) => boolean): void => {
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (at(g, x, y) === BASE && fn(x, y)) put(g, x, y, PATTERN);
  };
  switch (EGG_PATTERN[family]) {
    case 'stripes':
      each((x, y) => (y + seed + ((x >> 2) & 1)) % 4 === 0);
      break;
    case 'patches':
      for (let i = 0; i < 3; i++) {
        ellipse(g, cx + (random() - 0.5) * 9, cy + (random() - 0.5) * 12, 2 + random() * 1.4, 1.8 + random() * 1.4, PATTERN, onBase);
      }
      break;
    case 'freckles':
      each((x, y) => hash(x, y, seed) % 9 === 0);
      break;
    case 'split': {
      const line = Math.round(cy + (seed % 3) - 1);
      each((_, y) => y > line);
      break;
    }
    case 'dark':
      each(() => true);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (at(g, x, y) === PATTERN && hash(x, y, seed) % 11 === 0) put(g, x, y, BASE);
      break;
  }
  ellipse(g, cx - 3, cy - 4.5, 1.6, 1.3, LIGHT, onFilled);
  outline(g);
  if (cracked) for (const [x, y] of CRACK) if (at(g, x, y) >= BASE) put(g, x, y, OUTLINE);
  return g;
}
