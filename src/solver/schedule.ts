// Turns a plan into a build order (the TODO list) and simulates it turn by turn.
//
// Order: greedy "best payback first". At each step we look at every remaining
// action together with whatever it needs first (techs, clearing the forest, the
// support building a sawmill needs next to it, tearing down the city's old market
// before building the new one, ...), grow that bundle while adding nearby actions
// improves stars-per-turn gained per star spent, and take the best bundle.
// Expensive techs get shared by everything they unlock this way.
//
// Bundles are cached and only re-evaluated when something near them (or a tech) is
// committed, and income changes are worked out only around the tiles involved, so
// this stays fast on big maps.

import { BUILD_TECH, type BuildingKind, isProducer, LIMITED, LITERACY_TECH, OP_TECH, opCost, PRODUCER_SUPPORT, PRODUCERS, TECH_BY_KEY, type TechKey } from '../data/rules';
import type { GameState } from '../model/types';
import { currentLayout, type Plan } from './exact';
import { income, type Layout, type LayoutGet, marketIncomeAt, neighborTable, radius2Table } from './income';
import { missingChain, type Op, techPrice } from './options';

export type Action =
  | { id: number; kind: 'tech'; tech: TechKey; cost: number }
  | { id: number; kind: 'op'; op: Op; tile: number; cost: number }
  | { id: number; kind: 'build'; build: BuildingKind; tile: number; cost: number };

export interface Step {
  action: Action;
  turn: number;
  starsBefore: number;
  starsAfter: number;
  /** Market income per turn once this step is done. */
  incomeAfter: number;
  /** Which bundle (group of steps that pays off together) this belongs to. */
  group: number;
}

export interface Schedule {
  steps: Step[];
  /** turn -> stars at the start of that turn, after collecting income */
  starsAtTurn: number[];
  /** turn -> market income per turn at the start of that turn (turn 0 = the markets you have now) */
  incomeAtTurn: number[];
  /** Turn on which the last step is done. */
  doneTurn: number;
  finalIncome: number;
  /** Steps that were never affordable within the simulated turns. */
  unaffordable: number;
}

export interface Order {
  bundles: Action[][];
  /** Plan actions that could not be placed in a valid order (should not happen). */
  skipped: Action[];
}

export function planActions(state: GameState, plan: Plan): Action[] {
  const c = state.settings.costs;
  const acts: Action[] = [];
  let id = 0;
  for (const t of plan.techs) acts.push({ id: id++, kind: 'tech', tech: t, cost: plan.techPrices?.[t] ?? techPrice(state, t) });
  for (const ch of plan.changes) {
    for (const op of ch.option.ops) acts.push({ id: id++, kind: 'op', op, tile: ch.tile, cost: opCost(op, c) });
    if (ch.option.build) acts.push({ id: id++, kind: 'build', build: ch.option.build, tile: ch.tile, cost: c[ch.option.build] });
  }
  return acts;
}

function techOf(a: Action): TechKey | null {
  if (a.kind === 'tech') return TECH_BY_KEY[a.tech].parent;
  if (a.kind === 'op') return OP_TECH[a.op];
  return BUILD_TECH[a.build];
}

function apply(layout: Layout, a: Action) {
  if (a.kind === 'op' && a.op === 'destroy') layout[a.tile] = null;
  if (a.kind === 'build') layout[a.tile] = a.build;
}

/** What each build needs next to it when it is built. */
function adjacencyNeed(b: BuildingKind): readonly BuildingKind[] | null {
  if (b === 'market') return PRODUCERS;
  if (isProducer(b)) return PRODUCER_SUPPORT[b];
  return null;
}

/** How many tech-sharing actions a bundle may pull in at each growth step. */
const TECH_POOL = 12;

const tilesOf = (b: Action[]) => b.filter((x) => x.kind !== 'tech').map((x) => (x as { tile: number }).tile);

/** Build order: list of bundles, each a list of actions in a valid order. */
export function orderActions(state: GameState, plan: Plan): Order {
  const acts = planActions(state, plan);
  const W = state.width;
  const nb = neighborTable(W, state.height);
  const layout = currentLayout(state);
  const owned = new Set<TechKey>(state.settings.owned);
  const done = new Set<number>();

  // ---- fixed dependencies ----
  const techAct = new Map<TechKey, Action>();
  for (const a of acts) if (a.kind === 'tech') techAct.set(a.tech, a);
  const literacy = techAct.get(LITERACY_TECH);
  const literacyChain = new Set(literacy ? missingChain(state, LITERACY_TECH) : []);
  const byTile = new Map<number, Action[]>();
  for (const a of acts) {
    if (a.kind === 'tech') continue;
    if (!byTile.has(a.tile)) byTile.set(a.tile, []);
    byTile.get(a.tile)!.push(a);
  }
  const buildsAt = (t: number) => (byTile.get(t) ?? []).filter((a) => a.kind === 'build') as Extract<Action, { kind: 'build' }>[];
  const cityOf = (t: number) => state.tiles[t].city;
  // Destroying the city's old one-per-city building, by `${city}:${kind}`.
  const oldLimited = new Map<string, Extract<Action, { kind: 'op' }>[]>();
  for (const a of acts) {
    if (a.kind !== 'op' || a.op !== 'destroy') continue;
    const was = layout[a.tile];
    if (!was || !LIMITED.includes(was)) continue;
    const key = `${cityOf(a.tile)}:${was}`;
    if (!oldLimited.has(key)) oldLimited.set(key, []);
    oldLimited.get(key)!.push(a);
  }
  const fixedDeps = new Map<number, Action[] | null>();
  for (const a of acts) {
    const deps: Action[] = [];
    let ok = true;
    const t = techOf(a);
    if (t && !owned.has(t)) {
      const ta = techAct.get(t);
      if (ta) deps.push(ta);
      else ok = false;
    }
    if (a.kind === 'tech' && literacy && a !== literacy && !literacyChain.has(a.tech)) deps.push(literacy);
    if (a.kind !== 'tech') {
      const prev = byTile.get(a.tile)!.filter((x) => x.id < a.id);
      if (prev.length) deps.push(prev[prev.length - 1]);
      if (a.kind === 'build' && LIMITED.includes(a.build)) deps.push(...(oldLimited.get(`${cityOf(a.tile)}:${a.build}`) ?? []).filter((d) => d.tile !== a.tile));
    }
    fixedDeps.set(a.id, ok ? deps : null);
  }

  // ---- closure: an action plus everything it needs that isn't done yet ----
  interface Draft {
    list: Action[];
    ids: Set<number>;
    over: Map<number, BuildingKind | null>;
  }
  const getter = (d: Draft): LayoutGet => (i) => (d.over.has(i) ? d.over.get(i)! : layout[i]);
  const add = (d: Draft, x: Action) => {
    d.ids.add(x.id);
    d.list.push(x);
    if (x.kind === 'op' && x.op === 'destroy') d.over.set(x.tile, null);
    if (x.kind === 'build') d.over.set(x.tile, x.build);
  };
  const copy = (d: Draft): Draft => ({ list: [...d.list], ids: new Set(d.ids), over: new Map(d.over) });

  /** Adds `a` and what it needs to the draft. Returns false (draft unusable) if impossible. */
  const need = (d: Draft, a: Action, depth = 0): boolean => {
    if (done.has(a.id) || d.ids.has(a.id)) return true;
    if (depth > 24) return false;
    const deps = fixedDeps.get(a.id);
    if (!deps) return false;
    for (const x of deps) if (!need(d, x, depth + 1)) return false;
    if (a.kind === 'build') {
      const wants = adjacencyNeed(a.build);
      if (wants) {
        const get = getter(d);
        if (!nb[a.tile].some((n) => wants.includes(get(n) as BuildingKind))) {
          // Cheapest planned neighbour that satisfies it.
          let best: Draft | null = null;
          let bestCost = Infinity;
          for (const n of nb[a.tile]) {
            for (const y of buildsAt(n)) {
              if (!wants.includes(y.build) || done.has(y.id) || d.ids.has(y.id)) continue;
              const trial = copy(d);
              if (!need(trial, y, depth + 1)) continue;
              const cost = trial.list.slice(d.list.length).reduce((s, z) => s + z.cost, 0);
              if (cost < bestCost) {
                bestCost = cost;
                best = trial;
              }
            }
          }
          if (!best) return false;
          d.list = best.list;
          d.ids = best.ids;
          d.over = best.over;
        }
      }
    }
    add(d, a);
    return true;
  };

  // Income of each market as things stand, updated on every commit.
  const r2 = radius2Table(nb);
  const getNow: LayoutGet = (i) => layout[i];
  const incNow = layout.map((b, i) => (b === 'market' ? marketIncomeAt(getNow, nb, i) : 0));
  const stamp = new Int32Array(layout.length);
  let gen = 0;

  const evaluate = (d: Draft) => {
    // Only markets within 2 tiles of a changed tile can change.
    gen++;
    const get = getter(d);
    let gain = 0;
    for (const t of tilesOf(d.list))
      for (const m of r2[t]) {
        if (stamp[m] === gen) continue;
        stamp[m] = gen;
        if (get(m) === 'market') gain += marketIncomeAt(get, nb, m);
        gain -= incNow[m];
      }
    const cost = d.list.reduce((s, a) => s + a.cost, 0);
    // Free (or refunding) steps that don't lose income go first.
    const score = cost <= 0 ? (gain >= 0 ? 1e9 + gain - cost : -1) : gain / cost;
    return { gain, cost, score };
  };

  // Actions that could join a bundle: builds and ops within 2 tiles, or ones needing a tech in it.
  const nonTech = acts.filter((a) => a.kind !== 'tech');
  const byTech = new Map<TechKey, Action[]>();
  // (Only markets and producers: their support buildings come along with them.)
  for (const a of nonTech) {
    if (a.kind !== 'build' || !adjacencyNeed(a.build)) continue;
    const t = techOf(a);
    if (!t) continue;
    if (!byTech.has(t)) byTech.set(t, []);
    byTech.get(t)!.push(a);
  }

  interface Cand {
    d: Draft;
    gain: number;
    cost: number;
    score: number;
    tiles: number[];
  }

  const bundleFor = (a: Action): Cand | null => {
    let d: Draft = { list: [], ids: new Set(), over: new Map() };
    if (!need(d, a)) return null;
    let e = evaluate(d);
    for (let g = 0; g < 8 && e.score < 1e9; g++) {
      gen++;
      const pool = new Set<Action>();
      for (const t of tilesOf(d.list))
        for (const m of r2[t]) {
          if (stamp[m] === gen) continue;
          stamp[m] = gen;
          for (const x of byTile.get(m) ?? []) pool.add(x);
        }
      // Actions that share an unbought tech with the bundle: only the nearest few, which
      // keeps this linear on big maps (the far ones get their turn in their own bundle).
      const tiles = tilesOf(d.list);
      const dist = (t: number) => {
        let best = Infinity;
        for (const u of tiles) best = Math.min(best, Math.max(Math.abs((t % W) - (u % W)), Math.abs(Math.floor(t / W) - Math.floor(u / W))));
        return best;
      };
      for (const x of d.list) {
        if (x.kind !== 'tech' || owned.has(x.tech)) continue;
        const sharing = (byTech.get(x.tech) ?? []).filter((y) => !done.has(y.id) && !d.ids.has(y.id));
        const near = sharing.length <= TECH_POOL ? sharing : sharing.map((y) => [dist((y as { tile: number }).tile), y] as const).sort((a, b) => a[0] - b[0]).slice(0, TECH_POOL).map((z) => z[1]);
        for (const y of near) pool.add(y);
      }
      let improved: { d: Draft; e: ReturnType<typeof evaluate> } | null = null;
      for (const c of pool) {
        if (done.has(c.id) || d.ids.has(c.id)) continue;
        const trial = copy(d);
        if (!need(trial, c)) continue;
        const te = evaluate(trial);
        if (te.score > (improved?.e.score ?? e.score) + 1e-9) improved = { d: trial, e: te };
      }
      if (!improved) break;
      d = improved.d;
      e = improved.e;
    }
    return { d, ...e, tiles: tilesOf(d.list) };
  };

  const commit = (a: Action) => {
    done.add(a.id);
    apply(layout, a);
    if (a.kind === 'tech') owned.add(a.tech);
    else for (const m of r2[a.tile]) incNow[m] = layout[m] === 'market' ? marketIncomeAt(getNow, nb, m) : 0;
  };

  /**
   * The chosen bundle pays off as a whole, but its steps can still be done in a better
   * order: repeatedly take the piece (an action plus what it needs, all from the bundle)
   * with the best payback, so income starts as early as possible. Commits everything.
   */
  const splitBundle = (b: Draft): Action[][] => {
    const out: Action[][] = [];
    for (let guard = 0; guard < b.list.length + 1; guard++) {
      const left = b.list.filter((a) => !done.has(a.id));
      if (!left.length) break;
      let pick: { d: Draft; score: number; cost: number } | null = null;
      for (const a of left) {
        if (a.kind === 'tech') continue;
        const d: Draft = { list: [], ids: new Set(), over: new Map() };
        if (!need(d, a) || d.list.some((x) => !b.ids.has(x.id))) continue;
        const e = evaluate(d);
        if (!pick || e.score > pick.score + 1e-9 || (Math.abs(e.score - pick.score) <= 1e-9 && e.cost < pick.cost)) pick = { d, score: e.score, cost: e.cost };
      }
      // No piece qualifies when only techs remain. `left` keeps the bundle's order, which\n      // need() built prerequisites first, so it is still a valid order.
      const piece = pick ? pick.d.list : left;
      for (const a of piece) commit(a);
      out.push(piece);
    }
    return out;
  };

  const cache = new Map<number, Cand | null>();
  const bundles: Action[][] = [];
  const skipped: Action[] = [];
  const near4 = (a: number[], b: number[]) =>
    a.some((x) => b.some((y) => Math.abs((x % W) - (y % W)) <= 4 && Math.abs(Math.floor(x / W) - Math.floor(y / W)) <= 4));

  for (let guard = 0; done.size < acts.length && guard < 10000; guard++) {
    let best: Cand | null = null;
    for (const a of nonTech) {
      if (done.has(a.id)) continue;
      if (!cache.has(a.id)) cache.set(a.id, bundleFor(a));
      const c = cache.get(a.id)!;
      if (!c) continue;
      const better = !best || c.score > best.score + 1e-9 || (Math.abs(c.score - best.score) <= 1e-9 && c.cost < best.cost);
      if (better) best = c;
    }
    if (!best || (best.gain <= 0 && best.score < 1e9)) break;
    bundles.push(...splitBundle(best.d));
    // Re-evaluate bundles that share an action with this one or sit near it.
    const ids = best.d.ids;
    const tiles = best.tiles;
    for (const [k, c] of cache) {
      if (!c || [...c.d.ids].some((x) => ids.has(x)) || near4(c.tiles, tiles)) cache.delete(k);
    }
  }

  // Whatever is left raises no income: finish it in a valid order, one action at a time.
  for (const a of acts) {
    if (done.has(a.id)) continue;
    const d: Draft = { list: [], ids: new Set(), over: new Map() };
    if (!need(d, a)) {
      skipped.push(a);
      continue;
    }
    for (const x of d.list) commit(x);
    bundles.push(d.list);
  }
  return { bundles: bundles.filter((b) => b.length), skipped };
}

/**
 * Simulate doing the bundles in order, as soon as there are stars for each step.
 * Turn 0 is the current turn (you have `stars` now). Income arrives at the start of
 * each following turn: base income plus markets built by the end of the previous turn.
 * Runs at least `horizon` turns, and one turn past the last step so its income shows.
 */
export function simulate(state: GameState, bundles: Action[][], horizon = 60): Schedule {
  const s = state.settings;
  const layout = currentLayout(state);
  const nb = neighborTable(state.width, state.height);
  const inc = () => income(layout, state.width, state.height, nb).total;
  const steps: Step[] = [];
  const flat = bundles.flatMap((b, g) => b.map((a) => ({ a, g })));
  let stars = s.stars;
  let k = 0;
  const starsAtTurn: number[] = [stars];
  const incomeAtTurn: number[] = [inc()];
  let turn = 0;
  let doneTurn = 0;
  const maxTurns = Math.max(horizon, 400);
  for (;;) {
    while (k < flat.length && stars >= flat[k].a.cost) {
      const { a, g } = flat[k++];
      const before = stars;
      stars -= a.cost;
      apply(layout, a);
      steps.push({ action: a, turn, starsBefore: before, starsAfter: stars, incomeAfter: inc(), group: g });
      doneTurn = turn;
    }
    const allDone = k >= flat.length;
    if (allDone && turn >= horizon && (flat.length === 0 || turn > doneTurn)) break;
    if (turn >= maxTurns) break;
    const mi = inc();
    if (!allDone && s.baseIncome + mi <= 0 && stars < flat[k].a.cost && turn >= horizon) break; // can never afford
    turn++;
    stars += s.baseIncome + mi;
    starsAtTurn.push(stars);
    incomeAtTurn.push(mi);
  }
  return { steps, starsAtTurn, incomeAtTurn, doneTurn, finalIncome: inc(), unaffordable: flat.length - k };
}

/** The layout once `actions` are done, and which tiles lose their building. */
export function layoutAfter(state: GameState, actions: Action[]): { layout: Layout; removed: Set<number> } {
  const layout = currentLayout(state);
  const removed = new Set<number>();
  for (const a of actions) {
    apply(layout, a);
    if (a.kind === 'op' && a.op === 'destroy') removed.add(a.tile);
    if (a.kind === 'build') removed.delete(a.tile);
  }
  return { layout, removed };
}
