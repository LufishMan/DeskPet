// 把寵物、蛋和圖示泡泡畫進 40×44 的邏輯畫布（RGBA）。視窗和預覽腳本共用。

import { BUBBLES, type BubbleKind } from './bubbles.ts';
import { eggPalette, lookFor, type Look, type Palette, type Rgb } from './palette.ts';
import { CLEAR, EGG_SIZE, drawCreature, drawEgg, eggHalf, type CreatureSpec, type Grid } from './sprite.ts';
import type { PetView, Pose } from './types.ts';

/** 邏輯畫布大小（§2） */
export const W = 40;
export const H = 44;

export interface Scene {
  view: PetView;
  pose: Pose;
  breathe: boolean;
  tail: number;
  /** 跳起來（往上 2 像素） */
  hop: boolean;
  /** 蛋晃動的水平位移 */
  wobble: number;
  bubble: BubbleKind | null;
  /** 孵化動畫進度 0～1；不在孵化時為 null */
  hatch: number | null;
  /** 長大時的閃光進度 0～1；沒有時為 null */
  sparkle: number | null;
}

const EGG_X = (W - EGG_SIZE) / 2;
const EGG_Y = H - EGG_SIZE - 1;
const SPARKLE: Rgb = [255, 244, 168];

function setPixel(out: Uint8ClampedArray, x: number, y: number, [r, g, b]: Rgb): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  out[i] = r;
  out[i + 1] = g;
  out[i + 2] = b;
  out[i + 3] = 255;
}

function paint(out: Uint8ClampedArray, g: Grid, ox: number, oy: number, palette: Palette): void {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const v = g.px[y * g.w + x];
      if (v !== CLEAR) setPixel(out, x + ox, y + oy, palette[v - 1]);
    }
  }
}

function paintBubble(out: Uint8ClampedArray, kind: BubbleKind, ox: number, oy: number): void {
  const bubble = BUBBLES[kind];
  bubble.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = bubble.colors[ch];
      if (color) setPixel(out, x + ox, y + oy, color);
    });
  });
}

/** 閃爍的小星星：每顆輪流在「不見、小點、十字」之間切換 */
function paintSparkles(out: Uint8ClampedArray, progress: number, points: readonly (readonly [number, number])[]): void {
  points.forEach(([x, y], i) => {
    const phase = (Math.floor(progress * 12) + i) % 3;
    if (phase === 0) return;
    setPixel(out, x, y, SPARKLE);
    if (phase === 2) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) setPixel(out, x + dx, y + dy, SPARKLE);
  });
}

/** 每一列不透明像素的位元遮罩（第 x 位元代表第 x 欄），給後端設定視窗形狀 */
export function shapeOf(rgba: Uint8ClampedArray): number[] {
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    let bits = 0;
    for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 0) bits += 2 ** x;
    rows.push(bits);
  }
  return rows;
}

/** 熱量達門檻 75% 後出現裂痕，越接近門檻裂得越長（§11.1） */
export function eggCrack(progress: number): number {
  return progress < 0.75 ? 0 : 0.4 + 0.6 * Math.min(1, (progress - 0.75) / 0.25);
}

function creatureSpec(view: PetView, look: Look): CreatureSpec | null {
  if (view.stage === 'egg') return null;
  return {
    family: view.family,
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
function paintHatch(out: Uint8ClampedArray, scene: Scene, look: Look, spec: CreatureSpec, t: number): void {
  const { view } = scene;
  const palette = eggPalette(view);
  const egg = drawEgg(view.family, look.egg, view.seed, Math.min(1, t / 0.45));
  if (t < 0.5) {
    paint(out, egg, EGG_X + scene.wobble, EGG_Y, palette);
    return;
  }
  const top = eggHalf(egg, true);
  const bottom = eggHalf(egg, false);
  const crackSparkles = [[EGG_X + 2, EGG_Y + 7], [EGG_X + 20, EGG_Y + 6], [EGG_X + 11, EGG_Y + 4]] as const;
  if (t < 0.62) {
    const lift = Math.round(((t - 0.5) / 0.12) * 3);
    paint(out, bottom, EGG_X, EGG_Y, palette);
    paint(out, top, EGG_X, EGG_Y - lift, palette);
    paintSparkles(out, t, crackSparkles);
    return;
  }
  if (t < 0.88) paint(out, bottom, EGG_X, EGG_Y, palette);
  const creature = drawCreature(spec, { pose: 'happy', breathe: false, tail: 0 }, view.seed);
  paint(out, creature, Math.floor((W - creature.w) / 2), H - creature.h - 1, look.palette);
  const k = (t - 0.62) / 0.38;
  paint(out, top, EGG_X - Math.round(k * 10), EGG_Y - 3 - Math.round(k * 28), palette);
  paintSparkles(out, t, [[6, 22], [33, 18], [4, 36], [35, 32]]);
}

export function renderScene(out: Uint8ClampedArray, scene: Scene): void {
  out.fill(0);
  const { view } = scene;
  const look = lookFor(view);
  const spec = creatureSpec(view, look);
  let bubbleX: number;
  let bubbleY: number;
  if (!spec) {
    const egg = drawEgg(view.family, look.egg, view.seed, eggCrack(view.egg_progress));
    const ox = EGG_X + scene.wobble;
    paint(out, egg, ox, EGG_Y, eggPalette(view));
    bubbleX = ox + EGG_SIZE - 4;
    bubbleY = EGG_Y - 4;
  } else if (scene.hatch !== null && scene.hatch < 1) {
    paintHatch(out, scene, look, spec, scene.hatch);
    return;
  } else {
    const creature = drawCreature(spec, { pose: scene.pose, breathe: scene.breathe, tail: scene.tail }, view.seed);
    const ox = Math.floor((W - creature.w) / 2);
    const oy = H - creature.h - 1 - (scene.hop ? 2 : 0);
    paint(out, creature, ox, oy, look.palette);
    if (scene.sparkle !== null) paintSparkles(out, scene.sparkle, [[3, oy + 6], [36, oy + 3], [2, H - 8], [37, H - 12]]);
    bubbleX = W - 10;
    bubbleY = oy + Math.round(creature.h * 0.12) - 6;
  }
  if (scene.bubble) paintBubble(out, scene.bubble, bubbleX, Math.max(0, bubbleY));
}
