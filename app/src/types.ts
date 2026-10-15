// 和 Rust 端 PetView 對應的型別（app/src-tauri/src/main.rs）

export type Family = 'cat' | 'dog' | 'mouse' | 'hamster' | 'bear';
export type Stage = 'egg' | 'baby' | 'juvenile' | 'adult';
export type Body = 'very_thin' | 'thin' | 'standard' | 'fat' | 'very_fat';
export type Mood = 'happy' | 'normal' | 'tense' | 'depressed';

export type Pose = 'idle' | 'blink' | 'look' | 'happy' | 'sleep' | 'tired';
export type Pattern = 'solid' | 'stripes' | 'points' | 'mask' | 'cap' | 'dorsal' | 'panda';
export type Ears = 'pointy' | 'floppy' | 'round' | 'small' | 'big';

export interface PetView {
  family: Family;
  species: string;
  stage: Stage;
  body: Body;
  mood: Mood;
  energy: number;
  sleeping: boolean;
  waiting: boolean;
  legacy_ready: boolean;
  rare: boolean;
  hue_shift: number;
  egg_progress: number;
  /** 專注模式：停止主動冒泡泡 */
  focus: boolean;
}
