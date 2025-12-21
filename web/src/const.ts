import type { KeyBindings, Terrain, Attribute, Rarity, MonsterKind, Monster, Spell, Trap } from "@/types";
import { Vector3 } from "three";

// if prod do https://storage.googleapis.com/duelistassets
// if dev do /public
export const ASSET_URL = import.meta.env.DEV ? "" : "https://storage.googleapis.com/duelistassets";

export const PLAYER_BASE_Z = 0.1;
export const BOARD_SIZE = 11;
export const TILE_SIZE = 1;
export const X_AXIS_NEGATIVE_MAX = -(BOARD_SIZE - 1) / 2;
export const X_AXIS_POSITIVE_MAX = (BOARD_SIZE - 1) / 2;
export const Y_AXIS_NEGATIVE_MAX = -(BOARD_SIZE - 1) / 2;
export const Y_AXIS_POSITIVE_MAX = (BOARD_SIZE - 1) / 2;

export const NORTH_BOARD_START = new Vector3(0, Y_AXIS_POSITIVE_MAX, 0.1);
export const SOUTH_BOARD_START = new Vector3(0, Y_AXIS_NEGATIVE_MAX, 0.1);
export const EAST_BOARD_START = new Vector3(X_AXIS_POSITIVE_MAX, 0, 0.1);
export const WEST_BOARD_START = new Vector3(X_AXIS_NEGATIVE_MAX, 0, 0.1);

export const DEFAULT_KEYBINDINGS: KeyBindings = {
  select: "k",
  cancel: ["l", "Escape"],
  playCard: "j",
  viewDetails: "i",
  flipCard: "o",
  changePosition: "u",
  cursorUp: "w",
  cursorDown: "s",
  cursorLeft: "a",
  cursorRight: "d"
};

export const SOGEN_TERRAIN: Terrain = {
  type: "sogen",
  name: "Sogen",
  textureUrl: ASSET_URL + "/terrains/sogen.png"
};
export const YAMI_TERRAIN: Terrain = {
  type: "yami",
  name: "Yami",
  textureUrl: ASSET_URL + "/terrains/yami.png"
};
export const LABYRINTH_TERRAIN: Terrain = {
  type: "labyrinth",
  name: "Labyrinth",
  textureUrl: ASSET_URL + "/terrains/labyrinth.png"
};
export const NORMAL_TERRAIN: Terrain = {
  type: "normal",
  name: "Normal",
  textureUrl: ASSET_URL + "/terrains/normal.png"
};
export const UMI_TERRAIN: Terrain = {
  type: "umi",
  name: "Umi",
  textureUrl: ASSET_URL + "/terrains/umi.png"
};
export const CRUSH_TERRAIN: Terrain = {
  type: "crush",
  name: "Crush",
  textureUrl: ASSET_URL + "/terrains/crush.png"
};
export const MOUNTAIN_TERRAIN: Terrain = {
  type: "mountain",
  name: "Mountain",
  textureUrl: ASSET_URL + "/terrains/mountain.png",
  displacementUrl: ASSET_URL + "/terrains/mountain.png"
};
export const WASTELAND_TERRAIN: Terrain = {
  type: "wasteland",
  name: "Wasteland",
  textureUrl: ASSET_URL + "/terrains/wasteland.png"
};
export const FOREST_TERRAIN: Terrain = {
  type: "forest",
  name: "Forest",
  textureUrl: ASSET_URL + "/terrains/forest.png"
};
export const TOON_TERRAIN: Terrain = {
  type: "toon",
  name: "Toon",
  textureUrl: ASSET_URL + "/terrains/toon.png"
};
export const TERRAINS: Terrain[] = [
  SOGEN_TERRAIN,
  YAMI_TERRAIN,
  LABYRINTH_TERRAIN,
  NORMAL_TERRAIN,
  UMI_TERRAIN,
  CRUSH_TERRAIN,
  MOUNTAIN_TERRAIN,
  WASTELAND_TERRAIN,
  FOREST_TERRAIN,
  TOON_TERRAIN
];
export const CARD_TYPES = [
  'monster',
  'monster_effect',
  'fusion',
  'ritual',
  'spell',
  'trap'
];

export const SECRET_COLOR = "#8f6d42";
export const SUPER_COLOR = "#8f6d42";
export const GHOST_COLOR = "#9c9c9c";
export const ULTRA_COLOR = "#9c9c9c";
export const GOLD_COLOR = "#9c9c9c";
export const ULTIMATE_COLOR = "#ffbb00";
export const STARLIGHT_COLOR = "#ffbb00";

export const getGlowColor = (rarity: Omit<Rarity, 'common' | 'ghost' | 'secret' | 'ultra' | 'gold'>) => {
  switch (rarity) {
    case 'ultimate': return '#ffffff'; // Orange Red
    case 'starlight': return '#ffd700'; // Orange Red
    default: return '#ffd700'; // Default Gold
  }
};
export const getRarityTextColor = (rarity: Rarity) => {
  switch (rarity) {
    case 'common': return 'inherit';
    case 'secret': return SECRET_COLOR;
    case 'ghost': return GHOST_COLOR;
    case 'super': return SUPER_COLOR;
    case 'ultra': return ULTRA_COLOR;
    case 'gold': return GOLD_COLOR;
    case 'ultimate': return ULTIMATE_COLOR;
    case 'starlight': return STARLIGHT_COLOR;
    default: return '#ffffff';
  }
};

export const LIGHT: Attribute = {
  type: "light",
  attributeUrl: ASSET_URL + "/attributes/light_attribute.svg",
};
export const DARK: Attribute = {
  type: "dark",
  attributeUrl: ASSET_URL + "/attributes/dark_attribute.svg",
};
export const WIND: Attribute = {
  type: "wind",
  attributeUrl: ASSET_URL + "/attributes/wind_attribute.svg",
};
export const WATER: Attribute = {
  type: "water",
  attributeUrl: ASSET_URL + "/attributes/water_attribute.svg",
};
export const EARTH: Attribute = {
  type: "earth",
  attributeUrl: ASSET_URL + "/attributes/earth_attribute.svg",
};
export const FIRE: Attribute = {
  type: "fire",
  attributeUrl: ASSET_URL + "/attributes/fire_attribute.svg",
};
export const SPELL: Attribute = {
  type: "spell",
  attributeUrl: ASSET_URL + "/attributes/spell_attribute.svg",
};
export const TRAP: Attribute = {
  type: "trap",
  attributeUrl: ASSET_URL + "/attributes/trap_attribute.svg",
};

export const AQUA: MonsterKind = {
  monster: "aqua",
  strongIn: [
    "umi"
  ],
  weakIn: [
    "toon"
  ]
};
export const BEAST: MonsterKind = {
  monster: "beast",
  strongIn: [
    "sogen",
    "forest"
  ],
  weakIn: [
    "toon"
  ]
};
export const BEAST_WARRIOR: MonsterKind = {
  monster: "beast-warrior",
  strongIn: [
    "sogen",
    "forest"
  ],
  weakIn: [
    "toon"
  ]
};
export const DINOSAUR: MonsterKind = {
  monster: "dinosaur",
  strongIn: [
    "wasteland"
  ],
  weakIn: [
    "toon"
  ]
};
export const DRAGON: MonsterKind = {
  monster: "dragon",
  strongIn: [
    "mountain"
  ],
  weakIn: [
    "toon"
  ]
};
export const FAIRY: MonsterKind = {
  monster: "fairy",
  strongIn: [
    "mountain"
  ],
  weakIn: [
    "yami",
    "toon"
  ]
};
export const FISH: MonsterKind = {
  monster: "fish",
  strongIn: [
    "umi"
  ],
  weakIn: [
    "toon",
    "wasteland"
  ]
};
export const FIEND: MonsterKind = {
  monster: "fiend",
  strongIn: [
    "yami"
  ],
  weakIn: [
    "toon"
  ]
};
export const IMMORTAL: MonsterKind = {
  monster: "immortal",
  strongIn: [
    "crush"
  ],
  weakIn: [
    "toon"
  ]
};
export const INSECT: MonsterKind = {
  monster: "insect",
  strongIn: [
    "forest"
  ],
  weakIn: [
    "toon"
  ]
};
export const MACHINE: MonsterKind = {
  monster: "machine",
  strongIn: [
    "wasteland"
  ],
  weakIn: [
    "toon",
    "umi"
  ]
};
export const PLANT: MonsterKind = {
  monster: "plant",
  strongIn: [
    "forest"
  ],
  weakIn: [
    "toon",
    "wasteland"
  ]
};
export const PYRO: MonsterKind = {
  monster: "pyro",
  strongIn: [
    "forest"
  ],
  weakIn: [
    "toon",
    "umi"
  ]
};
export const REPTILE: MonsterKind = {
  monster: "reptile",
  strongIn: [
    "wasteland"
  ],
  weakIn: [
    "toon"
  ]
};
export const ROCK: MonsterKind = {
  monster: "rock",
  strongIn: [
    "wasteland"
  ],
  weakIn: [
    "toon"
  ]
};
export const SEA_SERPENT: MonsterKind = {
  monster: "sea-serpent",
  strongIn: [
    "umi"
  ],
  weakIn: [
    "toon"
  ]
};
export const SPELLCASTER: MonsterKind = {
  monster: "spellcaster",
  strongIn: [
    "yami"
  ],
  weakIn: [
    "toon",
    "sogen"
  ]
};
export const TOON: MonsterKind = {
  monster: "toon",
  strongIn: [
    "toon"
  ],
  weakIn: [

  ]
};
export const THUNDER: MonsterKind = {
  monster: "thunder",
  strongIn: [
    "mountain",
    "umi"
  ],
  weakIn: [
    "toon"
  ]
};
export const WARRIOR: MonsterKind = {
  monster: "warrior",
  strongIn: [
    "sogen"
  ],
  weakIn: [
    "toon"
  ]
};
export const WINGED_BEAST: MonsterKind = {
  monster: "winged-beast",
  strongIn: [
    "mountain"
  ],
  weakIn: [
    "toon"
  ]
};
export const ZOMBIE: MonsterKind = {
  monster: "zombie",
  strongIn: [
    "yami",
    "wasteland"
  ],
  weakIn: [
    "mountain",
    "toon"
  ]
};
export const NORMALMONSTER: Monster = "normal";
export const EFFECTMONSTER: Monster = "effect";
export const FUSIONMONSTER: Monster = "fusion";
export const RITUALMONSTER: Monster = "ritual";

export const NORMALSPELL: Spell = "normal";
export const POWERUPSPELL: Spell = "power-up";
export const FIELDSPELL: Spell = "field";
export const RITUALSPELL: Spell = "ritual";

export const LIMITEDRANGETRAP: Trap = "limited-range";
export const FULLRANGETRAP: Trap = "full-range";

// Non-immortal cards with more than this atk on crush are destroyed
export const DEATH_ON_CRUSH = 1500;

export const NEGATIVE_TERRAIN = -500;
export const POSITIVE_TERRAIN = 500;
