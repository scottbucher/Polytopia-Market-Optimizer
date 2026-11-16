import { describe, expect, it } from 'vitest';
import { objectivesFor, runOptimizer } from '../src/solver/index';
import { search } from '../src/solver/search';
import { bigMap } from './perf/bigmap';

// Generous budgets (CI machines are slower and may be shared); a regression to the old quadratic
// build-order code took minutes here.
describe('speed on a big map (30×30, 6 cities)', () => {
  const s = bigMap(6);
  for (const goal of [{ kind: 'max' }, { kind: 'income', income: 15, turns: 20 }, { kind: 'best-by', turns: 25 }] as const) {
    it(goal.kind, () => {
      const t = performance.now();
      const r = runOptimizer(s, goal);
      expect(r.result).not.toBeNull();
      expect(r.result!.skipped).toEqual([]);
      expect(performance.now() - t).toBeLessThan(40000);
    }, 60000);
  }
});

describe('speed with city levels known (level-ups modelled)', () => {
  // 10 touching cities on 30×30: about 1.5× the time without levels (13 s here; it was
  // 16 s before the build order scored population incrementally).
  it('best-by, 10 cities', () => {
    const s = bigMap(10);
    s.cities.forEach((c, i) => {
      c.level = 1 + (i % 4);
      c.population = i % 2;
    });
    const t = performance.now();
    const r = runOptimizer(s, { kind: 'best-by', turns: 25 });
    expect(r.result!.skipped).toEqual([]);
    expect(r.result!.schedule.steps.filter((x) => x.levelUps).length).toBeGreaterThanOrEqual(10);
    expect(r.result!.schedule.upgradeIncome).toBeGreaterThan(0);
    expect(performance.now() - t).toBeLessThan(45000);
  }, 90000);

  it('best-by', () => {
    const s = bigMap(6);
    s.cities.forEach((c, i) => {
      c.level = 1 + (i % 4);
      c.population = i % 2;
    });
    const t = performance.now();
    const r = runOptimizer(s, { kind: 'best-by', turns: 25 });
    expect(r.result!.skipped).toEqual([]);
    expect(r.result!.schedule.steps.some((x) => x.levelUps)).toBe(true);
    expect(performance.now() - t).toBeLessThan(40000);
  }, 60000);
});

describe('frontier quality on a big map', () => {
  it('the middle of the frontier stays cheap (peeling works)', () => {
    const f = search(bigMap(6), { objectives: objectivesFor({ kind: 'max' }) });
    const at = (inc: number) => f.plans.find((p) => p.income >= inc)!.cost;
    // Current values; a regression in peel() made these 141★ and 194★.
    expect(at(12)).toBeLessThanOrEqual(115);
    expect(at(20)).toBeLessThanOrEqual(180);
  }, 60000);
});
