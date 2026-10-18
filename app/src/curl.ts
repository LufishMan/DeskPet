// 睡覺：捲成一圈，從上面看下去。參考圓餅貓：身體是一個圓，頭埋在右邊、尾巴沿著下緣繞一圈。

import { BODY_DEPTH, SIDE_MARGIN, STAGES, thick, type Creature, type CreatureSpec, type Frame, type GrownStage } from './creature.ts';
import { drawFrontFace, eyeSize } from './face.ts';
import {
  BASE,
  CLEAR,
  LIGHT,
  PATTERN,
  PINK,
  SHADE,
  bumps,
  curls,
  curve,
  ellipse,
  makeGrid,
  mod,
  onBase,
  onFilled,
  outline,
  recolor,
  shag,
  stamp,
  triangle,
  type Grid,
  type Mask,
  type Pt,
} from './pixel.ts';
import type { Feature, Pattern } from './types.ts';

/** 捲起來的半徑（設計單位） */
const RADIUS: Record<GrownStage, number> = { baby: 5.4, juvenile: 6.8, adult: 8.2 };

interface Geo {
  u: number;
  cx: number;
  cy: number;
  r: number;
  hx: number;
  hy: number;
  hrx: number;
  hry: number;
  baby: boolean;
}

type Part = 'head' | 'body' | 'paws' | 'tail';

const fur: Mask = (c) => c === BASE || c === PATTERN;

function applyPattern(g: Grid, part: Part, pattern: Pattern, geo: Geo): void {
  const { u, cx, cy, r, hx, hy, hrx, hry, baby } = geo;
  const covers = (part === 'head' && (pattern === 'points' || pattern === 'mask' || pattern === 'hood')) || (part === 'body' && pattern === 'panda');
  const stripe = (n: number, period: number, width: number): boolean => mod(n, Math.round(period * u)) < Math.max(1, Math.round(width * u));
  recolor(g, PATTERN, (x, y, v) => {
    if (v !== BASE && !(covers && v === LIGHT)) return false;
    const px = x + 0.5;
    const py = y + 0.5;
    const dist = Math.hypot(px - cx, py - cy);
    const angle = Math.atan2(py - cy, px - cx);
    const nearHead = Math.hypot((px - hx) / hrx, (py - hy) / hry);
    // 沿著圓周放射的條紋（只在外圈）
    const radial = dist > r * 0.45 && mod(Math.floor(((angle + Math.PI) * r) / (2.6 * u)), 2) === 0 && mod(Math.floor(((angle + Math.PI) * r) / (1.3 * u)), 2) === 0;
    const forehead = py < hy - hry * 0.3 && Math.abs(px - hx) < 2 * u && stripe(px - hx + 0.35 * u, 1.3, 0.55);
    switch (pattern) {
      case 'stripes':
        if (part === 'head') return forehead;
        if (part === 'tail') return stripe(x + y, 3, 1);
        return part === 'body' && !baby && radial;
      case 'classic': {
        if (part === 'head') return forehead;
        if (part === 'tail') return stripe(x + y, 3, 1);
        if (part !== 'body' || baby) return false;
        const d = Math.hypot(px - (cx - r * 0.38), py - (cy - r * 0.05)) / r;
        return d < 0.08 || (d >= 0.18 && d < 0.27) || (dist > r * 0.78 && radial);
      }
      case 'points':
        if (part === 'head') return ((px - hx) / (hrx * 0.6)) ** 2 + ((py - hy - hry * 0.25) / (hry * 0.6)) ** 2 <= 1;
        return part === 'tail';
      case 'mask':
        if (part === 'head') return ((px - hx) / (hrx * 0.75)) ** 2 + ((py - hy - hry * 0.2) / (hry * 0.72)) ** 2 <= 1;
        return part === 'tail' || part === 'paws';
      case 'cap':
        // 哈士奇：背（整個圓的外側）深色，頭頂深色、臉白
        if (part === 'head') return py < hy - hry * 0.15 && Math.abs(px - hx) > 0.55 * u;
        return part === 'tail' || part === 'body';
      case 'hood':
        if (part === 'head') return true;
        return part === 'body' && nearHead < 1.7;
      case 'dorsal':
        // 三線鼠：沿著背的弧線
        return part === 'body' && Math.abs(dist - r * 0.7) < 0.6 * u && px < cx + r * 0.3;
      case 'panda':
        // 貓熊：肩膀一圈黑、後腿黑、手腳黑
        if (part === 'paws') return true;
        if (part !== 'body') return false;
        // 頭後面（左側）的肩帶
        return (nearHead > 1 && nearHead < 1.4 && px < hx) || Math.hypot(px - (cx - r * 0.45), py - (cy + r * 0.42)) < r * 0.3;
      case 'solid':
        return false;
    }
  });
}

/** 立耳（從頭頂往上），捲睡時耳朵比較貼 */
function drawEars(g: Grid, spec: CreatureSpec, geo: Geo, scale: number, color: number, inner: number): void {
  const { u, hx, hy, hrx, hry } = geo;
  const s = scale * u;
  for (const side of [-1, 1]) {
    const pointed = (height: number): void => {
      const a: Pt = [hx + side * hrx * 0.1, hy - hry * 0.82];
      const b: Pt = [hx + side * hrx * 0.92, hy - hry * 0.3];
      const tip: Pt = [hx + side * hrx * 0.75, hy - hry - height];
      triangle(g, a, b, tip, color);
      if (color === BASE) {
        const mid: Pt = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3];
        const shrink = (p: Pt, f: number): Pt => [mid[0] + (p[0] - mid[0]) * f, mid[1] + (p[1] - mid[1]) * f];
        triangle(g, shrink(a, 0.45), shrink(b, 0.45), shrink(tip, 0.6), inner, onBase);
      }
    };
    const round = (dx: number, dy: number, r: number, inR: number): void => {
      ellipse(g, hx + side * hrx * dx, hy - hry * dy, r, r, color);
      if (inR > 0 && color === BASE) ellipse(g, hx + side * hrx * dx, hy - hry * dy, inR, inR, inner);
    };
    switch (spec.ears) {
      case 'pointy':
        pointed(2.6 * s);
        break;
      case 'short':
        pointed(1.8 * s);
        break;
      case 'tall':
        pointed(4 * s);
        break;
      case 'round':
        round(0.72, 0.8, 2 * s, 1 * s);
        break;
      case 'big':
        round(0.82, 0.72, 2.8 * s, 1.8 * s);
        break;
      case 'small':
        round(0.66, 0.88, 1.3 * s, 0.6 * s);
        break;
      case 'floppy':
      case 'curly':
        // 垂耳貼在頭的兩側
        ellipse(g, hx + side * hrx * 0.95, hy + hry * 0.1, (spec.ears === 'curly' ? 2.2 : 1.6) * s, hry * 0.62, spec.ears === 'curly' ? BASE : PATTERN);
        break;
    }
  }
}

export function drawCurl(spec: CreatureSpec, frame: Frame, seed = 0): Creature {
  const st = STAGES[spec.stage];
  const u = st.u;
  const b = spec.build;
  const sty = spec.style;
  const has = (f: Feature): boolean => spec.features.includes(f);
  const h = Math.round(st.size * u);
  const w = h + 2 * Math.round(SIDE_MARGIN * u);
  const ground = h - 2;
  const baby = spec.stage === 'baby';
  const depth = BODY_DEPTH[spec.body];

  const r = RADIUS[spec.stage] * u * b.depth ** 0.4 * depth ** 0.6 + (frame.breathe ? 0.25 * u : 0);
  const cx = Math.round(w / 2) + 0.5;
  const cy = ground + 0.5 - r * 0.9;
  // 頭埋在右邊，臉朝向觀看者
  const hrx = r * 0.44 * b.head ** 0.5 + (has('cheeks') ? 0.6 * u : 0);
  const hry = r * 0.38 * b.head ** 0.5;
  const hx = cx + r * 0.4;
  const hy = cy - r * 0.08;
  const geo: Geo = { u, cx, cy, r, hx, hy, hrx, hry, baby };
  const darkEars = ['points', 'mask', 'cap', 'hood', 'panda'].includes(spec.pattern);
  const inner = sty.pinkEars ? PINK : LIGHT;

  // 身體：一個圓，頭和手縮著的地方是亮色的肚子
  const body = makeGrid(w, h);
  ellipse(body, cx, cy, r, r * 0.9, BASE);
  ellipse(body, cx + r * 0.2, cy + r * 0.2, r * 0.52, r * 0.42, LIGHT, onBase);
  applyPattern(body, 'body', spec.pattern, geo);
  if (sty.fur === 'shaggy') shag(body, u);
  else if (b.fur === 'curly') bumps(body, 1.1 * u, Math.round(2.4 * u));
  if (b.fur === 'curly') curls(body, u, seed, () => false);
  if (sty.shading === 'bottom') {
    recolor(body, SHADE, (x, y, v) => v === BASE && [1, 2].some((k) => body.px[(y + k) * w + x] === CLEAR || y + k >= h));
  }
  outline(body);

  // 尾巴沿著身體下緣繞到前面
  const tail = makeGrid(w, h);
  const tr = (spec.tail === 'fluffy' ? 1.6 : spec.tail === 'feather' ? 1.5 : 1.1) * u * (baby ? 0.85 : 1);
  const wrap = curve([cx + r * 0.75, cy + r * 0.5], [cx + r * 0.05, cy + r * 1.1], [cx - r * 0.78, cy + r * 0.45], 32);
  switch (spec.tail) {
    case 'long':
    case 'fluffy':
    case 'feather':
    case 'wag':
      thick(tail, wrap, tr);
      if (spec.tail !== 'wag') bumps(tail, 0.6 * u, Math.round(1.8 * u));
      break;
    case 'thin':
      thick(tail, wrap, Math.max(0.6, 0.45 * u), PINK);
      break;
    case 'curl':
    case 'pom':
      ellipse(tail, cx - r * 0.62, cy - r * 0.52, 2.2 * u, 2.2 * u, BASE);
      if (spec.tail === 'curl') ellipse(tail, cx - r * 0.62, cy - r * 0.5, 0.9 * u, 0.9 * u, LIGHT, onBase);
      else bumps(tail, 0.7 * u, Math.round(1.6 * u));
      break;
    case 'stub':
      ellipse(tail, cx - r * 0.92, cy + r * 0.15, 1.3 * u, 1.3 * u, BASE);
      break;
    case 'none':
      break;
  }
  applyPattern(tail, 'tail', spec.pattern, geo);
  outline(tail);

  // 前腳縮在下巴下面
  const paws = makeGrid(w, h);
  for (const [dx, dy] of [[-0.55, 0.98], [0.15, 1.05]] as const) ellipse(paws, hx + dx * hrx, hy + dy * hry, 1.2 * u, 0.9 * u, BASE);
  applyPattern(paws, 'paws', spec.pattern, geo);
  if (has('socks') || has('stockings') || has('urajiro') || has('blaze')) recolor(paws, LIGHT, (_, __, v) => fur(v));
  outline(paws);

  // 頭
  const ears = makeGrid(w, h);
  drawEars(ears, spec, geo, st.ear, darkEars ? PATTERN : BASE, inner);
  applyPattern(ears, 'head', spec.pattern, geo);
  outline(ears);
  const head = makeGrid(w, h);
  ellipse(head, hx, hy, hrx, hry, BASE);
  if (has('pouches')) for (const side of [-1, 1]) ellipse(head, hx + side * hrx * 0.7, hy + hry * 0.42, hrx * 0.4, hry * 0.36, LIGHT);
  const muzzleY = hy + hry * 0.42;
  ellipse(head, hx, muzzleY, hrx * (0.3 + 0.03 * b.snout), hry * (0.24 + 0.025 * b.snout), LIGHT, onBase);
  if (has('urajiro')) ellipse(head, hx, hy + hry * 0.5, hrx * 0.8, hry * 0.42, LIGHT, onBase);
  if (has('blaze')) ellipse(head, hx, hy - hry * 0.2, 0.7 * u, hry * 0.6, LIGHT, onBase);
  const [eyeRx, eyeRy] = eyeSize(sty, hrx, hry, u);
  const eyeDx = hrx * 0.42;
  const eyeY = hy + hry * 0.02;
  if (spec.pattern === 'panda') {
    for (const side of [-1, 1]) ellipse(head, hx + side * (eyeDx + 0.2 * u), eyeY + 0.3 * u, eyeRx * 1.05 + 0.5 * u, eyeRy * 0.95 + 0.5 * u, PATTERN, onFilled);
  }
  applyPattern(head, 'head', spec.pattern, geo);
  if (sty.fur === 'shaggy') shag(head, u, (x, y) => Math.abs(x + 0.5 - hx) > hrx * 0.45 || y < hy - hry * 0.6);
  outline(head);

  const out = makeGrid(w, h);
  for (const layer of [body, tail, ears, head, paws]) stamp(out, layer);
  drawFrontFace(
    out,
    {
      u,
      cx: hx,
      eyeY,
      eyeDx,
      eyeRx,
      eyeRy,
      noseY: muzzleY - hry * 0.12,
      nose: has('big_nose') ? 'big' : b.nose === 2 ? 'dog' : 'pink',
      mouth: false,
      whiskers: b.whiskers ? hrx : null,
    },
    sty,
    'sleep',
  );
  return Object.assign(out, { anchor: [Math.round(hx), Math.round(hy - hry)] as Pt });
}
