import { describe, expect, it } from 'vitest';
import { LIMITED } from '../src/data/rules';
import { finishPlan } from '../src/solver/exact';
import { income } from '../src/solver/income';
import { allTileOptions } from '../src/solver/options';
import { search } from '../src/solver/search';
import { makeState } from './helpers';

// Exhaustive check on small maps: the search should find the true best income and
// the true cheapest cost for that income.
function brute(s: ReturnType<typeof makeState>) {
  const to = allTileOptions(s);
  let best = { inc: -1, cost: Infinity };
  const pick = new Array(to.length).fill(0);
  const rec = (k: number) => {
    if (k === to.length) {
      const layout = s.tiles.map(() => null as any);
      const counts = new Map<string, number>();
      const changes: any[] = [];
      for (let i = 0; i < to.length; i++) {
        const o = to[i].options[pick[i]];
        layout[to[i].tile] = o.build;
        if (o.build && LIMITED.includes(o.build)) {
          const key = `${to[i].city}:${o.build}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (counts.get(key)! > 1) return;
        }
        if (!o.keep) changes.push({ tile: to[i].tile, option: o });
      }
      const inc = income(layout, s.width, s.height).total;
      const cost = finishPlan(s, layout, changes).cost;
      if (inc > best.inc || (inc === best.inc && cost < best.cost)) best = { inc, cost };
      return;
    }
    for (let j = 0; j < to[k].options.length; j++) {
      pick[k] = j;
      rec(k + 1);
    }
  };
  rec(0);
  return best;
}

const maps = [
  `f.f\nfC,\n.ff`,
  `ff.\nfCf\n,fM`,
  `.f,\nfCf\nMf.`,
];

describe('matches brute force', () => {
  for (const m of maps) {
    it(m.replace(/\n/g, '/'), () => {
      const s = makeState(m, { owned: ['hunting', 'riding', 'organization', 'climbing', 'forestry'] });
      const b = brute(s);
      const f = search(s, { objectives: [{ kind: 'weighted', w: 1000 }] });
      const top = f.plans[f.plans.length - 1];
      expect(top.income).toBe(b.inc);
      expect(top.cost).toBe(b.cost);
    });
  }
});
