import { describe, expect, it } from 'vitest';
import { objectivesFor, runOptimizer } from '../src/solver/index';
import { search } from '../src/solver/search';
import { bigMap } from './perf/bigmap';

// Generous budgets (CI machines are slower); a regression to the old quadratic
// build-order code took minutes here.
describe('speed on a big map (30×30, 6 cities)', () => {
  const s = bigMap(6);
  for (const goal of [{ kind: 'max' }, { kind: 'income', income: 15, turns: 20 }, { kind: 'best-by', turns: 25 }] as const) {
    it(goal.kind, () => {
      const t = performance.now();
      const r = runOptimizer(s, goal);
      expect(r.result).not.toBeNull();
      expect(r.result!.skipped).toEqual([]);
      expect(performance.now() - t).toBeLessThan(20000);
    }, 60000);
  }
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
