// 各品種的外觀：4 色色盤、花紋、耳型、尾巴、特徵部件，以及蛋的花色（DESIGN.md §3、§11.2）

import type { Ears, Feature, Pattern, PetView, Tail } from './types.ts';

export type Rgb = readonly [number, number, number];
/** 外框、底色、花紋、亮色 */
export type Palette = readonly [Rgb, Rgb, Rgb, Rgb];

/**
 * 蛋的花色（§3.1）。紋路「類型」由科決定（sprite.ts），這裡是品種層級的細微線索：
 * 蛋殼底色、紋路顏色、密度、大小、方向。
 */
export interface EggStyle {
  shell: Rgb;
  ink: Rgb;
  /** 0～1：條紋間距、斑塊數量、雀斑多寡、分界高低、暈染多寡 */
  density: number;
  /** 0～1：條紋粗細、斑塊大小、雀斑大小 */
  size: number;
  /** 條紋或分界線的傾斜角度（度） */
  angle: number;
}

export interface Look {
  palette: Palette;
  pattern: Pattern;
  ears: Ears;
  tail: Tail;
  features: readonly Feature[];
  /** 品種體格：身體寬、高的倍率 */
  build: readonly [number, number];
  egg: EggStyle;
}

function hex(s: string): Rgb {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function palette(outline: string, base: string, pattern: string, light: string): Palette {
  return [hex(outline), hex(base), hex(pattern), hex(light)];
}

function egg(shell: string, ink: string, density: number, size: number, angle = 0): EggStyle {
  return { shell: hex(shell), ink: hex(ink), density, size, angle };
}

interface Extra {
  features?: readonly Feature[];
  build?: readonly [number, number];
}

function look(colors: Palette, pattern: Pattern, ears: Ears, tail: Tail, eggStyle: EggStyle, extra: Extra = {}): Look {
  return { palette: colors, pattern, ears, tail, egg: eggStyle, features: extra.features ?? [], build: extra.build ?? [1, 1] };
}

const SPECIES: Record<string, Look> = {
  // 貓科：條紋蛋
  tabby_mix: look(
    palette('#3a2618', '#d4924a', '#9a5a26', '#f5e2c0'),
    'stripes',
    'pointy',
    'long',
    egg('#f0dcb8', '#b0703a', 0.6, 0.2),
  ),
  british_shorthair: look(
    palette('#262a33', '#8a96aa', '#6c778a', '#c5cdd9'),
    'solid',
    'short',
    'long',
    egg('#e2e4ea', '#7c869a', 0.15, 0.9),
    { features: ['cheeks'], build: [1.08, 1] },
  ),
  american_shorthair: look(
    palette('#262626', '#c4c4c4', '#555555', '#f0f0f0'),
    'stripes',
    'pointy',
    'long',
    egg('#ececec', '#6a6a6a', 0.6, 0.2, 28),
  ),
  ragdoll: look(
    palette('#3a3038', '#f1e8d6', '#7d6b5c', '#ffffff'),
    'points',
    'pointy',
    'fluffy',
    egg('#f7f0e4', '#9c8878', 0.35, 0.2),
    { features: ['bib'] },
  ),
  siamese: look(
    palette('#2a1d16', '#eddcbc', '#4e3628', '#fff5e3'),
    'mask',
    'pointy',
    'long',
    egg('#f2e6cc', '#5e4434', 0.6, 0.2, -28),
    { build: [0.9, 1] },
  ),
  persian: look(
    palette('#4a3c3c', '#f3eee7', '#d6cbbd', '#ffffff'),
    'solid',
    'short',
    'fluffy',
    egg('#f6f2ec', '#c8b8a4', 1, 0),
    { features: ['flat_face', 'bib'], build: [1.08, 1] },
  ),
  // 犬科：大塊斑蛋
  taiwan_dog_mix: look(
    palette('#2a1a0e', '#a8743e', '#6a4422', '#e4c8a0'),
    'solid',
    'pointy',
    'wag',
    egg('#ecd8bc', '#7a5230', 0.1, 0.5),
    { build: [0.9, 1] },
  ),
  shiba: look(
    palette('#3a2414', '#d98a3d', '#a85f22', '#fbeedd'),
    'solid',
    'pointy',
    'curl',
    egg('#f6e2c8', '#c4762e', 0.45, 0.45),
    { features: ['urajiro', 'bib'] },
  ),
  corgi: look(
    palette('#3a2414', '#e09a4c', '#b8702e', '#fff8ee'),
    'solid',
    'tall',
    'stub',
    egg('#faecd8', '#d08a40', 0.75, 0.3),
    { features: ['blaze', 'bib'], build: [1.1, 0.84] },
  ),
  golden_retriever: look(
    palette('#4a3014', '#e6b25c', '#c98f3a', '#f8e6c0'),
    'solid',
    'floppy',
    'feather',
    egg('#f8ecd0', '#d8a050', 0.25, 1),
  ),
  poodle: look(
    palette('#3a2418', '#c88a5a', '#9a6038', '#f0d0b0'),
    'solid',
    'curly',
    'pom',
    egg('#f2dcc8', '#a8704a', 1, 0),
    { features: ['topknot'], build: [0.94, 1] },
  ),
  husky: look(
    palette('#1e2329', '#7a8694', '#4a535e', '#f2f4f6'),
    'cap',
    'pointy',
    'curl',
    egg('#e8ecf0', '#4e5864', 0.5, 0.75),
  ),
  // 鼠科：細碎雀斑蛋
  white_mouse: look(
    palette('#5a3a44', '#f6f2f0', '#e8c8cc', '#ffd8de'),
    'solid',
    'big',
    'thin',
    egg('#faf4f4', '#e0a8b0', 0.2, 0),
  ),
  fancy_rat: look(
    palette('#2e2626', '#e8e0d8', '#5a4c44', '#fff8f2'),
    'cap',
    'big',
    'thin',
    egg('#f0e8e0', '#6a5a50', 0.85, 1),
  ),
  // 倉鼠科：上下雙色蛋
  syrian_hamster: look(
    palette('#4a2e18', '#e8a85c', '#c7843e', '#fbf0de'),
    'solid',
    'small',
    'none',
    egg('#f8ecd8', '#d8964c', 0.55, 0),
    { features: ['pouches'] },
  ),
  dwarf_hamster: look(
    palette('#2e2a2a', '#9c968e', '#4a4440', '#f2efe9'),
    'dorsal',
    'small',
    'none',
    egg('#eeeae4', '#6c6660', 0.35, 0, 12),
    { features: ['pouches'] },
  ),
  // 熊科：深底暈染蛋
  panda: look(
    palette('#1c1c1c', '#f4f4f0', '#2a2a2a', '#ffffff'),
    'panda',
    'round',
    'stub',
    egg('#f4f4f0', '#2e2e2e', 0.2, 1),
  ),
  wombat: look(
    palette('#2a2018', '#8a7058', '#6a5442', '#b8a088'),
    'solid',
    'small',
    'none',
    egg('#b49c84', '#6e5844', 0.8, 0),
    { features: ['big_nose'], build: [1.1, 0.92] },
  ),
};

/** 稀有變種（約 5%）：白化、黑化 */
const RARE: readonly Palette[] = [
  palette('#6a4a50', '#fbf8f6', '#efe4e2', '#ffffff'),
  palette('#0e0e10', '#3a3a42', '#26262c', '#5a5a64'),
];

export function speciesLook(species: string): Look {
  return SPECIES[species] ?? SPECIES.tabby_mix;
}

export function lookFor(view: PetView): Look {
  const base = speciesLook(view.species);
  if (view.rare) {
    return { ...base, palette: RARE[view.hue_shift % RARE.length] };
  }
  // 同品種內的毛色差異：色相偏移 ±12°
  const shift = (view.hue_shift / 255 - 0.5) * 24;
  const [outline, fur, pattern, light] = base.palette;
  return { ...base, palette: [outline, rotateHue(fur, shift), rotateHue(pattern, shift), rotateHue(light, shift)] };
}

/** 蛋的色盤：外框由紋路色加深、亮色由蛋殼色調亮；稀有變種直接換色盤 */
export function eggPalette(view: PetView): Palette {
  if (view.rare) return RARE[view.hue_shift % RARE.length];
  const { shell, ink } = speciesLook(view.species).egg;
  // 色相偏移只給 ±6°，避免蓋過品種之間的底色差異
  const shift = (view.hue_shift / 255 - 0.5) * 12;
  const s = rotateHue(shell, shift);
  const i = rotateHue(ink, shift);
  return [mix(i, [0, 0, 0], 0.6), s, i, mix(s, [255, 255, 255], 0.7)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const channel = (k: number): number => Math.round(a[k] + (b[k] - a[k]) * t);
  return [channel(0), channel(1), channel(2)];
}

function rotateHue([r, g, b]: Rgb, degrees: number): Rgb {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb((h + degrees / 360 + 1) % 1, s, l);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
}
