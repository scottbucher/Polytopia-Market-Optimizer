// Market layout optimizer.
//
// The search is exact for each city on its own: every market tile, every placement
// of the city's sawmill / windmill / forge next to it, and then the cheapest support
// buildings (lumber huts, farms, mines) for each income level 1..8. Cities are then
// combined with a knapsack over income levels, once for every sensible set of techs
// to buy, so tech costs are shared correctly between cities.
//
// What it does not search: a city's producers feeding a *neighbouring* city's market,
// and support buildings in one city's territory feeding another city's producer.
// The global search in search.ts looks for those cross-border layouts afterwards.

import {
  BUILD_TECH,
  type BuildingKind,
  isBuildingKind,
  isProducer,
  LIMITED,
  MAX_LEVEL,
  OP_TECH,
  PRODUCER_SUPPORT,
  PRODUCERS,
  type Producer,
  TECH_BY_KEY,
  type TechKey,
} from '../data/rules';
import { type GameState, neighbors } from '../model/types';
import { income as layoutIncome, type Layout } from './income';
import { isOwned, makeTechBiller, missingChain, type TechBiller, tileOptions, type TileOption } from './options';

export { isBuildingKind };

export interface Change {
  tile: number;
  option: TileOption;
}

export interface Plan {
  changes: Change[];
  layout: Layout;
  techs: TechKey[];
  income: number;
  /** Stars spent on buildings, terrain actions and techs (clearing forest refunds count as negative). */
  cost: number;
  techCost: number;
  /** Price of each tech in `techs` when it is researched (Literacy discounts later techs). */
  techPrices: Partial<Record<TechKey, number>>;
}

export function currentLayout(state: GameState): Layout {
  return state.tiles.map((t) => (t.city !== null && isBuildingKind(t.improvement) ? t.improvement : null));
}

interface RoleChoice {
  cost: number;
  option: TileOption;
}

interface TileInfo {
  tile: number;
  existing: BuildingKind | null;
  /** cheapest way to end up with each building on this tile */
  roles: Map<BuildingKind, RoleChoice>;
  /** cheapest way to clear the tile (destroy), when allowed */
  destroy: RoleChoice | null;
}

interface CityConfig {
  cost: number;
  income: number;
  /** tile -> chosen role (null = destroy) */
  assign: Map<number, BuildingKind | null>;
}

type Curve = (CityConfig | null)[]; // index = income level

/**
 * Sets of techs worth trying to buy. Each set is closed under prerequisites.
 *
 * Market tech is always in. One toggle per tech that unlocks something on its own: producers, terrain
 * actions, and support buildings whose tech is not already on the way to their
 * producer's tech (Aquaculture for aquafarms). Literacy is decided later, when pricing.
 */
export function candidateTechSets(state: GameState): TechKey[][] {
  const s = state.settings;
  if (!s.allowNewTech) return [[]];
  const used = new Set<TechKey>();
  const any = { ...state, settings: { ...s, allowNewTech: true } };
  state.tiles.forEach((t, i) => {
    if (t.city === null) return;
    for (const o of tileOptions(any, i)) for (const k of o.techs) used.add(k);
  });
  const chainOf = (t: TechKey) => {
    const out = new Set<TechKey>();
    for (let cur: TechKey | null = t; cur; cur = TECH_BY_KEY[cur].parent) out.add(cur);
    return out;
  };
  const leaders = new Set<TechKey>([...PRODUCERS.map((p) => BUILD_TECH[p]), ...Object.values(OP_TECH)]);
  for (const p of PRODUCERS) {
    const chain = chainOf(BUILD_TECH[p]);
    for (const sup of PRODUCER_SUPPORT[p]) if (!chain.has(BUILD_TECH[sup])) leaders.add(BUILD_TECH[sup]);
  }
  const toggles = [...leaders].filter((t) => used.has(t) && !isOwned(state, t)).sort();
  const seen = new Map<string, TechKey[]>();
  for (let mask = 0; mask < 1 << toggles.length; mask++) {
    // Every plan needs markets.
    const set = new Set<TechKey>(missingChain(state, BUILD_TECH.market));
    toggles.forEach((t, b) => {
      if (mask & (1 << b)) for (const k of missingChain(state, t)) set.add(k);
    });
    const list = [...set].sort();
    seen.set(list.join(','), list);
  }
  return [...seen.values()];
}

function tileInfos(state: GameState, tiles: number[], allowed: Set<TechKey>): TileInfo[] {
  const settings = { ...state.settings, allowNewTech: true };
  const st = { ...state, settings };
  return tiles.map((tile) => {
    const t = state.tiles[tile];
    const existing = isBuildingKind(t.improvement) ? t.improvement : null;
    const roles = new Map<BuildingKind, RoleChoice>();
    let destroy: RoleChoice | null = null;
    for (const o of tileOptions(st, tile)) {
      if (!o.techs.every((k) => isOwned(state, k) || allowed.has(k))) continue;
      if (o.build) {
        const cur = roles.get(o.build);
        if (!cur || o.cost < cur.cost) roles.set(o.build, { cost: o.cost, option: o });
      } else if (!o.keep) {
        if (!destroy || o.cost < destroy.cost) destroy = { cost: o.cost, option: o };
      }
    }
    return { tile, existing, roles, destroy };
  });
}

/** Exact cost curve for one city: cheapest config for each income level 0..8. */
function cityCurve(state: GameState, infos: TileInfo[]): Curve {
  const { width, height } = state;
  const byTile = new Map(infos.map((i) => [i.tile, i]));
  const curve: Curve = new Array(MAX_LEVEL + 1).fill(null);
  curve[0] = { cost: 0, income: 0, assign: new Map() };

  const canDestroy = infos.some((i) => i.destroy);
  const existingOf = (k: BuildingKind) => infos.filter((i) => i.existing === k).map((i) => i.tile);
  const exMarket = existingOf('market');
  const exProd = Object.fromEntries(PRODUCERS.map((p) => [p, existingOf(p)])) as Record<Producer, number[]>;

  const marketTiles: number[] =
    exMarket.length && !canDestroy ? [exMarket[0]] : infos.filter((i) => i.roles.has('market')).map((i) => i.tile);

  for (const m of marketTiles) {
    const mInfo = byTile.get(m)!;
    const nbM = neighbors(width, height, m);
    // Where each producer can go: nowhere, or next to the market (or where it already is
    // when it can't be destroyed).
    const choices: (number | null)[][] = PRODUCERS.map((p) => {
      if (exProd[p].length && !canDestroy) return [exProd[p][0]];
      const c: (number | null)[] = [null];
      for (const n of nbM) if (byTile.get(n)?.roles.has(p)) c.push(n);
      return c;
    });
    const pick: (number | null)[] = [];
    const walk = (k: number) => {
      if (k === PRODUCERS.length) {
        evalConfig(m, mInfo, nbM, pick);
        return;
      }
      for (const t of choices[k]) {
        if (t !== null && (t === m || pick.slice(0, k).includes(t))) continue;
        pick[k] = t;
        walk(k + 1);
      }
    };
    walk(0);
  }
  return curve;

  function evalConfig(m: number, mInfo: TileInfo, nbM: number[], prodTiles: (number | null)[]) {
    const assign = new Map<number, BuildingKind | null>();
    let base = mInfo.roles.get('market')!.cost;
    assign.set(m, 'market');
    const used = new Set<number>([m]);
    let active: { tile: number; p: Producer }[] = [];
    PRODUCERS.forEach((p, k) => {
      const t = prodTiles[k];
      if (t === null) return;
      const r = byTile.get(t)!.roles.get(p)!;
      base += r.cost;
      assign.set(t, p);
      used.add(t);
      if (nbM.includes(t)) active.push({ tile: t, p });
    });
    if (!active.length) return;
    // Existing one-per-city buildings that are replaced must be destroyed first. Their
    // tiles can still take a support building afterwards.
    const displacedCost = new Map<number, number>();
    for (const d of infos) {
      if (!d.existing || used.has(d.tile) || !LIMITED.includes(d.existing)) continue;
      const replaced = d.existing === 'market' || (isProducer(d.existing) && prodTiles[PRODUCERS.indexOf(d.existing)] !== null);
      if (!replaced) continue;
      if (!d.destroy) return;
      base += d.destroy.cost;
      assign.set(d.tile, null);
      displacedCost.set(d.tile, d.destroy.cost);
    }

    // Support slots: tile -> cheapest way to support one of the active producers.
    interface Slot { tile: number; cost: number; kind: BuildingKind; prod: number }
    const slotsFor = (a: { tile: number; p: Producer }, ai: number) => {
      const out: Slot[] = [];
      for (const s of neighbors(width, height, a.tile)) {
        if (used.has(s)) continue;
        const info = byTile.get(s);
        if (!info) continue;
        for (const kind of PRODUCER_SUPPORT[a.p]) {
          const r = info.roles.get(kind);
          // A displaced tile's support option already includes the destroy we paid for above.
          if (r) out.push({ tile: s, cost: r.cost - (displacedCost.get(s) ?? 0), kind, prod: ai });
        }
      }
      return out;
    };
    // A producer with no possible support adds nothing: it just stays at level 0.
    active = active.filter((a, ai) => slotsFor(a, ai).length > 0);
    if (!active.length) return;
    const perProd = active.map(slotsFor);
    const best = new Map<number, Slot>();
    for (const l of perProd)
      for (const slot of l) {
        const cur = best.get(slot.tile);
        if (!cur || slot.cost < cur.cost) best.set(slot.tile, slot);
      }

    // Each active producer needs one support: take the cheapest for each (on distinct tiles).
    const chosen: Slot[] = [];
    const taken = new Set<number>();
    const order = active.map((_, i) => i).sort((a, b) => perProd[a].length - perProd[b].length);
    for (const ai of order) {
      const s = perProd[ai].filter((x) => !taken.has(x.tile)).sort((a, b) => a.cost - b.cost)[0];
      if (!s) return;
      chosen.push(s);
      taken.add(s.tile);
    }
    const rest = [...best.values()].filter((s) => !taken.has(s.tile)).sort((a, b) => a.cost - b.cost);
    // Free supports (already built) always count.
    let cost = base + chosen.reduce((x, s) => x + s.cost, 0);
    const picks = [...chosen];
    let r = 0;
    while (r < rest.length && rest[r].cost <= 0) {
      cost += rest[r].cost;
      picks.push(rest[r++]);
    }
    const record = () => {
      const inc = Math.min(MAX_LEVEL, picks.length);
      const cur = curve[inc];
      if (!cur || cost < cur.cost) {
        const a = new Map(assign);
        for (const s of picks) a.set(s.tile, s.kind);
        curve[inc] = { cost, income: inc, assign: a };
      }
    };
    record();
    while (picks.length < MAX_LEVEL && r < rest.length) {
      cost += rest[r].cost;
      picks.push(rest[r++]);
      record();
    }
  }
}

export interface Frontier {
  /** Cheapest plan for each income level that is worth having (cost rises with income). */
  plans: Plan[];
  maxIncome: number;
}

/** Per-city exact plans for every tech set and income level (seeds for the global search). */
export function cityPlans(state: GameState): Plan[] {
  const cityTiles = new Map<number, number[]>();
  state.tiles.forEach((t, i) => {
    if (t.city === null || t.improvement === 'city') return;
    if (!cityTiles.has(t.city)) cityTiles.set(t.city, []);
    cityTiles.get(t.city)!.push(i);
  });
  const cities = [...cityTiles.keys()];
  const cache = new Map<string, Curve>();

  const out: Plan[] = [];
  const bill = makeTechBiller(state);

  for (const set of candidateTechSets(state)) {
    const allowed = new Set(set);
    const curves = cities.map((c) => {
      const infos = tileInfos(state, cityTiles.get(c)!, allowed);
      const key = c + '|' + infos.map((i) => [...i.roles.entries()].map(([k, v]) => k + v.cost).join(',') + (i.destroy ? 'd' : '')).join(';');
      let cv = cache.get(key);
      if (!cv) {
        cv = cityCurve(state, infos);
        cache.set(key, cv);
      }
      return cv;
    });
    // Knapsack over cities on income.
    let dp: { cost: number; picks: (CityConfig | null)[] }[] = [{ cost: 0, picks: [] }];
    for (const cv of curves) {
      const next: typeof dp = [];
      dp.forEach((d, inc) => {
        if (!d) return;
        cv.forEach((cfg, l) => {
          if (!cfg) return;
          const v = d.cost + cfg.cost;
          const cur = next[inc + l];
          if (!cur || v < cur.cost) next[inc + l] = { cost: v, picks: [...d.picks, cfg] };
        });
      });
      dp = next;
    }
    dp.forEach((d, inc) => {
      if (d && inc > 0) out.push(toPlan(state, d.picks, set, bill));
    });
  }
  return out;
}

export function toPlan(state: GameState, picks: (CityConfig | null)[], techSet: TechKey[], bill = makeTechBiller(state)): Plan {
  const ok = (o: TileOption) => o.techs.every((k) => isOwned(state, k) || techSet.includes(k));
  const layout = currentLayout(state);
  const changes: Change[] = [];
  const st = { ...state, settings: { ...state.settings, allowNewTech: true } };
  for (const cfg of picks) {
    if (!cfg) continue;
    for (const [tile, role] of cfg.assign) {
      const opts = tileOptions(st, tile).filter(ok);
      let o: TileOption | undefined;
      if (role === null) o = opts.filter((x) => !x.build && !x.keep).sort((a, b) => a.cost - b.cost)[0];
      else {
        const cands = opts.filter((x) => x.build === role);
        o = cands.find((x) => x.keep) ?? [...cands].sort((a, b) => a.cost - b.cost || a.techs.length - b.techs.length)[0];
      }
      if (!o) continue;
      layout[tile] = o.build;
      if (!o.keep) changes.push({ tile, option: o });
    }
  }
  return finishPlan(state, layout, changes, bill);
}

export function finishPlan(state: GameState, layout: Layout, changes: Change[], bill: TechBiller = makeTechBiller(state)): Plan {
  const b = bill(changes.flatMap((c) => c.option.techs));
  const cost = changes.reduce((s, c) => s + c.option.cost, 0) + b.cost;
  return {
    changes,
    layout,
    techs: b.techs,
    income: layoutIncome(layout, state.width, state.height).total,
    cost,
    techCost: b.cost,
    techPrices: Object.fromEntries(b.price),
  };
}
