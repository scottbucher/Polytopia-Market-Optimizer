// Cases found in review, each pinned to the right answer (checked against brute force).
import { describe, expect, it } from 'vitest';
import { evaluateGoal } from '../src/solver/goals';
import { income } from '../src/solver/income';
import { search } from '../src/solver/search';
import { orderActions } from '../src/solver/schedule';
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
