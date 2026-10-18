// 畫風。品種參數（palette.ts）和姿勢產生器不變，畫風只改眼睛、毛邊、上色、外框和裝飾。

export type StyleId = 'bit16' | 'fluffy' | 'flat' | 'sticker' | 'cream';

export interface Style {
  /** 奶油提案以側面呈現日常動作；其他提案沿用坐姿 */
  sideIdle?: boolean;
  /** 眼睛：有虹膜和反光的大眼、小黑點、帶一點反光的黑眼 */
  eyes: 'iris' | 'dot' | 'shine';
  /** 毛邊：整圈都長毛尖、只有長毛品種有、全部平滑（捲毛品種的雲朵外框一律保留） */
  fur: 'shaggy' | 'breed' | 'smooth';
  /** 耳朵內側用粉紅（否則用亮色） */
  pinkEars: boolean;
  /** 外框：色盤的深色，或依旁邊的顏色加深（sel-out） */
  outline: 'black' | 'selout';
  /** 上色：16-bit 色相偏移的明暗（含乾淨細線和反鋸齒）、多層次漸層加毛流、平塗、平塗加底部陰影 */
  shading: 'bit16' | 'fur' | 'flat' | 'bottom';
  /** 貼紙的白邊 */
  border: boolean;
  /** 腳下的淡陰影 */
  groundShadow: boolean;
  /** 平常就有腮紅 */
  blush: boolean;
}

export const STYLES: Record<StyleId, Style> = {
  // B 奶油像素：小點眼、品種毛邊、可可外框、平塗與單階底影，不加貼紙白邊。
  cream: { eyes: 'dot', fur: 'breed', pinkEars: true, outline: 'black', shading: 'bottom', border: false, groundShadow: true, blush: false, sideIdle: true },
  // 16-bit（類 SNES）：乾淨的細線、彩色外框、色相偏移的明暗、反鋸齒、虹膜大眼
  bit16: { eyes: 'iris', fur: 'breed', pinkEars: true, outline: 'selout', shading: 'bit16', border: false, groundShadow: true, blush: false },
  // 1 蓬鬆細膩（參考長毛貓）：多層次毛色、整圈毛尖、虹膜大眼、地面陰影
  fluffy: { eyes: 'iris', fur: 'shaggy', pinkEars: true, outline: 'selout', shading: 'fur', border: false, groundShadow: true, blush: false },
  // 2 圓潤平塗（參考圓餅貓）：乾淨外框、平塗、小黑點眼、腮紅
  flat: { eyes: 'dot', fur: 'smooth', pinkEars: true, outline: 'black', shading: 'flat', border: false, groundShadow: false, blush: true },
  // 3 貼紙（參考狗狗貼紙）：深色外框、底部陰影、白邊
  sticker: { eyes: 'shine', fur: 'breed', pinkEars: false, outline: 'black', shading: 'bottom', border: true, groundShadow: false, blush: false },
};

export const DEFAULT_STYLE: StyleId = 'cream';
