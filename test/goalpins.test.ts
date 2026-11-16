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

const two = (x: number) => (x < 3 ? 0 : 1);
describe('build order pins', () => {
  it('income of markets two tiles away stays current while ordering', () => {
    const r0 = makeState(map('f.ff.MM/m..~fff/fC..fC~/.,,.,,./mfff,,f'), { owned: ['riding', 'mathematics', 'organization', 'farming', 'mining', 'freespirit'], cityCount: 3, stars: 16, baseIncome: 4, allowDestroy: true, allowGrow: true }, two);
    expect(runOptimizer(r0, { kind: 'max' }).result!.schedule.starsAtTurn[30]).toBeGreaterThanOrEqual(310);
    expect(runOptimizer(r0, { kind: 'best-by', turns: 25 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(210);
    const r2 = makeState(map(',,ffmm./,m,ff.~/,Cm.mCm/f,f~f.f/.f~fffm'), { owned: ['mathematics'], cityCount: 2, stars: 13, baseIncome: 3, allowDestroy: false, allowGrow: true }, two);
    expect(runOptimizer(r2, { kind: 'income', income: 9, turns: 30 }).result!.reachedTurn).toBeLessThanOrEqual(18);
  });
  it('equal-payback bundles go cheapest first', () => {
    const r9 = makeState(map('~~f~mf,/ff~.f.m/MCff.C./MM~Mfff/fm.fMf.'), { owned: ['riding', 'trade', 'hunting', 'forestry', 'mathematics', 'organization', 'farming', 'freespirit', 'meditation'], cityCount: 2, stars: 19, baseIncome: 5, allowDestroy: false, allowGrow: true }, two);
    expect(runOptimizer(r9, { kind: 'bank', stars: 60, turns: 15 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(180);
    expect(runOptimizer(r9, { kind: 'best-by', turns: 8 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(89);
    const r20 = withBuildings(makeState(map('..~f,~M/,m,fff~/fC,..Cf/.m,fff~/ffmff,,'), { owned: ['roads', 'trade', 'forestry', 'mathematics', 'farming', 'mining', 'chivalry'], cityCount: 5, stars: 11, baseIncome: 6, allowDestroy: true, allowGrow: false }, two), { 14: 'other', 34: 'market' });
    expect(runOptimizer(r20, { kind: 'best-by', turns: 25 }).result!.bankAtDeadline).toBeGreaterThanOrEqual(385);
  });
});

describe('goal summaries', () => {
  it('"if you build nothing" counts income up to the deadline', () => {
    const s = makeState('fff\nfCf\nfff', { stars: 5, baseIncome: 5 });
    const r = runOptimizer(s, { kind: 'best-by', turns: 10 }).result!;
    expect(r.bankIfNothing).toBe(55);
    expect(r.summary).toContain('55★');
  });

  it('an income you already have is met with nothing to build', () => {
    const s = withBuildings(makeState('f..\nC..', { owned: ['hunting', 'forestry', 'mathematics', 'riding', 'roads', 'trade'] }), { 0: 'lumberhut', 1: 'sawmill', 2: 'market' });
    const r = runOptimizer(s, { kind: 'income', income: 1, turns: 5 }).result!;
    expect(r.reachedTurn).toBe(0);
    expect(r.summary).toMatch(/already make 1★/);
  });
});
