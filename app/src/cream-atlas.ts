// 奶油像素原畫：PNG 隨 Vite 打包，只在啟動時解碼；繼續使用既有 RGBA Canvas 與視窗遮罩。
import type { PetView, Pose } from './types.ts';

export const ATLAS_SPECIES = {
  cats: ['tabby_mix', 'british_shorthair', 'american_shorthair', 'ragdoll', 'siamese', 'persian'],
  dogs: ['taiwan_dog_mix', 'shiba', 'corgi', 'golden_retriever', 'poodle', 'husky'],
  small: ['white_mouse', 'fancy_rat', 'syrian_hamster', 'dwarf_hamster', 'panda', 'wombat'],
} as const;

type AtlasId = keyof typeof ATLAS_SPECIES;
interface Raster { w: number; h: number; pixels: Uint8ClampedArray }
const frames = new Map<string, Raster[]>();
const ALPHA = 200; // 去除生成原圖的半透明邊緣霧光，維持清楚像素與可靠點擊範圍。

/** 在預期格線附近找透明間隔，避免生成圖的幾像素排列誤差裁到腳或尾巴。 */
function divisions(projection: Uint32Array, count: number): number[] {
  const cuts = [0];
  const step = projection.length / count;
  for (let i = 1; i < count; i++) {
    const mid = i * step;
    const lo = Math.floor(mid - step * 0.22);
    const hi = Math.ceil(mid + step * 0.22);
    let min = Infinity;
    for (let p = lo; p <= hi; p++) min = Math.min(min, projection[p]);
    let best = Math.round(mid), bestLength = 0;
    for (let p = lo; p <= hi;) {
      if (projection[p] !== min) { p++; continue; }
      const start = p;
      while (p <= hi && projection[p] === min) p++;
      if (p - start > bestLength) { bestLength = p - start; best = Math.floor((start + p) / 2); }
    }
    cuts.push(best);
  }
  cuts.push(projection.length);
  return cuts;
}

/** 純資料入口也供離線預覽／驗證使用；原始 PNG 不經修改。 */
export function registerCreamAtlas(id: AtlasId, w: number, h: number, rgba: Uint8ClampedArray): void {
  if (rgba.length !== w * h * 4) throw new Error(`圖稿尺寸不符：${id}`);
  const rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= ALPHA) rows[y]++;
  const ys = divisions(rows, 6);
  const foreground = new Uint8Array(w * h);
  const prepared = new Map<string, Raster[]>();
  ATLAS_SPECIES[id].forEach((species, row) => {
    // 每列獨立找欄界，長尾與不同體型不必共享同一條垂直裁切線。
    const columns = new Uint32Array(w);
    for (let y = ys[row]; y < ys[row + 1]; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= ALPHA) columns[x]++;
    const xs = divisions(columns, 5);
    const boxes = Array.from({ length: 5 }, (_, col) => {
      const left = xs[col], right = xs[col + 1], top = ys[row], bottom = ys[row + 1];
      const cw = right - left;
      const visited = new Uint8Array(cw * (bottom - top));
      let largest: number[] = [];
      // 每格只留主角色連通區，排除霧邊碎點或鄰列突出的零星像素。
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const local = (y - top) * cw + x - left;
        if (visited[local] || rgba[(y * w + x) * 4 + 3] < ALPHA) continue;
        visited[local] = 1;
        const component = [y * w + x];
        for (let q = 0; q < component.length; q++) {
          const cy = Math.floor(component[q] / w), cx = component[q] % w;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < left || nx >= right || ny < top || ny >= bottom) continue;
            const ni = (ny - top) * cw + nx - left;
            if (visited[ni] || rgba[(ny * w + nx) * 4 + 3] < ALPHA) continue;
            visited[ni] = 1; component.push(ny * w + nx);
          }
        }
        if (component.length > largest.length) largest = component;
      }
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (const index of largest) {
        foreground[index] = 1;
        const x = index % w, y = Math.floor(index / w);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if (x1 < x0 || y1 < y0) throw new Error(`圖稿缺格：${species}/${col}`);
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    });
    const factor = species === 'dwarf_hamster' ? 0.62 : /mouse|rat|hamster/.test(species) ? 0.75 : 1;
    const scale = Math.min(76 / boxes[2].w, 62 / boxes[2].h) * factor;
    prepared.set(species, boxes.map(box => {
      const k = Math.min(scale, 84 / box.w, 70 / box.h);
      const fw = Math.max(1, Math.round(box.w * k)), fh = Math.max(1, Math.round(box.h * k));
      const pixels = new Uint8ClampedArray(fw * fh * 4);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const sx = box.x + Math.min(box.w - 1, Math.floor((x + 0.5) * box.w / fw));
        const sy = box.y + Math.min(box.h - 1, Math.floor((y + 0.5) * box.h / fh));
        const source = (sy * w + sx) * 4, dest = (y * fw + x) * 4;
        if (!foreground[sy * w + sx]) continue;
        pixels.set(rgba.subarray(source, source + 3), dest);
        pixels[dest + 3] = 255;
      }
      return { w: fw, h: fh, pixels };
    }));
  });
  for (const [species, atlas] of prepared) frames.set(species, atlas);
}

export async function loadCreamAtlases(): Promise<void> {
  const urls: Record<AtlasId, string> = {
    cats: new URL('./cream-cats.png', import.meta.url).href,
    dogs: new URL('./cream-dogs.png', import.meta.url).href,
    small: new URL('./cream-small.png', import.meta.url).href,
  };
  // 逐張解碼，避免三張高解析度圖稿同時佔用解碼記憶體。
  for (const id of Object.keys(urls) as AtlasId[]) {
    const image = new Image();
    image.src = urls[id];
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    registerCreamAtlas(id, canvas.width, canvas.height, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    canvas.width = canvas.height = 1;
    image.src = '';
  }
}

const BODY_WIDTH = { very_thin: 0.88, thin: 0.94, standard: 1, fat: 1.06, very_fat: 1.12 };

/** 把圖稿畫到現有畫布。找不到素材時回傳 null，由原繪圖器接手。 */
export function paintCream(out: Uint8ClampedArray, width: number, height: number, view: PetView, pose: Pose, breathe: boolean, hop: boolean): { x: number; y: number } | null {
  const atlas = frames.get(view.species);
  if (!atlas || view.stage === 'egg') return null;
  const stage = view.stage === 'baby' ? 0 : view.stage === 'juvenile' ? 1 : 2;
  const col = pose === 'sleep' || pose === 'tired' ? 4 : pose === 'happy' && stage === 2 ? 3 : stage;
  const frame = atlas[col];
  const growth = col >= 3 ? atlas[stage].w / atlas[2].w : 1;
  const dw = Math.min(width - 8, Math.max(1, Math.round(frame.w * growth * BODY_WIDTH[view.body])));
  const dh = Math.min(height - 24, Math.max(1, Math.round(frame.h * growth) + (breathe ? 1 : 0)));
  const ox = Math.floor((width - dw) / 2), oy = height - dh - 3 - (hop ? 4 : 0);
  // 同一原畫的毛色差異及稀有色：明暗與深色線條保留，不改品種輪廓。
  const tint = (view.hue_shift / 255 - 0.5) * 12;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = Math.min(frame.w - 1, Math.floor(x * frame.w / dw));
    const sy = Math.min(frame.h - 1, Math.floor(y * frame.h / dh));
    const source = (sy * frame.w + sx) * 4;
    if (!frame.pixels[source + 3]) continue;
    const dest = ((oy + y) * width + ox + x) * 4;
    const [r, g, b] = frame.pixels.subarray(source, source + 3);
    const light = r * 0.299 + g * 0.587 + b * 0.114;
    if (view.rare) {
      const v = view.hue_shift % 2 === 0 ? (light < 85 ? 92 + light * 0.3 : 195 + light * 0.22) : 28 + light * 0.25;
      out[dest] = v + 10; out[dest + 1] = v; out[dest + 2] = v - 7;
    } else {
      out[dest] = r + (light > 85 ? tint : 0); out[dest + 1] = g; out[dest + 2] = b - (light > 85 ? tint : 0);
    }
    out[dest + 3] = 255;
  }
  return { x: ox + Math.round(dw * 0.28), y: oy };
}
