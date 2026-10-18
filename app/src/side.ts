// 側面站姿（面向左）。參考像素貼紙：品種主要靠剪影辨識（腿長、身長、口鼻、耳型、尾巴、毛量）。

import {
  BASE,
  CLEAR,
  INK,
  LIGHT,
  OUTLINE,
  PATTERN,
  PINK,
  SHADE,
  SHINE,
  at,
  bumps,
  curls,
  curve,
  ellipse,
  shag,
  line,
  makeGrid,
  mod,
  onBase,
  onFilled,
  onFur,
  outline,
  put,
  recolor,
  stamp,
  triangle,
  tufts,
  type Grid,
  type Mask,
  type Pt,
} from './pixel.ts';
import { BODY_DEPTH, SIDE_MARGIN, STAGES, thick, type Creature, type CreatureSpec, type Frame } from './creature.ts';
import { drawEye, eyeSize } from './face.ts';
import type { Ears, Feature, Pattern, Tail } from './types.ts';

interface Geometry {
  /** 這個階段的解析度（像素／設計單位） */
  u: number;
  /** 腳底那一列 */
  ground: number;
  bodyX: number;
  bodyY: number;
  bodyRx: number;
  bodyRy: number;
  headX: number;
  headY: number;
  headRx: number;
  headRy: number;
  tailLen: number;
  /** 幼年：品種特徵才剛出現，身上的條紋還沒長出來（§11.1） */
  baby: boolean;
}

type Part = 'head' | 'body' | 'tail';

const isLeg = (geo: Geometry, y: number): boolean => y + 0.5 > geo.bodyY + geo.bodyRy * 0.8;

/** 花紋（各品種的辨識重點見 DESIGN.md §11.2）。只把底色換成花紋色；面罩類花紋也蓋過亮色 */
function applyPattern(g: Grid, part: Part, pattern: Pattern, geo: Geometry): void {
  const { u, bodyX, bodyY, bodyRx, bodyRy, headX, headY, headRx, headRy, baby } = geo;
  const covers = (part === 'head' && (pattern === 'points' || pattern === 'mask' || pattern === 'hood')) || (part === 'body' && pattern === 'panda');
  // 條紋的間距與粗細跟著解析度放大
  const stripe = (n: number, period: number, width: number): boolean => mod(n, Math.round(period * u)) < Math.max(1, Math.round(width * u));
  recolor(g, PATTERN, (x, y, v) => {
    if (v !== BASE && !(covers && v === LIGHT)) return false;
    const px = x + 0.5;
    const py = y + 0.5;
    const leg = isLeg(geo, y);
    const inHead = ((px - headX) / headRx) ** 2 + ((py - headY) / headRy) ** 2 <= 1;
    const foreheadStripes = inHead && py < headY - headRy * 0.3 && stripe(x - Math.round(headX), 2, 0.7);
    switch (pattern) {
      case 'stripes':
        if (part === 'head') return foreheadStripes;
        if (part === 'tail') return stripe(x + y, 3, 1);
        if (baby) return false;
        return leg ? stripe(y, 2.4, 1) : stripe(x - Math.round(bodyX), 3, 1) && py < bodyY + bodyRy * 0.3;
      case 'classic': {
        // 美短：身側的圓渦紋加背線
        if (part === 'head') return foreheadStripes;
        if (part === 'tail') return stripe(x + y, 3, 1);
        if (baby) return false;
        if (leg) return stripe(y, 2.4, 1);
        const d = Math.hypot(px - (bodyX + bodyRx * 0.1), (py - bodyY) * 1.15) / bodyRy;
        return d < 0.18 || (d >= 0.4 && d < 0.6) || py < bodyY - bodyRy * 0.72;
      }
      case 'points':
        // 布偶：口鼻一帶、耳朵、四肢、尾巴偏深
        if (part === 'head') return px < headX - headRx * 0.35 && py > headY - headRy * 0.3;
        return part === 'tail' || leg;
      case 'mask':
        // 暹羅：大面罩蓋住整張臉
        if (part === 'head') return px < headX - headRx * 0.05 && py > headY - headRy * 0.55;
        return part === 'tail' || leg;
      case 'cap':
        // 哈士奇：頭頂、後腦和背部深色，臉和肚子白
        if (part === 'head') return py < headY - headRy * 0.3 || (px > headX + headRx * 0.2 && py < headY + headRy * 0.3);
        if (part === 'tail') return true;
        return !leg && py < bodyY + bodyRy * 0.1;
      case 'hood':
        // 花枝鼠：整個頭和肩膀深色，背上一條線
        if (part === 'head') return true;
        if (part === 'tail') return false;
        return !leg && ((px < bodyX - bodyRx * 0.45 && py < bodyY + bodyRy * 0.4) || py < bodyY - bodyRy * 0.72);
      case 'dorsal':
        // 三線鼠：背上一條深線
        if (part === 'head') return py < headY - headRy * 0.72 && px > headX - headRx * 0.3;
        return part === 'body' && !leg && py < bodyY - bodyRy * 0.68;
      case 'panda':
        // 貓熊：四肢和肩帶黑色（黑耳和黑眼圈另外畫）
        return part === 'body' && (leg || (px > bodyX - bodyRx * 0.38 && px < bodyX + bodyRx * 0.12));
      case 'solid':
        return false;
    }
  });
}

/** 身體上的特徵部件：白圍兜、白襪子 */
function applyBodyFeatures(g: Grid, has: (f: Feature) => boolean, geo: Geometry): void {
  const { u, ground, bodyX, bodyY, bodyRx, bodyRy } = geo;
  const fur: Mask = (c) => c === BASE || c === PATTERN;
  if (has('bib') || has('urajiro') || has('blaze')) {
    ellipse(g, bodyX - bodyRx * 0.72, bodyY + bodyRy * 0.1, bodyRx * 0.3, bodyRy * 0.75, LIGHT, fur);
  }
  if (has('stockings')) recolor(g, LIGHT, (_, y, v) => fur(v) && isLeg(geo, y));
  else if (has('socks') || has('urajiro') || has('blaze')) {
    recolor(g, LIGHT, (_, y, v) => fur(v) && isLeg(geo, y) && y > ground - 1.6 * u);
  }
}

/** 立耳。near 是靠近觀看者的耳朵；遠側的耳朵往前偏一點、矮一點 */
function pointedEar(g: Grid, geo: Geometry, near: boolean, height: number, wide: boolean, color: number, inner: number): void {
  const { u, headX, headY, headRx, headRy } = geo;
  const off = near ? 0 : -2.2 * u;
  const widen = wide ? 0.35 : 0;
  const a: Pt = [headX - headRx * (0.2 + widen) + off, headY - headRy * 0.5];
  const b: Pt = [headX + headRx * (0.55 + widen) + off, headY - headRy * 0.45];
  const tip: Pt = [headX + headRx * 0.12 + off, headY - headRy - height + (near ? 0 : 0.6 * u)];
  triangle(g, a, b, tip, color);
  if (near && color === BASE) {
    const mid: Pt = [(a[0] + b[0] + tip[0]) / 3, (a[1] + b[1] + tip[1]) / 3];
    const shrink = (p: Pt, f: number): Pt => [mid[0] + (p[0] - mid[0]) * f, mid[1] + (p[1] - mid[1]) * f];
    triangle(g, shrink(a, 0.45), shrink(b, 0.45), shrink(tip, 0.6), inner, onBase);
  }
}

function drawEar(g: Grid, ears: Ears, geo: Geometry, scale: number, near: boolean, color: number, inner: number): void {
  const { u, headX, headY, headRx, headRy } = geo;
  const s = scale * u;
  const round = (dx: number, dy: number, r: number, innerR: number): void => {
    const [x, y] = near ? [headX + headRx * dx, headY - headRy * dy] : [headX + headRx * (dx - 0.5), headY - headRy * (dy + 0.1)];
    const k = near ? 1 : 0.88;
    ellipse(g, x, y, r * k, r * k, color);
    if (near && innerR > 0 && color === BASE) ellipse(g, x, y, innerR, innerR, inner);
  };
  switch (ears) {
    case 'pointy':
      pointedEar(g, geo, near, 3.4 * s, false, color, inner);
      break;
    case 'short':
      pointedEar(g, geo, near, 2.6 * s, false, color, inner);
      break;
    case 'tall':
      pointedEar(g, geo, near, 5 * s, true, color, inner);
      break;
    case 'round':
      round(0.3, 0.95, 2.3 * s, 1.1 * s);
      break;
    case 'big':
      round(0.25, 0.8, 3 * s, 1.9 * s);
      break;
    case 'small':
      round(0.3, 0.98, 1.5 * s, 0.7 * s);
      break;
    case 'floppy':
    case 'curly':
      break;
  }
}

/** 垂耳蓋在頭的側面 */
function drawLopEar(ears: Ears, geo: Geometry, w: number, h: number, scale: number, seed: number): Grid | null {
  if (ears !== 'floppy' && ears !== 'curly') return null;
  const { u, headX, headY, headRx, headRy } = geo;
  const g = makeGrid(w, h);
  const ex = headX + headRx * 0.42;
  if (ears === 'floppy') {
    ellipse(g, ex, headY + headRy * 0.05, (1.6 * scale + 0.2) * u, headRy * 0.72, PATTERN);
    // 耳朵下緣的飾毛
    tufts(g, [0, 1], Math.round(1.6 * u), Math.round(0.8 * u), () => true);
  } else {
    // 貴賓犬：蓬鬆的捲毛耳
    ellipse(g, ex, headY + headRy * 0.15, 2.4 * scale * u, headRy * 0.85, BASE);
    bumps(g, 0.9 * u, Math.round(2 * u));
    curls(g, u, seed + 2, () => false);
  }
  outline(g);
  return g;
}

/** 尾巴。睡覺時長尾巴圍在身體前面，所以分成後層和前層 */
function drawTail(tail: Tail, geo: Geometry, w: number, h: number, frame: Frame): { back: Grid; front: Grid | null } {
  const { u, ground, bodyX, bodyY, bodyRx, bodyRy, tailLen: tl, baby } = geo;
  const back = makeGrid(w, h);
  let front: Grid | null = null;
  const rearX = bodyX + bodyRx * 0.82;
  const rearY = bodyY - bodyRy * 0.3;
  const sw = frame.tail * u;
  // 開心時尾巴舉高，累了垂下來
  const up = frame.pose === 'happy' ? 1 : frame.pose === 'tired' ? -1 : 0;
  const k = (baby ? 0.85 : 1) * u;
  const droop = (r: number): void =>
    thick(back, curve([rearX, rearY], [rearX + tl * 0.6, rearY + tl * 0.1], [rearX + tl * 0.75 + sw * 0.5, Math.min(ground - u, rearY + tl * 0.8)], 24), r);
  switch (tail) {
    case 'long':
    case 'fluffy': {
      const r = (tail === 'fluffy' ? 1.5 : 1.05) * k;
      if (frame.pose === 'sleep') {
        front = makeGrid(w, h);
        thick(front, curve([bodyX + bodyRx * 0.6, ground - 0.6 * u], [bodyX - bodyRx * 0.1, ground + 0.6 * u], [bodyX - bodyRx * 0.85, ground - 0.9 * u], 28), r);
      } else if (up < 0) {
        droop(r);
      } else {
        const end: Pt = [rearX + tl * (up > 0 ? 0.15 : 0.35) + sw, rearY - tl * (up > 0 ? 1.1 : 0.95)];
        thick(back, curve([rearX, rearY], [rearX + tl * 0.6, rearY - tl * 0.1], end, 32), r);
      }
      if (tail === 'fluffy') for (const layer of front ? [front] : [back]) bumps(layer, 0.6 * u, Math.round(1.8 * u));
      break;
    }
    case 'wag':
      // 台灣犬的鐮刀尾：往上翹、尾端朝前
      if (up < 0) droop(1.1 * k);
      else thick(back, curve([rearX, rearY], [rearX + tl * 0.45, rearY - tl * 0.95], [rearX - tl * 0.05 + sw * 0.6, rearY - tl * (0.75 + up * 0.15)], 28), 1.1 * k);
      break;
    case 'curl': {
      // 捲尾（柴犬、哈士奇）：在背上捲成一圈，中心是亮色的尾巴內側
      const ring: Pt = [bodyX + bodyRx * 0.62 + sw * 0.3, bodyY - bodyRy - tl * (0.22 + up * 0.05)];
      const r = tl * 0.32;
      thick(back, curve([rearX, rearY], [rearX + u, ring[1] + r * 0.4], ring, 16), u);
      ellipse(back, ring[0], ring[1], r, r, BASE);
      ellipse(back, ring[0] - 0.2 * u, ring[1] + 0.3 * u, r * 0.42, r * 0.42, LIGHT, onBase);
      break;
    }
    case 'feather':
      // 黃金獵犬：往後飄的長飾毛
      thick(back, curve([rearX, rearY], [rearX + tl * 0.7, rearY - tl * (0.25 + up * 0.3)], [rearX + tl * 0.9 + sw, rearY + tl * (0.25 - up * 0.7)], 32), 1.3 * k);
      tufts(back, [0, 1], Math.round(2.2 * u), Math.round(1.3 * u), () => true);
      break;
    case 'pom': {
      // 貴賓犬：細細往上的尾巴加一顆毛球
      const ball: Pt = [rearX + tl * 0.25 + sw * 0.4, rearY - tl * (0.75 + up * 0.15)];
      thick(back, curve([rearX, rearY], [rearX + tl * 0.3, rearY - tl * 0.3], ball, 16), 0.65 * u);
      ellipse(back, ball[0], ball[1], tl * 0.24, tl * 0.24, BASE);
      bumps(back, 0.7 * u, Math.round(1.6 * u), (x, y) => Math.hypot(x - ball[0], y - ball[1]) < tl * 0.3);
      break;
    }
    case 'thin':
      // 鼠科：細長的粉紅色尾巴拖在地上
      thick(back, curve([rearX, bodyY + bodyRy * 0.3], [rearX + tl * 0.8, ground + 0.4 * u], [rearX + tl * 1.1 + sw, ground - (2.5 + up * 1.5) * u], 40), Math.max(0.6, 0.45 * u), PINK);
      break;
    case 'stub': {
      const r = Math.max(u, tl * 0.18);
      ellipse(back, rearX + 0.6 * u, rearY - (0.4 + up * 0.6) * u, r, r, BASE);
      break;
    }
    case 'none':
      break;
  }
  return { back, front };
}

export function drawSide(spec: CreatureSpec, frame: Frame, seed = 0): Creature {
  const st = STAGES[spec.stage];
  const u = st.u;
  const b = spec.build;
  const sty = spec.style;
  const has = (f: Feature): boolean => spec.features.includes(f);
  const h = Math.round(st.size * u);
  const w = h + 2 * Math.round(SIDE_MARGIN * u);
  const ground = h - 2;
  const pose = frame.pose;
  const sleeping = pose === 'sleep';
  const baby = spec.stage === 'baby';
  const depth = BODY_DEPTH[spec.body];

  // 身體
  const bodyRx = (st.torso[0] * b.length * (1 + (depth - 1) * 0.35) + (sleeping ? 0.5 : 0)) * u;
  const bodyRy = (st.torso[1] * b.depth * depth * (sleeping ? 0.85 : 1) + (frame.breathe ? 0.35 : 0)) * u;
  const legLen = Math.max(1.5, st.legs * b.legs) * u;
  const bodyY = sleeping ? ground + 0.5 - bodyRy : ground + 1.5 * u - legLen - bodyRy;

  // 頭：有脖子的頭在身體前上方，倉鼠的頭直接接在身體前面
  const headRx = (st.head[0] * b.head + (has('cheeks') ? 0.6 : 0)) * u;
  const headRy = st.head[1] * b.head * u * (sty.sideIdle ? 1.06 : 1);
  const lift = (pose === 'look' ? -1 : pose === 'tired' ? 1.5 : 0) * u;
  const forward = sleeping ? 0.95 : 0.5 + 0.35 * b.neck;
  const headLocalX = -bodyRx * forward - (sleeping ? headRx * 0.3 : 0);
  const headY = sleeping ? ground + 0.5 - headRy * 0.9 : bodyY - bodyRy * b.neck + lift;
  const snoutLen = b.snout * st.snout * u;
  const snoutDepth = b.snoutDepth * (baby ? 0.85 : 1) * u;

  // 以身體加頭的範圍置中（不含尾巴，尾巴擺動時身體才不會跟著動）
  const left = headLocalX - headRx - snoutLen;
  const bodyX = Math.round(w / 2 - (left + bodyRx) / 2);
  const headX = bodyX + headLocalX;
  const geo: Geometry = { u, ground, bodyX, bodyY, bodyRx, bodyRy, headX, headY, headRx, headRy, tailLen: st.torso[0] * 0.85 * u, baby };
  if (sty.sideIdle && ['thin', 'feather', 'wag'].includes(spec.tail)) {
    // 側面變成日常姿勢後，長尾與擺尾也必須留在既有畫布內。
    // 保留尾根、尾型與動畫，只依右側空間縮短尾長，不放大視窗。
    const reach = spec.tail === 'thin' ? 1.1 : spec.tail === 'feather' ? 0.9 : 0.75;
    const radius = spec.tail === 'thin' ? 0.45 : spec.tail === 'feather' ? 1.3 : 1.1;
    const room = w - 3 - (bodyX + bodyRx * 0.82) - (radius + 1) * u;
    geo.tailLen = Math.min(geo.tailLen, Math.max(u, room / reach));
  }

  const darkEars = ['points', 'mask', 'cap', 'hood', 'panda'].includes(spec.pattern);
  const earScale = st.ear * (sleeping ? 0.85 : 1);
  const legW = Math.max(2, Math.round(b.legWidth * u * (baby ? 0.8 : 1)));
  const legTop = Math.round(bodyY);
  const frontLeg = Math.round(bodyX - bodyRx * 0.62);
  const backLeg = Math.round(bodyX + bodyRx * 0.48);
  const legs = (g: Grid, dx: number): void => {
    for (const x0 of [frontLeg + dx, backLeg + dx]) {
      for (let y = legTop; y <= ground; y++) {
        // 奶油造型的腳腕往前收，腳掌圓潤；仍保留品種腿長及前後四足。
        const ankle = sty.sideIdle ? Math.round(Math.max(0, (y - bodyY - bodyRy * 0.45) / Math.max(1, ground - bodyY - bodyRy * 0.45)) * u * 0.6) : 0;
        for (let x = x0 - ankle; x < x0 + legW - ankle; x++) put(g, x, y, BASE);
      }
      if (sty.sideIdle) ellipse(g, x0 + legW * 0.35 - u * 0.5, ground - u * 0.35, legW * 0.62, u * 0.65, BASE);
    }
  };

  // 遠側的腿和耳朵：比較暗，畫在最後面
  const far = makeGrid(w, h);
  if (!sleeping) {
    legs(far, Math.round(2 * u));
    applyPattern(far, 'body', spec.pattern, geo);
    applyBodyFeatures(far, has, geo);
  }
  const inner = sty.pinkEars ? PINK : LIGHT;
  drawEar(far, spec.ears, geo, earScale, false, darkEars ? PATTERN : BASE, inner);
  recolor(far, SHADE, (_, __, v) => v === BASE);
  outline(far);

  const { back, front } = drawTail(spec.tail, geo, w, h, frame);
  for (const layer of front ? [back, front] : [back]) {
    applyPattern(layer, 'tail', spec.pattern, geo);
    outline(layer);
  }

  // 身體和近側的腿
  const torso = makeGrid(w, h);
  ellipse(torso, bodyX, bodyY, bodyRx, bodyRy, BASE);
  if (spec.body === 'very_fat') ellipse(torso, bodyX + bodyRx * 0.05, bodyY + bodyRy * 0.45, bodyRx * 0.75, bodyRy * 0.62, BASE);
  if (sleeping) ellipse(torso, bodyX - bodyRx * 0.85, ground - 0.3 * u, legW * 0.7 + 0.6 * u, 1.1 * u, BASE);
  else legs(torso, 0);
  ellipse(torso, bodyX, bodyY + bodyRy * 0.55, bodyRx * 0.7, bodyRy * 0.4, LIGHT, onBase);
  applyPattern(torso, 'body', spec.pattern, geo);
  applyBodyFeatures(torso, has, geo);
  if (spec.body === 'very_thin') {
    // 很瘦：看得到肋骨（§11.2）
    for (const dx of [-2, 0, 2]) {
      for (let y = Math.round(bodyY - u); y <= Math.round(bodyY + u); y++) {
        const x = Math.round(bodyX + dx * u);
        if (at(torso, x, y) === BASE) put(torso, x, y, SHADE);
      }
    }
  }
  if (!sleeping) {
    // 近側的腿：後緣暗一點，看起來是圓柱
    for (const x0 of [frontLeg, backLeg]) {
      for (let y = legTop; y <= ground; y++) if (isLeg(geo, y) && at(torso, x0 + legW - 1, y) === BASE) put(torso, x0 + legW - 1, y, SHADE);
    }
  }

  // 頭、近側的耳朵、口鼻
  const head = makeGrid(w, h);
  drawEar(head, spec.ears, geo, earScale, true, darkEars ? PATTERN : BASE, inner);
  ellipse(head, headX, headY, headRx, headRy, BASE);
  const snoutY = headY + headRy * 0.35;
  const tipX = headX - headRx - snoutLen;
  if (b.pointed) {
    triangle(head, [headX - headRx * 0.5, headY - headRy * 0.15], [headX - headRx * 0.4, headY + headRy * 0.75], [tipX, snoutY], BASE);
  } else {
    ellipse(head, headX - headRx * 0.7 - snoutLen * 0.5, snoutY, snoutLen * 0.5 + headRx * 0.3, snoutDepth * 0.5, BASE);
  }
  if (pose === 'happy' && b.nose === 2 && !has('big_nose')) {
    // 狗開心時吐舌頭
    ellipse(head, tipX + 1.6 * u, snoutY + snoutDepth * 0.5 + 0.4 * u, 0.6 * u, 0.8 * u, PINK);
  }
  if (has('pouches')) {
    // 倉鼠鼓鼓的頰囊
    ellipse(head, headX - headRx * 0.25, headY + headRy * 0.45, headRx * 0.55, headRy * 0.45, BASE);
    ellipse(head, headX - headRx * 0.25, headY + headRy * 0.5, headRx * 0.42, headRy * 0.32, LIGHT, onBase);
  }
  if (has('urajiro')) {
    // 柴犬的裏白：口鼻和臉頰下緣白色
    ellipse(head, headX - headRx * 0.45, headY + headRy * 0.5, headRx * 0.85, headRy * 0.38, LIGHT, onBase);
  }
  if (sty.sideIdle && (spec.pattern === 'stripes' || spec.pattern === 'classic')) {
    // 虎斑與美短：淡奶油口鼻和下頰，避免橘色覆蓋整張臉。
    ellipse(head, headX - headRx * 0.58, headY + headRy * 0.48, headRx * 0.7, headRy * 0.34, LIGHT, onBase);
  }
  if (has('blaze')) {
    // 柯基：白口鼻加上額頭往上的白線
    recolor(head, LIGHT, (x, y, v) => v === BASE && x + 0.5 < headX - headRx * 0.8 && y + 0.5 > headY);
    ellipse(head, headX - headRx * 0.62, headY - headRy * 0.25, 0.9 * u, headRy * 0.5, LIGHT, onBase);
  }
  const eyeX = headX - headRx * 0.45;
  const eyeY = headY - headRy * 0.05;
  // 側面只看得到一隻眼睛，虹膜大眼縮小一點
  const [eyeW, eyeH] = eyeSize(sty, headRx, headRy, u);
  const [eyeRx, eyeRy] = sty.eyes === 'iris' ? [eyeW * 0.8, eyeH * 0.85] : [eyeW, eyeH];
  if (spec.pattern === 'panda') ellipse(head, eyeX + 0.3 * u, eyeY + 0.2 * u, eyeRx * 1.6 + 0.8 * u, eyeRy * 1.5 + 0.7 * u, PATTERN, onFilled);
  applyPattern(head, 'head', spec.pattern, geo);

  // 頭和身體合成一個剪影，脖子後面不會多一條線
  const body = makeGrid(w, h);
  stamp(body, torso);
  stamp(body, head);
  const tuftPeriod = Math.round(2.4 * u);
  const tuftDepth = Math.max(1, Math.round(1.2 * u));
  if (sty.fur === 'shaggy') {
    shag(body, u, (x, y) => y <= ground && !(x + 0.5 < headX && Math.abs(y + 0.5 - headY) < headRy * 0.6));
    if (b.fur === 'curly') curls(body, u, seed, () => false);
  } else if (b.fur === 'fluffy' && sty.fur === 'breed') {
    // 長毛：肚子下緣、胸前和臉頰後方長出三角形的毛尖
    tufts(body, [0, 1], tuftPeriod, tuftDepth, (_, y) => y <= ground && y + 0.5 > bodyY + bodyRy * 0.3);
    tufts(body, [-1, 0], tuftPeriod, tuftDepth, (_, y) => y + 0.5 > headY + headRy * 0.4 && y + 0.5 < bodyY + bodyRy * 0.6);
    tufts(body, [1, 0], tuftPeriod, tuftDepth, (x, y) => x > headX && y + 0.5 > headY && y + 0.5 < headY + headRy && y + 0.5 < bodyY - bodyRy * 0.5);
  } else if (b.fur === 'curly') {
    bumps(body, 1.1 * u, tuftPeriod, (_, y) => y < ground - u);
    const face = (x: number, y: number): boolean => x + 0.5 < headX + headRx * 0.2 && y + 0.5 > headY - headRy * 0.4 && y + 0.5 < headY + headRy;
    curls(body, u, seed, face);
  }
  // 底部陰影：身體和頭的下緣暗一點，看起來有份量
  const shadeDepth = Math.max(1, Math.round(0.5 * u));
  recolor(body, SHADE, (x, y, v) => {
    if (sty.shading !== 'bottom' || v !== BASE || isLeg(geo, y)) return false;
    for (let k = 1; k <= shadeDepth; k++) if (at(body, x, y + k) === CLEAR) return true;
    return false;
  });
  outline(body);

  // 貴賓犬頭頂的毛球：獨立一層加外框，看起來是一團蓬毛
  let tuft: Grid | null = null;
  if (has('topknot')) {
    tuft = makeGrid(w, h);
    const ty = headY - headRy * 0.85;
    ellipse(tuft, headX - headRx * 0.05, ty, headRx * 0.6, headRy * 0.42, BASE);
    bumps(tuft, 0.9 * u, Math.round(1.8 * u), (_, y) => y < ty + headRy * 0.2);
    curls(tuft, u, seed + 1, () => false);
    outline(tuft);
  }
  const lop = drawLopEar(spec.ears, geo, w, h, earScale, seed);

  const out = makeGrid(w, h);
  for (const layer of [far, back, body, tuft, lop, front]) if (layer) stamp(out, layer);

  // 眼睛：圓眼加一點反光；閉眼是一條線，開心是彎彎的眼
  drawEye(out, eyeX, eyeY, eyeRx, eyeRy, sty, pose === 'stand' ? 'idle' : pose, u);
  if (pose === 'happy' || sty.blush) {
    ellipse(out, eyeX + eyeRx * 0.8, eyeY + eyeRy + 0.9 * u, Math.max(0.6 * u, eyeRx), 0.35 * u, PINK, onFur);
  }

  // 鼻子在口鼻最前端：狗和熊是有反光的大鼻頭，貓和鼠是粉紅色小鼻子
  const noseY = Math.round(snoutY - snoutDepth * 0.4);
  let noseX = 0;
  while (noseX < w && at(out, noseX, noseY) < BASE) noseX++;
  const big = has('big_nose');
  if (b.nose === 2 || big) {
    const [rx, ry] = big ? [1.1 * u, 1.2 * u] : [0.7 * u, 0.55 * u];
    ellipse(out, noseX + rx - 0.3, noseY + ry * 0.6, rx, ry, INK, (c) => c !== CLEAR);
    put(out, Math.round(noseX + rx * 0.8), noseY, SHINE);
  } else {
    ellipse(out, noseX + 0.45 * u, noseY + 0.3 * u, 0.45 * u, 0.35 * u, PINK, (c) => c !== CLEAR);
  }
  // 嘴巴：從鼻子下方往後的一條線
  if (b.snout >= 1 && !b.pointed && !sleeping) {
    const my = snoutY + snoutDepth * 0.2;
    const length = Math.max(0.8 * u, snoutLen * 0.55 + 0.4 * u);
    line(out, curve([noseX + 0.5 * u, my], [noseX + length * 0.6, my + 0.2 * u], [noseX + length, my - 0.3 * u], 12), INK, onFilled);
  }
  if (b.whiskers) {
    for (const dy of [0.6, 1.5]) line(out, curve([noseX + 1.2 * u, noseY + dy * u], [noseX - 0.6 * u, noseY + (dy - 0.2) * u], [noseX - 2 * u, noseY + (dy - 0.6 + dy * 0.3) * u], 10), INK);
  }
  // 腳趾：近側的腳底畫兩道短線
  if (!sleeping && legW >= 5 && !sty.sideIdle) {
    for (const x0 of [frontLeg, backLeg]) {
      for (const f of [0.34, 0.67]) {
        const x = x0 + Math.round(legW * f) - 1;
        for (let y = ground - Math.max(1, Math.round(0.5 * u)) + 1; y <= ground; y++) put(out, x, y, OUTLINE);
      }
    }
  }
  return Object.assign(out, { anchor: [Math.round(headX), Math.round(headY - headRy)] as Pt });
}
