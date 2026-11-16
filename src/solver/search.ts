// Global layout search.
//
// 1. Seeds: the exact per-city plans from exact.ts (every tech set, every income level).
// 2. Each seed is scored on the real map, where a city's sawmill can also feed the
//    neighbouring city's market and huts can sit in either city's territory.
// 3. The best seeds are improved by hill climbing over single-tile and two-tile
//    changes (including moving a city's one-per-city building somewhere else).
//    Three-tile moves (market + producer + support) find layouts across a city border,
//    which the per-city search can't see.
// 4. Every layout looked at is recorded (cheapest per income level). Each is then
//    pruned of buildings that add nothing, and the best one is peeled down one
//    building at a time to fill in the cheaper income levels.
// The result is the frontier the goals pick from.

import { type BuildingKind, isProducer, LIMITED, PRODUCER_SUPPORT, PRODUCERS, type Producer, TECHS, type TechKey } from '../data/rules';
import type { GameState } from '../model/types';
import { cityPlans, type Frontier, finishPlan, type Plan } from './exact';
import { marketIncomeAt, marketsAround, neighborTable } from './income';
import { makeTechBiller, type TechBiller, tileOptions, type TileOption } from './options';

export type Objective = { kind: 'weighted'; w: number } | { kind: 'atleast'; income: number };

interface Ctx {
  state: GameState;
  tiles: number[]; // map tile per slot
  slotOf: Map<number, number>;
  opts: TileOption[][];
  city: number[];
  nb: number[][]; // neighbours (map tiles) per map tile
  adj: number[][]; // adjacent slots per slot
  bill: TechBiller;
  keepIdx: number[]; // index of the "keep" option per slot
  markets: number[]; // map tiles that can hold a market
  border: number[]; // slots next to another city's slot
  around: number[][]; // per slot: market-capable tiles within 2 (their income can change)
  optTech: number[][][]; // per slot, per option: tech indexes in TECHS
  limKey: number[][]; // per slot, per option: city × kind key for one-per-city buildings, else -1
}

class Search {
  choice: number[];
  layout: (BuildingKind | null)[];
  buildCost = 0;
  /** How many chosen options need each tech (by index in TECHS). */
  techCount: Int32Array;
  /** One-per-city buildings: limKey (city × kind) -> slot holding it. */
  limit = new Map<number, number>();
  archive = new Map<number, { cost: number; choice: number[] }>();
  /** Market income, kept up to date as tiles change: total and per market tile. */
  private inc = 0;
  private mInc: number[];
  private get = (i: number) => this.layout[i];

  constructor(private c: Ctx, choice: number[]) {
    this.layout = new Array(c.state.tiles.length).fill(null);
    this.mInc = new Array(c.state.tiles.length).fill(0);
    this.techCount = new Int32Array(TECHS.length);
    this.choice = choice.map(() => -1);
    choice.forEach((k, s) => this.set(s, k));
  }

  private set(s: number, k: number) {
    const { c } = this;
    const old = this.choice[s];
    if (old >= 0) {
      const o = c.opts[s][old];
      this.buildCost -= o.cost;
      for (const t of c.optTech[s][old]) if (--this.techCount[t] === 0) this.techCache.dirty = true;
      const lk = c.limKey[s][old];
      if (lk >= 0 && this.limit.get(lk) === s) this.limit.delete(lk);
    }
    const o = c.opts[s][k];
    this.choice[s] = k;
    this.buildCost += o.cost;
    for (const t of c.optTech[s][k]) if (++this.techCount[t] === 1) this.techCache.dirty = true;
    const lk = c.limKey[s][k];
    if (lk >= 0) this.limit.set(lk, s);
    const x = c.tiles[s];
    if (this.layout[x] === o.build) return;
    this.layout[x] = o.build;
    for (const m of c.around[s]) {
      const isMarket = this.layout[m] === 'market';
      if (!isMarket && this.mInc[m] === 0) continue;
      const v = isMarket ? marketIncomeAt(this.get, c.nb, m) : 0;
      this.inc += v - this.mInc[m];
      this.mInc[m] = v;
    }
  }

  private techCache = { dirty: true, cost: 0 };

  techCost(): number {
    if (!this.techCache.dirty) return this.techCache.cost;
    const need: TechKey[] = [];
    this.techCount.forEach((n, t) => {
      if (n > 0) need.push(TECHS[t].key);
    });
    this.techCache = { dirty: false, cost: this.c.bill(need).cost };
    return this.techCache.cost;
  }

  cost() {
    return this.buildCost + this.techCost();
  }

  income(): number {
    return this.inc;
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
      if (c.limKey[s][k] >= 0) {
        const other = this.limit.get(c.limKey[s][k]);
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

  /** Hill-climb. With `region`, only those slots move and the costlier global moves are skipped. */
  climb(obj: Objective, rng: () => number, maxSweeps = 25, region?: number[]) {
    const { c } = this;
    let cur = this.score(obj).v;
    const n = c.tiles.length;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let improved = false;
      const order = shuffle(region ? [...region] : [...Array(n).keys()], rng);
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
      // Two-tile moves: needed when neither change pays off alone (sawmill + hut, market +
      // sawmill). One of the two is always a market or producer.
      outer: for (const s of order) {
        for (const t of c.adj[s]) {
          for (let k = 0; k < c.opts[s].length; k++) {
            const bk = c.opts[s][k].build;
            if (k === this.choice[s] || !(bk === 'market' || isProducer(bk))) continue;
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
      if (improved) continue;
      if (region) break;
      if (this.tripleMoves(obj, cur) || this.routeSwaps(obj, cur)) {
        cur = this.score(obj).v;
        continue;
      }
      break;
    }
  }

  /**
   * Market + producer + support placed together where they straddle a city border
   * (inside one city the exact search already covers this). Applies the first move
   * that improves the objective.
   */
  private tripleMoves(obj: Objective, cur: number): boolean {
    const { c } = this;
    // The producer sits in the middle, so it must touch another city's tile.
    for (const t of c.border) {
      for (let kt = 0; kt < c.opts[t].length; kt++) {
        const pt = c.opts[t][kt].build;
        if (!isProducer(pt) || kt === this.choice[t]) continue;
        for (const s of c.adj[t]) {
          const ks = c.opts[s].findIndex((o) => o.build === 'market' && !o.keep);
          if (ks < 0 || this.layout[c.tiles[s]] === 'market') continue;
          for (const u of c.adj[t]) {
            if (u === s || (c.city[s] === c.city[t] && c.city[t] === c.city[u])) continue;
            for (let ku = 0; ku < c.opts[u].length; ku++) {
              const bu = c.opts[u][ku].build;
              if (!bu || ku === this.choice[u] || !PRODUCER_SUPPORT[pt].includes(bu)) continue;
              const undo = this.tryMove([[s, ks], [t, kt], [u, ku]]);
              if (!undo) continue;
              if (this.score(obj).v > cur + 1e-9) return true;
              undo();
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Switch a group of nearby producers to another kind (say sawmills to windmills)
   * together with their support buildings, then fill every free spot next to them
   * with the new support. Finds route changes that only pay off all at once, like two
   * cities' markets sharing two windmills.
   */
  private routeSwaps(obj: Objective, cur: number): boolean {
    const { c } = this;
    const W = c.state.width;
    const close = (a: number, b: number) => Math.abs((a % W) - (b % W)) <= 2 && Math.abs(Math.floor(a / W) - Math.floor(b / W)) <= 2;
    const prodSlots = c.tiles.map((_, s) => s).filter((s) => isProducer(this.layout[c.tiles[s]]));
    const tried = new Set<string>();
    for (const t of prodSlots) {
      const from = this.layout[c.tiles[t]] as Producer;
      // Producers of the same kind linked by distance <= 2.
      const group = [t];
      for (let i = 0; i < group.length; i++)
        for (const v of prodSlots) if (!group.includes(v) && this.layout[c.tiles[v]] === from && close(c.tiles[group[i]], c.tiles[v])) group.push(v);
      for (const to of PRODUCERS) {
        if (to === from) continue;
        const key = [...group].sort().join() + to;
        if (tried.has(key)) continue;
        tried.add(key);
        const moves: [number, number][] = [];
        const set = new Map<number, number>();
        const cheapest = (s: number, kinds: readonly BuildingKind[]) => {
          let best = -1;
          c.opts[s].forEach((o, k) => {
            if (o.build && kinds.includes(o.build) && (best < 0 || o.cost < c.opts[s][best].cost)) best = k;
          });
          return best;
        };
        for (const v of group) {
          const k = cheapest(v, [to]);
          if (k >= 0) set.set(v, k);
        }
        if (!set.size) continue;
        const fromSup = PRODUCER_SUPPORT[from];
        const toSup = PRODUCER_SUPPORT[to];
        for (const v of set.keys())
          for (const u of c.adj[v]) {
            if (set.has(u)) continue;
            const b = this.layout[c.tiles[u]];
            if (b && !fromSup.includes(b)) continue;
            const k = cheapest(u, toSup);
            if (k >= 0) set.set(u, k);
          }
        for (const [sl, k] of set) moves.push([sl, k]);
        const undo = this.tryMove(moves);
        if (!undo) continue;
        if (this.score(obj).v > cur + 1e-9) return true;
        undo();
      }
    }
    return false;
  }

  /** Changes that can be undone one tile at a time (back to how the tile is now). */
  private changed(): number[] {
    const out: number[] = [];
    this.choice.forEach((k, s) => {
      if (k !== this.c.keepIdx[s]) out.push(s);
    });
    return out;
  }

  /** Undo changes that don't pay: same or more income for fewer stars. */
  prune() {
    let inc = this.income();
    let cost = this.cost();
    for (let pass = 0; pass < 10; pass++) {
      let any = false;
      for (const s of this.changed()) {
        // Back to how the tile is now, or (for a tile with a building) just emptied.
        const alts = [this.c.keepIdx[s]];
        const blank = this.c.opts[s].findIndex((o, k) => o.build === null && k !== this.choice[s]);
        if (blank >= 0 && blank !== alts[0] && this.c.opts[s][this.choice[s]].build !== null) alts.push(blank);
        for (const k of alts) {
          const undo = this.tryMove([[s, k]]);
          if (!undo) continue;
          const i2 = this.income();
          const c2 = this.cost();
          this.record(i2, c2);
          if (i2 >= inc && c2 <= cost) {
            inc = i2;
            cost = c2;
            any = true;
            break;
          } else undo();
        }
      }
      if (!any) break;
    }
  }

  /**
   * A market needs a producer next to it, and a producer its support building, or the game
   * won't let you build it. Pruning keeps such a building when it pays (a refund bigger
   * than its price), so remove those here.
   */
  dropUnbuildable() {
    const { c } = this;
    for (let guard = 0; guard < c.tiles.length; guard++) {
      let fixed = false;
      for (const s of this.changed()) {
        const o = c.opts[s][this.choice[s]];
        const b = o.build;
        const need = b === 'market' ? (PRODUCERS as readonly BuildingKind[]) : isProducer(b) ? PRODUCER_SUPPORT[b] : null;
        if (!need || c.nb[c.tiles[s]].some((n) => need.includes(this.layout[n] as BuildingKind))) continue;
        const blank = c.opts[s].findIndex((x) => x.build === null);
        const k = blank >= 0 ? blank : c.keepIdx[s];
        if (this.tryMove([[s, k]])) fixed = true;
      }
      if (!fixed) break;
    }
  }

  /**
   * Walk down from this layout to nothing, each time undoing the change that loses
   * the least income per star saved, and record every layout on the way.
   */
  peel() {
    this.prune();
    for (let guard = 0; guard < 2000; guard++) {
      const inc = this.income();
      const cost = this.cost();
      let best: { s: number; ratio: number } | null = null;
      for (const s of this.changed()) {
        const undo = this.tryMove([[s, this.c.keepIdx[s]]]);
        if (!undo) continue;
        const i2 = this.income();
        const c2 = this.cost();
        this.record(i2, c2);
        undo();
        const saved = cost - c2;
        if (saved <= 0 && i2 < inc) continue;
        const ratio = (inc - i2) / Math.max(saved, 1e-6);
        if (!best || ratio < best.ratio) best = { s, ratio };
      }
      if (!best) break;
      this.tryMove([[best.s, this.c.keepIdx[best.s]]]);
      this.prune();
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
    const o = undominated(state, tileOptions(state, i));
    if (!o.length) return;
    tiles.push(i);
    opts.push(o);
    city.push(t.city);
  });
  const slotOf = new Map(tiles.map((t, s) => [t, s]));
  const nb = neighborTable(state.width, state.height);
  const adj = tiles.map((t) => nb[t].map((n) => slotOf.get(n)).filter((x): x is number => x !== undefined));
  const keepIdx = opts.map((o) => Math.max(0, o.findIndex((x) => x.keep)));
  const markets = tiles.filter((_, s) => opts[s].some((o) => o.build === 'market'));
  const border = tiles.map((_, s) => s).filter((s) => adj[s].some((u) => city[u] !== city[s]));
  const mset = new Set(markets);
  const around = tiles.map((t) => [...marketsAround(nb, [t])].filter((m) => mset.has(m)));
  const techIdx = new Map(TECHS.map((t, i) => [t.key, i]));
  const optTech = opts.map((l) => l.map((o) => o.techs.map((t) => techIdx.get(t)!)));
  const limKey = opts.map((l, s) => l.map((o) => (o.build && LIMITED.includes(o.build) ? city[s] * 16 + LIMITED.indexOf(o.build) : -1)));
  return { state, tiles, slotOf, opts, city, nb, adj, bill: makeTechBiller(state), keepIdx, markets, border, around, optTech, limKey };
}

/**
 * Drops options another option on the same tile beats outright: same building, no
 * more stars, and no unowned tech the other doesn't also need.
 */
export function undominated(state: GameState, opts: TileOption[]): TileOption[] {
  const owned = new Set(state.settings.owned);
  const un = opts.map((o) => o.techs.filter((t) => !owned.has(t)));
  const beats = (j: number, i: number) => {
    const a = opts[j];
    const b = opts[i];
    if (a.build !== b.build || a.cost > b.cost || !un[j].every((t) => un[i].includes(t))) return false;
    // strictly better, or an exact tie broken by position (keep the first)
    return a.cost < b.cost || un[j].length < un[i].length || a.keep || (!b.keep && j < i);
  };
  return opts.filter((_, i) => !opts.some((_, j) => j !== i && beats(j, i)));
}

/** How far around a kick the follow-up climb may change tiles. */
const KICK_RADIUS = 3;

function planToChoice(c: Ctx, plan: Plan | null): number[] {
  const choice = [...c.keepIdx];
  if (!plan) return choice;
  for (const ch of plan.changes) {
    const s = c.slotOf.get(ch.tile);
    if (s === undefined) continue;
    let k = c.opts[s].findIndex((o) => o.build === ch.option.build && o.ops.join() === ch.option.ops.join());
    if (k < 0) {
      // That exact option was dropped as dominated: take the cheapest with the same result.
      const same = c.opts[s].map((o, i) => ({ o, i })).filter((x) => x.o.build === ch.option.build && !x.o.keep);
      same.sort((a, b) => a.o.cost - b.o.cost);
      k = same[0]?.i ?? -1;
    }
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
  return finishPlan(c.state, layout, changes, c.bill);
}

export interface SearchOptions {
  objectives: Objective[];
  /** How many of the best seeds to improve per objective. */
  seeds?: number;
  /** How many more tech families (best seed of each) to improve per objective. */
  families?: number;
  /** Random restarts around the richest layout (see search()). */
  kicks?: number;
}

export function search(state: GameState, opts: SearchOptions): Frontier {
  const c = makeCtx(state);
  const base = planToChoice(c, null);
  const archive = new Search(c, base);
  archive.score({ kind: 'weighted', w: 1 });

  // Score every per-city exact plan on the real map.
  // Seeds come in families: the set of techs they use (e.g. the sawmill route or the windmill route).
  const seeds: { ch: number[]; fam: string }[] = [{ ch: base, fam: '' }];
  for (const p of cityPlans(state)) seeds.push({ ch: planToChoice(c, p), fam: p.techs.join() });
  const scored = seeds.map(({ ch, fam }) => {
    const s = new Search(c, ch);
    const inc = s.income();
    const cost = s.cost();
    archive.record(inc, cost);
    // keep the seed's choice in the shared archive
    const cur = archive.archive.get(inc)!;
    if (cur.cost === cost) cur.choice = ch;
    return { ch, fam, inc, cost };
  });

  const rng = mulberry(12345);
  const climbed: { s: Search; fam: string }[] = [];
  opts.objectives.forEach((obj, oi) => {
    const val = (x: { inc: number; cost: number }) =>
      obj.kind === 'weighted' ? obj.w * x.inc - x.cost : -x.cost - 1000 * Math.max(0, obj.income - x.inc);
    const ranked = [...scored].sort((a, b) => val(b) - val(a));
    const best = ranked.slice(0, opts.seeds ?? 3);
    // Also the best seed of the next few families, so other tech routes get improved too.
    const fams = new Set(best.map((b) => b.fam));
    for (const r of ranked) {
      // (Only for the first objective, to keep the run time down.)
      if (oi > 0 || fams.size >= (opts.seeds ?? 3) + (opts.families ?? 4)) break;
      if (fams.has(r.fam)) continue;
      fams.add(r.fam);
      best.push(r);
    }
    if (!best.some((b) => b.ch === base)) best.push(scored[0]);
    for (const b of best) {
      const s = new Search(c, b.ch);
      s.archive = archive.archive;
      s.climb(obj, rng);
      climbed.push({ s, fam: b.fam });
    }
  });

  // Kicks (iterated local search) on the richest layout: scramble a tile and its
  // neighbours, climb again, keep it if richer. Finds layouts that need several
  // buildings moved at once, which single climbs miss.
  const maxObj: Objective = { kind: 'weighted', w: 1000 };
  let champ = climbed.reduce<Search | null>((b, x) => (!b || x.s.score(maxObj).v > b.score(maxObj).v ? x.s : b), null);
  if (champ && c.tiles.length) {
    for (let it = 0; it < (opts.kicks ?? 24); it++) {
      const s = new Search(c, champ.choice);
      s.archive = archive.archive;
      const center = Math.floor(rng() * c.tiles.length);
      const kicked = [center, ...c.adj[center]];
      let region = kicked;
      for (let r = 0; r < KICK_RADIUS; r++) region = [...new Set(region.flatMap((t) => [t, ...c.adj[t]]))];
      if (!s.tryMove(kicked.map((t) => [t, Math.floor(rng() * c.opts[t].length)]))) continue;
      s.climb(maxObj, rng, 10, region);
      if (s.score(maxObj).v > champ.score(maxObj).v + 1e-9) champ = s;
    }
    if (!climbed.some((x) => x.s === champ)) climbed.push({ s: champ, fam: '#kick' });
  }

  // Clean up: prune every recorded layout, then peel the richest layout of each family
  // down one building at a time so the middle income levels get real candidates too.
  for (const [, e] of [...archive.archive.entries()]) {
    const s = new Search(c, e.choice);
    s.archive = archive.archive;
    s.prune();
  }
  const richest = new Map<string, Search>();
  for (const { s, fam } of climbed) {
    const cur = richest.get(fam);
    if (!cur || s.income() > cur.income()) richest.set(fam, s);
  }
  const top = [...archive.archive.entries()].sort((a, b) => b[0] - a[0])[0];
  if (top) richest.set('#top', new Search(c, top[1].choice));
  for (const s of richest.values()) {
    s.archive = archive.archive;
    s.peel();
  }

  // Final prune of every candidate: prune() and peel() record half-pruned layouts on the way,
  // which can still hold buildings that add nothing.
  const finals: typeof archive.archive = new Map();
  for (const [, e] of archive.archive) {
    const s = new Search(c, e.choice);
    s.prune();
    s.dropUnbuildable();
    const inc = s.income();
    const cost = s.cost();
    const cur = finals.get(inc);
    if (!cur || cost < cur.cost - 1e-9) finals.set(inc, { cost, choice: [...s.choice] });
  }
  archive.archive = finals;

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
