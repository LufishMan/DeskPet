// 和 Rust 端 PetView 對應的型別（app/src-tauri/src/main.rs）

export type Family = 'cat' | 'dog' | 'mouse' | 'hamster' | 'bear';
export type Stage = 'egg' | 'baby' | 'juvenile' | 'adult';
export type Body = 'very_thin' | 'thin' | 'standard' | 'fat' | 'very_fat';
export type Mood = 'happy' | 'normal' | 'tense' | 'depressed';

export type Pose = 'idle' | 'blink' | 'look' | 'happy' | 'sleep' | 'tired';
export type Pattern = 'solid' | 'stripes' | 'points' | 'mask' | 'cap' | 'dorsal' | 'panda';
export type Ears = 'pointy' | 'short' | 'tall' | 'floppy' | 'curly' | 'round' | 'small' | 'big';
export type Tail = 'long' | 'fluffy' | 'wag' | 'feather' | 'curl' | 'pom' | 'thin' | 'stub' | 'none';
/** 品種特徵部件 */
export type Feature = 'cheeks' | 'flat_face' | 'bib' | 'urajiro' | 'blaze' | 'topknot' | 'pouches' | 'big_nose';

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
  /** 蛋紋的排列種子（由 egg_seed 而來） */
  seed: number;
  egg_progress: number;
  /** 專注模式：停止主動冒泡泡 */
  focus: boolean;
}
