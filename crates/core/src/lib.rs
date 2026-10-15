//! DeskPet 核心邏輯：養分、成長、體型、活力、心情。
//!
//! 這個 crate 不碰作業系統，也不讀時鐘；時間一律由呼叫端傳入，
//! 所以模擬器可以直接加速執行（DESIGN.md §16）。

pub mod balance;
pub mod calendar;
pub mod mood;
pub mod pet;
pub mod rng;
pub mod sampling;
pub mod species;

pub use balance::Balance;
pub use mood::{MoodEngine, MoodLevel};
pub use pet::{BodyType, Event, LegacyChoice, Pet, Stage, TickInput};
pub use sampling::{Sample, SampleOutcome, TickAccumulator, TickSummary};
pub use species::{EggRoll, Family, Species};
