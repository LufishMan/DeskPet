// 寵物視窗：繪製、動畫、互動（DESIGN.md §7、§9.1、§9.2）。
// 只呼叫本程式的自訂指令：get_pet、start_drag、show_menu。

import { invoke } from '@tauri-apps/api/core';

import type { BubbleKind } from './bubbles.ts';
import { H, W, renderScene } from './render.ts';
import type { PetView, Pose } from './types.ts';

const canvas = document.getElementById('pet') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
const image = ctx.createImageData(W, H);

/** 每 15 秒向後端要一次狀態；數值每 5 分鐘才結算一次，不需要更頻繁 */
const POLL_MS = 15_000;
/** 待機 4 fps、動作中 10 fps（§2） */
const IDLE_FRAME_MS = 250;
const ACTIVE_FRAME_MS = 100;
const DRAG_THRESHOLD_PX = 3;
const MULTI_CLICK_MS = 450;

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

async function refresh(): Promise<void> {
  try {
    view = await invoke<PetView>('get_pet');
    schedule(0);
  } catch (error) {
    console.error('讀取寵物狀態失敗', error);
  }
}

/** 心情泡泡：每隔一段時間冒出來一下（§7） */
function moodBubble(v: PetView, now: number): BubbleKind | null {
  const cycle = (period: number, shown: number): boolean => now % period < shown;
  if (v.sleeping) return cycle(2000, 1200) ? 'zzz' : null;
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

  const wobbling = view.stage === 'egg' && (view.waiting || active?.wobble === true);
  renderScene(image.data, {
    view,
    pose,
    breathe: Math.floor(now / 1000) % 2 === 1,
    tail: [-1, 0, 1, 0][Math.floor(now / 600) % 4],
    hop: active?.hop === true && Math.floor(now / 150) % 2 === 0,
    wobble: wobbling ? [-1, 0, 1, 0][Math.floor(now / 120) % 4] : 0,
    bubble: active ? active.bubble : moodBubble(view, now),
  });
  ctx.putImageData(image, 0, 0);
  return active !== null || wobbling;
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

void refresh();
window.setInterval(() => void refresh(), POLL_MS);
