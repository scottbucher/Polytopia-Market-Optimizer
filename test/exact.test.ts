import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/model/types';
import { search } from '../src/solver/search';
import { makeState } from './helpers';

const optimize = (s: GameState) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });

describe('optimize', () => {
  it('reaches 8 on a forest city quickly', () => {
    const s = makeState(`
fffff
fffff
ffCff
fffff
fffff`, { owned: ['hunting', 'forestry', 'mathematics', 'riding', 'roads', 'trade'] });
    const t = Date.now();
    const f = optimize(s);
    const top = f.plans[f.plans.length - 1];
    expect(Date.now() - t).toBeLessThan(15000);
    expect(top.income).toBe(8);
    expect(f.plans[0].income).toBe(0);
  });

  it('buys trade when needed', () => {
    const s = makeState(`
.f.
fCf
.f.`);
    const f = optimize(s);
    const top = f.plans[f.plans.length - 1];
    expect(top.techs).toContain('trade');
    expect(top.income).toBeGreaterThan(0);
  });
});
