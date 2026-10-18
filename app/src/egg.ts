// 蛋（§3.1）：紋路類型暗示科別，密度、大小、方向和底色暗示品種。

import type { EggStyle } from './palette.ts';
import { BASE, LIGHT, OUTLINE, PATTERN, at, ellipse, hash, makeGrid, mod, mulberry32, onBase, onFilled, onPattern, outline, put, recolor, type Grid } from './pixel.ts';
import { STAGES } from './creature.ts';
import type { Family } from './types.ts';

type EggPattern = 'stripes' | 'patches' | 'freckles' | 'split' | 'dark';
const EGG_PATTERN: Record<Family, EggPattern> = {
  cat: 'stripes',
  dog: 'patches',
  mouse: 'freckles',
  hamster: 'split',
  bear: 'dark',
};

/** 蛋的解析度（像素／設計單位），和幼年相同 */
const EU = STAGES.baby.u;
export const EGG_SIZE = Math.round(24 * EU);
const EGG_CX = EGG_SIZE / 2 - 0.5;
const EGG_CY = 13.2 * EU;
const EGG_RX = 7.6 * EU;
const EGG_RY = 9.6 * EU;

/** 裂痕所在的列：沿著蛋的上半部呈鋸齒狀，孵化時蛋殼從這裡裂成上下兩半 */
export function crackY(x: number): number {
  const period = Math.round(4 * EU);
  const t = mod(x, period) / period;
  const zig = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
  return Math.round(10 * EU + zig * EU);
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
  // 雀斑和細點以 2×2 的格子為單位，維持像素感
  const cell = Math.round(EU);
  const cellHash = (x: number, y: number): number => hash(Math.floor(x / cell), Math.floor(y / cell), seed);
  switch (EGG_PATTERN[family]) {
    case 'stripes': {
      // 密度 → 間距；大小 → 粗細；角度 → 斜紋；個體差異：起點與是否波浪
      const spacing = Math.round(lerpInt(6, 3, style.density) * EU);
      const width = Math.round((style.size >= 0.5 ? 2 : 1) * EU);
      const slope = Math.tan((style.angle * Math.PI) / 180);
      const phase = Math.floor(random() * spacing);
      const wavy = random() < 0.5;
      const wave = Math.round(4 * EU);
      each((x, y) => {
        const v = Math.floor(y + (x - cx) * slope + (wavy ? mod(Math.floor(x / wave), 2) * cell : 0)) + phase;
        return mod(v, spacing) < width;
      });
      break;
    }
    case 'patches': {
      // 密度 → 2～5 塊；大小 → 半徑
      const count = lerpInt(2, 5, style.density);
      const r = (1.4 + style.size * 1.8) * EU;
      for (let i = 0; i < count; i++) {
        const px = cx + (random() - 0.5) * 10 * EU;
        const py = cy + (random() - 0.5) * 13 * EU;
        ellipse(g, px, py, r * (0.8 + random() * 0.4), r * (0.7 + random() * 0.4), PATTERN, onBase);
      }
      break;
    }
    case 'freckles': {
      // 密度 → 每 14～5 格一點；大小 → 單點或兩格
      const every = lerpInt(14, 5, style.density);
      const dot = (x: number, y: number): boolean => cellHash(x, y) % every === 0;
      each((x, y) => dot(x, y) || (style.size >= 0.5 && dot(x - cell, y)));
      break;
    }
    case 'split': {
      // 密度 → 分界線高低（越高深色越多）；角度 → 傾斜；個體差異：分界的起伏
      const level = cy + (0.5 - style.density) * 8 * EU;
      const slope = Math.tan((style.angle * Math.PI) / 180);
      const phase = random() * Math.PI * 2;
      each((x, y) => y + 0.5 > level + (x - cx) * slope + Math.sin(x * (0.9 / EU) + phase) * 0.7 * EU);
      break;
    }
    case 'dark': {
      // 深色底，上方暈染；大小 → 大塊亮斑（貓熊）或細點（袋熊），密度 → 多寡
      each(() => true);
      recolor(g, BASE, (x, y, v) => v === PATTERN && y < cy - EGG_RY * 0.55 && (x + y) % 2 === 0);
      if (style.size >= 0.5) {
        const count = lerpInt(2, 4, style.density);
        for (let i = 0; i < count; i++) {
          ellipse(g, cx + (random() - 0.5) * 9 * EU, cy + (random() - 0.2) * 10 * EU, (1.6 + random()) * EU, (1.4 + random()) * EU, BASE, onPattern);
        }
      } else {
        const every = lerpInt(12, 5, style.density);
        recolor(g, BASE, (x, y, v) => v === PATTERN && cellHash(x, y) % every === 0);
      }
      break;
    }
  }
  ellipse(g, cx - 3 * EU, cy - 4.5 * EU, 1.6 * EU, 1.3 * EU, LIGHT, onFilled);
  outline(g);
  const reach = crack * 8 * EU;
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
      const crack = crackY(x);
      if (top ? y <= crack : y >= crack) put(g, x, y, at(egg, x, y));
    }
  }
  return g;
}
