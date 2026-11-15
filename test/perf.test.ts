import { describe, expect, it } from 'vitest';
import { runOptimizer } from '../src/solver/index';
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
