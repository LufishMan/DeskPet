// 開發腳本共用的 PNG 讀寫：只用 Node 內建的 zlib，不增加相依套件。
// 只支援 8-bit RGBA、非交錯的 PNG（圖稿和產出都是這種格式）。

import { readFileSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export interface Rgba {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
}

export function readPng(file: URL | string): Rgba {
  const data = readFileSync(file);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`不是 PNG：${file}`);
  const w = data.readUInt32BE(16);
  const h = data.readUInt32BE(20);
  if (data[24] !== 8 || data[25] !== 6 || data[28] !== 0) throw new Error(`需為 8-bit RGBA、非交錯 PNG：${file}`);
  const chunks: Buffer[] = [];
  for (let p = 8; p < data.length; ) {
    const size = data.readUInt32BE(p);
    if (data.toString('ascii', p + 4, p + 8) === 'IDAT') chunks.push(data.subarray(p + 8, p + 8 + size));
    p += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = w * 4;
  if (raw.length !== (stride + 1) * h) throw new Error(`PNG 資料長度不符：${file}`);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error(`不支援的 PNG 濾波器：${file}`);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? rgba[i - 4] : 0;
      const b = y > 0 ? rgba[i - stride] : 0;
      const c = x >= 4 && y > 0 ? rgba[i - stride - 4] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      rgba[i] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { w, h, rgba };
}

/** 每一列挑壓縮效果最好的濾波器（差值總和最小的那個），檔案通常小好幾倍 */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const i = y * stride + x;
        const v = rgba[i];
        const a = x >= 4 ? rgba[i - 4] : 0;
        const b = y > 0 ? rgba[i - stride] : 0;
        const c = x >= 4 && y > 0 ? rgba[i - stride - 4] : 0;
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
        const d = (v - predictor) & 255;
        line[x] = d;
        score += d < 128 ? d : 256 - d;
      }
      if (score < bestScore) {
        bestScore = score;
        raw[y * (stride + 1)] = filter;
        raw.set(line, y * (stride + 1) + 1);
      }
    }
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
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
