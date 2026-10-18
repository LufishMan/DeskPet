// 寵物視窗：繪製、動畫、互動（DESIGN.md §7、§9.1、§9.2）。
// 只呼叫本程式的自訂指令：get_pet、set_shape、start_drag、show_menu。

import { invoke } from '@tauri-apps/api/core';

import type { BubbleKind } from './bubbles.ts';
import { H, W, renderScene, shapeOf, type Scene } from './render.ts';
import { DEFAULT_STYLE } from './style.ts';
import { loadAtlas } from './cream-atlas.ts';
import type { PetView, Pose, Stage } from './types.ts';

const canvas = document.getElementById('pet') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
const image = ctx.createImageData(W, H);
/**
 * 畫布以整數倍放大、靠底置中。Windows 有最小視窗寬度（約 136 像素），
 * 視窗可能比畫布寬，不能直接撐滿，否則會變成非整數倍放大。後端的視窗形狀用同樣的方式計算位移。
 */
function layout(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.round(window.innerHeight / H));
  const width = W * scale;
  const height = H * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${Math.floor((window.innerWidth * dpr - width * dpr) / 2) / dpr}px`;
  canvas.style.top = `${window.innerHeight - height}px`;
}
layout();
window.addEventListener('resize', layout);

/** 算視窗形狀用的畫布：不含跳躍和晃動，這兩種位移由後端擴張形狀涵蓋 */
const shapeBuffer = new Uint8ClampedArray(W * H * 4);
let sentShape = '';

/** 每 15 秒向後端要一次狀態；數值每 5 分鐘才結算一次，不需要更頻繁 */
const POLL_MS = 15_000;
/** 待機 4 fps、動作中 10 fps（§2） */
const IDLE_FRAME_MS = 250;
const ACTIVE_FRAME_MS = 100;
const DRAG_THRESHOLD_PX = 3;
const MULTI_CLICK_MS = 450;
/** 孵化與長大的動畫長度（§11.2 evolve） */
const HATCH_MS = 3200;
const EVOLVE_MS = 1800;
const STAGE_ORDER: readonly Stage[] = ['egg', 'baby', 'juvenile', 'adult'];

let view: PetView | null = null;

/** 互動造成的短暫反應（§9.1：3 秒內結束） */
interface Reaction {
  pose: Pose;
  until: number;
  hop: boolean;
  bubble: BubbleKind | null;
  wobble: boolean;
}
let reaction: Reaction | null = null;
let hovering = false;
let blinkUntil = 0;
let nextBlink = 0;
let clicks: number[] = [];
let timer: number | undefined;
let hatchAt = -Infinity;
let evolveAt = -Infinity;

/** 階段改變時播放動畫。程式關著的時候長大就不播（重新開啟時沒有上一個階段可比） */
function onStageChange(prev: Stage, next: Stage): void {
  const now = performance.now();
  if (prev === 'egg') {
    hatchAt = now;
  } else if (STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(prev)) {
    evolveAt = now;
    react({ pose: 'happy', hop: true, bubble: null, wobble: false }, EVOLVE_MS);
  }
}

async function refresh(): Promise<void> {
  try {
    const next = await invoke<PetView>('get_pet');
    const prev = view?.stage;
    view = next;
    if (prev !== undefined && prev !== next.stage) onStageChange(prev, next.stage);
    schedule(0);
  } catch (error) {
    console.error('讀取寵物狀態失敗', error);
  }
}

/** 心情泡泡：每隔一段時間冒出來一下（§7） */
function moodBubble(v: PetView, now: number): BubbleKind | null {
  const cycle = (period: number, shown: number): boolean => now % period < shown;
  if (v.sleeping) return cycle(2000, 1200) ? 'zzz' : null;
  // 專注模式不主動找你（§10）
  if (v.focus) return null;
  switch (v.mood) {
    case 'happy':
      return cycle(18_000, 2500) ? 'note' : null;
    case 'tense':
      return cycle(12_000, 2500) ? 'sweat' : null;
    case 'depressed':
      return cycle(10_000, 3000) ? 'cloud' : null;
    default:
      return null;
  }
}

function draw(now: number): boolean {
  if (!view) return false;
  const active = reaction !== null && now < reaction.until ? reaction : null;
  if (!active) reaction = null;

  if (now >= nextBlink) {
    blinkUntil = now + 160;
    nextBlink = now + 3000 + Math.random() * 4000;
  }

  let pose: Pose = 'idle';
  if (active) pose = active.pose;
  else if (view.sleeping) pose = 'sleep';
  else if (hovering) pose = 'look';
  else if (view.energy <= 2) pose = 'tired';
  if (pose === 'idle' && now < blinkUntil) pose = 'blink';

  const hatching = now - hatchAt < HATCH_MS;
  const evolving = now - evolveAt < EVOLVE_MS;
  const wobbling = view.stage === 'egg' && (view.waiting || active?.wobble === true);
  const scene: Scene = {
    view,
    pose,
    breathe: Math.floor(now / 1000) % 2 === 1,
    tail: [-1, 0, 1, 0][Math.floor(now / 600) % 4],
    hop: active?.hop === true && Math.floor(now / 150) % 2 === 0,
    wobble: hatching ? [-1, 0, 1, 0][Math.floor(now / 70) % 4] : wobbling ? [-1, 0, 1, 0][Math.floor(now / 120) % 4] : 0,
    bubble: hatching ? null : active ? active.bubble : moodBubble(view, now),
    hatch: hatching ? (now - hatchAt) / HATCH_MS : null,
    sparkle: evolving ? (now - evolveAt) / EVOLVE_MS : null,
    style: DEFAULT_STYLE,
  };
  renderScene(image.data, scene);
  ctx.putImageData(image, 0, 0);
  updateShape(scene);
  return active !== null || wobbling || hatching || evolving;
}

/** 形狀改變時才通知後端（點擊穿透透明區域） */
function updateShape(scene: Scene): void {
  renderScene(shapeBuffer, { ...scene, hop: false, wobble: 0 });
  const spans = shapeOf(shapeBuffer);
  const key = spans.join(',');
  if (key === sentShape) return;
  sentShape = key;
  invoke('set_shape', { spans }).catch((error) => {
    sentShape = '';
    console.error('設定視窗形狀失敗', error);
  });
}

function schedule(delay: number): void {
  window.clearTimeout(timer);
  if (document.hidden) return;
  timer = window.setTimeout(() => {
    const busy = draw(performance.now());
    schedule(busy ? ACTIVE_FRAME_MS : IDLE_FRAME_MS);
  }, delay);
}

function react(r: Omit<Reaction, 'until'>, durationMs: number): void {
  reaction = { ...r, until: performance.now() + durationMs };
  schedule(0);
}

function onClick(): void {
  if (!view) return;
  const now = performance.now();
  clicks = [...clicks.filter((t) => now - t < MULTI_CLICK_MS * 3), now];
  if (view.stage === 'egg') {
    react({ pose: 'idle', hop: false, bubble: null, wobble: true }, 600);
  } else if (view.sleeping) {
    react({ pose: 'look', hop: false, bubble: 'question', wobble: false }, 1200);
  } else if (clicks.length >= 3) {
    // 連點：搔癢
    clicks = [];
    react({ pose: 'happy', hop: true, bubble: 'heart', wobble: false }, 2000);
  } else {
    // 單擊：摸摸
    react({ pose: 'happy', hop: false, bubble: 'heart', wobble: false }, 1500);
  }
}

// ── 滑鼠：只處理這個視窗本身收到的事件（§9.2），不讀取全域游標 ──

let pressed: { x: number; y: number; dragging: boolean } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) pressed = { x: e.screenX, y: e.screenY, dragging: false };
});

canvas.addEventListener('pointermove', (e) => {
  if (!pressed || pressed.dragging) return;
  if (Math.hypot(e.screenX - pressed.x, e.screenY - pressed.y) > DRAG_THRESHOLD_PX) {
    pressed.dragging = true;
    pressed = null;
    invoke('start_drag').catch((error) => console.error('拖曳失敗', error));
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button === 0 && pressed && !pressed.dragging) onClick();
  pressed = null;
});

canvas.addEventListener('pointerenter', () => {
  hovering = true;
  schedule(0);
});

canvas.addEventListener('pointerleave', () => {
  hovering = false;
  pressed = null;
  schedule(0);
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  invoke('show_menu').catch((error) => console.error('選單失敗', error));
});

document.addEventListener('visibilitychange', () => schedule(0));

// 先準備本機圖稿，首次顯示即使用原畫；載入失敗仍可由既有像素繪圖器呈現。
void loadAtlas()
  .catch((error) => console.error('奶油圖稿載入失敗，使用備援造型', error))
  .finally(() => {
    void refresh();
    window.setInterval(() => void refresh(), POLL_MS);
  });
