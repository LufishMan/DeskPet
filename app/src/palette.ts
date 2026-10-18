// 各品種的外觀：色盤、花紋、耳型、尾巴、體格、特徵部件，以及蛋的花色（DESIGN.md §3、§11.2）

import type { Ears, Family, Feature, Pattern, PetView, Tail } from './types.ts';

export type Rgb = readonly [number, number, number];
/** 外框、底色、花紋、亮色、陰影（由底色自動算出）、反光、粉紅（所有品種共用）、虹膜（依科別） */
export type Palette = readonly [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];
type Colors = readonly [Rgb, Rgb, Rgb, Rgb];

/**
 * 蛋的花色（§3.1）。紋路「類型」由科決定（egg.ts），這裡是品種層級的細微線索：
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

/** 側面剪影的體格。品種辨識度主要來自這裡：腿長、身長、口鼻長短、有沒有脖子、毛量 */
export interface Build {
  /** 身體長、身體高、腿長、頭大小的倍率 */
  length: number;
  depth: number;
  legs: number;
  head: number;
  /** 成年時口鼻伸出頭部的像素數、口鼻高度 */
  snout: number;
  snoutDepth: number;
  /** 尖口鼻（鼠科） */
  pointed: boolean;
  /** 頭在身體上方多高：1 有明顯脖子，0 頭直接接在身體前面（倉鼠） */
  neck: number;
  legWidth: number;
  /** 鼻子大小：1 小點（貓、鼠），2 狗和熊的大鼻頭 */
  nose: 1 | 2;
  /** 毛量：平滑、蓬鬆（外框鋸齒）、捲毛（外框凹凸） */
  fur: 'smooth' | 'fluffy' | 'curly';
  whiskers: boolean;
}

export interface Look {
  colors: Colors;
  pattern: Pattern;
  ears: Ears;
  tail: Tail;
  features: readonly Feature[];
  build: Build;
  egg: EggStyle;
}

const FAMILY_BUILD: Record<Family, Build> = {
  cat: { length: 1, depth: 0.95, legs: 0.9, head: 1, snout: 1.2, snoutDepth: 2.4, pointed: false, neck: 0.95, legWidth: 2, nose: 1, fur: 'smooth', whiskers: false },
  dog: { length: 1, depth: 1, legs: 1, head: 1, snout: 3, snoutDepth: 3.8, pointed: false, neck: 1, legWidth: 3, nose: 2, fur: 'smooth', whiskers: false },
  mouse: { length: 0.85, depth: 0.9, legs: 0.35, head: 0.95, snout: 3, snoutDepth: 2.6, pointed: true, neck: 0.35, legWidth: 2, nose: 1, fur: 'smooth', whiskers: true },
  hamster: { length: 0.72, depth: 1.3, legs: 0.25, head: 1.08, snout: 1, snoutDepth: 3, pointed: false, neck: 0.15, legWidth: 2, nose: 1, fur: 'smooth', whiskers: false },
  bear: { length: 1, depth: 1.2, legs: 0.6, head: 1.05, snout: 2, snoutDepth: 3, pointed: false, neck: 0.6, legWidth: 4, nose: 2, fur: 'smooth', whiskers: false },
};

function hex(s: string): Rgb {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colors(outline: string, base: string, pattern: string, light: string): Colors {
  return [hex(outline), hex(base), hex(pattern), hex(light)];
}

function egg(shell: string, ink: string, density: number, size: number, angle = 0): EggStyle {
  return { shell: hex(shell), ink: hex(ink), density, size, angle };
}

interface Extra {
  features?: readonly Feature[];
  build?: Partial<Build>;
}

function look(family: Family, c: Colors, pattern: Pattern, ears: Ears, tail: Tail, eggStyle: EggStyle, extra: Extra = {}): Look {
  return {
    colors: c,
    pattern,
    ears,
    tail,
    egg: eggStyle,
    features: extra.features ?? [],
    build: { ...FAMILY_BUILD[family], ...extra.build },
  };
}

/*
 * 各品種的辨識重點（側面）：
 * 米克斯虎斑：橘底深色條紋、額頭 M 紋。英短：藍灰、圓臉短口鼻、矮壯。美短：銀底、身側黑色圓渦紋。
 * 布偶：長毛蓬鬆、臉耳尾深色、白圍兜白手套。暹羅：修長高腳、楔形臉、深色面罩和四肢。波斯：扁臉、長毛、短腿。
 * 台灣犬：精瘦高腳、鐮刀尾。柴犬：捲尾、裏白（白口鼻、白臉頰、白胸白腳）。柯基：短腿長身、大立耳、白胸白腳、短尾。
 * 黃金獵犬：垂耳、長口鼻、飾毛尾、毛蓬鬆。貴賓：捲毛、頭頂毛球、捲毛垂耳、毛球尾。哈士奇：黑背白臉白腳、捲尾。
 * 小白鼠：白毛粉耳、尖鼻長尾。花枝鼠：深色頭罩加背線。黃金鼠：圓滾無脖子、頰囊。三線鼠：灰色、背上一條深線。
 * 貓熊：黑耳黑眼圈、黑色四肢與肩帶。袋熊：矮壯短腿、大方鼻、無尾。
 */
const SPECIES: Record<string, Look> = {
  // 貓科：條紋蛋
  tabby_mix: look('cat', colors('#51382f', '#eda65e', '#be793f', '#f8e6c9'), 'stripes', 'pointy', 'long', egg('#f0dcb8', '#b0703a', 0.6, 0.2)),
  british_shorthair: look(
    'cat',
    colors('#464249', '#a1a9b1', '#7f8995', '#e0deda'),
    'solid',
    'short',
    'long',
    egg('#e2e4ea', '#7c869a', 0.15, 0.9),
    { features: ['cheeks'], build: { depth: 1.12, legs: 0.8, head: 1.12, snout: 0.6 } },
  ),
  american_shorthair: look(
    'cat',
    colors('#48403b', '#c9c5bd', '#70645c', '#f6ecdd'),
    'classic',
    'pointy',
    'long',
    egg('#ececec', '#6a6a6a', 0.6, 0.2, 28),
    { build: { depth: 1.04 } },
  ),
  ragdoll: look(
    'cat',
    colors('#51423c', '#eee0cb', '#8d7766', '#fff2df'),
    'points',
    'pointy',
    'fluffy',
    egg('#f7f0e4', '#9c8878', 0.35, 0.2),
    { features: ['bib', 'socks'], build: { length: 1.08, depth: 1.08, fur: 'fluffy' } },
  ),
  siamese: look(
    'cat',
    colors('#4a352f', '#ebd5b2', '#795c4a', '#faedda'),
    'mask',
    'tall',
    'long',
    egg('#f2e6cc', '#5e4434', 0.6, 0.2, -28),
    { build: { depth: 0.82, legs: 1.15, head: 0.92, snout: 2 } },
  ),
  persian: look(
    'cat',
    colors('#655049', '#f4e8d8', '#d5bcaa', '#fff4e4'),
    'solid',
    'short',
    'fluffy',
    egg('#f6f2ec', '#c8b8a4', 1, 0),
    { features: ['flat_face'], build: { depth: 1.15, legs: 0.7, head: 1.12, snout: 0, fur: 'fluffy' } },
  ),
  // 犬科：大塊斑蛋
  taiwan_dog_mix: look(
    'dog',
    colors('#49362c', '#bc925f', '#8c6847', '#ead2af'),
    'solid',
    'pointy',
    'wag',
    egg('#ecd8bc', '#7a5230', 0.1, 0.5),
    { build: { depth: 0.88, legs: 1.2, snout: 3.6, snoutDepth: 3.4 } },
  ),
  shiba: look(
    'dog',
    colors('#51392c', '#e6ab65', '#be8147', '#fff0d9'),
    'solid',
    'pointy',
    'curl',
    egg('#f6e2c8', '#c4762e', 0.45, 0.45),
    { features: ['urajiro'], build: { snout: 2.8 } },
  ),
  corgi: look(
    'dog',
    colors('#533a2e', '#eab075', '#c38954', '#fff1df'),
    'solid',
    'tall',
    'stub',
    egg('#faecd8', '#d08a40', 0.75, 0.3),
    { features: ['blaze', 'bib', 'socks'], build: { length: 1.18, legs: 0.45 } },
  ),
  golden_retriever: look(
    'dog',
    colors('#614834', '#e5bc7c', '#bf965d', '#f7e7c8'),
    'solid',
    'floppy',
    'feather',
    egg('#f8ecd0', '#d8a050', 0.25, 1),
    { build: { depth: 1.08, legs: 1.05, snout: 3.6, snoutDepth: 4.3, fur: 'fluffy' } },
  ),
  poodle: look(
    'dog',
    colors('#5d4235', '#d5a580', '#aa7959', '#f3dcc3'),
    'solid',
    'curly',
    'pom',
    egg('#f2dcc8', '#a8704a', 1, 0),
    { features: ['topknot'], build: { legs: 1.1, head: 1.05, snout: 2.8, fur: 'curly' } },
  ),
  husky: look(
    'dog',
    colors('#403d40', '#9da5ab', '#625e61', '#f6ecdd'),
    'cap',
    'pointy',
    'curl',
    egg('#e8ecf0', '#4e5864', 0.5, 0.75),
    { features: ['stockings'], build: { legs: 1.05, snout: 3.3 } },
  ),
  // 鼠科：細碎雀斑蛋
  white_mouse: look('mouse', colors('#6a514b', '#fbefdf', '#d8b4aa', '#f4d0c4'), 'solid', 'big', 'thin', egg('#faf4f4', '#e0a8b0', 0.2, 0)),
  fancy_rat: look(
    'mouse',
    colors('#504039', '#f1e4d3', '#796356', '#f1c7bd'),
    'hood',
    'big',
    'thin',
    egg('#f0e8e0', '#6a5a50', 0.85, 1),
    { build: { length: 1, snout: 3.2 } },
  ),
  // 倉鼠科：上下雙色蛋
  syrian_hamster: look(
    'hamster',
    colors('#5c4331', '#e9b675', '#c99558', '#fff0d7'),
    'solid',
    'small',
    'none',
    egg('#f8ecd8', '#d8964c', 0.55, 0),
    { features: ['pouches'] },
  ),
  dwarf_hamster: look(
    'hamster',
    colors('#51443b', '#b4a799', '#796b5e', '#f7ebda'),
    'dorsal',
    'small',
    'none',
    egg('#eeeae4', '#6c6660', 0.35, 0, 12),
    { features: ['pouches'], build: { length: 0.66 } },
  ),
  // 熊科：深底暈染蛋
  panda: look(
    'bear',
    colors('#3e302c', '#f8eddd', '#59483e', '#fff5e6'),
    'panda',
    'round',
    'stub',
    egg('#f4f4f0', '#2e2e2e', 0.2, 1),
    { build: { depth: 1.25, legs: 0.65, snout: 1.8 } },
  ),
  wombat: look(
    'bear',
    colors('#514033', '#ae9276', '#89705a', '#ddc5a7'),
    'solid',
    'small',
    'none',
    egg('#b49c84', '#6e5844', 0.8, 0),
    { features: ['big_nose'], build: { length: 1.05, depth: 1.15, legs: 0.45, head: 1.1, snout: 1.6, snoutDepth: 3.4, neck: 0.3 } },
  ),
};

/** 稀有變種（約 5%）：白化、黑化 */
const RARE: readonly Colors[] = [
  colors('#80635d', '#fff4e7', '#e8d2c5', '#fff9ef'),
  colors('#2e2728', '#574c50', '#40373c', '#958086'),
];

export function speciesLook(species: string): Look {
  return SPECIES[species] ?? SPECIES.tabby_mix;
}

const SHINE: Rgb = [255, 246, 232];
const PINK: Rgb = [224, 164, 152];

/** 虹膜：貓琥珀色、狗褐色，其他科接近黑色 */
const IRIS: Record<Family, Rgb> = {
  cat: [214, 168, 40],
  dog: [128, 78, 36],
  mouse: [90, 40, 48],
  hamster: [60, 40, 30],
  bear: [70, 50, 40],
};

/** 補上陰影色（底色往外框色靠一些）和共用的固定色 */
function withShade([outline, base, pattern, light]: Colors, family: Family = 'cat'): Palette {
  return [outline, base, pattern, light, mix(base, outline, 0.18), SHINE, PINK, IRIS[family]];
}

export function lookFor(view: PetView): Look & { palette: Palette } {
  const base = speciesLook(view.species);
  if (view.rare) return { ...base, palette: withShade(RARE[view.hue_shift % RARE.length], view.family) };
  // 同品種內的毛色差異：色相偏移 ±12°
  const shift = (view.hue_shift / 255 - 0.5) * 24;
  const [outline, fur, pattern, light] = base.colors;
  return { ...base, palette: withShade([outline, rotateHue(fur, shift), rotateHue(pattern, shift), rotateHue(light, shift)], view.family) };
}

/** 蛋的色盤：外框由紋路色加深、亮色由蛋殼色調亮；稀有變種直接換色盤 */
export function eggPalette(view: PetView): Palette {
  if (view.rare) return withShade(RARE[view.hue_shift % RARE.length]);
  const { shell, ink } = speciesLook(view.species).egg;
  // 色相偏移只給 ±6°，避免蓋過品種之間的底色差異
  const shift = (view.hue_shift / 255 - 0.5) * 12;
  // 蛋紋仍保留科別與品種線索，統一罩上少量奶油色，外框改用可可色。
  const s = mix(rotateHue(shell, shift), [250, 237, 217], 0.18);
  const i = mix(rotateHue(ink, shift), [154, 121, 100], 0.12);
  return withShade([mix(i, [65, 45, 37], 0.65), s, i, mix(s, SHINE, 0.7)]);
}

/**
 * 調整顏色：色相往 target（度）靠近最多 degrees 度，飽和度和亮度各加 ds、dl（0～1）。
 * 16-bit 上色用：亮部偏暖、暗部偏冷。
 */
export function shiftColor([r, g, b]: Rgb, target: number, degrees: number, ds: number, dl: number): Rgb {
  const [h, s, l] = rgbToHsl(r, g, b);
  const diff = ((target / 360 - h + 1.5) % 1) - 0.5;
  // 很淡的顏色（白、奶油色）色相和飽和度幾乎不動，不然會變成粉紅
  const weight = s > 0.05 ? Math.min(1, (1 - l) * 2.5) : 0;
  const step = Math.sign(diff) * Math.min(Math.abs(diff), degrees / 360) * weight;
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return hslToRgb((h + step + 1) % 1, clamp(s + ds * (s > 0.05 ? weight : 0.3)), clamp(l + dl));
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
