import { DEFAULT_COSTS, type TechKey } from '../src/data/rules';
import type { GameState, Settings, Tile } from '../src/model/types';


/**
 * Map legend (one char per tile, rows separated by newlines):
 *  . field   , crop field   f forest   m mountain   M metal mountain   ~ water
 *  C city center   (lowercase letter after '|' row marker not used)
 * All tiles are given to city 0 unless `cityOf` says otherwise.
 */
export function makeState(map: string, settings: Partial<Settings> = {}, cityOf?: (x: number, y: number) => number | null): GameState {
  const rows = map.trim().split('\n').map((r) => r.trim());
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[] = [];
  const cities: GameState['cities'] = [];
  rows.forEach((r, y) => {
    [...r].forEach((ch, x) => {
      const t: Tile = { terrain: 'field', resource: 'none', improvement: 'none', city: cityOf ? cityOf(x, y) : 0 };
      if (ch === ',') t.resource = 'crop';
      if (ch === 'f') t.terrain = 'forest';
      if (ch === 'm') t.terrain = 'mountain';
      if (ch === 'M') { t.terrain = 'mountain'; t.resource = 'metal'; }
      if (ch === '~') t.terrain = 'water';
      if (ch === 'C') { t.improvement = 'city'; cities.push({ name: `City ${cities.length + 1}`, x, y }); }
      tiles.push(t);
    });
  });
  const all: TechKey[] = [];
  return {
    width,
    height,
    tiles,
    cities,
    settings: {
      tribe: 'generic',
      owned: all,
      cityCount: Math.max(1, cities.length),
      stars: 0,
      baseIncome: 5,
      allowClear: true,
      allowBurn: true,
      allowGrow: false,
      allowDestroy: false,
      allowNewTech: true,
      costs: { ...DEFAULT_COSTS },
      ...settings,
    },
  };
}
