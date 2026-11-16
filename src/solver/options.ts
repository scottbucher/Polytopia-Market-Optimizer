// What can be done with each tile, and what techs cost.

import {
  BUILDINGS,
  type BuildingKind,
  isBuildingKind,
  LITERACY_TECH,
  type Op,
  OP_TECH,
  opCost,
  TECH_BY_KEY,
  TECHS,
  type TechKey,
  TERRAIN_OPS,
  TRIBE_BY_KEY,
  techCost,
} from '../data/rules';
import type { GameState, Tile } from '../model/types';

export type { Op };

export interface TileOption {
  /** Building that ends up on the tile (null = leave it as it is / empty). */
  build: BuildingKind | null;
  /** Terrain actions done first, in order. */
  ops: Op[];
  /** True when this option just keeps the tile as it is. */
  keep: boolean;
  /** Net star cost of the ops and the building (clearing a forest refunds stars). */
  cost: number;
  techs: TechKey[];
}

export function isOwned(state: GameState, t: TechKey) {
  return state.settings.owned.includes(t);
}

/** `t` and every prerequisite of it that is not owned yet, prerequisites first. */
export function missingChain(state: GameState, t: TechKey): TechKey[] {
  const out: TechKey[] = [];
  let cur: TechKey | null = t;
  while (cur && !isOwned(state, cur)) {
    out.unshift(cur);
    cur = TECH_BY_KEY[cur].parent;
  }
  return out;
}

/** Price of a tech now. `literacy` = priced as if Philosophy were owned. */
export function techPrice(state: GameState, t: TechKey, literacy = isOwned(state, LITERACY_TECH)) {
  const s = state.settings;
  return techCost(TECH_BY_KEY[t].tier, s.cityCount, s.costs, literacy);
}

export interface TechBill {
  /** Techs to research, in research order (Philosophy's chain first when it is bought). */
  techs: TechKey[];
  cost: number;
  /** Price of each tech in `techs`, at the time it is researched. */
  price: Map<TechKey, number>;
  /** Philosophy is bought first because the discount pays for it. */
  buysLiteracy: boolean;
}

/**
 * Prices a set of needed techs (plus their missing prerequisites). Also tries buying
 * Philosophy first when that makes the whole set cheaper, as Literacy discounts later techs.
 */
export function makeTechBiller(state: GameState) {
  const full = new Map<TechKey, number>();
  const disc = new Map<TechKey, number>();
  for (const t of TECHS) {
    full.set(t.key, techPrice(state, t.key));
    disc.set(t.key, techPrice(state, t.key, true));
  }
  const litOwned = isOwned(state, LITERACY_TECH);
  const litChain = new Set(missingChain(state, LITERACY_TECH));
  const canBuyLiteracy = !litOwned && state.settings.allowNewTech;
  const tierSort = (a: TechKey, b: TechKey) => TECH_BY_KEY[a].tier - TECH_BY_KEY[b].tier || TECH_BY_KEY[a].idx - TECH_BY_KEY[b].idx;

  // Bills are asked for the same few tech sets over and over during the search.
  const memo = new Map<string, TechBill>();
  return (needed: Iterable<TechKey>): TechBill => {
    const arr = [...needed];
    const key = arr.join();
    let bill = memo.get(key);
    if (!bill) {
      bill = billOf(arr);
      if (memo.size < 100_000) memo.set(key, bill);
    }
    return bill;
  };

  function billOf(needed: TechKey[]): TechBill {
    const need = new Set<TechKey>();
    for (const t of needed) for (const k of missingChain(state, t)) need.add(k);
    const plainCost = [...need].reduce((s, t) => s + full.get(t)!, 0);
    if (canBuyLiteracy && need.size) {
      let litCost = 0;
      for (const t of litChain) litCost += full.get(t)!;
      for (const t of need) if (!litChain.has(t)) litCost += disc.get(t)!;
      if (litCost < plainCost) {
        const chain = [...litChain];
        const rest = [...need].filter((t) => !litChain.has(t)).sort(tierSort);
        const price = new Map<TechKey, number>();
        for (const t of chain) price.set(t, full.get(t)!);
        for (const t of rest) price.set(t, disc.get(t)!);
        return { techs: [...chain, ...rest], cost: litCost, price, buysLiteracy: true };
      }
    }
    const techs = [...need].sort(tierSort);
    return { techs, cost: plainCost, price: new Map(techs.map((t) => [t, full.get(t)!])), buysLiteracy: false };
  }
}

export type TechBiller = ReturnType<typeof makeTechBiller>;

/**
 * Every way to use a tile. The first option always keeps the tile as it is.
 * This is the one place that decides what the plan may change: everything else
 * (the exact search, the global search, the build order) only uses these options.
 */
export function tileOptions(state: GameState, i: number): TileOption[] {
  const tile: Tile = state.tiles[i];
  const s = state.settings;
  const tribe = TRIBE_BY_KEY[s.tribe];
  const c = s.costs;

  if (tile.city === null || tile.improvement === 'city') return [];

  const existing = tile.improvement;
  const opts: TileOption[] = [{ build: isBuildingKind(existing) ? existing : null, ops: [], keep: true, cost: 0, techs: [] }];

  // Temples, ports, monuments and the like are never torn down for a market.
  // With an enemy unit on the tile you can't build, destroy or change the terrain;
  // its building still earns.
  if (existing === 'other' || tile.enemy) return opts;
  const hasBuilding = existing !== 'none';
  if (hasBuilding && !s.allowDestroy) return opts;

  const pre: Op[] = hasBuilding ? ['destroy'] : [];
  if (hasBuilding) opts.push({ build: null, ops: ['destroy'], keep: false, cost: opCost('destroy', c), techs: [OP_TECH.destroy] });

  // The terrain the tile can be turned into (at most one terrain action).
  const reachable = [{ terrain: tile.terrain, resource: tile.resource, ops: [] as Op[] }];
  for (const t of TERRAIN_OPS) {
    if (t.from !== tile.terrain || !s[t.setting] || (t.tribeFlag && !tribe[t.tribeFlag])) continue;
    reachable.push({ terrain: t.to, resource: t.resource, ops: [t.op] });
  }

  for (const r of reachable) {
    for (const b of BUILDINGS) {
      if (!b.terrain.includes(r.terrain)) continue;
      if (b.resource && r.resource !== b.resource) continue;
      if (b.tribeFlag && !tribe[b.tribeFlag]) continue;
      if (b.kind === existing && r.ops.length === 0) continue; // that is just keeping it
      const ops = [...pre, ...r.ops];
      const techs = [...new Set([...ops.map((o) => OP_TECH[o]), b.tech])];
      const cost = ops.reduce((x, o) => x + opCost(o, c), 0) + c[b.kind];
      opts.push({ build: b.kind, ops, keep: false, cost, techs });
    }
  }

  if (!s.allowNewTech) return opts.filter((o) => o.techs.every((t) => isOwned(state, t)));
  return opts;
}

/** Your tiles that the plan could change if the enemy unit on them weren't there. */
export function enemyBlocked(state: GameState): number[] {
  const out: number[] = [];
  state.tiles.forEach((t, i) => {
    if (!t.enemy) return;
    const tiles = [...state.tiles];
    tiles[i] = { ...t, enemy: false };
    if (tileOptions({ ...state, tiles }, i).length > 1) out.push(i);
  });
  return out;
}
