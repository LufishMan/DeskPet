// 把寵物精靈圖輸出成 PNG，方便檢查美術，也用來產生程式圖示。
//   npm run preview-sprites -- <輸出.png>          整張預覽表
//   npm run preview-sprites -- --hatch <輸出.png>  孵化動畫的分格
//   npm run preview-sprites -- --icon <輸出.png>   1024×1024 圖示原圖

import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

import { H, W, renderScene, type Scene } from '../src/render.ts';
import type { BubbleKind } from '../src/bubbles.ts';
import type { Body, Family, PetView, Pose, Stage } from '../src/types.ts';

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
  return { view: v, pose, breathe: false, tail: 0, hop, wobble: 0, bubble, hatch: null, sparkle: null };
}

function frame(s: Scene): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  renderScene(out, s);
  return out;
}

const args = process.argv.slice(2);

if (args[0] === '--icon') {
  // 成年虎斑貓，取中間 32×32，放大 32 倍成 1024×1024
  const src = frame(scene(view('cat', 'tabby_mix', 'adult')));
  const size = 32;
  const scale = 32;
  const [ox, oy] = [4, H - size - 1];
  const out = new Uint8Array(size * scale * size * scale * 4);
  for (let y = 0; y < size * scale; y++) {
    for (let x = 0; x < size * scale; x++) {
      const s = ((oy + Math.floor(y / scale)) * W + ox + Math.floor(x / scale)) * 4;
      out.set(src.subarray(s, s + 4), (y * size * scale + x) * 4);
    }
  }
  writeFileSync(args[1], png(size * scale, size * scale, out));
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

if (args[0] === '--hatch') {
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

const scale = Number(scaleArg ?? 3);
const cellW = (W + 2) * scale;
const cellH = (H + 2) * scale;
const cols = rows[0].length;
const sheetW = cols * cellW;
const sheetH = rows.length * cellH;
const sheet = new Uint8Array(sheetW * sheetH * 4);
// 淺灰底，模擬桌面
for (let i = 0; i < sheet.length; i += 4) sheet.set([214, 220, 228, 255], i);

rows.forEach((row, r) =>
  row.forEach((s, col) => {
    const src = frame(s);
    for (let y = 0; y < H * scale; y++) {
      for (let x = 0; x < W * scale; x++) {
        const i = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
        if (src[i + 3] === 0) continue;
        const dx = col * cellW + scale + x;
        const dy = r * cellH + scale + y;
        sheet.set(src.subarray(i, i + 4), (dy * sheetW + dx) * 4);
      }
    }
  }),
);
writeFileSync(out, png(sheetW, sheetH, sheet));
console.log(`已輸出 ${rows.length}×${cols} 張精靈圖`);
