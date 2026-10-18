// 把寵物精靈圖輸出成 PNG，方便檢查美術，也用來產生程式圖示。
//   npm run preview-sprites -- <輸出.png>          整張預覽表
//   npm run preview-sprites -- --hatch <輸出.png>  孵化動畫的分格
//   npm run preview-sprites -- --style <畫風> <輸出.png>  畫風提案（代表品種）
//   npm run preview-sprites -- --icon <輸出.png>   1024×1024 圖示原圖

import { writeFileSync } from 'node:fs';

import { encodePng as png, readPng } from './png.ts';

import { H, W, renderScene, type Scene } from '../src/render.ts';
import type { BubbleKind } from '../src/bubbles.ts';
import { DEFAULT_STYLE, STYLES, type StyleId } from '../src/style.ts';
import { registerAtlas } from '../src/cream-atlas.ts';
import type { Body, Family, PetView, Pose, Stage } from '../src/types.ts';

// 與瀏覽器共用同一張圖集和切格方式
{
  const { w, h, rgba } = readPng(new URL('../src/assets/pets.png', import.meta.url));
  registerAtlas(w, h, rgba);
}

function view(family: Family, species: string, stage: Stage, body: Body = 'standard', extra: Partial<PetView> = {}): PetView {
  return {
    family,
    species,
    stage,
    body,
    mood: 'normal',
    energy: 5,
    sleeping: false,
    waiting: false,
    legacy_ready: false,
    rare: false,
    hue_shift: 128,
    seed: 1,
    egg_progress: 0,
    focus: false,
    ...extra,
  };
}

function scene(v: PetView, pose: Pose = 'idle', bubble: BubbleKind | null = null, hop = false): Scene {
  return { view: v, pose, breathe: false, tail: 0, hop, wobble: 0, bubble, hatch: null, sparkle: null, style: DEFAULT_STYLE };
}

function frame(s: Scene): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  renderScene(out, s);
  return out;
}

const args = process.argv.slice(2);

if (args[0] === '--icon') {
  // 成年虎斑貓：取不透明像素的範圍，以整數倍放大、置中在 1024×1024 裡
  const src = frame(scene(view('cat', 'tabby_mix', 'adult')));
  let [x0, y0, x1, y1] = [W, H, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (src[(y * W + x) * 4 + 3] === 0) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  const SIZE = 1024;
  const scale = Math.floor(SIZE / (Math.max(x1 - x0, y1 - y0) + 3));
  const ox = Math.floor((SIZE - (x1 - x0 + 1) * scale) / 2);
  const oy = Math.floor((SIZE - (y1 - y0 + 1) * scale) / 2);
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const s = (y * W + x) * 4;
      if (src[s + 3] === 0) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          out.set(src.subarray(s, s + 4), ((oy + (y - y0) * scale + dy) * SIZE + ox + (x - x0) * scale + dx) * 4);
        }
      }
    }
  }
  writeFileSync(args[1], png(SIZE, SIZE, out));
  process.exit(0);
}

const SPECIES: [Family, string][] = [
  ['cat', 'tabby_mix'],
  ['cat', 'british_shorthair'],
  ['cat', 'american_shorthair'],
  ['cat', 'ragdoll'],
  ['cat', 'siamese'],
  ['cat', 'persian'],
  ['dog', 'taiwan_dog_mix'],
  ['dog', 'shiba'],
  ['dog', 'corgi'],
  ['dog', 'golden_retriever'],
  ['dog', 'poodle'],
  ['dog', 'husky'],
  ['mouse', 'white_mouse'],
  ['mouse', 'fancy_rat'],
  ['hamster', 'syrian_hamster'],
  ['hamster', 'dwarf_hamster'],
  ['bear', 'panda'],
  ['bear', 'wombat'],
];
const BODIES: Body[] = ['very_thin', 'thin', 'standard', 'fat', 'very_fat'];

let rows: Scene[][];
let out = args[0] ?? 'sprites.png';
let scaleArg = args[1];

if (args[0] === '--style') {
  // 畫風提案：幾個代表品種，從蛋到成年和幾個動作
  const style = args[1] as StyleId;
  if (!Object.hasOwn(STYLES, style)) throw new Error(`未知畫風：${style}`);
  out = args[2] ?? 'style.png';
  scaleArg = args[3];
  const picks: [Family, string][] = [['cat', 'tabby_mix'], ['dog', 'shiba'], ['mouse', 'white_mouse'], ['hamster', 'syrian_hamster'], ['bear', 'panda']];
  rows = picks.map(([family, species]) =>
    [
      scene(view(family, species, 'egg')),
      scene(view(family, species, 'baby')),
      scene(view(family, species, 'juvenile')),
      scene(view(family, species, 'adult')),
      scene(view(family, species, 'adult'), 'happy', 'heart', true),
      scene(view(family, species, 'adult', 'standard', { sleeping: true }), 'sleep', 'zzz'),
      scene(view(family, species, 'adult'), 'stand'),
      scene(view(family, species, 'adult', 'very_fat')),
    ].map((s) => ({ ...s, style })),
  );
} else if (args[0] === '--hatch') {
  // 每個科一列，從蛋到幼體
  out = args[1] ?? 'hatch.png';
  scaleArg = args[2];
  const steps = [0, 0.15, 0.3, 0.45, 0.52, 0.58, 0.64, 0.7, 0.78, 0.86, 0.94, 1];
  rows = SPECIES.filter((_, i) => [0, 7, 12, 14, 16].includes(i)).map(([family, species]) =>
    steps.map((t, i) => ({ ...scene(view(family, species, 'baby')), hatch: t, wobble: t < 0.5 ? [-1, 0, 1, 0][i % 4] : 0 })),
  );
} else {
  rows = SPECIES.map(([family, species]) => [
    // 同品種三顆不同的蛋（種子與色相偏移不同），再加上裂痕的兩個程度
    scene(view(family, species, 'egg', 'standard', { seed: 1, hue_shift: 128 })),
    scene(view(family, species, 'egg', 'standard', { seed: 77, hue_shift: 30 })),
    scene(view(family, species, 'egg', 'standard', { seed: 4242, hue_shift: 220 })),
    scene(view(family, species, 'egg', 'standard', { egg_progress: 0.8 })),
    scene(view(family, species, 'egg', 'standard', { egg_progress: 1 })),
    scene(view(family, species, 'baby')),
    scene(view(family, species, 'juvenile')),
    ...BODIES.map((b) => scene(view(family, species, 'adult', b))),
    scene(view(family, species, 'adult'), 'look'),
    scene(view(family, species, 'adult'), 'happy', 'heart', true),
    scene(view(family, species, 'adult', 'standard', { sleeping: true }), 'sleep', 'zzz'),
    scene(view(family, species, 'adult', 'standard', { mood: 'tense' }), 'idle', 'sweat'),
    scene(view(family, species, 'egg', 'standard', { rare: true, hue_shift: 0 })),
    scene(view(family, species, 'adult', 'standard', { rare: true, hue_shift: 0 })),
    scene(view(family, species, 'adult', 'standard', { rare: true, hue_shift: 1 })),
  ]);
}

const scale = Number(scaleArg ?? 1);
if (!Number.isInteger(scale) || scale < 1 || scale > 8) throw new Error('預覽倍率必須為 1～8 的整數');
const cellW = (W + 2) * scale;
const cellH = (H + 2) * scale;
const cols = rows[0].length;
const sheetW = cols * cellW;
const sheetH = rows.length * cellH;
const sheet = new Uint8Array(sheetW * sheetH * 4);
// 奶油展示底；實際寵物視窗仍然透明。
for (let i = 0; i < sheet.length; i += 4) sheet.set([250, 241, 225, 255], i);

rows.forEach((row, r) =>
  row.forEach((s, col) => {
    const src = frame(s);
    for (let y = 0; y < H * scale; y++) {
      for (let x = 0; x < W * scale; x++) {
        const i = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
        if (src[i + 3] === 0) continue;
        const dx = col * cellW + scale + x;
        const dy = r * cellH + scale + y;
        // 淡陰影必須先和展示底合成，避免輸出的預覽表出現半透明洞。
        const dst = (dy * sheetW + dx) * 4;
        const alpha = src[i + 3] / 255;
        for (let c = 0; c < 3; c++) sheet[dst + c] = Math.round(src[i + c] * alpha + sheet[dst + c] * (1 - alpha));
      }
    }
  }),
);
writeFileSync(out, png(sheetW, sheetH, sheet));
console.log(`已輸出 ${rows.length}×${cols} 張精靈圖`);
