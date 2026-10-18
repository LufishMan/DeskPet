// 正面坐姿：平常待著的樣子。參考長毛貓的像素畫：大頭、圓身體、前腳併攏、尾巴繞在身旁。

import { BODY_DEPTH, SIDE_MARGIN, STAGES, thick, type Creature, type CreatureSpec, type Frame, type GrownStage } from './creature.ts';
import { drawFrontFace, eyeSize } from './face.ts';
import {
  BASE,
  CLEAR,
  LIGHT,
  OUTLINE,
  PATTERN,
  PINK,
  SHADE,
  bumps,
  curls,
  curve,
  ellipse,
  line,
  makeGrid,
  mod,
  onBase,
  onFilled,
  outline,
  put,
  recolor,
  shag,
  stamp,
  triangle,
  tufts,
  type Grid,
  type Mask,
  type Pt,
} from './pixel.ts';
import type { Feature, Pattern } from './types.ts';

/** 坐姿的身體和頭（設計單位）。頭比側面大，比較可愛 */
const SIT: Record<GrownStage, { body: Pt; head: Pt }> = {
  baby: { body: [4.3, 3.9], head: [4.9, 4.4] },
  juvenile: { body: [5.4, 5.2], head: [5.4, 4.8] },
  adult: { body: [6.4, 6.4], head: [6, 5.2] },
};

interface Geo {
  u: number;
  ground: number;
  cx: number;
  bodyY: number;
  bodyRx: number;
  bodyRy: number;
  headY: number;
  headRx: number;
  headRy: number;
  baby: boolean;
}

type Part = 'head' | 'body' | 'paws' | 'tail';

const fur: Mask = (c) => c === BASE || c === PATTERN;

function applyPattern(g: Grid, part: Part, pattern: Pattern, geo: Geo): void {
  const { u, cx, bodyY, bodyRx, bodyRy, headY, headRx, headRy, baby } = geo;
  const bodyTop = bodyY - bodyRy;
  const covers = (part === 'head' && (pattern === 'points' || pattern === 'mask' || pattern === 'hood')) || (part === 'body' && pattern === 'panda');
  const stripe = (n: number, period: number, width: number): boolean => mod(n, Math.round(period * u)) < Math.max(1, Math.round(width * u));
  recolor(g, PATTERN, (x, y, v) => {
    if (v !== BASE && !(covers && v === LIGHT)) return false;
    const px = x + 0.5;
    const py = y + 0.5;
    const dx = Math.abs(px - cx);
    const inHead = (dx / headRx) ** 2 + ((py - headY) / headRy) ** 2 <= 1;
    // 額頭三道直紋、兩頰各兩道橫紋（虎斑的 M 字和臉頰紋）
    const tabbyFace =
      inHead &&
      ((py < headY - headRy * 0.3 && dx < 2.6 * u && stripe(px - cx + 0.35 * u, 1.3, 0.55)) ||
        (dx > headRx * 0.58 && py > headY - headRy * 0.1 && py < headY + headRy * 0.5 && stripe(py, 1.6, 0.55)));
    switch (pattern) {
      case 'stripes':
        if (part === 'head') return tabbyFace;
        if (part === 'tail') return stripe(x + y, 3, 1);
        if (part === 'paws' || baby) return false;
        return dx > bodyRx * 0.32 && stripe(py + dx * 0.5, 3, 1);
      case 'classic': {
        // 美短：身體兩側的圓渦紋
        if (part === 'head') return tabbyFace;
        if (part === 'tail') return stripe(x + y, 3, 1);
        if (part === 'paws' || baby) return false;
        const d = Math.hypot(dx - bodyRx * 0.62, py - bodyY) / bodyRy;
        return d < 0.14 || (d >= 0.3 && d < 0.46);
      }
      case 'points':
        // 布偶：臉中央、耳朵、尾巴深色
        if (part === 'head') return ((px - cx) / (headRx * 0.55)) ** 2 + ((py - headY - headRy * 0.25) / (headRy * 0.55)) ** 2 <= 1;
        return part === 'tail';
      case 'mask':
        // 暹羅：大面罩，深色的腳和尾巴
        if (part === 'head') return ((px - cx) / (headRx * 0.72)) ** 2 + ((py - headY - headRy * 0.2) / (headRy * 0.7)) ** 2 <= 1;
        return part === 'tail' || part === 'paws';
      case 'cap': {
        // 哈士奇：頭頂和兩側深色、白色的臉和額頭中線；肩膀和身體兩側深色
        if (part === 'head') {
          const face = ((px - cx) / (headRx * 0.78)) ** 2 + ((py - headY - headRy * 0.38) / (headRy * 0.62)) ** 2 <= 1;
          const blaze = dx < 0.55 * u && py > headY - headRy * 0.75;
          return !face && !blaze;
        }
        if (part === 'tail') return true;
        return part === 'body' && (dx > bodyRx * 0.45 || py < bodyTop + bodyRy * 0.25);
      }
      case 'hood':
        // 花枝鼠：整個頭和肩膀深色
        if (part === 'head') return true;
        return part === 'body' && py < bodyTop + bodyRy * 0.45;
      case 'dorsal':
        // 三線鼠：頭頂中央一條深線
        return part === 'head' && dx < 0.6 * u && py < headY - headRy * 0.35;
      case 'panda':
        // 貓熊：肩帶和手臂、腳黑色（黑耳和黑眼圈另外畫）
        if (part === 'paws') return true;
        return part === 'body' && (py < bodyTop + bodyRy * 0.42 || dx > bodyRx * 0.58);
      case 'solid':
        return false;
    }
  });
}

function drawEars(g: Grid, spec: CreatureSpec, geo: Geo, scale: number, color: number, inner: number): void {
  const { u, cx, headY, headRx, headRy } = geo;
  const s = scale * u;
  for (const side of [-1, 1]) {
    const pointed = (height: number, spread: number): void => {
      const a: Pt = [cx + side * headRx * 0.12, headY - headRy * 0.82];
      const b: Pt = [cx + side * headRx * (0.9 + spread), headY - headRy * 0.32];
      const tip: Pt = [cx + side * headRx * (0.68 + spread), headY - headRy - height];
      triangle(g, a, b, tip, color);
      if (color === BASE) {
        const mid: Pt = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3];
        const shrink = (p: Pt, f: number): Pt => [mid[0] + (p[0] - mid[0]) * f, mid[1] + (p[1] - mid[1]) * f];
        triangle(g, shrink(a, 0.45), shrink(b, 0.45), shrink(tip, 0.62), inner, onBase);
      }
    };
    const round = (dx: number, dy: number, r: number, inR: number): void => {
      ellipse(g, cx + side * headRx * dx, headY - headRy * dy, r, r, color);
      if (inR > 0 && color === BASE) ellipse(g, cx + side * headRx * dx, headY - headRy * dy + r * 0.1, inR, inR, inner);
    };
    switch (spec.ears) {
      case 'pointy':
        pointed(3.4 * s, 0);
        break;
      case 'short':
        pointed(2.4 * s, 0.05);
        break;
      case 'tall':
        pointed(5.2 * s, 0.12);
        break;
      case 'round':
        round(0.72, 0.82, 2.4 * s, 1.2 * s);
        break;
      case 'big':
        round(0.8, 0.78, 3.4 * s, 2.2 * s);
        break;
      case 'small':
        round(0.66, 0.9, 1.6 * s, 0.8 * s);
        break;
      case 'floppy':
      case 'curly':
        break;
    }
  }
}

/** 垂耳：從頭頂兩側垂下來，蓋在頭上 */
function drawLopEars(spec: CreatureSpec, geo: Geo, w: number, h: number, scale: number, seed: number): Grid | null {
  if (spec.ears !== 'floppy' && spec.ears !== 'curly') return null;
  const { u, cx, headY, headRx, headRy } = geo;
  const g = makeGrid(w, h);
  for (const side of [-1, 1]) {
    if (spec.ears === 'floppy') {
      ellipse(g, cx + side * headRx * 0.92, headY + headRy * 0.05, (1.7 * scale + 0.3) * u, headRy * 0.7, PATTERN);
    } else {
      ellipse(g, cx + side * headRx * 0.95, headY + headRy * 0.2, 2.5 * scale * u, headRy * 0.82, BASE);
    }
  }
  if (spec.ears === 'curly') {
    bumps(g, 0.9 * u, Math.round(2 * u));
    curls(g, u, seed + 2, () => false);
  } else {
    tufts(g, [0, 1], Math.round(1.6 * u), Math.round(0.8 * u), () => true);
  }
  outline(g);
  return g;
}

/** 尾巴繞在身體右側（從觀看者看） */
function drawTail(spec: CreatureSpec, geo: Geo, w: number, h: number, frame: Frame): Grid {
  const { u, ground, cx, bodyY, bodyRx, bodyRy, baby } = geo;
  const g = makeGrid(w, h);
  const sw = frame.tail * u;
  const up = frame.pose === 'happy' ? 1 : frame.pose === 'tired' ? -1 : 0;
  const k = (baby ? 0.85 : 1) * u;
  const right = cx + bodyRx;
  const bodyTop = bodyY - bodyRy;
  switch (spec.tail) {
    case 'long':
    case 'fluffy': {
      const r = (spec.tail === 'fluffy' ? 1.9 : 1.2) * k;
      const end: Pt = [right + 3.8 * u + sw * 0.6, ground - (4.2 + up * 2) * u];
      thick(g, curve([cx + bodyRx * 0.55, ground - 1.2 * u], [right + 3.5 * u, ground + 0.3 * u], end, 28), r);
      if (spec.tail === 'fluffy') bumps(g, 0.7 * u, Math.round(1.8 * u));
      break;
    }
    case 'wag':
      thick(g, curve([cx + bodyRx * 0.6, bodyY], [right + 3 * u, bodyY - u], [right + 1.5 * u + sw, bodyTop - (1.5 + up) * u], 24), 1.1 * k);
      break;
    case 'curl': {
      const ring: Pt = [cx + bodyRx * 0.88 + sw * 0.3, bodyTop + (1.2 - up * 0.4) * u];
      const r = 2.6 * k;
      ellipse(g, ring[0], ring[1], r, r, BASE);
      ellipse(g, ring[0] - 0.2 * u, ring[1] + 0.3 * u, r * 0.42, r * 0.42, LIGHT, onBase);
      break;
    }
    case 'feather':
      thick(g, curve([cx + bodyRx * 0.6, ground - 1.5 * u], [right + 3.5 * u, ground - (1 + up) * u], [right + 5 * u + sw, ground - (3.5 + up * 2) * u], 28), 1.5 * k);
      tufts(g, [0, 1], Math.round(2.2 * u), Math.round(1.2 * u), () => true);
      break;
    case 'pom': {
      const ball: Pt = [right + 1.6 * u + sw * 0.4, bodyY - (2 + up) * u];
      thick(g, curve([cx + bodyRx * 0.6, bodyY + u], [right + u, bodyY], ball, 12), 0.65 * u);
      ellipse(g, ball[0], ball[1], 2.1 * k, 2.1 * k, BASE);
      bumps(g, 0.7 * u, Math.round(1.6 * u), (x, y) => Math.hypot(x - ball[0], y - ball[1]) < 2.6 * k);
      break;
    }
    case 'thin':
      thick(g, curve([cx + bodyRx * 0.6, ground - 0.5 * u], [right + 4 * u, ground + 0.4 * u], [right + 7 * u + sw, ground - (2.5 + up * 1.5) * u], 40), Math.max(0.6, 0.45 * u), PINK);
      break;
    case 'stub':
      ellipse(g, cx + bodyRx * 0.92, ground - 1.6 * u, 1.4 * k, 1.4 * k, BASE);
      break;
    case 'none':
      break;
  }
  return g;
}

export function drawSit(spec: CreatureSpec, frame: Frame, seed = 0): Creature {
  const st = STAGES[spec.stage];
  const u = st.u;
  const b = spec.build;
  const sty = spec.style;
  const S = SIT[spec.stage];
  const has = (f: Feature): boolean => spec.features.includes(f);
  const h = Math.round(st.size * u);
  const w = h + 2 * Math.round(SIDE_MARGIN * u);
  const ground = h - 2;
  const pose = frame.pose;
  const baby = spec.stage === 'baby';
  const depth = BODY_DEPTH[spec.body];
  // 尾巴在右邊，身體稍微往左放
  const cx = Math.round(w / 2 - 2 * u) + 0.5;

  // 身體：寬度跟體型和品種的厚度走，高度跟腿長走（長腿的坐起來比較高）
  const bodyRx = S.body[0] * u * b.depth ** 0.6 * depth;
  const bodyRy = S.body[1] * u * (0.86 + 0.14 * b.legs) * b.depth ** 0.3 + (frame.breathe ? 0.3 * u : 0);
  const bodyY = ground + 0.5 - bodyRy;
  const bodyTop = bodyY - bodyRy;

  // 頭：脖子越短，頭越往身體裡沉（倉鼠整隻是一團）
  const flat = has('flat_face');
  const headRx = S.head[0] * u * b.head + (has('cheeks') ? 0.7 * u : 0) + (flat ? 0.4 * u : 0);
  const headRy = S.head[1] * u * b.head;
  const lift = (pose === 'look' ? -0.6 : pose === 'tired' ? 1.2 : 0) * u;
  const headY = bodyTop + headRy * (0.45 - 0.75 * b.neck) + lift;
  const geo: Geo = { u, ground, cx, bodyY, bodyRx, bodyRy, headY, headRx, headRy, baby };

  const darkEars = ['points', 'mask', 'cap', 'hood', 'panda'].includes(spec.pattern);
  const inner = sty.pinkEars ? PINK : LIGHT;
  const earScale = st.ear;

  // 尾巴（最後面）
  const tail = drawTail(spec, geo, w, h, frame);
  applyPattern(tail, 'tail', spec.pattern, geo);
  if (sty.fur === 'shaggy') shag(tail, u);
  outline(tail);

  // 身體：圓身體加兩側的後腿，胸口亮色
  const body = makeGrid(w, h);
  ellipse(body, cx, bodyY, bodyRx * 0.82, bodyRy, BASE);
  for (const side of [-1, 1]) ellipse(body, cx + side * bodyRx * 0.55, ground - bodyRy * 0.4, bodyRx * 0.48, bodyRy * 0.42, BASE);
  if (spec.body === 'very_fat') ellipse(body, cx, bodyY + bodyRy * 0.25, bodyRx * 1.08, bodyRy * 0.72, BASE);
  ellipse(body, cx, bodyY - bodyRy * 0.05, bodyRx * 0.45, bodyRy * 0.62, LIGHT, onBase);
  applyPattern(body, 'body', spec.pattern, geo);
  if (has('bib') || has('urajiro') || has('blaze')) ellipse(body, cx, bodyTop + bodyRy * 0.55, bodyRx * 0.42, bodyRy * 0.55, LIGHT, fur);
  if (spec.body === 'very_thin') {
    // 很瘦：胸口兩側看得到肋骨（§11.2）
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const y = Math.round(bodyY - bodyRy * 0.1 + k * 1.2 * u);
        line(body, curve([cx + side * bodyRx * 0.5, y], [cx + side * bodyRx * 0.62, y - 0.3 * u], [cx + side * bodyRx * 0.74, y], 6), SHADE, fur);
      }
    }
  }
  if (sty.fur === 'shaggy') shag(body, u, (_, y) => y <= ground);
  else if (b.fur === 'curly') bumps(body, 1.1 * u, Math.round(2.4 * u), (_, y) => y < ground - u);
  else if (b.fur === 'fluffy' && sty.fur === 'breed') {
    for (const dir of [[1, 0], [-1, 0]] as const) tufts(body, dir, Math.round(2.4 * u), Math.round(1.2 * u), (_, y) => y < bodyY);
  }
  if (b.fur === 'curly') curls(body, u, seed, () => false);
  if (sty.shading === 'bottom') {
    recolor(body, SHADE, (x, y, v) => v === BASE && [1, 2].some((k) => body.px[(y + k) * w + x] === CLEAR || y + k >= h));
  }
  outline(body);

  // 前腳：長腿的品種看得到前腿，短腿的（鼠、倉鼠）把手縮在胸前
  const paws = makeGrid(w, h);
  const pawRx = Math.max(1.2 * u, b.legWidth * 0.55 * u) * (baby ? 0.85 : 1);
  const pawRy = 1.1 * u * (0.8 + 0.4 * Math.min(1.2, b.legs));
  const tucked = b.legs < 0.4;
  const pawDx = tucked ? Math.max(pawRx * 0.9, headRx * 0.18) : Math.max(pawRx + 0.2 * u, bodyRx * 0.28);
  const pawY = tucked ? headY + headRy * 0.98 : ground + 0.5 - pawRy;
  for (const side of [-1, 1]) {
    const px = cx + side * pawDx;
    ellipse(paws, px, pawY, pawRx, pawRy, BASE);
  }
  applyPattern(paws, 'paws', spec.pattern, geo);
  if (has('socks') || has('stockings') || has('urajiro') || has('blaze')) recolor(paws, LIGHT, (_, __, v) => fur(v));
  outline(paws);
  if (!tucked && pawRx >= 2) {
    // 腳趾：每隻腳底兩道短線
    for (const side of [-1, 1]) {
      for (const f of [-0.3, 0.3]) {
        const x = Math.round(cx + side * pawDx + f * pawRx);
        for (let y = ground - Math.round(0.5 * u); y <= ground; y++) if (paws.px[y * w + x] >= BASE) put(paws, x, y, OUTLINE);
      }
    }
  }

  // 立耳：獨立一層畫在頭後面，不會被頭上的毛尖蓋掉
  const ears = makeGrid(w, h);
  drawEars(ears, spec, geo, earScale, darkEars ? PATTERN : BASE, inner);
  applyPattern(ears, 'head', spec.pattern, geo);
  outline(ears);

  // 頭、口鼻、臉頰
  const head = makeGrid(w, h);
  ellipse(head, cx, headY, headRx, headRy, BASE);
  if (has('pouches')) {
    for (const side of [-1, 1]) {
      ellipse(head, cx + side * headRx * 0.72, headY + headRy * 0.42, headRx * 0.42, headRy * 0.38, BASE);
      ellipse(head, cx + side * headRx * 0.72, headY + headRy * 0.48, headRx * 0.3, headRy * 0.26, LIGHT, onBase);
    }
  }
  // 口鼻：口鼻越長，亮色的嘴邊越大、越低
  const snout = flat ? 0 : b.snout;
  const muzzleY = headY + headRy * (0.42 + 0.02 * snout);
  const muzzleRx = headRx * (0.28 + 0.035 * snout);
  const muzzleRy = headRy * (0.22 + 0.03 * snout);
  ellipse(head, cx, muzzleY, muzzleRx, muzzleRy, LIGHT, onBase);
  if (has('urajiro')) ellipse(head, cx, headY + headRy * 0.5, headRx * 0.8, headRy * 0.42, LIGHT, onBase);
  if (has('blaze')) ellipse(head, cx, headY - headRy * 0.2, 0.8 * u, headRy * 0.6, LIGHT, onBase);
  const [eyeRx, eyeRy] = eyeSize(sty, headRx, headRy, u);
  const eyeDx = headRx * 0.42;
  const eyeY = headY + headRy * 0.02;
  if (spec.pattern === 'panda') {
    for (const side of [-1, 1]) ellipse(head, cx + side * (eyeDx + 0.2 * u), eyeY + 0.3 * u, eyeRx * 1.5 + 0.9 * u, eyeRy * 1.4 + 0.9 * u, PATTERN, onFilled);
  }
  applyPattern(head, 'head', spec.pattern, geo);
  if (sty.fur === 'shaggy') {
    // 臉的中央不長毛尖，只有頭頂、臉頰和下巴
    shag(head, u, (x, y) => Math.abs(x + 0.5 - cx) > headRx * 0.45 || y > headY + headRy * 0.6 || y < headY - headRy * 0.6);
  } else if (b.fur === 'fluffy' && sty.fur === 'breed') {
    tufts(head, [0, 1], Math.round(2.4 * u), Math.round(1.2 * u), (x) => Math.abs(x + 0.5 - cx) < headRx * 0.7);
  }
  outline(head);

  let tuft: Grid | null = null;
  if (has('topknot')) {
    tuft = makeGrid(w, h);
    const ty = headY - headRy * 0.88;
    ellipse(tuft, cx, ty, headRx * 0.55, headRy * 0.4, BASE);
    bumps(tuft, 0.9 * u, Math.round(1.8 * u), (_, y) => y < ty + headRy * 0.2);
    curls(tuft, u, seed + 1, () => false);
    outline(tuft);
  }
  const lop = drawLopEars(spec, geo, w, h, earScale, seed);

  const out = makeGrid(w, h);
  // 縮在胸前的手要蓋在頭的下緣上
  for (const layer of [tail, body, tucked ? null : paws, ears, head, tuft, lop, tucked ? paws : null]) if (layer) stamp(out, layer);

  drawFrontFace(
    out,
    {
      u,
      cx,
      eyeY,
      eyeDx,
      eyeRx,
      eyeRy,
      noseY: flat ? headY + headRy * 0.22 : muzzleY - muzzleRy * 0.45,
      nose: has('big_nose') ? 'big' : b.nose === 2 ? 'dog' : 'pink',
      mouth: !b.pointed,
      whiskers: b.whiskers ? headRx : null,
    },
    sty,
    pose,
  );
  return Object.assign(out, { anchor: [Math.round(cx), Math.round(headY - headRy)] as Pt });
}
