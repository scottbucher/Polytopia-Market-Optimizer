// Global layout search.
//
// 1. Seeds: the exact per-city plans from exact.ts (every tech set, every income level).
// 2. Each seed is scored on the real map, where a city's sawmill can also feed the
//    neighbouring city's market and huts can sit in either city's territory.
// 3. The best seeds are improved by hill climbing over single-tile and two-tile
//    changes (including moving a city's one-per-city building somewhere else).
// Every layout looked at is recorded, so we end with the cheapest known layout for
// each income level: the frontier the goals pick from.

import { type BuildingKind, LIMITED, MAX_LEVEL, PRODUCER_SUPPORT, type Producer, TECH_BY_KEY, type TechKey } from '../data/rules';
import { type GameState, neighbors } from '../model/types';
import { cityPlans, type Frontier, finishPlan, type Plan } from './exact';
import { isOwned, techPrice, tileOptions, type TileOption } from './options';

export type Objective = { kind: 'weighted'; w: number } | { kind: 'atleast'; income: number };

interface Ctx {
  state: GameState;
  tiles: number[]; // map tile per slot
  slotOf: Map<number, number>;
  opts: TileOption[][];
  city: number[];
  nb: number[][]; // neighbours (map tiles) per map tile
  near: number[][]; // slots within distance 2 per slot
  techPrice: Map<TechKey, number>;
}

class Search {
  choice: number[];
  layout: (BuildingKind | null)[];
  buildCost = 0;
  techCount = new Map<TechKey, number>();
  limit = new Map<string, number>(); // `${city}:${kind}` -> slot
  archive = new Map<number, { cost: number; choice: number[] }>();

  constructor(private c: Ctx, choice: number[]) {
    this.layout = new Array(c.state.tiles.length).fill(null);
    this.choice = choice.map(() => -1);
    choice.forEach((k, s) => this.set(s, k));
  }

  private set(s: number, k: number) {
    const { c } = this;
    const old = this.choice[s];
    if (old >= 0) {
      const o = c.opts[s][old];
      this.buildCost -= o.cost;
      for (const t of o.techs) this.techCount.set(t, (this.techCount.get(t) ?? 0) - 1);
      if (o.build && LIMITED.includes(o.build)) this.limit.delete(`${c.city[s]}:${o.build}`);
    }
    const o = c.opts[s][k];
    this.choice[s] = k;
    this.buildCost += o.cost;
    for (const t of o.techs) this.techCount.set(t, (this.techCount.get(t) ?? 0) + 1);
    if (o.build && LIMITED.includes(o.build)) this.limit.set(`${c.city[s]}:${o.build}`, s);
    this.layout[c.tiles[s]] = o.build;
  }

  techCost(): number {
    const need = new Set<TechKey>();
    for (const [t, n] of this.techCount) {
      if (n <= 0) continue;
      let cur: TechKey | null = t;
      while (cur && !isOwned(this.c.state, cur) && !need.has(cur)) {
        need.add(cur);
        cur = TECH_BY_KEY[cur].parent;
      }
    }
    let sum = 0;
    for (const t of need) sum += this.c.techPrice.get(t) ?? 0;
    return sum;
  }

  cost() {
    return this.buildCost + this.techCost();
  }

  income(): number {
    const { layout, c } = this;
    let total = 0;
    const lvl = new Map<number, number>();
    const level = (p: number) => {
      let v = lvl.get(p);
      if (v !== undefined) return v;
      const sup = PRODUCER_SUPPORT[layout[p] as Producer];
      v = 0;
      for (const n of c.nb[p]) {
        const b = layout[n];
        if (b && sup.includes(b)) v++;
      }
      lvl.set(p, v);
      return v;
    };
    for (const t of c.tiles) {
      if (layout[t] !== 'market') continue;
      let sum = 0;
      for (const n of c.nb[t]) {
        const b = layout[n];
        if (b === 'sawmill' || b === 'windmill' || b === 'forge') sum += level(n);
      }
      total += Math.min(MAX_LEVEL, sum);
    }
    return total;
  }

  score(obj: Objective): { v: number; inc: number; cost: number } {
    const inc = this.income();
    const cost = this.cost();
    this.record(inc, cost);
    const v = obj.kind === 'weighted' ? obj.w * inc - cost : -cost - 1000 * Math.max(0, obj.income - inc) + 0.001 * inc;
    return { v, inc, cost };
  }

  record(inc: number, cost: number) {
    const cur = this.archive.get(inc);
    if (!cur || cost < cur.cost - 1e-9) this.archive.set(inc, { cost, choice: [...this.choice] });
  }

  /** Try changing slots; returns a function that undoes the change, or null when not allowed. */
  tryMove(moves: [number, number][]): (() => void) | null {
    const { c } = this;
    const undo: [number, number][] = [];
    const doSet = (s: number, k: number) => {
      undo.push([s, this.choice[s]]);
      this.set(s, k);
    };
    const revert = () => {
      for (let i = undo.length - 1; i >= 0; i--) this.set(undo[i][0], undo[i][1]);
    };
    for (const [s, k] of moves) {
      const o = c.opts[s][k];
      if (o.build && LIMITED.includes(o.build)) {
        const other = this.limit.get(`${c.city[s]}:${o.build}`);
        if (other !== undefined && other !== s) {
          // Move the city's one-per-city building: clear the old spot.
          const blank = c.opts[other].findIndex((x) => x.build === null);
          if (blank < 0) {
            revert();
            return null;
          }
          doSet(other, blank);
        }
      }
      doSet(s, k);
    }
    return revert;
  }

  climb(obj: Objective, rng: () => number, maxSweeps = 25) {
    const { c } = this;
    let cur = this.score(obj).v;
    const n = c.tiles.length;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let improved = false;
      const order = shuffle([...Array(n).keys()], rng);
      for (const s of order) {
        for (let k = 0; k < c.opts[s].length; k++) {
          if (k === this.choice[s]) continue;
          const undo = this.tryMove([[s, k]]);
          if (!undo) continue;
          const v = this.score(obj).v;
          if (v > cur + 1e-9) {
            cur = v;
            improved = true;
          } else undo();
        }
      }
      if (improved) continue;
      // Two-tile moves: needed when neither change pays off alone (e.g. sawmill + hut).
      outer: for (const s of order) {
        for (const t of c.near[s]) {
          for (let k = 0; k < c.opts[s].length; k++) {
            if (k === this.choice[s] || !c.opts[s][k].build) continue;
            for (let l = 0; l < c.opts[t].length; l++) {
              if (l === this.choice[t] || !c.opts[t][l].build) continue;
              const undo = this.tryMove([[s, k], [t, l]]);
              if (!undo) continue;
              const v = this.score(obj).v;
              if (v > cur + 1e-9) {
                cur = v;
                improved = true;
                break outer;
              }
              undo();
            }
          }
        }
      }
      if (!improved) break;
    }
  }
}

function shuffle<T>(a: T[], rng: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCtx(state: GameState): Ctx {
  const tiles: number[] = [];
  const opts: TileOption[][] = [];
  const city: number[] = [];
  state.tiles.forEach((t, i) => {
    if (t.city === null || t.improvement === 'city') return;
    const o = tileOptions(state, i);
    if (!o.length) return;
    tiles.push(i);
    opts.push(o);
    city.push(t.city);
  });
  const slotOf = new Map(tiles.map((t, s) => [t, s]));
  const nb = state.tiles.map((_, i) => neighbors(state.width, state.height, i));
  const near = tiles.map((t) => {
    const x = t % state.width;
    const y = Math.floor(t / state.width);
    const out: number[] = [];
    tiles.forEach((u, s) => {
      if (u === t) return;
      const dx = Math.abs((u % state.width) - x);
      const dy = Math.abs(Math.floor(u / state.width) - y);
      if (dx <= 2 && dy <= 2) out.push(s);
    });
    return out;
  });
  const prices = new Map<TechKey, number>();
  for (const t of Object.keys(TECH_BY_KEY) as TechKey[]) prices.set(t, techPrice(state, t));
  return { state, tiles, slotOf, opts, city, nb, near, techPrice: prices };
}

function planToChoice(c: Ctx, plan: Plan | null): number[] {
  const choice = c.opts.map((o) => Math.max(0, o.findIndex((x) => x.keep)));
  if (!plan) return choice;
  for (const ch of plan.changes) {
    const s = c.slotOf.get(ch.tile);
    if (s === undefined) continue;
    const k = c.opts[s].findIndex((o) => o.build === ch.option.build && o.ops.join() === ch.option.ops.join());
    if (k >= 0) choice[s] = k;
  }
  return choice;
}

function choiceToPlan(c: Ctx, choice: number[]): Plan {
  const layout = c.state.tiles.map(() => null as BuildingKind | null);
  const changes: Plan['changes'] = [];
  choice.forEach((k, s) => {
    const o = c.opts[s][k];
    layout[c.tiles[s]] = o.build;
    if (!o.keep) changes.push({ tile: c.tiles[s], option: o });
  });
  return finishPlan(c.state, layout, changes);
}

export interface SearchOptions {
  objectives: Objective[];
  /** How many of the best seeds to improve per objective. */
  seeds?: number;
}

export function search(state: GameState, opts: SearchOptions): Frontier {
  const c = makeCtx(state);
  const base = planToChoice(c, null);
  const archive = new Search(c, base);
  archive.score({ kind: 'weighted', w: 1 });

  // Score every per-city exact plan on the real map.
  const seeds: number[][] = [base];
  for (const p of cityPlans(state)) {
    const ch = planToChoice(c, p);
    seeds.push(ch);
  }
  const scored = seeds.map((ch) => {
    const s = new Search(c, ch);
    const inc = s.income();
    const cost = s.cost();
    archive.record(inc, cost);
    // keep the seed's choice in the shared archive
    const cur = archive.archive.get(inc)!;
    if (cur.cost === cost) cur.choice = ch;
    return { ch, inc, cost };
  });

  const rng = mulberry(12345);
  for (const obj of opts.objectives) {
    const val = (x: { inc: number; cost: number }) =>
      obj.kind === 'weighted' ? obj.w * x.inc - x.cost : -x.cost - 1000 * Math.max(0, obj.income - x.inc);
    const best = [...scored].sort((a, b) => val(b) - val(a)).slice(0, opts.seeds ?? 3);
    if (!best.some((b) => b.ch === base)) best.push(scored[0]);
    for (const b of best) {
      const s = new Search(c, b.ch);
      s.archive = archive.archive;
      s.climb(obj, rng);
    }
  }

  // Frontier: cheapest layout per income level, keeping only levels that cost more than the level below.
  const entries = [...archive.archive.entries()].sort((a, b) => a[0] - b[0]);
  const plans: Plan[] = [];
  let lastCost = Infinity;
  for (let i = entries.length - 1; i >= 0; i--) {
    const [, e] = entries[i];
    if (e.cost >= lastCost) continue;
    lastCost = e.cost;
    plans.unshift(choiceToPlan(c, e.choice));
  }
  return { plans, maxIncome: plans.length ? plans[plans.length - 1].income : 0 };
}
