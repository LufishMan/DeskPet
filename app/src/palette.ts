// 各品種的 4 色色盤、花紋與耳型（DESIGN.md §3、§11.2）

import type { Ears, Pattern, PetView } from './types.ts';

export type Rgb = readonly [number, number, number];
/** 外框、底色、花紋、亮色 */
export type Palette = readonly [Rgb, Rgb, Rgb, Rgb];

export interface Look {
  palette: Palette;
  pattern: Pattern;
  ears: Ears;
}

function hex(s: string): Rgb {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function palette(outline: string, base: string, pattern: string, light: string): Palette {
  return [hex(outline), hex(base), hex(pattern), hex(light)];
}

function look(colors: Palette, pattern: Pattern, ears: Ears): Look {
  return { palette: colors, pattern, ears };
}

const SPECIES: Record<string, Look> = {
  tabby_mix: look(palette('#3a2618', '#d4924a', '#9a5a26', '#f5e2c0'), 'stripes', 'pointy'),
  british_shorthair: look(palette('#262a33', '#8a96aa', '#6c778a', '#c5cdd9'), 'solid', 'pointy'),
  american_shorthair: look(palette('#262626', '#c4c4c4', '#555555', '#f0f0f0'), 'stripes', 'pointy'),
  ragdoll: look(palette('#3a3038', '#f1e8d6', '#7d6b5c', '#ffffff'), 'points', 'pointy'),
  siamese: look(palette('#2a1d16', '#eddcbc', '#4e3628', '#fff5e3'), 'mask', 'pointy'),
  persian: look(palette('#4a3c3c', '#f3eee7', '#d6cbbd', '#ffffff'), 'solid', 'small'),
  taiwan_dog_mix: look(palette('#2e2216', '#c8904f', '#8a5a2b', '#efdcc0'), 'solid', 'pointy'),
  shiba: look(palette('#3a2414', '#d98a3d', '#a85f22', '#fbeedd'), 'solid', 'pointy'),
  corgi: look(palette('#3a2414', '#e09a4c', '#b8702e', '#fff8ee'), 'solid', 'big'),
  golden_retriever: look(palette('#4a3014', '#e6b25c', '#c98f3a', '#f8e6c0'), 'solid', 'floppy'),
  poodle: look(palette('#3a2a2a', '#f2ebe4', '#d9cfc6', '#ffffff'), 'solid', 'floppy'),
  husky: look(palette('#1e2329', '#7a8694', '#4a535e', '#f2f4f6'), 'cap', 'pointy'),
  white_mouse: look(palette('#5a3a44', '#f6f2f0', '#e8c8cc', '#ffd8de'), 'solid', 'big'),
  fancy_rat: look(palette('#2e2626', '#e8e0d8', '#5a4c44', '#fff8f2'), 'cap', 'big'),
  syrian_hamster: look(palette('#4a2e18', '#e8a85c', '#c7843e', '#fbf0de'), 'solid', 'small'),
  dwarf_hamster: look(palette('#2e2a2a', '#9c968e', '#4a4440', '#f2efe9'), 'dorsal', 'small'),
  panda: look(palette('#1c1c1c', '#f4f4f0', '#2a2a2a', '#ffffff'), 'panda', 'round'),
  wombat: look(palette('#2a2018', '#8a7058', '#6a5442', '#b8a088'), 'solid', 'small'),
};

/** 稀有變種（約 5%）：白化、黑化 */
const RARE: readonly Palette[] = [
  palette('#6a4a50', '#fbf8f6', '#efe4e2', '#ffffff'),
  palette('#0e0e10', '#3a3a42', '#26262c', '#5a5a64'),
];

export function lookFor(view: PetView): Look {
  const base = SPECIES[view.species] ?? SPECIES.tabby_mix;
  if (view.rare) {
    return { ...base, palette: RARE[view.hue_shift % RARE.length] };
  }
  // 同品種內的毛色差異：色相偏移 ±12°
  const shift = (view.hue_shift / 255 - 0.5) * 24;
  const [outline, fur, pattern, light] = base.palette;
  return { ...base, palette: [outline, rotateHue(fur, shift), rotateHue(pattern, shift), rotateHue(light, shift)] };
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
