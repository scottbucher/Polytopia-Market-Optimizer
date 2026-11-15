// Cases found in review, each pinned to the right answer (checked against brute force).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/model/types';
import { evaluateGoal } from '../src/solver/goals';
import { income } from '../src/solver/income';
import { search } from '../src/solver/search';
import { objectivesFor, runOptimizer } from '../src/solver';
import { orderActions, simulate } from '../src/solver/schedule';
import { bruteFrontier } from './brute';
import { makeState, withBuildings } from './helpers';

const S = (s: ReturnType<typeof makeState>) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });
const levels = (f: ReturnType<typeof S>) => f.plans.map((p) => `${p.income}:${p.cost}`);
const brute = (s: ReturnType<typeof makeState>) => bruteFrontier(s)!.map((x) => `${x.inc}:${x.cost}`);

describe('solver regressions', () => {
  it('an existing producer with no possible support does not block the market spot', () => {
    const s = withBuildings(makeState(`.f.\nMCM\n~~f`, { owned: ['hunting', 'riding', 'organization', 'climbing', 'forestry'], cityCount: 3 }), { 0: 'sawmill' });
    expect(levels(S(s))).toEqual(brute(s));
  });

  it('the tile of a replaced market can take a support building', () => {
    const s = withBuildings(
      makeState(`.fM\nfC,\nmf.`, { owned: ['riding', 'freespirit', 'chivalry', 'hunting', 'forestry', 'organization', 'farming'], cityCount: 2, allowDestroy: true, allowGrow: true }),
      { 0: 'market' },
    );
    expect(levels(S(s))).toEqual(brute(s));
  });

  it('finds layouts across a city border', () => {
    const a = makeState(`.~mm\nC~.C\nMf.m`, { owned: ['riding', 'freespirit', 'chivalry', 'hunting', 'forestry', 'organization', 'farming'], cityCount: 2 }, (x) => (x < 2 ? 0 : 1));
    expect(levels(S(a))).toEqual(brute(a));
    const b = makeState(`fMm.\nC.MC\nf~,M`, { owned: ['climbing', 'meditation', 'philosophy', 'organization', 'hunting'], cityCount: 2 }, (x) => (x < 2 ? 0 : 1));
    expect(levels(S(b))).toEqual(brute(b));
  });

  it('buys Philosophy first when the discount pays for it', () => {
    const m = `fffff\nfffff\nffCff\nfffff\nfffff`;
    const without = S(makeState(m, { owned: ['climbing', 'meditation'], cityCount: 12 }));
    const top = without.plans[without.plans.length - 1];
    expect(top.income).toBe(8);
    expect(top.techs[0]).toBe('philosophy'); // research order: Philosophy before the rest
    const owned = S(makeState(m, { owned: ['climbing', 'meditation', 'philosophy'], cityCount: 12 }));
    const philosophyPrice = 3 * 12 + 4;
    expect(top.cost).toBe(owned.plans[owned.plans.length - 1].cost + philosophyPrice);
    // and the build order researches it before the discounted techs
    const st = makeState(m, { owned: ['climbing', 'meditation'], cityCount: 12 });
    const order = orderActions(st, top).bundles.flat().filter((a) => a.kind === 'tech');
    expect(order[0]).toMatchObject({ tech: 'philosophy' });
    expect(order.reduce((x, a) => x + a.cost, 0)).toBe(top.techCost);
  });

  it('plans contain no buildings that add nothing', () => {
    const s = makeState(`f.f.f\n.,f,.\nffCff\nfM.f,\nf.ff.`, { owned: ['hunting', 'climbing', 'organization', 'riding'], allowDestroy: true, allowGrow: true });
    for (const p of S(s).plans) {
      for (const ch of p.changes) {
        // (Tiles that had a building are covered by the round 3 case below.)
        if (!ch.option.build || ch.option.cost <= 0 || s.tiles[ch.tile].improvement !== 'none') continue;
        const layout = [...p.layout];
        layout[ch.tile] = null;
        // Removing any one paid-for building must lose income (or it would have been pruned).
        expect(income(layout, s.width, s.height).total, `tile ${ch.tile} in ${p.income}:${p.cost}`).toBeLessThan(p.income);
      }
    }
  });
});

describe('build order regressions', () => {
  it('tears down the old market before building the new one', () => {
    const s = withBuildings(
      makeState(`.~fff\n~~Cff\n~~fff`, { owned: ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics'], allowDestroy: true, stars: 30 }),
      { 0: 'market' },
    );
    const f = S(s);
    const top = f.plans[f.plans.length - 1];
    const flat = orderActions(s, top).bundles.flat();
    const destroy = flat.findIndex((a) => a.kind === 'op' && a.op === 'destroy' && a.tile === 0);
    const newMarket = flat.findIndex((a) => a.kind === 'build' && a.build === 'market' && a.tile !== 0);
    if (newMarket >= 0) {
      expect(destroy).toBeGreaterThanOrEqual(0);
      expect(destroy).toBeLessThan(newMarket);
      const chivalry = flat.findIndex((a) => a.kind === 'tech' && a.tech === 'chivalry');
      expect(chivalry).toBeLessThan(destroy);
    }
  });

  it('income you already have counts from turn 0', () => {
    const s = withBuildings(makeState(`.f.\n.Cf\n...`, { owned: ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics'], stars: 0, baseIncome: 3 }), {
      0: 'market',
      1: 'lumberhut',
      3: 'sawmill',
    });
    const r = evaluateGoal(s, S(s), { kind: 'income', income: 1, turns: 0 })!;
    expect(r.met).toBe(true);
    expect(r.reachedTurn).toBe(0);
  });

  it('a tight income deadline reports the real turn', () => {
    const s = makeState(`fffff\nf,f,f\nffCff\nfM.ff\nfffff`, { owned: ['hunting', 'forestry', 'mathematics', 'riding', 'roads', 'trade'], stars: 20, baseIncome: 2 });
    const f = S(s);
    const loose = evaluateGoal(s, f, { kind: 'income', income: 3, turns: 30 })!;
    expect(loose.met).toBe(true);
    const t = loose.reachedTurn!;
    expect(Number.isFinite(t)).toBe(true);
    const tight = evaluateGoal(s, f, { kind: 'income', income: 3, turns: t })!;
    expect(tight.met).toBe(true);
    expect(tight.reachedTurn).toBe(t);
    if (t > 0) {
      const tooTight = evaluateGoal(s, f, { kind: 'income', income: 3, turns: t - 1 })!;
      expect(tooTight.met).toBe(false);
      expect(tooTight.reachedTurn).toBe(t);
    }
  });
});

describe('round 2 solver findings', () => {
  const cities = ['0000112', '0001122', '0001122', '0001122', '0000112'];
  const cityOf = (x: number, y: number) => Number(cities[y][x]);

  it('no frontier plan keeps a building that adds nothing', () => {
    const s = withBuildings(makeState('f,~f,f.\nfMfffMM\n.C,CmC,\nmmM,fff\nffmmM.f', {
      tribe: 'aquarion', owned: ['riding', 'roads', 'freespirit', 'chivalry', 'organization', 'farming', 'fishing', 'sailing', 'ramming', 'climbing', 'mining', 'meditation', 'philosophy'],
      cityCount: 6, stars: 11, baseIncome: 11, allowGrow: false, allowDestroy: false,
    }, cityOf), { 6: 'sawmill', 7: 'lumberhut', 14: 'other', 25: 'other', 26: 'lumberhut', 30: 'other' });
    s.tiles[2].resource = 'aquacrop';
    const o = runOptimizer(s, { kind: 'income', income: 7, turns: 30 });
    expect(o.result!.skipped).toEqual([]);
    for (const p of o.frontier.plans) expect(orderActions(s, p).skipped).toEqual([]);
  }, 60000);

  it('a bank goal finds the best plan on the frontier', () => {
    const s = withBuildings(makeState('fff~~ff\nMfff.,,\n,C,CfCf\nf..f.,f\n,~M,~,,', {
      owned: ['organization'], cityCount: 5, stars: 19, baseIncome: 11, allowBurn: false, allowGrow: true, allowDestroy: true,
    }, cityOf), { 14: 'market', 16: 'windmill', 20: 'lumberhut', 28: 'forge', 33: 'other' });
    const T = 29;
    const o = runOptimizer(s, { kind: 'bank', stars: 50, turns: T });
    let best = -1;
    for (const p of o.frontier.plans) {
      const all = orderActions(s, p).bundles;
      for (let k = 0; k <= all.length; k++) {
        const sc = simulate(s, all.slice(0, k), T);
        if (sc.unaffordable || sc.steps.some((x) => x.turn >= T)) break;
        best = Math.max(best, sc.starsAtTurn[T]);
      }
    }
    // Within 2% of trying every plan (it tries a handful and their neighbours).
    expect(o.result!.bankAtDeadline!).toBeGreaterThanOrEqual(best * 0.98);
  }, 60000);
});

describe('round 3 solver findings', () => {
  const load = (name: string) => JSON.parse(readFileSync(new URL(`./cases/${name}`, import.meta.url), 'utf8'));

  it('no plan keeps a useless replacement on a tile that had a building', () => {
    const s = load('r3-windmill.json') as GameState;
    for (let target = 1; target <= 10; target++) {
      const f = search(s, { objectives: objectivesFor({ kind: 'income', income: target, turns: 0 }) });
      for (const p of f.plans) expect(orderActions(s, p).skipped, `target ${target} plan ${p.income}:${p.cost}`).toEqual([]);
    }
  }, 60000);

  it('a refund bigger than the build price does not put unbuildable markets in plans', () => {
    const s = makeState('fff\nfCf\nfff', { owned: ['riding', 'roads', 'trade', 'hunting', 'forestry'] });
    s.settings.costs = { ...s.settings.costs, market: 0, clearForestRefund: 2 };
    for (const p of search(s, { objectives: objectivesFor({ kind: 'max' }) }).plans) expect(orderActions(s, p).skipped, `plan ${p.income}:${p.cost}`).toEqual([]);
  });

  it('a bank goal tries every plan when the frontier is small', () => {
    const { state, goal } = load('r3-bank.json');
    expect(runOptimizer(state, goal).result!.bankAtDeadline).toBe(97); // plan 8 of 13; a local walk stopped at 57
  });

  it('an income goal looks past the cheapest few plans', () => {
    const { state, goal } = load('r3-income.json');
    expect(runOptimizer(state, goal).result!.reachedTurn).toBe(12);
  });
});
