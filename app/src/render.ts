// 把寵物、蛋和圖示泡泡畫進 40×44 的邏輯畫布（RGBA）。視窗和預覽腳本共用。

import { BUBBLES, type BubbleKind } from './bubbles.ts';
import { lookFor, type Palette } from './palette.ts';
import { CLEAR, EGG_SIZE, drawCreature, drawEgg, type Grid } from './sprite.ts';
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
}

function setPixel(out: Uint8ClampedArray, x: number, y: number, [r, g, b]: readonly [number, number, number]): void {
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

export function renderScene(out: Uint8ClampedArray, scene: Scene): void {
  out.fill(0);
  const { view } = scene;
  const look = lookFor(view);
  let bubbleX: number;
  let bubbleY: number;
  if (view.stage === 'egg') {
    const egg = drawEgg(view.family, view.hue_shift, view.egg_progress >= 0.75);
    const ox = (W - EGG_SIZE) / 2 + scene.wobble;
    const oy = H - EGG_SIZE - 1;
    paint(out, egg, ox, oy, look.palette);
    bubbleX = ox + EGG_SIZE - 4;
    bubbleY = oy - 4;
  } else {
    const creature = drawCreature(
      { family: view.family, stage: view.stage, body: view.body, pattern: look.pattern, ears: look.ears },
      { pose: scene.pose, breathe: scene.breathe, tail: scene.tail },
    );
    const ox = Math.floor((W - creature.w) / 2);
    const oy = H - creature.h - 1 - (scene.hop ? 2 : 0);
    paint(out, creature, ox, oy, look.palette);
    bubbleX = W - 10;
    bubbleY = oy + Math.round(creature.h * 0.12) - 6;
  }
  if (scene.bubble) paintBubble(out, scene.bubble, bubbleX, Math.max(0, bubbleY));
}
