// 把寵物、蛋和圖示泡泡畫進 100×100 的邏輯畫布（RGBA）。視窗和預覽腳本共用。

import { BUBBLES, type BubbleKind } from './bubbles.ts';
import { paintCream } from './cream-atlas.ts';
import { eggPalette, lookFor, type Look, type Palette, type Rgb } from './palette.ts';
import type { CreatureSpec } from './creature.ts';
import { EGG_SIZE, drawEgg, eggHalf } from './egg.ts';
import { drawCreature } from './pet.ts';
import { BASE, CLEAR, INK, LIGHT, OUTLINE, PATTERN, SHADE, hash, type Grid } from './pixel.ts';
import { paint16 } from './shade16.ts';
import { DEFAULT_STYLE, STYLES, type Style, type StyleId } from './style.ts';
import type { PetView, Pose } from './types.ts';

/** 邏輯畫布大小（§2）。後端的視窗形狀（shape.rs）用同樣的大小 */
export const W = 100;
export const H = 100;
/** 跳起來的高度；後端擴張視窗形狀時要涵蓋這段位移 */
const HOP = 4;
/** 蛋晃動時，每一步的水平位移 */
const WOBBLE = 2;
/** 圖示泡泡是 8×8 的點陣，放大 2 倍畫，和寵物的像素密度相近 */
const BUBBLE_SCALE = 2;

export interface Scene {
  view: PetView;
  pose: Pose;
  breathe: boolean;
  tail: number;
  /** 跳起來 */
  hop: boolean;
  /** 蛋晃動的方向 −1～1 */
  wobble: number;
  bubble: BubbleKind | null;
  /** 孵化動畫進度 0～1；不在孵化時為 null */
  hatch: number | null;
  /** 長大時的閃光進度 0～1；沒有時為 null */
  sparkle: number | null;
  style: StyleId;
}

const EGG_X = Math.floor((W - EGG_SIZE) / 2);
const EGG_Y = H - EGG_SIZE - 1;
const SPARKLE: Rgb = [244, 205, 145];

type Pt = readonly [number, number];

function setPixel(out: Uint8ClampedArray, x: number, y: number, [r, g, b]: Rgb, alpha = 255): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  out[i] = r;
  out[i + 1] = g;
  out[i + 2] = b;
  out[i + 3] = alpha;
}

function mix([r, g, b]: Rgb, [r2, g2, b2]: Rgb, t: number): Rgb {
  return [Math.round(r + (r2 - r) * t), Math.round(g + (g2 - g) * t), Math.round(b + (b2 - b) * t)];
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const TONED = new Set([BASE, PATTERN, LIGHT, SHADE]);

/**
 * 毛色的層次：同一欄連續的不透明區段，上面亮、下面暗（光從上方來），交界用棋盤格抖色。
 * 回傳 −2～2。
 */
function furTone(g: Grid, x: number, y: number): number {
  let top = y;
  while (top > 0 && g.px[(top - 1) * g.w + x] !== CLEAR) top--;
  let bottom = y;
  while (bottom < g.h - 1 && g.px[(bottom + 1) * g.w + x] !== CLEAR) bottom++;
  const t = (y - top) / Math.max(1, bottom - top);
  const dither = (x + y) % 2 === 0;
  let tone = 0;
  if (t < 0.1 || (t < 0.16 && dither)) tone = 2;
  else if (t < 0.28 || (t < 0.36 && dither)) tone = 1;
  else if (t > 0.88 || (t > 0.82 && dither)) tone = -2;
  else if (t > 0.66 || (t > 0.58 && dither)) tone = -1;
  // 毛流：散布的 3 像素長短線，暗的比亮的多
  const strand = hash(x, Math.floor(y / 3), 7) % 11;
  if (strand === 0) tone -= 1;
  else if (strand === 1 && tone < 2) tone += 1;
  return Math.max(-2, Math.min(2, tone));
}

const TONE_MIX: Record<number, [Rgb, number]> = { 2: [[255, 255, 255], 0.22], 1: [[255, 255, 255], 0.1], [-1]: [[0, 0, 0], 0.12], [-2]: [[0, 0, 0], 0.24] };

/** 依畫風上色：彩色外框、毛色層次 */
function paint(out: Uint8ClampedArray, g: Grid, ox: number, oy: number, palette: Palette, style: Style = STYLES[DEFAULT_STYLE]): void {
  if (style.shading === 'bit16') {
    paint16(g, palette, (x, y, color, alpha) => setPixel(out, x + ox, y + oy, color, alpha));
    return;
  }
  const colors = palette;
  const get = (x: number, y: number): number => (x >= 0 && y >= 0 && x < g.w && y < g.h ? g.px[y * g.w + x] : CLEAR);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = g.px[y * g.w + x];
      if (v === CLEAR) continue;
      let color = v === INK ? colors[OUTLINE - 1] : colors[v - 1];
      if (v === OUTLINE && style.outline === 'selout') {
        // 外圍的外框改成旁邊顏色加深，臉上的線條（眼睛、嘴巴）維持深色
        const around = [get(x + 1, y), get(x - 1, y), get(x, y + 1), get(x, y - 1)];
        const inner = around.find((n) => TONED.has(n));
        if (around.includes(CLEAR) && inner !== undefined) color = mix(colors[inner - 1], BLACK, 0.55);
      } else if (style.shading === 'fur' && TONED.has(v)) {
        const tone = TONE_MIX[furTone(g, x, y)];
        if (tone) color = mix(color, tone[0], tone[1]);
      }
      setPixel(out, x + ox, y + oy, color);
    }
  }
}

/** 腳下的淡陰影：寬度跟著寵物底部的寬度 */
function groundShadow(out: Uint8ClampedArray, g: Grid, ox: number, oy: number): void {
  let bottom = -1;
  for (let y = g.h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < g.w; x++) if (g.px[y * g.w + x] !== 0) bottom = y;
  if (bottom < 0) return;
  let [x0, x1] = [g.w, 0];
  for (let y = Math.max(0, bottom - 4); y <= bottom; y++) {
    for (let x = 0; x < g.w; x++) if (g.px[y * g.w + x] !== 0) [x0, x1] = [Math.min(x0, x), Math.max(x1, x)];
  }
  const cx = ox + (x0 + x1 + 1) / 2;
  const cy = oy + bottom + 0.5;
  const rx = (x1 - x0) * 0.62;
  for (let y = Math.floor(cy - 3); y <= Math.ceil(cy + 3); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / 2.6) ** 2;
      if (d <= 1) setPixel(out, x, y, [120, 84, 72], d < 0.5 ? 90 : 55);
    }
  }
}

/** 貼紙風：在不透明區域外圍加 2 像素白邊，右下再加 1 像素淡陰影 */
function stickerBorder(out: Uint8ClampedArray): void {
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = out[i * 4 + 3] > 0 ? 1 : 0;
  const near = (x: number, y: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && filled[ny * W + nx]) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (filled[y * W + x]) continue;
      if (near(x, y, 2)) setPixel(out, x, y, WHITE);
      else if (near(x - 1, y - 1, 2)) setPixel(out, x, y, [168, 176, 192]);
    }
  }
}

function paintBubble(out: Uint8ClampedArray, kind: BubbleKind, ox: number, oy: number): void {
  const bubble = BUBBLES[kind];
  bubble.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = bubble.colors[ch];
      if (!color) return;
      for (let dy = 0; dy < BUBBLE_SCALE; dy++) {
        for (let dx = 0; dx < BUBBLE_SCALE; dx++) setPixel(out, ox + x * BUBBLE_SCALE + dx, oy + y * BUBBLE_SCALE + dy, color);
      }
    });
  });
}

/** 閃爍的小星星：每顆輪流在「不見、小點、十字」之間切換 */
function paintSparkles(out: Uint8ClampedArray, progress: number, points: readonly Pt[]): void {
  points.forEach(([x, y], i) => {
    const phase = (Math.floor(progress * 12) + i) % 3;
    if (phase === 0) return;
    const arm = phase === 2 ? 3 : 1;
    for (let d = -arm; d <= arm; d++) {
      setPixel(out, x + d, y, SPARKLE);
      setPixel(out, x, y + d, SPARKLE);
    }
  });
}

/** 不透明像素的橫向區段，攤平成 [起始欄, 結束欄（不含）, 列, …]，給後端設定視窗形狀 */
export function shapeOf(rgba: Uint8ClampedArray): number[] {
  const spans: number[] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (rgba[(y * W + x) * 4 + 3] === 0) {
        x++;
        continue;
      }
      const start = x;
      while (x < W && rgba[(y * W + x) * 4 + 3] > 0) x++;
      spans.push(start, x, y);
    }
  }
  return spans;
}

/** 熱量達門檻 75% 後出現裂痕，越接近門檻裂得越長（§11.1） */
export function eggCrack(progress: number): number {
  return progress < 0.75 ? 0 : 0.4 + 0.6 * Math.min(1, (progress - 0.75) / 0.25);
}

function creatureSpec(view: PetView, look: Look, style: Style): CreatureSpec | null {
  if (view.stage === 'egg') return null;
  return {
    style,
    stage: view.stage,
    body: view.body,
    pattern: look.pattern,
    ears: look.ears,
    tail: look.tail,
    features: look.features,
    build: look.build,
  };
}

/**
 * 孵化（§11.1）：
 * 0～0.5 蛋劇烈晃動、裂痕擴大；0.5～0.62 上半殼被頂起；
 * 0.62～1 幼體站在下半殼前面，上半殼飛走，最後下半殼消失。
 */
function paintHatch(out: Uint8ClampedArray, scene: Scene, look: Look & { palette: Palette }, spec: CreatureSpec, t: number): void {
  const { view } = scene;
  const palette = eggPalette(view);
  const egg = drawEgg(view.family, look.egg, view.seed, Math.min(1, t / 0.45));
  if (t < 0.5) {
    paint(out, egg, EGG_X + scene.wobble * WOBBLE, EGG_Y, palette, spec.style);
    return;
  }
  const top = eggHalf(egg, true);
  const bottom = eggHalf(egg, false);
  const s = EGG_SIZE / 24;
  const crackSparkles: Pt[] = [[EGG_X + 3 * s, EGG_Y + 7 * s], [EGG_X + 21 * s, EGG_Y + 6 * s], [EGG_X + 12 * s, EGG_Y + 4 * s]].map(
    ([x, y]) => [Math.round(x), Math.round(y)] as const,
  );
  if (t < 0.62) {
    const lift = Math.round(((t - 0.5) / 0.12) * 6);
    paint(out, bottom, EGG_X, EGG_Y, palette, spec.style);
    paint(out, top, EGG_X, EGG_Y - lift, palette, spec.style);
    paintSparkles(out, t, crackSparkles);
    return;
  }
  if (t < 0.88) paint(out, bottom, EGG_X, EGG_Y, palette, spec.style);
  if (scene.style !== 'cream' || !paintCream(out, W, H, view, 'happy', false, false)) {
    const creature = drawCreature(spec, { pose: 'happy', breathe: false, tail: 0 }, view.seed);
    paint(out, creature, Math.floor((W - creature.w) / 2), H - creature.h - 1, look.palette, spec.style);
  }
  const k = (t - 0.62) / 0.38;
  paint(out, top, EGG_X - Math.round(k * 24), EGG_Y - 6 - Math.round(k * 64), palette, spec.style);
  paintSparkles(out, t, [[18, 56], [80, 50], [14, 86], [86, 78]]);
}

export function renderScene(out: Uint8ClampedArray, scene: Scene): void {
  out.fill(0);
  const { view } = scene;
  const look = lookFor(view);
  const style = STYLES[scene.style];
  const spec = creatureSpec(view, look, style);
  let bubbleX: number;
  let bubbleY: number;
  if (!spec) {
    const egg = drawEgg(view.family, look.egg, view.seed, eggCrack(view.egg_progress));
    const ox = EGG_X + scene.wobble * WOBBLE;
    if (style.groundShadow) groundShadow(out, egg, ox, EGG_Y);
    paint(out, egg, ox, EGG_Y, eggPalette(view), style);
    bubbleX = ox + EGG_SIZE - 8;
    bubbleY = EGG_Y - 12;
  } else if (scene.hatch !== null && scene.hatch < 1) {
    paintHatch(out, scene, look, spec, scene.hatch);
    if (style.border) stickerBorder(out);
    return;
  } else {
    const drawn = scene.style === 'cream' ? paintCream(out, W, H, view, scene.pose, scene.breathe, scene.hop) : null;
    if (drawn) {
      if (scene.sparkle !== null) paintSparkles(out, scene.sparkle, [[8, drawn.y + 14], [92, drawn.y + 8], [6, H - 18], [94, H - 30]]);
      bubbleX = Math.min(W - 8 * BUBBLE_SCALE, Math.max(0, drawn.x + 4));
      bubbleY = drawn.y - 18;
    } else {
      const creature = drawCreature(spec, { pose: scene.pose, breathe: scene.breathe, tail: scene.tail }, view.seed);
      const ox = Math.floor((W - creature.w) / 2);
      const oy = H - creature.h - 1 - (scene.hop ? HOP : 0);
      if (style.groundShadow) groundShadow(out, creature, ox, oy + (scene.hop ? HOP : 0));
      paint(out, creature, ox, oy, look.palette, style);
      if (scene.sparkle !== null) paintSparkles(out, scene.sparkle, [[8, oy + 14], [92, oy + 8], [6, H - 18], [94, H - 30]]);
      // 泡泡放在頭的右上方（耳朵上面）
      const [ax, ay] = creature.anchor;
      bubbleX = Math.min(W - 8 * BUBBLE_SCALE, Math.max(0, ox + ax + 4));
      bubbleY = oy + ay - 22;
    }
  }
  if (style.border) stickerBorder(out);
  if (scene.bubble) paintBubble(out, scene.bubble, bubbleX, Math.max(0, bubbleY));
}
