// 奶油像素原畫：預先切好、縮好的圖集（assets/pets.png，由 scripts/bake-atlas.ts 產生）隨 Vite 打包，
// 啟動時在本機解碼一次，之後畫到既有的 RGBA 畫布，視窗遮罩照舊由畫布算出。

import { PET_FRAMES } from './assets/pets-atlas.ts';
import type { PetView, Pose } from './types.ts';

interface Raster {
  w: number;
  h: number;
  pixels: Uint8ClampedArray;
}
const frames = new Map<string, Raster[]>();

/** 依格子座標切出每一格。瀏覽器和離線預覽共用 */
export function registerAtlas(w: number, h: number, rgba: Uint8ClampedArray): void {
  if (rgba.length !== w * h * 4) throw new Error('圖集尺寸不符');
  for (const [species, rects] of Object.entries(PET_FRAMES)) {
    frames.set(
      species,
      rects.map(([x, y, fw, fh]) => {
        const pixels = new Uint8ClampedArray(fw * fh * 4);
        for (let row = 0; row < fh; row++) pixels.set(rgba.subarray(((y + row) * w + x) * 4, ((y + row) * w + x + fw) * 4), row * fw * 4);
        return { w: fw, h: fh, pixels };
      }),
    );
  }
}

export async function loadAtlas(): Promise<void> {
  const image = new Image();
  image.src = new URL('./assets/pets.png', import.meta.url).href;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  registerAtlas(canvas.width, canvas.height, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
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
