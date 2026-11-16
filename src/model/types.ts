import type { CostTable, Improvement, Resource, TechKey, Terrain, TribeKey } from '../data/rules';

export interface Tile {
  terrain: Terrain;
  resource: Resource;
  improvement: Improvement;
  /** Index into GameState.cities when the tile is in one of the player's cities, else null. */
  city: number | null;
}

export interface City {
  name: string;
  x: number;
  y: number;
  /** City level, when known (from a save, or typed in). */
  level?: number;
  /** Population toward the next level. */
  population?: number;
}

export interface Settings {
  tribe: TribeKey;
  owned: TechKey[];
  /** Number of cities you own (drives tech cost). Defaults to cities on the map. */
  cityCount: number;
  stars: number;
  /** Stars per turn from everything except Markets. */
  baseIncome: number;
  allowClear: boolean;
  allowBurn: boolean;
  allowGrow: boolean;
  allowDestroy: boolean;
  /** Let the plan buy new techs. Off = only use techs you own. */
  allowNewTech: boolean;
  /** Count the rewards of cities levelling up from the plan's population. Unset = on. */
  cityUpgrades?: boolean;
  costs: CostTable;
}

export interface GameState {
  width: number;
  height: number;
  /** Row-major: tiles[y * width + x] */
  tiles: Tile[];
  cities: City[];
  settings: Settings;
  /** Free-form info about where the state came from (file name, turn). */
  source?: string;
  /** The game's current turn. */
  turn?: number;
}

export type Goal =
  | { kind: 'max' }
  | { kind: 'income'; income: number; turns: number }
  | { kind: 'bank'; stars: number; turns: number }
  | { kind: 'best-by'; turns: number };

export function idx(state: { width: number }, x: number, y: number) {
  return y * state.width + x;
}

export function neighbors(width: number, height: number, i: number): number[] {
  const x = i % width;
  const y = Math.floor(i / width);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) out.push(ny * width + nx);
    }
  }
  return out;
}
