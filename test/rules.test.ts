// Game rules checked against hand-computed values, independent of the solver's own code paths.
import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS, techCost, type BuildingKind, type TechKey } from '../src/data/rules';
import { income } from '../src/solver/income';
import { techPrice, tileOptions } from '../src/solver/options';
import { search } from '../src/solver/search';
import { makeState } from './helpers';

const ALL: TechKey[] = ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics', 'archery', 'spiritualism', 'organization', 'farming', 'construction', 'climbing', 'mining', 'smithery', 'freespirit', 'chivalry'];

describe('market income', () => {
  it('a market earns at most 8', () => {
    // 5×5: market in the middle, a sawmill, windmill and forge next to it, each with 3 support buildings.
    const L: (BuildingKind | null)[] = Array(25).fill(null);
    const put = (x: number, y: number, b: BuildingKind) => (L[y * 5 + x] = b);
    put(2, 2, 'market');
    put(1, 1, 'sawmill');
    put(0, 0, 'lumberhut'); put(1, 0, 'lumberhut'); put(0, 1, 'lumberhut');
    put(3, 1, 'windmill');
    put(3, 0, 'farm'); put(4, 0, 'farm'); put(4, 1, 'farm');
    put(2, 3, 'forge');
    put(1, 4, 'mine'); put(2, 4, 'mine'); put(3, 4, 'mine');
    expect(income(L, 5, 5).total).toBe(8); // 3 + 3 + 3 = 9, capped
    L[0] = null; // sawmill drops to level 2
    expect(income(L, 5, 5).total).toBe(8);
    L[1] = null; // level 1: 1 + 3 + 3
    expect(income(L, 5, 5).total).toBe(7);
  });

  it('the optimizer respects the cap', () => {
    const s = makeState('fff,M\nf.f.,\nfffC,\n,,.f.\nM,M,M', { owned: ALL, allowNewTech: false });
    expect(search(s, { objectives: [{ kind: 'weighted', w: 1000 }] }).maxIncome).toBe(8);
  });
});

describe('tech prices', () => {
  it('tier × cities + 4, a third off with Literacy (rounded up)', () => {
    expect(techCost(3, 12, DEFAULT_COSTS, false)).toBe(40);
    expect(techCost(3, 12, DEFAULT_COSTS, true)).toBe(27);
    expect(techCost(1, 12, DEFAULT_COSTS, false)).toBe(16);
    expect(techCost(1, 12, DEFAULT_COSTS, true)).toBe(11);
    expect(techCost(1, 2, DEFAULT_COSTS, false)).toBe(6);
    expect(techCost(1, 2, DEFAULT_COSTS, true)).toBe(4);
    expect(techCost(2, 0, DEFAULT_COSTS, false)).toBe(6); // at least one city
  });

  it('uses the city count, not the cities on the map', () => {
    const s = makeState('.C.', { cityCount: 5 });
    expect(techPrice(s, 'trade')).toBe(19);
    expect(techPrice({ ...s, settings: { ...s.settings, owned: ['philosophy'] } }, 'trade')).toBe(13);
  });
});

describe('tribes and terrain actions', () => {
  const forest = (tribe: never) => tileOptions(makeState('fC', { tribe, allowBurn: true, allowClear: true }), 0);

  it('Aquarion cannot burn forest but can clear it', () => {
    const ops = forest('aquarion' as never).flatMap((o) => o.ops);
    expect(ops).not.toContain('burn');
    expect(ops).toContain('clear');
    expect(forest('bardur' as never).flatMap((o) => o.ops)).toContain('burn');
  });

  it('Polaris and Cymanti never get a market', () => {
    for (const tribe of ['polaris', 'cymanti']) {
      const s = makeState('...\n.C.\n...', { tribe: tribe as never });
      for (let i = 0; i < 9; i++) expect(tileOptions(s, i).some((o) => o.build === 'market')).toBe(false);
    }
    expect(tileOptions(makeState('.C', {}), 0).some((o) => o.build === 'market')).toBe(true);
  });

  it('terrain actions need the right tech and cost', () => {
    const grow = tileOptions(makeState('.C', { allowGrow: true }), 0).find((o) => o.ops.includes('grow') && o.build === 'lumberhut')!;
    expect(grow.techs).toEqual(expect.arrayContaining(['spiritualism', 'forestry']));
    expect(grow.cost).toBe(5 + 3);
    const opts = tileOptions(makeState('fC', { allowBurn: true }), 0);
    const burn = opts.find((o) => o.ops.includes('burn') && o.build === 'farm')!;
    expect(burn.techs).toEqual(expect.arrayContaining(['construction', 'farming']));
    expect(burn.cost).toBe(3 + 5);
    const clear = opts.find((o) => o.ops.includes('clear') && o.build === 'market')!;
    expect(clear.techs).toEqual(expect.arrayContaining(['forestry', 'trade']));
    expect(clear.cost).toBe(-1 + 5);
    expect(opts.some((o) => o.ops.includes('clear') && o.build === 'farm')).toBe(false); // clearing leaves no crop
  });

  it('a forge can go on forest, a market cannot', () => {
    const opts = tileOptions(makeState('fC', { allowClear: false, allowBurn: false }), 0);
    expect(opts.some((o) => o.build === 'forge' && o.ops.length === 0)).toBe(true);
    expect(opts.some((o) => o.build === 'market')).toBe(false);
  });
});

describe("don't research new techs", () => {
  it('only uses techs you own', () => {
    const map = 'f.,.\nfC..\nM,.f';
    const none = makeState(map, { allowNewTech: false, owned: [] });
    const f0 = search(none, { objectives: [{ kind: 'weighted', w: 1000 }] });
    expect(f0.maxIncome).toBe(0);
    expect(f0.plans.every((p) => p.techs.length === 0 && p.changes.length === 0)).toBe(true);

    const owned: TechKey[] = ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics'];
    const some = makeState(map, { allowNewTech: false, owned });
    const f = search(some, { objectives: [{ kind: 'weighted', w: 1000 }] });
    expect(f.maxIncome).toBeGreaterThan(0);
    for (const p of f.plans) {
      expect(p.techs).toEqual([]);
      for (const c of p.changes) expect(['market', 'sawmill', 'lumberhut', null]).toContain(c.option.build);
    }
  });
});
