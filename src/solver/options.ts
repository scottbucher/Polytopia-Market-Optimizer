import {
  BUILD_TECH,
  type BuildingKind,
  OP_TECH,
  TECH_BY_KEY,
  type TechKey,
  TRIBE_BY_KEY,
  techCost,
} from '../data/rules';
import type { GameState, Tile } from '../model/types';

export type Op = 'destroy' | 'clear' | 'burn' | 'grow';

export interface TileOption {
  /** Building that ends up on the tile (null = leave it as it is). */
  build: BuildingKind | null;
  /** Terrain actions done first, in order. */
  ops: Op[];
  /** True when this option just keeps the building already there. */
  keep: boolean;
  /** Net star cost of the ops and the building (clearing a forest refunds stars). */
  cost: number;
  techs: TechKey[];
}

export interface TileOptions {
  tile: number;
  city: number;
  options: TileOption[];
}

export function isOwned(state: GameState, t: TechKey) {
  return state.settings.owned.includes(t);
}

/** Every tech in the chain needed for `t`, including `t`, that is not owned yet. */
export function missingChain(state: GameState, t: TechKey): TechKey[] {
  const out: TechKey[] = [];
  let cur: TechKey | null = t;
  while (cur && !isOwned(state, cur)) {
    out.unshift(cur);
    cur = TECH_BY_KEY[cur].parent;
  }
  return out;
}

export function techPrice(state: GameState, t: TechKey) {
  const s = state.settings;
  return techCost(TECH_BY_KEY[t].tier, s.cityCount, s.costs, s.owned.includes('philosophy'));
}

const KINDS: BuildingKind[] = ['market', 'sawmill', 'windmill', 'forge', 'lumberhut', 'farm', 'mine', 'aquafarm'];

function isBuilding(v: string): v is BuildingKind {
  return (KINDS as string[]).includes(v);
}

export function tileOptions(state: GameState, i: number): TileOption[] {
  const tile: Tile = state.tiles[i];
  const s = state.settings;
  const tribe = TRIBE_BY_KEY[s.tribe];
  const c = s.costs;
  const opts: TileOption[] = [];

  if (tile.city === null || tile.improvement === 'city') return [];

  const existing = tile.improvement;
  const hasBuilding = existing !== 'none';
  if (isBuilding(existing)) {
    opts.push({ build: existing, ops: [], keep: true, cost: 0, techs: [] });
  } else {
    opts.push({ build: null, ops: [], keep: true, cost: 0, techs: [] });
  }

  const canDestroy = s.allowDestroy;
  if (hasBuilding && !canDestroy) return opts;

  const pre: Op[] = hasBuilding ? ['destroy'] : [];
  const preCost = hasBuilding ? c.destroy : 0;
  const preTech: TechKey[] = hasBuilding ? [OP_TECH.destroy] : [];

  const add = (build: BuildingKind, ops: Op[], extraCost: number, extraTechs: TechKey[]) => {
    if (build === existing && ops.length === 0) return;
    if (build === 'market' && !tribe.hasMarket) return;
    if (build === 'aquafarm' && !tribe.hasAquafarm) return;
    const techs = Array.from(new Set([...preTech, ...extraTechs, BUILD_TECH[build]]));
    opts.push({ build, ops: [...pre, ...ops], keep: false, cost: preCost + extraCost + c[build], techs });
  };

  if (hasBuilding) {
    // Clear the tile so it can be used differently (or just to free it).
    opts.push({ build: null, ops: ['destroy'], keep: false, cost: c.destroy, techs: [OP_TECH.destroy] });
  }

  const canClear = s.allowClear && tribe.canClearForest;
  const canBurn = s.allowBurn && tribe.canBurnForest;
  const canGrow = s.allowGrow;
  const fieldBuilds: BuildingKind[] = ['market', 'sawmill', 'windmill', 'forge'];

  switch (tile.terrain) {
    case 'field':
      for (const b of fieldBuilds) add(b, [], 0, []);
      if (tile.resource === 'crop') add('farm', [], 0, []);
      if (canGrow) add('lumberhut', ['grow'], c.growForest, [OP_TECH.grow]);
      break;
    case 'forest':
      add('lumberhut', [], 0, []);
      add('forge', [], 0, []);
      if (canClear) {
        for (const b of ['market', 'sawmill', 'windmill'] as BuildingKind[]) add(b, ['clear'], -c.clearForestRefund, [OP_TECH.clear]);
      }
      if (canBurn) {
        add('farm', ['burn'], c.burnForest, [OP_TECH.burn]);
        if (!canClear) {
          for (const b of ['market', 'sawmill', 'windmill'] as BuildingKind[]) add(b, ['burn'], c.burnForest, [OP_TECH.burn]);
        }
      }
      break;
    case 'mountain':
      if (tile.resource === 'metal') add('mine', [], 0, []);
      break;
    case 'water':
    case 'ocean':
      if (tile.resource === 'aquacrop') add('aquafarm', [], 0, []);
      break;
    default:
      break;
  }

  if (!s.allowNewTech) {
    return opts.filter((o) => o.techs.every((t) => isOwned(state, t)));
  }
  return opts;
}

export function allTileOptions(state: GameState): TileOptions[] {
  const out: TileOptions[] = [];
  state.tiles.forEach((t, i) => {
    if (t.city === null) return;
    const options = tileOptions(state, i);
    if (options.length) out.push({ tile: i, city: t.city, options });
  });
  return out;
}
