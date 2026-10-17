// 像素寵物的程序化產生器（DESIGN.md §11）。
// 輸出的是色盤索引格（0 透明、1 外框、2 底色、3 花紋、4 亮色），再由 render.ts 套上色盤。
// 科決定骨架（頭身比例、口鼻、鬍鬚），品種換色盤、花紋、耳型、尾巴和特徵部件（palette.ts）。

import type { EggStyle } from './palette.ts';
import type { Body, Ears, Family, Feature, Pattern, Pose, Stage, Tail } from './types.ts';

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
const onPattern: Mask = (c) => c === PATTERN;

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

/** 把 g 裡符合條件的格子換成 v */
function recolor(g: Grid, v: number, fn: (x: number, y: number, current: number) => boolean): void {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (fn(x, y, at(g, x, y))) put(g, x, y, v);
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

/** 科的骨架：同一科共用 */
interface Skeleton {
  /** 頭寬、身體寬的倍率 */
  head: number;
  body: number;
  /** 頭往身體裡沉的像素數（倉鼠幾乎沒有脖子） */
  sink: number;
  /** 口鼻亮色區相對頭的大小 */
  muzzle: Pt;
  nose: 'cat' | 'dog' | 'dot' | 'bear';
  whiskers: boolean;
}

const SKELETONS: Record<Family, Skeleton> = {
  cat: { head: 1, body: 1, sink: 0, muzzle: [0.42, 0.36], nose: 'cat', whiskers: false },
  dog: { head: 1, body: 1, sink: 0, muzzle: [0.5, 0.42], nose: 'dog', whiskers: false },
  mouse: { head: 0.92, body: 0.95, sink: 0, muzzle: [0.34, 0.3], nose: 'dot', whiskers: true },
  hamster: { head: 1.06, body: 1.2, sink: 2.2, muzzle: [0.34, 0.3], nose: 'dot', whiskers: false },
  bear: { head: 1.04, body: 1.12, sink: 0.5, muzzle: [0.5, 0.42], nose: 'bear', whiskers: false },
};

const BODY_WIDTH: Record<Body, number> = { very_thin: 0.72, thin: 0.86, standard: 1, fat: 1.15, very_fat: 1.3 };

/** 左右各留 4 像素給尾巴 */
const SIDE_MARGIN = 4;

export interface CreatureSpec {
  family: Family;
  stage: GrownStage;
  body: Body;
  pattern: Pattern;
  ears: Ears;
  tail: Tail;
  features: readonly Feature[];
  /** 品種體格：身體寬、高的倍率 */
  build: readonly [number, number];
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
  /** 幼年：品種特徵才剛出現，身上的條紋還沒長出來（§11.1） */
  baby: boolean;
}

type Part = 'head' | 'body' | 'tail';

function applyPattern(g: Grid, part: Part, pattern: Pattern, geo: Geometry): void {
  const { s, cx, c, headY, hrx, hry, bodyY, bry, baby } = geo;
  recolor(g, PATTERN, (x, y, v) => {
    const maskable = pattern === 'mask' && part === 'head' && v === LIGHT;
    if (v !== BASE && !maskable) return false;
    switch (pattern) {
      case 'stripes':
        if (part === 'head') return y <= headY - hry * 0.45 && (x === c || x === c - 2 || x === c + 2);
        if (part === 'body') return !baby && y % 3 === 1;
        return x % 2 === 0;
      case 'points':
        if (part === 'head') return y < headY - hry + 0.5;
        if (part === 'body') return y >= s - 2;
        return true;
      case 'mask': {
        if (part === 'head') {
          const dx = (x + 0.5 - cx) / (hrx * 0.45);
          const dy = (y + 0.5 - (headY + hry * 0.35)) / (hry * 0.48);
          return dx * dx + dy * dy <= 1;
        }
        if (part === 'body') return y >= s - 2;
        return true;
      }
      case 'cap':
        if (part === 'head') return y < headY - hry * 0.1;
        if (part === 'body') return y < bodyY - bry * 0.35;
        return true;
      case 'dorsal':
        return part === 'head' && x === c && y < headY - hry * 0.2;
      case 'panda':
        if (part === 'body') return y < bodyY - bry * 0.3 || y >= s - 2.5;
        return part === 'tail';
      case 'solid':
        return false;
    }
  });
}

/** 三角形的立耳：spread 讓耳朵往外開，height 是耳尖高出頭頂的像素數 */
function pointedEar(g: Grid, geo: Geometry, side: number, spread: number, height: number, color: number): void {
  const { cx, headY, hrx, hry } = geo;
  const a: Pt = [cx + side * (hrx - 0.6 + spread), headY - hry * 0.25];
  const b: Pt = [cx + side * hrx * 0.12, headY - hry + 0.2];
  const tip: Pt = [cx + side * (hrx * 0.62 + spread), headY - hry - height];
  triangle(g, a, b, tip, color);
  if (color === BASE) {
    const mid: Pt = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3];
    const shrink = (p: Pt, f: number): Pt => [mid[0] + (p[0] - mid[0]) * f, mid[1] + (p[1] - mid[1]) * f];
    triangle(g, shrink(a, 0.45), shrink(b, 0.45), shrink(tip, 0.6), LIGHT, onBase);
  }
}

/** 畫在頭後面的耳朵；垂耳另外畫在頭上（drawLopEars） */
function drawEars(g: Grid, ears: Ears, geo: Geometry, scale: number, color: number): void {
  const { cx, headY, hrx, hry } = geo;
  for (const side of [-1, 1]) {
    switch (ears) {
      case 'pointy':
        pointedEar(g, geo, side, 0, 3.2 * scale, color);
        break;
      case 'short':
        pointedEar(g, geo, side, 0.4, 2 * scale, color);
        break;
      case 'tall':
        pointedEar(g, geo, side, 0.6, 4.6 * scale, color);
        break;
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
      case 'curly':
        break;
    }
  }
}

function drawLopEars(ears: Ears, geo: Geometry, w: number, sleeping: boolean, seed: number): Grid | null {
  if (ears !== 'floppy' && ears !== 'curly') return null;
  const { cx, headY, hrx, hry } = geo;
  const g = makeGrid(w, geo.s);
  const drop = sleeping ? 1 : 0;
  for (const side of [-1, 1]) {
    if (ears === 'floppy') {
      ellipse(g, cx + side * (hrx - 0.2), headY - hry * 0.15 + drop, 1.9, 3.8, PATTERN);
    } else {
      // 貴賓犬：蓬鬆的捲毛耳，用深色點表現捲度
      const ex = cx + side * (hrx - 0.1);
      const ey = headY + hry * 0.05 + drop;
      ellipse(g, ex, ey, 2.5, 4.4, BASE);
      recolor(g, PATTERN, (x, y, v) => v === BASE && Math.abs(x + 0.5 - ex) < 3 && hash(x, y, seed) % 4 === 0);
    }
  }
  outline(g);
  return g;
}

function thick(g: Grid, points: Pt[], r: number): void {
  for (const [x, y] of points) ellipse(g, x, y, r, r, BASE);
}

/** 尾巴。睡覺時長尾巴圍在身體前面，所以分成後層和前層 */
function drawTail(tail: Tail, geo: Geometry, w: number, frame: Frame): { back: Grid; front: Grid | null } {
  const { s, cx, bodyY, brx, bry } = geo;
  const back = makeGrid(w, s);
  let front: Grid | null = null;
  const sleeping = frame.pose === 'sleep';
  switch (tail) {
    case 'long':
    case 'fluffy': {
      const r = tail === 'fluffy' ? 1.6 : 1.15;
      if (sleeping) {
        front = makeGrid(w, s);
        thick(front, curve([cx + brx * 0.6, bodyY + bry * 0.5], [cx + brx * 0.2, s - 0.8], [cx - brx * 0.55, s - 1.6], 14), r - 0.05);
      } else {
        const end: Pt = [cx + brx + 3.2 + frame.tail, bodyY - bry * 0.95];
        thick(back, curve([cx + brx * 0.7, bodyY + bry * 0.55], [cx + brx + 4.5, bodyY + bry * 0.9], end, 16), r);
      }
      break;
    }
    case 'wag':
    case 'feather': {
      const end: Pt = [cx + brx + 2 + frame.tail * 0.8, bodyY - bry - 0.8];
      thick(back, curve([cx + brx * 0.7, bodyY - bry * 0.05], [cx + brx + 2.2, bodyY - 0.2], end, 10), tail === 'feather' ? 1.7 : 1.2);
      break;
    }
    case 'curl': {
      // 捲尾（柴犬、哈士奇）：從正面看是身體側邊一圈捲起來的毛，中心是亮色的尾巴內側
      const ring: Pt = [cx + brx + 1.2 + frame.tail * 0.4, bodyY - bry * 0.45];
      thick(back, curve([cx + brx * 0.6, bodyY + bry * 0.3], [cx + brx + 1.5, bodyY + bry * 0.2], ring, 6), 1);
      ellipse(back, ring[0], ring[1], 2.5, 2.5, BASE);
      ellipse(back, ring[0] - 0.3, ring[1] + 0.2, 1.1, 1.1, LIGHT, onBase);
      break;
    }
    case 'pom': {
      // 貴賓犬：短尾巴加一顆毛球
      const ball: Pt = [cx + brx + 1.6 + frame.tail * 0.5, bodyY - bry * 0.55];
      thick(back, curve([cx + brx * 0.7, bodyY], [cx + brx + 1, bodyY - bry * 0.2], ball, 6), 0.8);
      ellipse(back, ball[0], ball[1], 2.1, 2.1, BASE);
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
  return { back, front };
}

export function drawCreature(spec: CreatureSpec, frame: Frame, seed = 0): Grid {
  const shape = STAGES[spec.stage];
  const sk = SKELETONS[spec.family];
  const has = (f: Feature): boolean => spec.features.includes(f);
  const s = shape.size;
  const w = s + SIDE_MARGIN * 2;
  const cx = w / 2 - 0.5;
  const c = Math.floor(cx);
  const sleeping = frame.pose === 'sleep';
  const lowered = sleeping ? 2 : frame.pose === 'tired' ? 1 : 0;
  const fat = spec.body === 'very_fat' ? 2 : spec.body === 'fat' ? 1 : 0;
  const flat = has('flat_face');
  const [buildW, buildH] = spec.build;

  const brx = shape.body[0] * BODY_WIDTH[spec.body] * sk.body * buildW + (sleeping ? 1 : 0);
  const bry = shape.body[1] * buildH - (sleeping ? 1 : 0) + (frame.breathe ? 0.4 : 0) + (fat === 2 ? 0.4 : 0);
  const bodyY = s - 0.6 - bry;
  const hrx = shape.head[0] * sk.head + fat * 0.35 + (has('cheeks') ? 0.8 : 0) + (flat ? 0.5 : 0);
  const hry = shape.head[1] - (has('cheeks') ? 0.2 : 0);
  const headY = bodyY - bry - hry * 0.7 + lowered + sk.sink;
  const geo: Geometry = { s, cx, c, headY, hrx, hry, bodyY, brx, bry, baby: spec.stage === 'baby' };

  // 尾巴（在身體後面；睡覺的貓把尾巴圍在身體前面）
  const { back, front } = drawTail(spec.tail, geo, w, frame);
  for (const layer of front ? [back, front] : [back]) {
    applyPattern(layer, 'tail', spec.pattern, geo);
    outline(layer);
  }

  // 身體與肚子
  const bodyLayer = makeGrid(w, s);
  ellipse(bodyLayer, cx, bodyY, brx, bry, BASE);
  ellipse(bodyLayer, cx, bodyY + bry * 0.3, brx * 0.55, bry * 0.6, LIGHT, onBase);
  if (has('bib')) ellipse(bodyLayer, cx, bodyY - bry * 0.35, brx * 0.5, bry * 0.55, LIGHT, onBase);
  applyPattern(bodyLayer, 'body', spec.pattern, geo);
  outline(bodyLayer);
  if (!sleeping) {
    put(bodyLayer, c, s - 1, OUTLINE);
    put(bodyLayer, c, s - 2, OUTLINE);
  }

  // 頭、耳朵、口鼻
  const head = makeGrid(w, s);
  const darkEars = spec.pattern !== 'solid' && spec.pattern !== 'stripes' && spec.pattern !== 'dorsal';
  const earScale = shape.ear * (sleeping ? 0.8 : 1);
  drawEars(head, spec.ears, geo, earScale, darkEars ? PATTERN : BASE);
  ellipse(head, cx, headY, hrx, hry, BASE);
  const muzzleK = flat ? 0.8 : 1;
  ellipse(head, cx, headY + hry * (flat ? 0.35 : 0.45), hrx * sk.muzzle[0] * muzzleK, hry * sk.muzzle[1] * muzzleK, LIGHT, onBase);
  if (has('urajiro') || has('pouches')) {
    // 柴犬的白色臉頰（裏白）、倉鼠的頰囊
    const [kx, ky, r] = has('urajiro') ? [0.55, 0.38, 0.32] : [0.62, 0.42, 0.3];
    for (const side of [-1, 1]) ellipse(head, cx + side * hrx * kx, headY + hry * ky, hrx * r, hry * r, LIGHT, onBase);
  }
  if (has('blaze')) {
    // 柯基額頭中央的白線
    for (let y = Math.round(headY - hry + 1); y <= Math.round(headY + hry * 0.3); y++) {
      if (at(head, c, y) === BASE) put(head, c, y, LIGHT);
    }
  }
  const eyeY = Math.round(headY - 0.3);
  const eyeDx = Math.max(2, Math.round(hrx * 0.42));
  if (spec.pattern === 'panda') {
    for (const side of [-1, 1]) ellipse(head, c + side * eyeDx + 0.5, eyeY + 0.3, 1.6, 2, PATTERN, onFilled);
  }
  applyPattern(head, 'head', spec.pattern, geo);
  outline(head);

  // 貴賓犬頭頂的毛球：獨立一層加外框，看起來是一團蓬毛
  let tuft: Grid | null = null;
  if (has('topknot')) {
    tuft = makeGrid(w, s);
    const ty = headY - hry * 0.8;
    ellipse(tuft, cx, ty, hrx * 0.58, hry * 0.45, BASE);
    recolor(tuft, PATTERN, (x, y, v) => v === BASE && y < ty && hash(x, y, seed + 1) % 4 === 0);
    outline(tuft);
  }

  const lop = drawLopEars(spec.ears, geo, w, sleeping, seed);

  const out = makeGrid(w, s);
  for (const layer of [back, bodyLayer, head, tuft, lop, front]) if (layer) stamp(out, layer);

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
  const noseY = Math.round(headY + hry * (flat ? 0.2 : 0.3));
  switch (sk.nose) {
    case 'cat':
      put(out, c, noseY, OUTLINE);
      put(out, c - 1, noseY + 1, OUTLINE);
      put(out, c + 1, noseY + 1, OUTLINE);
      break;
    case 'dog':
      for (let dx = -1; dx <= 1; dx++) put(out, c + dx, noseY, OUTLINE);
      put(out, c, noseY + 1, OUTLINE);
      break;
    case 'bear': {
      const half = has('big_nose') ? 2 : 1;
      for (let dx = -half; dx <= half; dx++) put(out, c + dx, noseY, OUTLINE);
      if (has('big_nose')) for (let dx = -1; dx <= 1; dx++) put(out, c + dx, noseY + 1, OUTLINE);
      else put(out, c, noseY + 1, OUTLINE);
      break;
    }
    case 'dot':
      put(out, c, noseY, OUTLINE);
      break;
  }
  if (sk.whiskers) {
    // 鬍鬚從臉頰往外伸
    const edge = Math.floor(hrx * 0.95) + 2;
    for (const side of [-1, 1]) {
      for (const [dy, dx] of [[0, 0], [0, 1], [2, 0], [2, 1]] as const) put(out, c + side * (edge + dx), noseY + dy, OUTLINE);
    }
  }
  return out;
}

// ── 蛋（§3.1：紋路類型暗示科別，密度、大小、方向和底色暗示品種） ──

type EggPattern = 'stripes' | 'patches' | 'freckles' | 'split' | 'dark';
const EGG_PATTERN: Record<Family, EggPattern> = {
  cat: 'stripes',
  dog: 'patches',
  mouse: 'freckles',
  hamster: 'split',
  bear: 'dark',
};

export const EGG_SIZE = 24;
const EGG_CX = 11.5;
const EGG_CY = 13.2;
const EGG_RX = 7.6;
const EGG_RY = 9.6;

/** 裂痕所在的列：沿著蛋的上半部呈鋸齒狀，孵化時蛋殼從這裡裂成上下兩半 */
export function crackY(x: number): number {
  return 10 + [0, -1, 0, 1][((x % 4) + 4) % 4];
}

/** 0～1 的值換成整數區間 [lo, hi] */
function lerpInt(lo: number, hi: number, t: number): number {
  return Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, t)));
}

/**
 * `crack` 是裂痕長度 0～1：0 沒有裂痕，1 橫跨整顆蛋。
 * `seed` 決定同品種之間的個體差異（斑點位置、條紋起點）。
 */
export function drawEgg(family: Family, style: EggStyle, seed: number, crack: number): Grid {
  const g = makeGrid(EGG_SIZE, EGG_SIZE);
  const cx = EGG_CX;
  const cy = EGG_CY;
  ellipse(g, cx, cy, EGG_RX, EGG_RY, BASE);
  const random = mulberry32(seed);
  const each = (fn: (x: number, y: number) => boolean): void => recolor(g, PATTERN, (x, y, v) => v === BASE && fn(x, y));
  switch (EGG_PATTERN[family]) {
    case 'stripes': {
      // 密度 → 間距 6～3；大小 → 粗 1～2；角度 → 斜紋；個體差異：起點與是否波浪
      const spacing = lerpInt(6, 3, style.density);
      const width = style.size >= 0.5 ? 2 : 1;
      const slope = Math.tan((style.angle * Math.PI) / 180);
      const phase = Math.floor(random() * spacing);
      const wavy = random() < 0.5;
      each((x, y) => {
        const u = Math.floor(y + (x - cx) * slope + (wavy ? (x >> 2) & 1 : 0)) + phase;
        return ((u % spacing) + spacing) % spacing < width;
      });
      break;
    }
    case 'patches': {
      // 密度 → 2～5 塊；大小 → 半徑
      const count = lerpInt(2, 5, style.density);
      const r = 1.4 + style.size * 1.8;
      for (let i = 0; i < count; i++) {
        const px = cx + (random() - 0.5) * 10;
        const py = cy + (random() - 0.5) * 13;
        ellipse(g, px, py, r * (0.8 + random() * 0.4), r * (0.7 + random() * 0.4), PATTERN, onBase);
      }
      break;
    }
    case 'freckles': {
      // 密度 → 每 14～5 格一點；大小 → 單點或兩格
      const every = lerpInt(14, 5, style.density);
      const dot = (x: number, y: number): boolean => hash(x, y, seed) % every === 0;
      each((x, y) => dot(x, y) || (style.size >= 0.5 && dot(x - 1, y)));
      break;
    }
    case 'split': {
      // 密度 → 分界線高低（越高深色越多）；角度 → 傾斜；個體差異：分界的起伏
      const line = cy + (0.5 - style.density) * 8;
      const slope = Math.tan((style.angle * Math.PI) / 180);
      const phase = random() * Math.PI * 2;
      each((x, y) => y + 0.5 > line + (x - cx) * slope + Math.sin(x * 0.9 + phase) * 0.7);
      break;
    }
    case 'dark': {
      // 深色底，上方暈染；大小 → 大塊亮斑（貓熊）或細點（袋熊），密度 → 多寡
      each(() => true);
      recolor(g, BASE, (x, y, v) => v === PATTERN && y < cy - EGG_RY * 0.55 && (x + y) % 2 === 0);
      if (style.size >= 0.5) {
        const count = lerpInt(2, 4, style.density);
        for (let i = 0; i < count; i++) {
          ellipse(g, cx + (random() - 0.5) * 9, cy + (random() - 0.2) * 10, 1.6 + random(), 1.4 + random(), BASE, onPattern);
        }
      } else {
        const every = lerpInt(12, 5, style.density);
        recolor(g, BASE, (x, y, v) => v === PATTERN && hash(x, y, seed) % every === 0);
      }
      break;
    }
  }
  ellipse(g, cx - 3, cy - 4.5, 1.6, 1.3, LIGHT, onFilled);
  outline(g);
  const reach = crack * 8;
  for (let x = 0; x < g.w; x++) {
    if (crack > 0 && Math.abs(x - Math.floor(cx)) <= reach && at(g, x, crackY(x)) >= BASE) put(g, x, crackY(x), OUTLINE);
  }
  return g;
}

/** 孵化時把裂開的蛋分成上下兩半（裂痕那一列兩半都保留，當作斷面的外框） */
export function eggHalf(egg: Grid, top: boolean): Grid {
  const g = makeGrid(egg.w, egg.h);
  for (let y = 0; y < egg.h; y++) {
    for (let x = 0; x < egg.w; x++) {
      const line = crackY(x);
      if (top ? y <= line : y >= line) put(g, x, y, at(egg, x, y));
    }
  }
  return g;
}
