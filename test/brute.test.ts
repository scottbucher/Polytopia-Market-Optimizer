import { describe, expect, it } from 'vitest';
import { search } from '../src/solver/search';
import { bruteFrontier, rng } from './brute';
import { makeState } from './helpers';

// Exhaustive check on small maps: the search finds the true cheapest cost for every income level.
const full = (s: ReturnType<typeof makeState>) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });

const maps = [`f.f\nfC,\n.ff`, `ff.\nfCf\n,fM`, `.f,\nfCf\nMf.`];

describe('matches brute force (one city)', () => {
  for (const m of maps) {
    it(m.replace(/\n/g, '/'), () => {
      const s = makeState(m, { owned: ['hunting', 'riding', 'organization', 'climbing', 'forestry'] });
      const b = bruteFrontier(s)!;
      const f = full(s);
      expect(f.plans.map((p) => `${p.income}:${p.cost}`)).toEqual(b.map((x) => `${x.inc}:${x.cost}`));
    });
  }
});

// Two cities sharing a border: layouts that use both cities' tiles. The global search
// is a local search here, so a rare layout that needs several buildings moved at once
// can be missed; this pins how often that happens.
describe('matches brute force (two cities, random maps)', () => {
  const chars = '..,,ffffmM~';
  const techSets: string[][] = [
    ['riding', 'freespirit', 'chivalry', 'hunting', 'forestry', 'organization', 'farming'],
    ['climbing', 'meditation', 'philosophy', 'organization', 'hunting'],
    ['hunting', 'riding', 'organization', 'climbing', 'forestry'],
    ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics'],
  ];
  it('24 random 4×3 maps', () => {
    const r = rng(7);
    let compared = 0;
    let exact = 0;
    let topOk = 0;
    const misses: string[] = [];
    for (let n = 0; n < 24; n++) {
      const rows = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => chars[Math.floor(r() * chars.length)]));
      rows[1][0] = 'C';
      rows[1][3] = 'C';
      const map = rows.map((x) => x.join('')).join('\n');
      const owned = techSets[n % techSets.length] as never[];
      const s = makeState(map, { owned, allowDestroy: n % 3 === 0, allowGrow: n % 2 === 0 }, (x) => (x < 2 ? 0 : 1));
      const b = bruteFrontier(s, 4e6);
      if (!b) continue;
      compared++;
      const f = full(s);
      const got = f.plans.map((p) => `${p.income}:${p.cost}`).join(' ');
      const want = b.map((x) => `${x.inc}:${x.cost}`).join(' ');
      // Never claims something cheaper than possible.
      for (const p of f.plans) expect(p.cost).toBeGreaterThanOrEqual(b.filter((x) => x.inc >= p.income)[0]?.cost ?? Infinity);
      if (got === want) exact++;
      else misses.push(`${map.replace(/\n/g, '/')}: got ${got}, best ${want}`);
      if (f.maxIncome === b[b.length - 1].inc) topOk++;
    }
    if (misses.length) console.log(misses.join('\n'));
    expect(compared).toBeGreaterThanOrEqual(15);
    // Deterministic: today exactly these 2 maps miss (both need several buildings moved
    // at once). Tighten this when the search improves; never loosen it.
    expect(exact).toBeGreaterThanOrEqual(compared - 2);
    expect(topOk).toBeGreaterThanOrEqual(compared - 1);
  }, 120000);
});
