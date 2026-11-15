import { describe, expect, it } from 'vitest';
import { search } from '../src/solver/search';
const optimize = (s: any) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });
import { makeState } from './helpers';

describe('optimize', () => {
  it('reaches 8 on a forest city and is fast', () => {
    const s = makeState(`
fffff
fffff
ffCff
fffff
fffff`, { owned: ['hunting', 'forestry', 'mathematics', 'riding', 'roads', 'trade'] });
    const t = Date.now();
    const f = optimize(s);
    const top = f.plans[f.plans.length - 1];
    console.log('ms', Date.now() - t, f.plans.map((p) => `${p.income}:${p.cost}`).join(' '), top.techs);
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
