import { DEFAULT_COSTS } from '../data/rules';
import type { GameState, Settings } from './types';

export function defaultSettings(): Settings {
  return {
    tribe: 'generic',
    owned: [],
    cityCount: 1,
    stars: 5,
    baseIncome: 2,
    allowClear: true,
    allowBurn: true,
    allowGrow: true,
    allowDestroy: false,
    allowNewTech: true,
    costs: { ...DEFAULT_COSTS },
  };
}

export function blankState(width = 11, height = 11): GameState {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'unknown' as const, resource: 'none' as const, improvement: 'none' as const, city: null })),
    cities: [],
    settings: defaultSettings(),
    source: 'blank map',
  };
}

/** A small example so the app isn't empty on first open. */
export function exampleState(): GameState {
  const rows = [
    '~~~ffff....',
    '~~f.ff,f.mM',
    '~f.f..f.fff',
    'ff.,f.ff.,f',
    'f.ffC.f.fff',
    '.ff.ff,ff.M',
    'fMf..ffC.ff',
    'f,ff.f..f.f',
    '.ffmff.,ff~',
    'ff.f.ff.f~~',
    '..ff.fff~~~',
  ];
  const s = blankState(11, 11);
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      const t = s.tiles[y * 11 + x];
      t.terrain = ch === '~' ? 'water' : ch === 'f' ? 'forest' : ch === 'm' || ch === 'M' ? 'mountain' : 'field';
      if (ch === ',') t.resource = 'crop';
      if (ch === 'M') t.resource = 'metal';
      if (ch === 'C') {
        t.improvement = 'city';
        s.cities.push({ name: s.cities.length ? 'Westmoor' : 'Capital', x, y });
      }
    }),
  );
  // Each city starts with its 3x3; the first one has grown to 5x5.
  s.cities.forEach((c, ci) => {
    const r = ci === 0 ? 2 : 1;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= 11 || y >= 11) continue;
        const t = s.tiles[y * 11 + x];
        if (t.city === null) t.city = ci;
      }
  });
  s.settings.owned = ['hunting', 'forestry', 'riding', 'organization', 'climbing'];
  s.settings.cityCount = 2;
  s.settings.stars = 12;
  s.settings.baseIncome = 6;
  s.source = 'example map';
  return s;
}
