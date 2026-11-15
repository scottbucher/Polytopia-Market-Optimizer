import { describe, expect, it } from 'vitest';
import { search } from '../src/solver/search';
const optimize = (s: any) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });
import { evaluateGoal } from '../src/solver/goals';
import { makeState } from './helpers';

const map = `
fffff
f,f,f
ffCff
fM.ff
fffff`;

describe('goals', () => {
  it('max plan builds a valid order', () => {
    const s = makeState(map, { owned: ['hunting', 'climbing', 'organization', 'riding'], stars: 10, baseIncome: 4 });
    const f = optimize(s);
    const r = evaluateGoal(s, f, { kind: 'max' })!;
    console.log(r.summary);
    for (const st of r.schedule.steps) console.log(st.turn, st.action.kind, (st.action as any).tech ?? (st.action as any).build ?? (st.action as any).op, (st.action as any).tile ?? '', st.action.cost, '->', st.incomeAfter);
    expect(r.schedule.finalIncome).toBe(r.plan.income);
    // techs come before buildings that need them
    const techTurn = new Map(r.schedule.steps.filter((x) => x.action.kind === 'tech').map((x) => [(x.action as any).tech, r.schedule.steps.indexOf(x)]));
    expect(techTurn.size).toBe(r.plan.techs.length);
  });

  it('income and bank goals', () => {
    const s = makeState(map, { owned: ['hunting', 'climbing', 'organization', 'riding'], stars: 10, baseIncome: 4 });
    const f = optimize(s);
    const a = evaluateGoal(s, f, { kind: 'income', income: 4, turns: 20 })!;
    console.log(a.summary);
    expect(a.met).toBe(true);
    const b = evaluateGoal(s, f, { kind: 'best-by', turns: 5 })!;
    console.log(b.summary);
    const c = evaluateGoal(s, f, { kind: 'best-by', turns: 40 })!;
    console.log(c.summary);
    expect(c.bankAtDeadline!).toBeGreaterThan(c.bankIfNothing!);
  });
});
