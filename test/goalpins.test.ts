// Goal answers pinned on small two-city maps. Values are what the solver finds today;
// a change that makes any of them worse is a regression (better is fine: update the pin).
import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS, techCost } from '../src/data/rules';
import { runOptimizer } from '../src/solver';
import { compressState } from './lz4Writer';
import { decompressState } from '../src/parse/lz4';
import { makeState, withBuildings } from './helpers';

const map = (rows: string) => rows.split('/').join('\n');

describe('goal answers', () => {
  it('bank and best-by', () => {
    const s = withBuildings(
      makeState(map('fMfff.f/f.m..~f/fC~~.Cf/fff..f,/fff,ff~'), { owned: ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics'], cityCount: 5, stars: 5, baseIncome: 5, allowDestroy: true, allowGrow: false }, (x) => (x < 3 ? 0 : 1)),
      { 8: 'forge', 11: 'windmill' },
    );
    // Without the bank-goal search objectives these drop to 122, 65 and 252.
    expect(runOptimizer(s, { kind: 'bank', stars: 60, turns: 15 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(147);
    expect(runOptimizer(s, { kind: 'best-by', turns: 10 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(77);
    expect(runOptimizer(s, { kind: 'best-by', turns: 25 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(287);
  });

  it('income: cheaper plan on a tie', () => {
    const s = withBuildings(
      makeState(map('ffffMf./ffffMff/fC.,fCf/.fffMmm/,f,.m~,'), { owned: ['riding', 'freespirit', 'chivalry', 'hunting', 'forestry', 'organization', 'farming'], cityCount: 2, stars: 2, baseIncome: 7, allowDestroy: true, allowGrow: true }, (x) => (x <= 3 ? 0 : 1)),
      { 28: 'farm' },
    );
    for (const [income, turn, cost] of [[2, 7, 40], [5, 8, 50]]) {
      const r = runOptimizer(s, { kind: 'income', income, turns: 30 }).result!;
      expect(r.reachedTurn).toBeLessThanOrEqual(turn);
      if (r.reachedTurn === turn) expect(r.bundles.flat().reduce((x, a) => x + a.cost, 0)).toBeLessThanOrEqual(cost);
    }
  });

  it('bank tie-break on final income', () => {
    const s = withBuildings(
      makeState(map(',fMff,f/f.f,~f,/,Cf,fCM/Mf,,f.f/..ff,ff'), { owned: ['climbing', 'meditation', 'organization', 'hunting'], cityCount: 3, stars: 17, baseIncome: 9, allowDestroy: true, allowGrow: false }, (x) => (x < 3 ? 0 : 1)),
      { 0: 'forge', 16: 'lumberhut', 24: 'other', 32: 'farm' },
    );
    const r = runOptimizer(s, { kind: 'bank', stars: 60, turns: 15 }).result!;
    expect(r.bankAtDeadline).toBeGreaterThanOrEqual(164);
    // Same stars either way, so prefer the plan that keeps earning.
    if (r.bankAtDeadline === 164) expect(r.schedule.finalIncome).toBeGreaterThanOrEqual(11);
  });
});

describe('more pinned values', () => {
  it('Literacy rounds up, not to nearest', () => {
    expect(techCost(1, 4, DEFAULT_COSTS, true)).toBe(6); // 8 × 2/3 = 5.33
    expect(techCost(1, 7, DEFAULT_COSTS, true)).toBe(8); // 11 × 2/3 = 7.33
  });

  it('a 2-byte size field is unsigned', () => {
    const data = new Uint8Array(60000).map((_, i) => (i % 3 === 0 ? 1 : 2));
    const packed = compressState(data, 2);
    expect(new DataView(packed.buffer).getUint16(1, true)).toBeGreaterThan(32767);
    expect(decompressState(packed).length).toBe(data.length);
  });
});
