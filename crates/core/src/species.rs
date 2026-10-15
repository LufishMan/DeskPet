//! 科別、品種與蛋的抽選（DESIGN.md §3、§12）。

use serde::{Deserialize, Serialize};

use crate::rng::Rng;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Family {
    Cat,
    Dog,
    Mouse,
    Hamster,
    Bear,
}

impl Family {
    pub const ALL: [Family; 5] = [Family::Cat, Family::Dog, Family::Mouse, Family::Hamster, Family::Bear];

    pub fn species(self) -> &'static [Species] {
        use Species::*;
        match self {
            Family::Cat => &[TabbyMix, BritishShorthair, AmericanShorthair, Ragdoll, Siamese, Persian],
            Family::Dog => &[TaiwanDogMix, Shiba, Corgi, GoldenRetriever, Poodle, Husky],
            Family::Mouse => &[WhiteMouse, FancyRat],
            Family::Hamster => &[SyrianHamster, DwarfHamster],
            Family::Bear => &[Panda, Wombat],
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Family::Cat => "貓科",
            Family::Dog => "犬科",
            Family::Mouse => "鼠科",
            Family::Hamster => "倉鼠科",
            Family::Bear => "熊科",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Species {
    TabbyMix,
    BritishShorthair,
    AmericanShorthair,
    Ragdoll,
    Siamese,
    Persian,
    TaiwanDogMix,
    Shiba,
    Corgi,
    GoldenRetriever,
    Poodle,
    Husky,
    WhiteMouse,
    FancyRat,
    SyrianHamster,
    DwarfHamster,
    Panda,
    Wombat,
}

impl Species {
    pub fn family(self) -> Family {
        use Species::*;
        match self {
            TabbyMix | BritishShorthair | AmericanShorthair | Ragdoll | Siamese | Persian => Family::Cat,
            TaiwanDogMix | Shiba | Corgi | GoldenRetriever | Poodle | Husky => Family::Dog,
            WhiteMouse | FancyRat => Family::Mouse,
            SyrianHamster | DwarfHamster => Family::Hamster,
            Panda | Wombat => Family::Bear,
        }
    }

    pub fn name(self) -> &'static str {
        use Species::*;
        match self {
            TabbyMix => "米克斯（虎斑）",
            BritishShorthair => "英國短毛貓",
            AmericanShorthair => "美國短毛貓",
            Ragdoll => "布偶貓",
            Siamese => "暹羅貓",
            Persian => "波斯貓",
            TaiwanDogMix => "米克斯（台灣犬）",
            Shiba => "柴犬",
            Corgi => "柯基",
            GoldenRetriever => "黃金獵犬",
            Poodle => "貴賓犬",
            Husky => "哈士奇",
            WhiteMouse => "小白鼠",
            FancyRat => "花枝鼠",
            SyrianHamster => "黃金鼠",
            DwarfHamster => "三線鼠",
            Panda => "貓熊",
            Wombat => "袋熊",
        }
    }
}

/// 稀有色盤（白化、黑化等）的機率（§3.1）
pub const RARE_PALETTE_CHANCE: f64 = 0.05;

/// 由 `egg_seed` 決定的品種與花色。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EggRoll {
    pub family: Family,
    pub species: Species,
    /// 同品種內的色相偏移
    pub hue_shift: u8,
    pub rare: bool,
}

impl EggRoll {
    /// `family` 為 `Some` 時延續血脈；`None` 時 5 科機率相同。
    pub fn roll(seed: u64, family: Option<Family>) -> Self {
        let mut rng = Rng::new(seed);
        // 一律先抽科別，讓同一個 seed 的品種與花色不受血脈選擇影響
        let rolled = Family::ALL[rng.below(Family::ALL.len())];
        let family = family.unwrap_or(rolled);
        let list = family.species();
        let species = list[rng.below(list.len())];
        let hue_shift = rng.below(256) as u8;
        let rare = rng.chance(RARE_PALETTE_CHANCE);
        Self { family, species, hue_shift, rare }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eighteen_species_with_consistent_families() {
        let all: Vec<Species> = Family::ALL.iter().flat_map(|f| f.species().iter().copied()).collect();
        assert_eq!(all.len(), 18);
        for f in Family::ALL {
            assert!(f.species().iter().all(|s| s.family() == f));
        }
    }

    #[test]
    fn roll_is_deterministic_and_respects_lineage() {
        assert_eq!(EggRoll::roll(42, None), EggRoll::roll(42, None));
        for seed in 0..200 {
            assert_eq!(EggRoll::roll(seed, Some(Family::Bear)).family, Family::Bear);
        }
    }

    #[test]
    fn families_are_roughly_uniform() {
        let mut counts = [0u32; 5];
        for seed in 0..10_000 {
            let f = EggRoll::roll(seed, None).family;
            counts[Family::ALL.iter().position(|x| *x == f).unwrap()] += 1;
        }
        assert!(counts.iter().all(|&c| (1800..2200).contains(&c)), "{counts:?}");
    }
}
