import { BUILDING_KINDS, type CostTable, DEFAULT_COSTS, type Improvement, MIN_POPULATION, type Resource, TECHS, type TechKey, type Terrain, TRIBE_BY_KEY } from '../data/rules';
import { defaultSettings } from './defaults';
import type { City, GameState, Settings, Tile } from './types';

const KEY = 'market-planner/state/v1';
/** Bumped when the saved map format changes incompatibly. */
export const MAP_FORMAT = 1;

export function saveLocal(state: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, format: MAP_FORMAT }));
  } catch {
    /* storage unavailable */
  }
}

export function loadLocal(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseJson(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

const TERRAINS: Terrain[] = ['unknown', 'field', 'forest', 'mountain', 'water', 'ocean', 'ice', 'wetland'];
const RESOURCES: Resource[] = ['none', 'crop', 'metal', 'fruit', 'game', 'fish', 'aquacrop', 'other'];
const IMPROVEMENTS: Improvement[] = [...BUILDING_KINDS, 'city', 'other', 'none'];
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, fallback: number, min = -Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback);

/**
 * Reads a saved map. Anything unknown or out of range falls back to a default
 * rather than breaking the app later.
 */
export function parseJson(text: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a market planner map (it is not valid JSON). Choose a .json file made with Download map.');
  }
  const s = raw as Partial<GameState> & { format?: number };
  const w = s?.width;
  const h = s?.height;
  if (!s || !Number.isInteger(w) || !Number.isInteger(h) || w! < 1 || h! < 1 || w! > 128 || h! > 128 || !Array.isArray(s.tiles) || s.tiles.length !== w! * h!) {
    throw new Error('This file is not a market planner map. Choose a .json file made with Download map.');
  }
  if (s.format !== undefined && s.format > MAP_FORMAT) throw new Error('This map was saved by a newer version of the app. Reload the page to update, then try again.');
  // Cities off the map are dropped; `newIndex` maps each saved city index to its new one.
  const cities: City[] = [];
  const newIndex = new Map<number, number>();
  (Array.isArray(s.cities) ? s.cities : []).forEach((c, i) => {
    if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x >= w! || c.y >= h!) return;
    newIndex.set(i, cities.length);
    cities.push({ name: typeof c.name === 'string' ? c.name : `City ${cities.length + 1}`, x: c.x, y: c.y, ...cityGrowth(c) });
  });
  const tiles: Tile[] = s.tiles.map((t) => {
    const city = t?.city;
    const tile: Tile = {
      terrain: pick(t?.terrain, TERRAINS, 'unknown'),
      resource: pick(t?.resource, RESOURCES, 'none'),
      improvement: pick(t?.improvement, IMPROVEMENTS, 'none'),
      city: Number.isInteger(city) ? (newIndex.get(city!) ?? null) : null,
    };
    if (t?.enemy === true && tile.terrain !== 'unknown') tile.enemy = true;
    return tile;
  });
  const d = defaultSettings();
  const ss = (s.settings ?? {}) as Partial<Settings>;
  const techKeys = new Set(TECHS.map((t) => t.key));
  const costs = { ...DEFAULT_COSTS } as CostTable;
  // Same limits as the rules editor.
  for (const k of Object.keys(DEFAULT_COSTS) as (keyof CostTable)[]) costs[k] = Math.min(k === 'literacyFactor' ? 1 : 999, num(ss.costs?.[k], DEFAULT_COSTS[k], 0));
  const settings: Settings = {
    tribe: ss.tribe && ss.tribe in TRIBE_BY_KEY ? ss.tribe : d.tribe,
    owned: (Array.isArray(ss.owned) ? ss.owned : []).filter((t): t is TechKey => techKeys.has(t)),
    cityCount: Math.min(999, Math.round(num(ss.cityCount, Math.max(1, cities.length), 1))),
    stars: Math.min(9999, num(ss.stars, d.stars, 0)),
    baseIncome: Math.min(9999, num(ss.baseIncome, d.baseIncome, 0)),
    allowClear: typeof ss.allowClear === 'boolean' ? ss.allowClear : d.allowClear,
    allowBurn: typeof ss.allowBurn === 'boolean' ? ss.allowBurn : d.allowBurn,
    allowGrow: typeof ss.allowGrow === 'boolean' ? ss.allowGrow : d.allowGrow,
    allowDestroy: typeof ss.allowDestroy === 'boolean' ? ss.allowDestroy : d.allowDestroy,
    allowNewTech: typeof ss.allowNewTech === 'boolean' ? ss.allowNewTech : d.allowNewTech,
    ...(ss.cityUpgrades === false && { cityUpgrades: false }),
    costs,
  };
  const turn = Number.isInteger(s.turn) && s.turn! >= 0 && s.turn! <= 100_000 ? s.turn : undefined;
  return { width: w!, height: h!, tiles, cities, settings, source: typeof s.source === 'string' ? s.source : undefined, ...(turn !== undefined && { turn }) };
}

/** A city's level and population, when they are known and make sense. */
function cityGrowth(c: Partial<City>): Pick<City, 'level' | 'population'> {
  const level = c.level;
  if (!Number.isInteger(level) || level! < 1 || level! > 999) return {};
  const pop = Number.isInteger(c.population) ? c.population! : 0;
  // A city levels up once its population reaches level + 1; it can be below zero.
  return { level, population: Math.min(level!, Math.max(MIN_POPULATION, pop)) };
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mapJson(state: GameState) {
  return JSON.stringify({ ...state, format: MAP_FORMAT }, null, 1);
}
