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

/** Buildings limited to one per city. */
export const LIMITED: BuildingKind[] = ['market', 'sawmill', 'windmill', 'forge'];

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
  42: 'sailing', // icefishing (Polaris)
  31: 'navigation', // polarwarfare (Polaris)
  32: 'aquatism', // polarism (Polaris)
  41: 'ramming', // sledding (Polaris)
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

/** Tech needed to build each building (by slot). */
export const BUILD_TECH: Record<BuildingKind, TechKey> = {
  market: 'trade',
  sawmill: 'mathematics',
  windmill: 'construction',
  forge: 'smithery',
  lumberhut: 'forestry',
  farm: 'farming',
  mine: 'mining',
  aquafarm: 'ramming', // Aquarion's Aquaculture sits in the Ramming slot
};

export const OP_TECH = {
  clear: 'forestry',
  burn: 'construction',
  grow: 'spiritualism',
  destroy: 'chivalry',
} as const satisfies Record<string, TechKey>;

/** Techs that reveal resources. Without them the player cannot see the resource. */
export const REVEAL_TECH: Partial<Record<Resource, TechKey>> = {
  crop: 'organization',
  metal: 'climbing',
};

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  market: 'Market',
  sawmill: 'Sawmill',
  windmill: 'Windmill',
  forge: 'Forge',
  lumberhut: 'Lumber Hut',
  farm: 'Farm',
  mine: 'Mine',
  aquafarm: 'Aquafarm',
};

export const BUILDING_ABBR: Record<BuildingKind, string> = {
  market: 'Mk',
  sawmill: 'Sw',
  windmill: 'Wm',
  forge: 'Fg',
  lumberhut: 'Lh',
  farm: 'Fa',
  mine: 'Mi',
  aquafarm: 'Aq',
};
