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
// `refine()` in refine.ts looks for those cross-border bonuses afterwards.

import {
  type BuildingKind,
  PRODUCER_SUPPORT,
  PRODUCERS,
  type Producer,
  TECH_BY_KEY,
  type TechKey,
  MAX_LEVEL,
} from '../data/rules';
import { type GameState, neighbors } from '../model/types';
import { income as layoutIncome, type Layout } from './income';
import { isOwned, techPrice, tileOptions, type TileOption } from './options';

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
}

const BUILDINGS: BuildingKind[] = ['market', 'sawmill', 'windmill', 'forge', 'lumberhut', 'farm', 'mine', 'aquafarm'];

export function isBuildingKind(v: string): v is BuildingKind {
  return (BUILDINGS as string[]).includes(v);
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

/** Sets of techs worth trying to buy. Each set is closed under prerequisites. */
export function candidateTechSets(state: GameState): TechKey[][] {
  const s = state.settings;
  const closure = (keys: TechKey[]) => {
    const out = new Set<TechKey>();
    for (const k of keys) {
      let cur: TechKey | null = k;
      while (cur && !isOwned(state, cur)) {
        out.add(cur);
        cur = TECH_BY_KEY[cur].parent;
      }
    }
    return out;
  };
  if (!s.allowNewTech) return [[]];
  const used = new Set<TechKey>();
  state.tiles.forEach((t, i) => {
    if (t.city === null) return;
    for (const o of tileOptions({ ...state, settings: { ...s, allowNewTech: true } }, i)) for (const k of o.techs) used.add(k);
  });
  const toggles: TechKey[][] = [];
  const opt = (...k: TechKey[]) => {
    const missing = k.filter((x) => used.has(x) && !isOwned(state, x));
    if (missing.length) toggles.push(missing);
  };
  opt('mathematics');
  opt('construction');
  opt('smithery');
  opt('forestry'); // clearing forest / huts without Mathematics
  opt('spiritualism');
  opt('chivalry');
  opt('ramming');
  const base: TechKey[] = isOwned(state, 'trade') ? [] : ['trade'];
  const seen = new Map<string, TechKey[]>();
  seen.set('', []);
  const n = toggles.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const keys = [...base];
    toggles.forEach((t, b) => {
      if (mask & (1 << b)) keys.push(...t);
    });
    const set = [...closure(keys)].sort();
    seen.set(set.join(','), set);
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
  const exProd: Record<Producer, number[]> = {
    sawmill: existingOf('sawmill'),
    windmill: existingOf('windmill'),
    forge: existingOf('forge'),
  };

  const marketTiles: (number | null)[] =
    exMarket.length && !canDestroy ? [exMarket[0]] : infos.filter((i) => i.roles.has('market')).map((i) => i.tile);

  for (const m of marketTiles) {
    if (m === null) continue;
    const mInfo = byTile.get(m)!;
    const nbM = neighbors(width, height, m);
    const choices: (number | null)[][] = PRODUCERS.map((p) => {
      if (exProd[p].length && !canDestroy) return [exProd[p][0]];
      const c: (number | null)[] = [null];
      for (const n of nbM) if (byTile.get(n)?.roles.has(p)) c.push(n);
      return c;
    });

    for (const ps of choices[0]) {
      for (const pw of choices[1]) {
        if (pw !== null && pw === ps) continue;
        for (const pf of choices[2]) {
          if (pf !== null && (pf === ps || pf === pw)) continue;
          const prodTiles: (number | null)[] = [ps, pw, pf];
          if (prodTiles.includes(m)) continue;
          evalConfig(m, mInfo, prodTiles);
        }
      }
    }
  }
  return curve;

  function evalConfig(m: number, mInfo: TileInfo, prodTiles: (number | null)[]) {
    const assign = new Map<number, BuildingKind | null>();
    let base = mInfo.roles.get('market')!.cost;
    assign.set(m, 'market');
    const used = new Set<number>([m]);
    const active: { tile: number; p: Producer }[] = [];
    for (let k = 0; k < 3; k++) {
      const t = prodTiles[k];
      if (t === null) continue;
      const p = PRODUCERS[k];
      const r = byTile.get(t)!.roles.get(p);
      if (!r) return;
      base += r.cost;
      assign.set(t, p);
      used.add(t);
      if (neighbors(width, height, m).includes(t)) active.push({ tile: t, p });
    }
    if (!active.length) return;
    // Existing limited buildings that are displaced must be destroyed.
    const displaced = [...infos.filter((i) => (i.existing === 'market' || (PRODUCERS as readonly string[]).includes(i.existing ?? '')) && !used.has(i.tile))];
    for (const d of displaced) {
      if (d.existing === 'market' || prodTiles[PRODUCERS.indexOf(d.existing as Producer)] !== null) {
        if (!d.destroy) return;
        base += d.destroy.cost;
        assign.set(d.tile, null);
        used.add(d.tile);
      }
    }

    // Support slots: tile -> cheapest way to support one of the active producers.
    interface Slot { tile: number; cost: number; kind: BuildingKind; prod: number }
    const best = new Map<number, Slot>();
    const perProd: Slot[][] = active.map(() => []);
    active.forEach((a, ai) => {
      for (const s of neighbors(width, height, a.tile)) {
        if (used.has(s)) continue;
        const info = byTile.get(s);
        if (!info) continue;
        for (const kind of PRODUCER_SUPPORT[a.p]) {
          const r = info.roles.get(kind);
          if (!r) continue;
          const slot = { tile: s, cost: r.cost, kind, prod: ai };
          perProd[ai].push(slot);
          const cur = best.get(s);
          if (!cur || slot.cost < cur.cost) best.set(s, slot);
        }
      }
    });
    if (perProd.some((l) => !l.length)) return;

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

  for (const set of candidateTechSets(state)) {
    const allowed = new Set(set);
    const techCost = set.reduce((s, k) => s + techPrice(state, k), 0);
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
      if (d && inc > 0) out.push(toPlan(state, d.picks, set));
    });
  }
  return out;
}

export function toPlan(state: GameState, picks: (CityConfig | null)[], techSet: TechKey[]): Plan {
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
  return finishPlan(state, layout, changes);
}

export function finishPlan(state: GameState, layout: Layout, changes: Change[]): Plan {
  const needed = new Set<TechKey>();
  for (const c of changes)
    for (const t of c.option.techs) {
      let cur: TechKey | null = t;
      while (cur && !isOwned(state, cur)) {
        needed.add(cur);
        cur = TECH_BY_KEY[cur].parent;
      }
    }
  const techs = [...needed].sort((a, b) => TECH_BY_KEY[a].tier - TECH_BY_KEY[b].tier);
  const techCost = techs.reduce((s, t) => s + techPrice(state, t), 0);
  const cost = changes.reduce((s, c) => s + c.option.cost, 0) + techCost;
  return { changes, layout, techs, income: layoutIncome(layout, state.width, state.height).total, cost, techCost };
}
