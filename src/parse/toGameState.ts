// Turns a parsed save into the optimizer's GameState for one player, keeping only
// what that player can actually see in the game (no fog-of-war spoilers).

import {
  DEFAULT_COSTS,
  type Improvement,
  type Resource,
  REVEAL_TECH,
  TECH_IDX_ALIASES,
  type TechKey,
  TECHS,
  type Terrain,
  tribeFromIdx,
} from '../data/rules';
import type { City, GameState, Tile } from '../model/types';
import type { RawSave, RawTile } from './stateFile';

const TERRAIN: Record<number, Terrain> = {
  1: 'water',
  2: 'ocean',
  3: 'field',
  4: 'mountain',
  5: 'forest',
  6: 'ice',
  7: 'wetland',
  8: 'wetland',
};

const RESOURCE: Record<number, Resource> = {
  1: 'game',
  2: 'crop',
  3: 'fish',
  5: 'metal',
  6: 'fruit',
  9: 'aquacrop',
};

const IMPROVEMENT: Record<number, Improvement> = {
  3: 'none', // road
  5: 'farm',
  6: 'windmill',
  12: 'lumberhut',
  13: 'sawmill',
  21: 'mine',
  22: 'forge',
  49: 'aquafarm',
  50: 'market',
};

export function techsFromIdx(ids: number[]): TechKey[] {
  const out = new Set<TechKey>();
  for (const i of ids) {
    const t = TECHS.find((x) => x.idx === i)?.key ?? TECH_IDX_ALIASES[i];
    if (t) out.add(t);
  }
  return [...out];
}

export interface HumanPlayer {
  id: number;
  name: string;
  tribe: number;
  cities: number;
}

/** Players controlled by a person (not the AI). */
export function humanPlayers(save: RawSave): HumanPlayer[] {
  return save.players
    .filter((p) => !p.autoPlay && p.id !== 0 && p.id !== 255)
    .map((p) => ({ id: p.id, name: p.name, tribe: p.tribe, cities: p.numCities }));
}

export interface LoadReport {
  state: GameState;
  hiddenTiles: number;
  hiddenResources: number;
  /** Sum of each city's stored production: a starting estimate of non-market income. */
  incomeEstimate: number;
}

export function toGameState(save: RawSave, playerId: number, fileName = 'save'): LoadReport {
  const player = save.players.find((p) => p.id === playerId);
  if (!player) throw new Error('Player not found in save.');
  const owned = techsFromIdx(player.techs);
  const { width, height } = save.header;

  const cities: City[] = [];
  const cityAt = new Map<string, number>();
  let incomeEstimate = 0;
  for (const row of save.tiles) {
    for (const t of row) {
      if (t.improvement === 1 && t.owner === playerId && t.visibility.includes(playerId)) {
        cityAt.set(`${t.x},${t.y}`, cities.length);
        cities.push({ name: t.city?.name || `City ${cities.length + 1}`, x: t.x, y: t.y });
        incomeEstimate += Math.max(0, t.city?.production ?? 0);
      }
    }
  }

  let hiddenTiles = 0;
  let hiddenResources = 0;
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const raw: RawTile = save.tiles[y][x];
      if (!raw.visibility.includes(playerId)) {
        hiddenTiles++;
        tiles.push({ terrain: 'unknown', resource: 'none', improvement: 'none', city: null });
        continue;
      }
      let resource: Resource = raw.resource === -1 ? 'none' : (RESOURCE[raw.resource] ?? 'other');
      const reveal = REVEAL_TECH[resource];
      if (reveal && !owned.includes(reveal)) {
        // The player can't see this resource yet.
        hiddenResources++;
        resource = 'none';
      }
      let improvement: Improvement;
      if (raw.improvement === -1) improvement = 'none';
      else if (raw.improvement === 1) improvement = raw.owner === playerId ? 'city' : 'other';
      else improvement = IMPROVEMENT[raw.improvement] ?? 'other';

      let city: number | null = null;
      if (raw.owner === playerId) {
        city = cityAt.get(`${raw.rulingCity[0]},${raw.rulingCity[1]}`) ?? nearestCity(cities, x, y);
      }
      // Buildings in other players' territory don't help you.
      if (city === null && improvement !== 'none' && improvement !== 'city') improvement = 'other';
      tiles.push({ terrain: TERRAIN[raw.terrain] ?? 'unknown', resource, improvement, city });
    }
  }

  const state: GameState = {
    width,
    height,
    tiles,
    cities,
    source: `${fileName} · turn ${save.header.currentTurn}`,
    settings: {
      tribe: tribeFromIdx(player.tribe),
      owned,
      cityCount: Math.max(1, player.numCities || cities.length),
      stars: player.stars,
      baseIncome: incomeEstimate,
      allowClear: true,
      allowBurn: true,
      allowGrow: true,
      allowDestroy: false,
      allowNewTech: true,
      costs: { ...DEFAULT_COSTS },
    },
  };
  return { state, hiddenTiles, hiddenResources, incomeEstimate };
}

function nearestCity(cities: City[], x: number, y: number): number | null {
  let best: number | null = null;
  let bd = Infinity;
  cities.forEach((c, i) => {
    const d = Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
