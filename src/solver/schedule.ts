// Turns a plan into a build order (the TODO list) and simulates it turn by turn.
//
// Order: greedy "best payback first". At each step we look at every remaining
// action together with whatever it depends on (techs, clearing the forest, the
// support building a sawmill needs next to it, ...), grow that bundle while adding
// related actions improves stars-per-turn gained per star spent, and take the best
// bundle. Expensive techs get shared by everything they unlock this way.

import { BUILD_TECH, type BuildingKind, OP_TECH, PRODUCER_SUPPORT, type Producer, TECH_BY_KEY, type TechKey } from '../data/rules';
import { type GameState, neighbors } from '../model/types';
import { income, type Layout } from './income';
import type { Plan } from './exact';
import { currentLayout } from './exact';
import { type Op, techPrice } from './options';

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
  /** turn -> market income collected at the start of that turn */
  incomeAtTurn: number[];
  /** Turn on which the last step is done. */
  doneTurn: number;
  finalIncome: number;
}

const isProducer = (b: BuildingKind | null): b is Producer => b === 'sawmill' || b === 'windmill' || b === 'forge';

export function planActions(state: GameState, plan: Plan): Action[] {
  const c = state.settings.costs;
  const acts: Action[] = [];
  let id = 0;
  for (const t of plan.techs) acts.push({ id: id++, kind: 'tech', tech: t, cost: techPrice(state, t) });
  for (const ch of plan.changes) {
    for (const op of ch.option.ops) {
      const cost = op === 'clear' ? -c.clearForestRefund : op === 'burn' ? c.burnForest : op === 'grow' ? c.growForest : c.destroy;
      acts.push({ id: id++, kind: 'op', op, tile: ch.tile, cost });
    }
    if (ch.option.build) acts.push({ id: id++, kind: 'build', build: ch.option.build, tile: ch.tile, cost: c[ch.option.build] });
  }
  return acts;
}

interface Sim {
  layout: Layout;
  techs: Set<TechKey>;
  /** tiles with an op still pending, keyed by tile -> remaining op action ids */
  done: Set<number>;
}

function techOf(a: Action): TechKey | null {
  if (a.kind === 'tech') return TECH_BY_KEY[a.tech].parent;
  if (a.kind === 'op') return OP_TECH[a.op];
  return BUILD_TECH[a.build];
}

/** Returns the actions (not done, not in `extra`) needed before `a` can run, plus `a`. */
function closure(state: GameState, acts: Action[], sim: Sim, a: Action, extra: Set<number>, layout: Layout): Action[] | null {
  const out: Action[] = [];
  const inSet = new Set<number>(extra);
  const owned = (t: TechKey) => sim.techs.has(t) || acts.some((x) => x.kind === 'tech' && x.tech === t && inSet.has(x.id));
  const visit = (x: Action, depth: number): boolean => {
    if (sim.done.has(x.id) || inSet.has(x.id)) return true;
    if (depth > 12) return false;
    const t = techOf(x);
    if (t && !owned(t)) {
      const ta = acts.find((y) => y.kind === 'tech' && y.tech === t);
      if (!ta || !visit(ta, depth + 1)) return false;
    }
    if (x.kind !== 'tech') {
      // earlier ops on the same tile
      for (const y of acts) {
        if (y.id >= x.id) break;
        if (y.kind === 'op' && y.tile === x.tile && !visit(y, depth + 1)) return false;
      }
    }
    if (x.kind === 'build' && (isProducer(x.build) || x.build === 'market')) {
      const wants: BuildingKind[] = x.build === 'market' ? ['sawmill', 'windmill', 'forge'] : PRODUCER_SUPPORT[x.build as Producer];
      const nb = neighbors(state.width, state.height, x.tile);
      const has = nb.some((n) => {
        const b = layout[n];
        return b !== null && wants.includes(b) && !pendingDestroy(acts, sim, inSet, n);
      });
      const hasInSet = nb.some((n) => acts.some((y) => y.kind === 'build' && y.tile === n && wants.includes(y.build) && inSet.has(y.id)));
      if (!has && !hasInSet) {
        // pick the cheapest neighbour build that satisfies it
        let bestC: Action[] | null = null;
        let bestCost = Infinity;
        for (const y of acts) {
          if (y.kind !== 'build' || !wants.includes(y.build) || !nb.includes(y.tile) || sim.done.has(y.id)) continue;
          const cl = closure(state, acts, sim, y, inSet, layout);
          if (!cl) continue;
          const cc = cl.reduce((s, z) => s + z.cost, 0);
          if (cc < bestCost) {
            bestCost = cc;
            bestC = cl;
          }
        }
        if (!bestC) return false;
        for (const z of bestC) {
          if (!inSet.has(z.id)) {
            inSet.add(z.id);
            out.push(z);
          }
        }
      }
    }
    inSet.add(x.id);
    out.push(x);
    return true;
  };
  return visit(a, 0) ? out : null;
}

function pendingDestroy(acts: Action[], sim: Sim, inSet: Set<number>, tile: number) {
  return acts.some((y) => y.kind === 'op' && y.op === 'destroy' && y.tile === tile && (sim.done.has(y.id) || inSet.has(y.id)));
}

function apply(layout: Layout, a: Action) {
  if (a.kind === 'op' && a.op === 'destroy') layout[a.tile] = null;
  if (a.kind === 'build') layout[a.tile] = a.build;
}

/** Build order: list of bundles, each a list of actions in a valid order. */
export function orderActions(state: GameState, plan: Plan): Action[][] {
  const acts = planActions(state, plan);
  const sim: Sim = { layout: currentLayout(state), techs: new Set(state.settings.owned), done: new Set() };
  const bundles: Action[][] = [];
  const W = state.width;
  const H = state.height;
  const inc = (l: Layout) => income(l, W, H).total;

  const evalBundle = (b: Action[]) => {
    const l = [...sim.layout];
    for (const a of b) apply(l, a);
    const d = inc(l) - inc(sim.layout);
    const cost = b.reduce((s, a) => s + a.cost, 0);
    return { d, cost, score: cost <= 0 ? (d >= 0 ? 1e9 + d : -1) : d / cost };
  };

  let guard = 0;
  while (sim.done.size < acts.length && guard++ < 1000) {
    const remaining = acts.filter((a) => !sim.done.has(a.id));
    let best: { b: Action[]; score: number; d: number; cost: number } | null = null;
    for (const a of remaining) {
      let b = closure(state, acts, sim, a, new Set(), sim.layout);
      if (!b) continue;
      let e = evalBundle(b);
      // Grow the bundle while it improves the payback ratio.
      for (let g = 0; g < 8 && e.score < 1e9; g++) {
        let improved: { b: Action[]; e: ReturnType<typeof evalBundle> } | null = null;
        const ids = new Set(b.map((x) => x.id));
        const tilesInB = new Set(b.filter((x) => x.kind !== 'tech').map((x) => (x as { tile: number }).tile));
        const near = new Set<number>();
        for (const t of tilesInB) for (const n of neighbors(W, H, t)) near.add(n);
        for (const c of remaining) {
          if (ids.has(c.id)) continue;
          if (c.kind !== 'tech' && !near.has(c.tile) && !techSharing(c, b)) continue;
          const cl = closure(state, acts, sim, c, ids, (() => { const l = [...sim.layout]; for (const x of b) apply(l, x); return l; })());
          if (!cl) continue;
          const nb: Action[] = [...b, ...cl];
          const ne = evalBundle(nb);
          if (ne.score > (improved?.e.score ?? e.score) + 1e-9) improved = { b: nb, e: ne };
        }
        if (!improved) break;
        b = improved.b;
        e = improved.e;
      }
      const better =
        !best ||
        e.score > best.score + 1e-9 ||
        (Math.abs(e.score - best.score) <= 1e-9 && e.cost < best.cost);
      if (better) best = { b, ...e };
    }
    if (!best) break;
    if (best.d <= 0 && best.score < 1e9) {
      // Nothing left raises income; finish the rest in dependency order.
      for (const a of remaining) {
        const cl = closure(state, acts, sim, a, new Set(), sim.layout) ?? [a];
        for (const x of cl) {
          if (sim.done.has(x.id)) continue;
          commit(x);
        }
        bundles.push(cl.filter((x) => x));
      }
      break;
    }
    for (const a of best.b) commit(a);
    bundles.push(best.b);
  }
  return bundles.filter((b) => b.length);

  function commit(a: Action) {
    sim.done.add(a.id);
    apply(sim.layout, a);
    if (a.kind === 'tech') sim.techs.add(a.tech);
  }
}

function techSharing(c: Action, b: Action[]) {
  const t = techOf(c);
  return !!t && b.some((x) => x.kind === 'tech' && x.tech === t);
}

/**
 * Simulate doing the bundles in order, as soon as there are stars for each step.
 * Turn 0 is the current turn (you have `stars` now). Income arrives at the start of
 * each following turn: base income plus markets built by the end of the previous turn.
 */
export function simulate(state: GameState, bundles: Action[][], horizon = 60): Schedule {
  const s = state.settings;
  const layout = currentLayout(state);
  const steps: Step[] = [];
  const flat = bundles.flatMap((b, g) => b.map((a) => ({ a, g })));
  let stars = s.stars;
  let k = 0;
  const starsAtTurn: number[] = [stars];
  const incomeAtTurn: number[] = [0];
  let turn = 0;
  let doneTurn = 0;
  const maxTurns = Math.max(horizon, 400);
  for (;;) {
    while (k < flat.length && stars >= flat[k].a.cost) {
      const { a, g } = flat[k++];
      const before = stars;
      stars -= a.cost;
      apply(layout, a);
      steps.push({ action: a, turn, starsBefore: before, starsAfter: stars, incomeAfter: income(layout, state.width, state.height).total, group: g });
      doneTurn = turn;
    }
    if (turn >= horizon && k >= flat.length) break;
    if (turn >= maxTurns) break;
    const mi = income(layout, state.width, state.height).total;
    turn++;
    stars += s.baseIncome + mi;
    starsAtTurn.push(stars);
    incomeAtTurn.push(mi);
    if (s.baseIncome + mi <= 0 && k < flat.length && stars < flat[k].a.cost) break; // can never afford
  }
  return {
    steps,
    starsAtTurn,
    incomeAtTurn,
    doneTurn,
    finalIncome: income(layout, state.width, state.height).total,
  };
}
