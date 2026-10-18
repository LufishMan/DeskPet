// 把奶油像素原畫（art/cream/*.png）切成每一格、縮成程式實際使用的大小，
// 打包成一張小圖集 app/src/assets/pets.png 和格子座標 app/src/assets/pets-atlas.ts。
// 原畫或裁切規則改變時重新執行：npm run bake-atlas
//
// 原畫三張各 5 欄 × 6 列；欄位依序是幼年、少年、成年待機、成年開心、成年睡眠（說明見 art/cream/README.md）。

import { writeFileSync } from 'node:fs';

import { encodePng, readPng } from './png.ts';

const SHEETS = {
  cats: ['tabby_mix', 'british_shorthair', 'american_shorthair', 'ragdoll', 'siamese', 'persian'],
  dogs: ['taiwan_dog_mix', 'shiba', 'corgi', 'golden_retriever', 'poodle', 'husky'],
  small: ['white_mouse', 'fancy_rat', 'syrian_hamster', 'dwarf_hamster', 'panda', 'wombat'],
} as const;
const COLUMNS = 5;
/** 去除生成原圖的半透明邊緣霧光，維持清楚像素與可靠點擊範圍 */
const ALPHA = 200;
/** 圖集裡格子之間留的透明間隔 */
const GAP = 1;

interface Frame {
  w: number;
  h: number;
  pixels: Uint8ClampedArray;
}

/** 在預期格線附近找透明間隔，避免生成圖的幾像素排列誤差裁到腳或尾巴 */
function divisions(projection: Uint32Array, count: number): number[] {
  const cuts = [0];
  const step = projection.length / count;
  for (let i = 1; i < count; i++) {
    const mid = i * step;
    const lo = Math.floor(mid - step * 0.22);
    const hi = Math.ceil(mid + step * 0.22);
    let min = Infinity;
    for (let p = lo; p <= hi; p++) min = Math.min(min, projection[p]);
    let best = Math.round(mid);
    let bestLength = 0;
    for (let p = lo; p <= hi; ) {
      if (projection[p] !== min) {
        p++;
        continue;
      }
      const start = p;
      while (p <= hi && projection[p] === min) p++;
      if (p - start > bestLength) {
        bestLength = p - start;
        best = Math.floor((start + p) / 2);
      }
    }
    cuts.push(best);
  }
  cuts.push(projection.length);
  return cuts;
}

/** 切出一張原畫裡每個品種的 5 格，縮成邏輯像素（成年待機約 76×62 以內） */
function slice(species: readonly string[], w: number, h: number, rgba: Uint8ClampedArray): Map<string, Frame[]> {
  const rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= ALPHA) rows[y]++;
  const ys = divisions(rows, species.length);
  const foreground = new Uint8Array(w * h);
  const out = new Map<string, Frame[]>();
  species.forEach((name, row) => {
    // 每列獨立找欄界，長尾與不同體型不必共享同一條垂直裁切線
    const columns = new Uint32Array(w);
    for (let y = ys[row]; y < ys[row + 1]; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= ALPHA) columns[x]++;
    const xs = divisions(columns, COLUMNS);
    const boxes = Array.from({ length: COLUMNS }, (_, col) => {
      const [left, right, top, bottom] = [xs[col], xs[col + 1], ys[row], ys[row + 1]];
      const cw = right - left;
      const visited = new Uint8Array(cw * (bottom - top));
      let largest: number[] = [];
      // 每格只留主角色的連通區，排除霧邊碎點或鄰列突出的零星像素
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const local = (y - top) * cw + x - left;
          if (visited[local] || rgba[(y * w + x) * 4 + 3] < ALPHA) continue;
          visited[local] = 1;
          const component = [y * w + x];
          for (let q = 0; q < component.length; q++) {
            const cy = Math.floor(component[q] / w);
            const cx = component[q] % w;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < left || nx >= right || ny < top || ny >= bottom) continue;
                const ni = (ny - top) * cw + nx - left;
                if (visited[ni] || rgba[(ny * w + nx) * 4 + 3] < ALPHA) continue;
                visited[ni] = 1;
                component.push(ny * w + nx);
              }
            }
          }
          if (component.length > largest.length) largest = component;
        }
      }
      let [x0, y0, x1, y1] = [w, h, -1, -1];
      for (const index of largest) {
        foreground[index] = 1;
        const x = index % w;
        const y = Math.floor(index / w);
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
      if (x1 < x0 || y1 < y0) throw new Error(`圖稿缺格：${name}/${col}`);
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    });
    // 鼠科和倉鼠本來就小，三線鼠更小
    const factor = name === 'dwarf_hamster' ? 0.62 : /mouse|rat|hamster/.test(name) ? 0.75 : 1;
    const scale = Math.min(76 / boxes[2].w, 62 / boxes[2].h) * factor;
    out.set(
      name,
      boxes.map((box) => {
        const k = Math.min(scale, 84 / box.w, 70 / box.h);
        const fw = Math.max(1, Math.round(box.w * k));
        const fh = Math.max(1, Math.round(box.h * k));
        const pixels = new Uint8ClampedArray(fw * fh * 4);
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const sx = box.x + Math.min(box.w - 1, Math.floor(((x + 0.5) * box.w) / fw));
            const sy = box.y + Math.min(box.h - 1, Math.floor(((y + 0.5) * box.h) / fh));
            if (!foreground[sy * w + sx]) continue;
            const source = (sy * w + sx) * 4;
            const dest = (y * fw + x) * 4;
            pixels.set(rgba.subarray(source, source + 3), dest);
            pixels[dest + 3] = 255;
          }
        }
        return { w: fw, h: fh, pixels };
      }),
    );
  });
  return out;
}

const frames = new Map<string, Frame[]>();
for (const [sheet, species] of Object.entries(SHEETS)) {
  const { w, h, rgba } = readPng(new URL(`../../art/cream/${sheet}.png`, import.meta.url));
  for (const [name, list] of slice(species, w, h, rgba)) frames.set(name, list);
}

// 每個品種一列、5 格一排
const rowWidths = [...frames.values()].map((list) => list.reduce((sum, f) => sum + f.w + GAP, 0));
const width = Math.max(...rowWidths);
const height = [...frames.values()].reduce((sum, list) => sum + Math.max(...list.map((f) => f.h)) + GAP, 0);
const atlas = new Uint8ClampedArray(width * height * 4);
const rects: Record<string, [number, number, number, number][]> = {};
let top = 0;
for (const [name, list] of frames) {
  let left = 0;
  rects[name] = list.map((f) => {
    for (let y = 0; y < f.h; y++) atlas.set(f.pixels.subarray(y * f.w * 4, (y + 1) * f.w * 4), ((top + y) * width + left) * 4);
    const rect: [number, number, number, number] = [left, top, f.w, f.h];
    left += f.w + GAP;
    return rect;
  });
  top += Math.max(...list.map((f) => f.h)) + GAP;
}

const png = encodePng(width, height, atlas);
writeFileSync(new URL('../src/assets/pets.png', import.meta.url), png);
const body = Object.entries(rects)
  .map(([name, list]) => `  ${name}: [${list.map((r) => `[${r.join(', ')}]`).join(', ')}],`)
  .join('\n');
writeFileSync(
  new URL('../src/assets/pets-atlas.ts', import.meta.url),
  `// 由 scripts/bake-atlas.ts 產生，請勿手動修改。
// 每個品種 5 格：幼年、少年、成年待機、成年開心、成年睡眠；每格是 pets.png 裡的 [x, y, 寬, 高]。

export type Rect = readonly [number, number, number, number];

export const PET_FRAMES: Readonly<Record<string, readonly Rect[]>> = {
${body}
};
`,
);
console.log(`已輸出圖集 ${width}×${height}（${(png.length / 1024).toFixed(1)} KB），${frames.size} 個品種`);
