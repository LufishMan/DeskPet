// 寵物的共用定義：階段尺寸、規格、動畫格。各姿勢的產生器見 pet.ts。
// 尺寸都用「設計單位」描述，乘上各階段的解析度（STAGES 的 u）才是像素，所以長大時畫得越來越精細。

import type { Build } from './palette.ts';
import { BASE, ellipse, type Grid, type Pt } from './pixel.ts';
import type { Style } from './style.ts';
import type { Body, Ears, Feature, Pattern, Pose, Stage, Tail } from './types.ts';

export type GrownStage = Exclude<Stage, 'egg'>;

export interface StageShape {
  /** 一個設計單位等於幾個像素。階段越大畫得越精細，長大時也看得出變大 */
  u: number;
  /** 以下都是設計單位：本體高度（§11.2）、身體半長半高、腿長、頭半寬半高 */
  size: number;
  torso: Pt;
  legs: number;
  head: Pt;
  /** 口鼻和耳朵相對成年的比例：幼年口鼻短、頭大 */
  snout: number;
  ear: number;
}

export const STAGES: Record<GrownStage, StageShape> = {
  baby: { u: 1.6, size: 24, torso: [5.5, 3.6], legs: 3, head: [4.6, 4.2], snout: 0.5, ear: 0.75 },
  juvenile: { u: 2, size: 32, torso: [7.5, 4.6], legs: 5, head: [5.2, 4.7], snout: 0.8, ear: 0.9 },
  adult: { u: 2.5, size: 32, torso: [9, 5.4], legs: 6, head: [5.6, 5], snout: 1, ear: 1 },
};

/** 體型主要改變身體的高度（肚子），長度只跟著變一點 */
export const BODY_DEPTH: Record<Body, number> = { very_thin: 0.78, thin: 0.9, standard: 1, fat: 1.13, very_fat: 1.27 };

/** 左右各留 4 個設計單位給尾巴 */
export const SIDE_MARGIN = 4;

export interface CreatureSpec {
  stage: GrownStage;
  body: Body;
  pattern: Pattern;
  ears: Ears;
  tail: Tail;
  features: readonly Feature[];
  build: Build;
  style: Style;
}

export interface Frame {
  pose: Pose;
  /** 呼吸起伏 */
  breathe: boolean;
  /** 尾巴擺動 −1～1 */
  tail: number;
}

export interface Creature extends Grid {
  /** 頭頂中央，用來放圖示泡泡 */
  anchor: Pt;
}

export function thick(g: Grid, points: Pt[], r: number, v = BASE): void {
  for (const [x, y] of points) ellipse(g, x, y, r, r, v);
}
