// Game rules used by the optimizer.
//
// Numbers come from the game's own logic data (GameLogicData, latest extract),
// not from the wiki, which is out of date in several places. Everything here is
// a default: the Rules panel lets the player change any cost if the game is
// patched again.

export type Terrain = 'unknown' | 'field' | 'forest' | 'mountain' | 'water' | 'ocean' | 'ice' | 'wetland';
export type Resource = 'none' | 'crop' | 'metal' | 'fruit' | 'game' | 'fish' | 'aquacrop' | 'other';

/** Buildings the optimizer reasons about. Anything else is an "other" improvement. */
export type BuildingKind =
  | 'market'
  | 'sawmill'
  | 'windmill'
  | 'forge'
  | 'lumberhut'
  | 'farm'
  | 'mine'
  | 'aquafarm';

export type Improvement = BuildingKind | 'city' | 'other' | 'none';

export const PRODUCERS = ['sawmill', 'windmill', 'forge'] as const;
export type Producer = (typeof PRODUCERS)[number];

/** Which support buildings level up each producer. */
export const PRODUCER_SUPPORT: Record<Producer, BuildingKind[]> = {
  sawmill: ['lumberhut'],
  windmill: ['farm', 'aquafarm'],
  forge: ['mine'],
};

export const MAX_LEVEL = 8;

export type TechKey =
  | 'riding' | 'roads' | 'trade' | 'freespirit' | 'chivalry'
  | 'organization' | 'farming' | 'construction' | 'shields' | 'diplomacy'
  | 'fishing' | 'sailing' | 'navigation' | 'ramming' | 'aquatism'
  | 'hunting' | 'forestry' | 'mathematics' | 'archery' | 'spiritualism'
  | 'climbing' | 'mining' | 'smithery' | 'meditation' | 'philosophy';

export interface TechDef {
  key: TechKey;
  name: string;
  tier: 1 | 2 | 3;
  parent: TechKey | null;
  /** Index in the save file's tech list (GameLogicData idx). */
  idx: number;
}

export const TECHS: TechDef[] = [
  { key: 'riding', name: 'Riding', tier: 1, parent: null, idx: 1 },
  { key: 'roads', name: 'Roads', tier: 2, parent: 'riding', idx: 4 },
  { key: 'trade', name: 'Trade', tier: 3, parent: 'roads', idx: 5 },
  { key: 'freespirit', name: 'Free Spirit', tier: 2, parent: 'riding', idx: 2 },
  { key: 'chivalry', name: 'Chivalry', tier: 3, parent: 'freespirit', idx: 3 },
  { key: 'organization', name: 'Organization', tier: 1, parent: null, idx: 6 },
  { key: 'farming', name: 'Farming', tier: 2, parent: 'organization', idx: 8 },
  { key: 'construction', name: 'Construction', tier: 3, parent: 'farming', idx: 9 },
  { key: 'shields', name: 'Strategy', tier: 2, parent: 'organization', idx: 7 },
  { key: 'diplomacy', name: 'Diplomacy', tier: 3, parent: 'shields', idx: 38 },
  { key: 'fishing', name: 'Fishing', tier: 1, parent: null, idx: 10 },
  { key: 'sailing', name: 'Sailing', tier: 2, parent: 'fishing', idx: 13 },
  { key: 'navigation', name: 'Navigation', tier: 3, parent: 'sailing', idx: 14 },
  { key: 'ramming', name: 'Ramming', tier: 2, parent: 'fishing', idx: 44 },
  { key: 'aquatism', name: 'Aquatism', tier: 3, parent: 'ramming', idx: 12 },
  { key: 'hunting', name: 'Hunting', tier: 1, parent: null, idx: 15 },
  { key: 'forestry', name: 'Forestry', tier: 2, parent: 'hunting', idx: 16 },
  { key: 'mathematics', name: 'Mathematics', tier: 3, parent: 'forestry', idx: 17 },
  { key: 'archery', name: 'Archery', tier: 2, parent: 'hunting', idx: 18 },
  { key: 'spiritualism', name: 'Spiritualism', tier: 3, parent: 'archery', idx: 19 },
  { key: 'climbing', name: 'Climbing', tier: 1, parent: null, idx: 20 },
  { key: 'mining', name: 'Mining', tier: 2, parent: 'climbing', idx: 23 },
  { key: 'smithery', name: 'Smithery', tier: 3, parent: 'mining', idx: 24 },
  { key: 'meditation', name: 'Meditation', tier: 2, parent: 'climbing', idx: 21 },
  { key: 'philosophy', name: 'Philosophy', tier: 3, parent: 'meditation', idx: 22 },
];

export const TECH_BY_KEY: Record<TechKey, TechDef> = Object.fromEntries(
  TECHS.map((t) => [t.key, t]),
) as Record<TechKey, TechDef>;

/**
 * Tribe-specific techs that sit in the same slot as a standard tech.
 * A save file lists the tribe's own tech id, so we map it back to the slot.
 */
export const TECH_IDX_ALIASES: Record<number, TechKey> = {
  28: 'hunting', // forestmagic (Elyrion)
  27: 'riding', // riding2 (Aquarion)
  25: 'freespirit', // freediving (Aquarion)
  26: 'chivalry', // spearing (Aquarion)
  48: 'roads', // waterways (Aquarion)
  47: 'fishing', // aquafishing (Aquarion)
  39: 'ramming', // aquaculture (Aquarion)
  46: 'sailing', // marinelife (Aquarion)
  40: 'fishing', // fishingsimple
  30: 'fishing', // frostwork (Polaris)
  42: 'ramming', // icefishing (Polaris): parent of Polarism, so the Ramming slot
  31: 'navigation', // polarwarfare (Polaris)
  32: 'aquatism', // polarism (Polaris)
  41: 'sailing', // sledding (Polaris): parent of Polar Warfare, so the Sailing slot
  36: 'construction', // recycling (Cymanti)
  35: 'chivalry', // shock (Cymanti)
  49: 'meditation', // rituals (Cymanti)
  50: 'philosophy', // mysticism (Cymanti)
};

export type TribeKey =
  | 'generic' | 'xinxi' | 'imperius' | 'bardur' | 'oumaji' | 'kickoo' | 'hoodrick'
  | 'luxidoor' | 'vengir' | 'zebasi' | 'aimo' | 'quetzali' | 'yadakk'
  | 'aquarion' | 'elyrion' | 'polaris' | 'cymanti';

export interface TribeDef {
  key: TribeKey;
  name: string;
  idx: number;
  /** Tribe-specific names for tech slots, shown in the UI. */
  techNames?: Partial<Record<TechKey, string>>;
  canClearForest: boolean;
  canBurnForest: boolean;
  /** Aquarion farms water crops with Aquafarms (slot: Ramming → Aquaculture). */
  hasAquafarm: boolean;
  /** Polaris and Cymanti replace the Market with a different building. */
  hasMarket: boolean;
  note?: string;
}

const std = { canClearForest: true, canBurnForest: true, hasAquafarm: false, hasMarket: true };

export const TRIBES: TribeDef[] = [
  { key: 'generic', name: 'Any standard tribe', idx: -1, ...std },
  { key: 'xinxi', name: 'Xin-xi', idx: 13, ...std },
  { key: 'imperius', name: 'Imperius', idx: 7, ...std },
  { key: 'bardur', name: 'Bardur', idx: 4, ...std },
  { key: 'oumaji', name: 'Oumaji', idx: 10, ...std },
  { key: 'kickoo', name: 'Kickoo', idx: 8, ...std },
  { key: 'hoodrick', name: 'Hoodrick', idx: 6, ...std },
  { key: 'luxidoor', name: 'Luxidoor', idx: 9, ...std },
  { key: 'vengir', name: 'Vengir', idx: 12, ...std },
  { key: 'zebasi', name: 'Zebasi', idx: 15, ...std },
  { key: 'aimo', name: 'Ai-Mo', idx: 2, ...std },
  { key: 'quetzali', name: 'Quetzali', idx: 11, ...std },
  { key: 'yadakk', name: 'Yădakk', idx: 14, ...std },
  {
    key: 'aquarion', name: 'Aquarion', idx: 3, ...std,
    canBurnForest: false, hasAquafarm: true,
    techNames: { roads: 'Waterways', chivalry: 'Spearing', ramming: 'Aquaculture', fishing: 'Aquafishing', sailing: 'Marine Life', riding: 'Riding', freespirit: 'Free Diving' },
  },
  {
    key: 'elyrion', name: 'Elyrion', idx: 5, ...std,
    canClearForest: false, canBurnForest: false,
    techNames: { hunting: 'Forest Magic' },
    note: 'Elyrion cannot clear or burn forest.',
  },
  {
    key: 'polaris', name: 'Polaris', idx: 16, ...std, hasMarket: false,
    note: 'Polaris builds Ice Banks instead of Markets, so this optimizer does not apply.',
  },
  {
    key: 'cymanti', name: 'Cymanti', idx: 17, ...std, hasMarket: false,
    note: 'Cymanti builds Clathrus instead of Markets, so this optimizer does not apply.',
  },
];

export const TRIBE_BY_KEY: Record<TribeKey, TribeDef> = Object.fromEntries(
  TRIBES.map((t) => [t.key, t]),
) as Record<TribeKey, TribeDef>;

export function tribeFromIdx(idx: number): TribeKey {
  return TRIBES.find((t) => t.idx === idx)?.key ?? 'generic';
}

export function techName(key: TechKey, tribe: TribeKey): string {
  return TRIBE_BY_KEY[tribe].techNames?.[key] ?? TECH_BY_KEY[key].name;
}

/** Star costs. Editable in the Rules panel. */
export interface CostTable {
  market: number;
  sawmill: number;
  windmill: number;
  forge: number;
  lumberhut: number;
  farm: number;
  mine: number;
  aquafarm: number;
  /** Clearing pays you stars, so this is a refund (positive number = stars gained). */
  clearForestRefund: number;
  burnForest: number;
  growForest: number;
  destroy: number;
  /** Tech cost = tier × cities + techBase. */
  techBase: number;
  /** Multiplier once Philosophy (Literacy) is owned; result is rounded up. */
  literacyFactor: number;
}

export const DEFAULT_COSTS: CostTable = {
  market: 5,
  sawmill: 5,
  windmill: 5,
  forge: 5,
  lumberhut: 3,
  farm: 5,
  mine: 5,
  aquafarm: 5,
  clearForestRefund: 1,
  burnForest: 3,
  growForest: 5,
  destroy: 0,
  techBase: 4,
  literacyFactor: 2 / 3,
};

export function techCost(tier: number, cities: number, costs: CostTable, hasLiteracy: boolean): number {
  const base = tier * Math.max(1, cities) + costs.techBase;
  return hasLiteracy ? Math.ceil(base * costs.literacyFactor - 1e-9) : base;
}

export type Op = 'destroy' | 'clear' | 'burn' | 'grow';

/** Everything the optimizer needs to know about a building, in one place. */
export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  /** Short label drawn on the map. */
  abbr: string;
  /** Tech (by slot) needed to build it. */
  tech: TechKey;
  /** Terrains it can stand on. Terrain actions (clear, burn, grow) can get a tile there. */
  terrain: Terrain[];
  /** Resource the tile must have. */
  resource?: Resource;
  /** One per city. */
  limited: boolean;
  /** Only some tribes have it. */
  tribeFlag?: 'hasMarket' | 'hasAquafarm';
}

export const BUILDINGS: BuildingDef[] = [
  { kind: 'market', name: 'Market', abbr: 'Mk', tech: 'trade', terrain: ['field'], limited: true, tribeFlag: 'hasMarket' },
  { kind: 'sawmill', name: 'Sawmill', abbr: 'Sw', tech: 'mathematics', terrain: ['field'], limited: true },
  { kind: 'windmill', name: 'Windmill', abbr: 'Wm', tech: 'construction', terrain: ['field'], limited: true },
  { kind: 'forge', name: 'Forge', abbr: 'Fg', tech: 'smithery', terrain: ['field', 'forest'], limited: true },
  { kind: 'lumberhut', name: 'Lumber Hut', abbr: 'Lh', tech: 'forestry', terrain: ['forest'], limited: false },
  { kind: 'farm', name: 'Farm', abbr: 'Fa', tech: 'farming', terrain: ['field'], resource: 'crop', limited: false },
  { kind: 'mine', name: 'Mine', abbr: 'Mi', tech: 'mining', terrain: ['mountain'], resource: 'metal', limited: false },
  // Aquarion's Aquaculture sits in the Ramming slot.
  { kind: 'aquafarm', name: 'Aquafarm', abbr: 'Aq', tech: 'ramming', terrain: ['water', 'ocean'], resource: 'aquacrop', limited: false, tribeFlag: 'hasAquafarm' },
];

export const BUILDING_KINDS: BuildingKind[] = BUILDINGS.map((b) => b.kind);
export const BUILDING_BY_KIND = Object.fromEntries(BUILDINGS.map((b) => [b.kind, b])) as Record<BuildingKind, BuildingDef>;

export function isBuildingKind(v: string | null | undefined): v is BuildingKind {
  return !!v && v in BUILDING_BY_KIND;
}

export function isProducer(b: string | null | undefined): b is Producer {
  return !!b && (PRODUCERS as readonly string[]).includes(b);
}

/** Tech needed to build each building (by slot). */
export const BUILD_TECH = Object.fromEntries(BUILDINGS.map((b) => [b.kind, b.tech])) as Record<BuildingKind, TechKey>;
export const BUILDING_NAMES = Object.fromEntries(BUILDINGS.map((b) => [b.kind, b.name])) as Record<BuildingKind, string>;
export const BUILDING_ABBR = Object.fromEntries(BUILDINGS.map((b) => [b.kind, b.abbr])) as Record<BuildingKind, string>;

/** Buildings limited to one per city. */
export const LIMITED: BuildingKind[] = BUILDINGS.filter((b) => b.limited).map((b) => b.kind);

/** Terrain actions: what they need and what they turn the tile into. */
export interface TerrainOpDef {
  op: Exclude<Op, 'destroy'>;
  from: Terrain;
  to: Terrain;
  /** Resource the tile has afterwards ('none' clears it). */
  resource: Resource;
  /** Tribe flag that must be true. */
  tribeFlag?: 'canClearForest' | 'canBurnForest';
  /** Setting that must be on. */
  setting: 'allowClear' | 'allowBurn' | 'allowGrow';
}

export const TERRAIN_OPS: TerrainOpDef[] = [
  { op: 'clear', from: 'forest', to: 'field', resource: 'none', tribeFlag: 'canClearForest', setting: 'allowClear' },
  { op: 'burn', from: 'forest', to: 'field', resource: 'crop', tribeFlag: 'canBurnForest', setting: 'allowBurn' },
  { op: 'grow', from: 'field', to: 'forest', resource: 'none', setting: 'allowGrow' },
];

export const OP_TECH = {
  clear: 'forestry',
  burn: 'construction',
  grow: 'spiritualism',
  destroy: 'chivalry',
} as const satisfies Record<Op, TechKey>;

export const OP_NAMES: Record<Op, string> = {
  clear: 'Clear forest',
  burn: 'Burn forest',
  grow: 'Grow forest',
  destroy: 'Destroy',
};

/** Star cost of a terrain action (clearing refunds stars, so it is negative). */
export function opCost(op: Op, c: CostTable): number {
  switch (op) {
    case 'clear':
      return -c.clearForestRefund;
    case 'burn':
      return c.burnForest;
    case 'grow':
      return c.growForest;
    case 'destroy':
      return c.destroy;
  }
}

/** Philosophy grants Literacy, which makes every later tech cheaper. */
export const LITERACY_TECH: TechKey = 'philosophy';

/**
 * Techs that reveal resources: the player sees the resource once they own any of them.
 * Zebasi start with Farming without Organization and can still see crops.
 * Aquacrop is only shown to tribes that can farm it (see toGameState).
 */
export const REVEAL_TECH: Partial<Record<Resource, TechKey[]>> = {
  crop: ['organization', 'farming'],
  metal: ['climbing'],
};

/** Tech roots in tree order. */
export const TECH_ROOTS: TechKey[] = TECHS.filter((t) => t.parent === null).map((t) => t.key);

// ---- City growth ----
//
// Population from buildings comes from the game's logic data (`rewards`, and for
// producers `growthRewards` per level). The level-up rewards are not in that data:
// they are the game's fixed choices, checked against a real save, where a city's
// income is its level, plus 1 for each Workshop and Park, plus 1 for the capital
// (the save's city `production` field is 1 + Workshops + Parks).
// Destroying a building takes its population away again. Population can go below zero
// (the save stores it signed); each point below zero costs 1★ per turn of that city's
// income, down to nothing, and a city never loses a level. That penalty is from the
// Polytopia wiki (Population) only: it is not in the data and not yet checked against a save.

/** Population a building adds to the city it stands in. */
export const BUILDING_POPULATION: Partial<Record<BuildingKind, number>> = { farm: 2, lumberhut: 1, mine: 2, aquafarm: 2 };

/** Population a producer adds to its own city for each level it gains. */
export const PRODUCER_POPULATION: Record<Producer, number> = { sawmill: 1, windmill: 1, forge: 2 };

/** Population a city at `level` needs to reach the next level. Extra population carries over. */
export const popToLevelUp = (level: number) => level + 1;

/** Lowest population we read or let you type (below zero after destroying buildings). */
export const MIN_POPULATION = -99;

/** Stars per turn each city level adds by itself, whatever reward you take. */
export const LEVEL_INCOME = 1;

export type CityReward = 'workshop' | 'resources' | 'popgrowth' | 'park';

export interface CityRewardDef {
  /** The level the city reaches. Level 5 and up all offer the last row. */
  level: number;
  reward: CityReward;
  name: string;
  /** Stars right away. */
  stars: number;
  /** Stars per turn from the reward, on top of LEVEL_INCOME. */
  income: number;
  /** Population right away (it can level the city up again). */
  population: number;
}

/** The economic reward at each level-up: the one this planner always takes. */
export const CITY_REWARDS: CityRewardDef[] = [
  { level: 2, reward: 'workshop', name: 'Workshop', stars: 0, income: 1, population: 0 },
  { level: 3, reward: 'resources', name: 'Resources', stars: 5, income: 0, population: 0 },
  { level: 4, reward: 'popgrowth', name: 'Population growth', stars: 0, income: 0, population: 3 },
  { level: 5, reward: 'park', name: 'Park', stars: 0, income: 1, population: 0 },
];

/** The economic reward for reaching `level` (null below level 2). */
export function cityReward(level: number): CityRewardDef | null {
  if (level < CITY_REWARDS[0].level) return null;
  return CITY_REWARDS.find((r) => r.level === level) ?? CITY_REWARDS[CITY_REWARDS.length - 1];
}
