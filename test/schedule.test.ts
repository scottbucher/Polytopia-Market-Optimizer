import { describe, expect, it } from 'vitest';
import { BUILD_TECH, isProducer, LIMITED, OP_TECH, PRODUCER_SUPPORT, PRODUCERS, TECH_BY_KEY, type TechKey } from '../src/data/rules';
import type { GameState } from '../src/model/types';
import { currentLayout, type Plan } from '../src/solver/exact';
import { evaluateGoal } from '../src/solver/goals';
import { income, neighborTable } from '../src/solver/income';
import { type Action, orderActions, planActions, simulate } from '../src/solver/schedule';
import { runOptimizer } from '../src/solver';
import { search } from '../src/solver/search';
import { rng } from './brute';
import { makeState, withBuildings } from './helpers';

const optimize = (s: GameState) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });

/** Checks that a build order could really be played in the game, step by step. */
function checkOrder(s: GameState, plan: Plan, flat: Action[]) {
  const owned = new Set<TechKey>(s.settings.owned);
  const layout = currentLayout(s);
  const nb = neighborTable(s.width, s.height);
  const doneOps = new Map<number, string[]>();
  expect(flat.length).toBe(planActions(s, plan).length);
  for (const a of flat) {
    if (a.kind === 'tech') {
      const parent = TECH_BY_KEY[a.tech].parent;
      if (parent) expect(owned.has(parent), `${a.tech} needs ${parent}`).toBe(true);
      owned.add(a.tech);
      continue;
    }
    const need = a.kind === 'op' ? OP_TECH[a.op] : BUILD_TECH[a.build];
    expect(owned.has(need), `${a.kind} on ${a.tile} needs ${need}`).toBe(true);
    if (a.kind === 'op') {
      doneOps.set(a.tile, [...(doneOps.get(a.tile) ?? []), a.op]);
      if (a.op === 'destroy') layout[a.tile] = null;
      continue;
    }
    // Terrain actions on the tile come first.
    const ch = plan.changes.find((c) => c.tile === a.tile)!;
    expect(doneOps.get(a.tile) ?? []).toEqual(ch.option.ops);
    // What has to be next to it already stands.
    const wants = a.build === 'market' ? PRODUCERS : isProducer(a.build) ? PRODUCER_SUPPORT[a.build] : null;
    if (wants) expect(nb[a.tile].some((n) => wants.includes(layout[n] as never)), `${a.build} on ${a.tile} has its neighbour`).toBe(true);
    // One per city.
    if (LIMITED.includes(a.build)) {
      const city = s.tiles[a.tile].city;
      const other = layout.findIndex((b, i) => b === a.build && i !== a.tile && s.tiles[i].city === city);
      expect(other, `second ${a.build} in city ${city}`).toBe(-1);
    }
    layout[a.tile] = a.build;
  }
  expect(income(layout, s.width, s.height).total).toBe(plan.income);
}

const map = `
fffff
f,f,f
ffCff
fM.ff
fffff`;

describe('build order', () => {
  it('max plan builds a valid order', () => {
    const s = makeState(map, { owned: ['hunting', 'climbing', 'organization', 'riding'], stars: 10, baseIncome: 4 });
    const f = optimize(s);
    const r = evaluateGoal(s, f, { kind: 'max' })!;
    expect(r.skipped).toEqual([]);
    checkOrder(s, r.plan, r.bundles.flat());
    expect(r.schedule.finalIncome).toBe(r.plan.income);
    expect(r.schedule.steps.every((x) => x.starsAfter >= 0)).toBe(true);
  });

  it('every frontier plan has a valid order on random maps (with existing buildings)', () => {
    const r = rng(3);
    const chars = '..,ffffmM~';
    const kinds = ['market', 'sawmill', 'lumberhut', 'farm', 'windmill', 'other'] as const;
    for (let n = 0; n < 12; n++) {
      const rows = Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => chars[Math.floor(r() * chars.length)]));
      rows[2][1] = 'C';
      rows[2][4] = 'C';
      const s = makeState(rows.map((x) => x.join('')).join('\n'), { owned: ['hunting', 'riding', 'organization', 'climbing', 'chivalry', 'freespirit'], allowDestroy: n % 2 === 0, allowGrow: true, stars: 15 }, (x) => (x < 3 ? 0 : 1));
      // a few existing buildings
      for (let k = 0; k < 3; k++) {
        const i = Math.floor(r() * s.tiles.length);
        if (s.tiles[i].improvement === 'none' && s.tiles[i].terrain === 'field') s.tiles[i].improvement = kinds[Math.floor(r() * kinds.length)];
      }
      // keep the starting map legal: one market/producer per city
      for (const c of [0, 1])
        for (const k of LIMITED) {
          const tiles = s.tiles.map((t, i) => (t.city === c && t.improvement === k ? i : -1)).filter((i) => i >= 0);
          for (const i of tiles.slice(1)) s.tiles[i].improvement = 'none';
        }
      for (const plan of optimize(s).plans) {
        const o = orderActions(s, plan);
        expect(o.skipped).toEqual([]);
        checkOrder(s, plan, o.bundles.flat());
      }
    }
  }, 60000);

  it('stars never go negative and income arrives the turn after building', () => {
    const s = makeState(map, { owned: ['hunting', 'forestry', 'mathematics', 'riding', 'roads', 'trade'], stars: 13, baseIncome: 2 });
    const top = optimize(s).plans.at(-1)!;
    const sch = simulate(s, orderActions(s, top).bundles, 10);
    for (const st of sch.steps) {
      expect(st.starsAfter).toBeGreaterThanOrEqual(0);
      expect(sch.incomeAtTurn[st.turn + 1]).toBeGreaterThanOrEqual(st.incomeAfter > 0 ? 1 : 0);
    }
    expect(sch.starsAtTurn.length).toBeGreaterThan(10);
  });
});

describe('goals', () => {
  const s = makeState(map, { owned: ['hunting', 'climbing', 'organization', 'riding'], stars: 10, baseIncome: 4 });
  const f = optimize(s);

  it('income and bank goals', () => {
    expect(evaluateGoal(s, f, { kind: 'income', income: 4, turns: 20 })!.met).toBe(true);
    const c = evaluateGoal(s, f, { kind: 'best-by', turns: 40 })!;
    expect(c.bankAtDeadline!).toBeGreaterThan(c.bankIfNothing!);
  });

  it('an income above the maximum says so', () => {
    const r = evaluateGoal(s, f, { kind: 'income', income: 99, turns: 20 })!;
    expect(r.met).toBe(false);
    expect(r.summary).toMatch(/isn't possible/);
  });

  it('best by turn 0 builds nothing and banks what you have', () => {
    const r = evaluateGoal(s, f, { kind: 'best-by', turns: 0 })!;
    expect(r.bundles).toEqual([]);
    expect(r.bankAtDeadline).toBe(s.settings.stars);
  });

  it('an unreachable bank goal is reported as not met', () => {
    const r = evaluateGoal(s, f, { kind: 'bank', stars: 10_000, turns: 5 })!;
    expect(r.met).toBe(false);
    expect(r.summary).toMatch(/short of/);
  });

  it('bank goals only count steps done before the deadline', () => {
    const r = evaluateGoal(s, f, { kind: 'bank', stars: 1, turns: 12 })!;
    expect(r.schedule.steps.every((x) => x.turn < 12)).toBe(true);
    expect(r.bankAtDeadline).toBe(r.schedule.starsAtTurn[12]);
  });

  it('an income goal stops building once the target is reached', () => {
    for (const target of [1, 2, 3, 4, f.maxIncome]) {
      const r = evaluateGoal(s, f, { kind: 'income', income: target, turns: 30 })!;
      expect(r.schedule.finalIncome, `target ${target}`).toBeGreaterThanOrEqual(target);
      expect(simulate(s, r.bundles.slice(0, -1)).finalIncome, `target ${target}`).toBeLessThan(target);
    }
  });

  it('an income goal picks the fastest of the plans that reach it', () => {
    for (const target of [2, 4, f.maxIncome]) {
      const goal = { kind: 'income', income: target, turns: 30 } as const;
      const r = evaluateGoal(s, f, goal)!;
      for (const p of f.plans.filter((x) => x.income >= target).slice(0, 4)) {
        const alone = evaluateGoal(s, { plans: [p], maxIncome: p.income }, goal)!;
        expect(r.reachedTurn!).toBeLessThanOrEqual(alone.reachedTurn!);
      }
    }
  });

  it('bank goals never finish a step on the deadline turn, and never do worse than saving', () => {
    for (let T = 1; T <= 30; T++) {
      const r = evaluateGoal(s, f, { kind: 'best-by', turns: T })!;
      expect(r.schedule.steps.every((x) => x.turn < T), `turn ${T}`).toBe(true);
      expect(r.bankAtDeadline!).toBeGreaterThanOrEqual(r.bankIfNothing!);
    }
  });

  it('the per-goal search does at least as well as a generic one', () => {
    for (const goal of [
      { kind: 'income', income: 3, turns: 30 },
      { kind: 'best-by', turns: 15 },
      { kind: 'best-by', turns: 40 },
      { kind: 'bank', stars: 50, turns: 25 },
    ] as const) {
      const mine = runOptimizer(s, goal).result!;
      const generic = evaluateGoal(s, f, goal)!;
      if (goal.kind === 'income') expect(mine.reachedTurn!).toBeLessThanOrEqual(generic.reachedTurn!);
      else expect(mine.bankAtDeadline!, JSON.stringify(goal)).toBeGreaterThanOrEqual(generic.bankAtDeadline!);
    }
  }, 60000);

  it('a market you already have is never torn down without destroy allowed', () => {
    const t = withBuildings(makeState(map, { owned: ['hunting', 'forestry', 'mathematics', 'riding', 'roads', 'trade'] }), { 6: 'market' });
    for (const p of optimize(t).plans) expect(p.layout[6]).toBe('market');
  });
});
