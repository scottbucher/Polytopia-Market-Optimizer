// Turns a parsed save into the optimizer's GameState for one player, keeping only
// what that player can actually see in the game (no fog-of-war spoilers).

import {
  type Improvement,
  type Resource,
  REVEAL_TECH,
  TECH_IDX_ALIASES,
  type TechKey,
  TECHS,
  type Terrain,
  TRIBE_BY_KEY,
  tribeFromIdx,
} from '../data/rules';
import { defaultSettings } from '../model/defaults';
import type { City, GameState, Tile } from '../model/types';
import { IMP_CITY, type RawSave, type RawTile } from './stateFile';

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

/**
 * Unit types other players can't see (the game's "hide" ability): cloak, cloak boat
 * (dinghy) and mermaid cloak. Never shown, even when they stand in your territory.
 */
export const HIDDEN_UNITS = new Set([38, 39, 50]);

/** A unit of another player that you can see stands on this tile. */
function enemyOn(raw: RawTile, playerId: number) {
  const u = raw.unit;
  return !!u && u.owner !== playerId && !HIDDEN_UNITS.has(u.type);
}

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
}

/** Players controlled by a person (not the AI). */
export function humanPlayers(save: RawSave): HumanPlayer[] {
  return save.players
    .filter((p) => !p.autoPlay && p.id !== 0 && p.id !== 255)
    .map((p) => ({ id: p.id, name: p.name }));
}

export interface LoadReport {
  state: GameState;
  hiddenTiles: number;
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
      if (t.improvement === IMP_CITY && t.owner === playerId && t.visibility.includes(playerId)) {
        cityAt.set(`${t.x},${t.y}`, cities.length);
        cities.push({ name: t.city?.name || `City ${cities.length + 1}`, x: t.x, y: t.y });
        incomeEstimate += Math.max(0, t.city?.production ?? 0);
      }
    }
  }

  const tribe = tribeFromIdx(player.tribe);
  // Resources the player can't see yet are left out. We don't count them either:
  // even the number would be a hint.
  const canSee = (r: Resource) => {
    if (r === 'aquacrop') return TRIBE_BY_KEY[tribe].hasAquafarm;
    const reveal = REVEAL_TECH[r];
    return !reveal || reveal.some((t) => owned.includes(t));
  };
  let hiddenTiles = 0;
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const raw: RawTile = save.tiles[y][x];
      if (!raw.visibility.includes(playerId)) {
        hiddenTiles++;
        tiles.push({ terrain: 'unknown', resource: 'none', improvement: 'none', city: null });
        continue;
      }
      // Unknown resource ids are dropped rather than shown as "other": we can't tell
      // whether the player can see them.
      let resource: Resource = raw.resource === -1 ? 'none' : (RESOURCE[raw.resource] ?? 'none');
      if (!canSee(resource)) resource = 'none';
      let improvement: Improvement;
      if (raw.improvement === -1) improvement = 'none';
      else if (raw.improvement === IMP_CITY) improvement = raw.owner === playerId ? 'city' : 'other';
      else improvement = IMPROVEMENT[raw.improvement] ?? 'other';

      let city: number | null = null;
      if (raw.owner === playerId) {
        city = cityAt.get(`${raw.rulingCity[0]},${raw.rulingCity[1]}`) ?? nearestCity(cities, x, y);
      }
      // Buildings in other players' territory don't help you.
      if (city === null && improvement !== 'none' && improvement !== 'city') improvement = 'other';
      const tile: Tile = { terrain: TERRAIN[raw.terrain] ?? 'unknown', resource, improvement, city };
      if (tile.terrain !== 'unknown' && enemyOn(raw, playerId)) tile.enemy = true;
      tiles.push(tile);
    }
  }

  const state: GameState = {
    width,
    height,
    tiles,
    cities,
    source: `${fileName} · turn ${save.header.currentTurn}`,
    settings: {
      ...defaultSettings(),
      tribe,
      owned,
      cityCount: Math.max(1, player.numCities || cities.length),
      stars: player.stars,
      baseIncome: incomeEstimate,
    },
  };
  return { state, hiddenTiles, incomeEstimate };
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
