import { describe, expect, it } from 'vitest';
import { defaultGoalPrefs, type GoalPrefs, goalPrefsJson, parseGoalPrefs, resolveGoal, turnNow, turnsFromNow } from '../src/model/goalPrefs';
import { mapJson, parseJson } from '../src/model/io';
import { evaluateGoal } from '../src/solver/goals';
import { search } from '../src/solver/search';
import { makeState, withBuildings } from './helpers';

describe('goal settings', () => {
  it('round-trip, one set of numbers per goal kind', () => {
    const p: GoalPrefs = { kind: 'bank', income: { income: 12, by: 40 }, bank: { stars: 1000, by: 30 }, 'best-by': { by: 25 } };
    expect(parseGoalPrefs(goalPrefsJson(p))).toEqual(p);
    // Switching kind keeps the others' numbers.
    expect(parseGoalPrefs(goalPrefsJson({ ...p, kind: 'max' }))).toEqual({ ...p, kind: 'max' });
  });

  it('fall back to defaults for anything missing or broken', () => {
    expect(parseGoalPrefs(null)).toEqual(defaultGoalPrefs());
    expect(parseGoalPrefs('not json')).toEqual(defaultGoalPrefs());
    expect(parseGoalPrefs('[1,2]')).toEqual(defaultGoalPrefs());
    const p = parseGoalPrefs(JSON.stringify({ kind: 'win', income: { income: -3, by: 2.5 }, bank: { stars: 'lots', by: 30 }, 'best-by': { by: 1e9 } }));
    expect(p).toEqual({ kind: 'max', income: {}, bank: { stars: 30, by: 30 }, 'best-by': {} });
  });
});

describe('deadlines are game turns', () => {
  it('a deadline turn becomes turns from now for the solver', () => {
    const p: GoalPrefs = { ...defaultGoalPrefs(), kind: 'bank', bank: { stars: 1000, by: 30 } };
    expect(resolveGoal(p, 18, 0)).toEqual({ goal: { kind: 'bank', stars: 1000, turns: 12 }, by: 30, problem: null });
    // A newer save of the same game keeps the deadline.
    expect(resolveGoal(p, 25, 0).goal).toEqual({ kind: 'bank', stars: 1000, turns: 5 });
  });

  it('a deadline that is not after this turn is a problem', () => {
    const p: GoalPrefs = { ...defaultGoalPrefs(), kind: 'best-by', 'best-by': { by: 18 } };
    expect(resolveGoal(p, 18, 0).problem).toMatch(/Turn 18 is this turn/);
    expect(resolveGoal(p, 20, 0).problem).toMatch(/Turn 18 has passed/);
    expect(resolveGoal(p, 17, 0).problem).toBeNull();
  });

  it('deadlines and targets you never set follow the game', () => {
    const p: GoalPrefs = { ...defaultGoalPrefs(), kind: 'income' };
    expect(resolveGoal(p, 18, 24)).toEqual({ goal: { kind: 'income', income: 28, turns: 10 }, by: 28, problem: null });
    expect(resolveGoal({ ...p, kind: 'bank' }, 5, 0).by).toBe(13);
  });

  it('helper text', () => {
    expect(turnsFromNow(30, 18)).toBe('12 turns from now');
    expect(turnsFromNow(19, 18)).toBe('next turn');
    expect(turnNow({})).toBe(1);
    expect(turnNow({ turn: 18 })).toBe(18);
  });

  it('turn 19 from a mid-turn save on turn 18 adds exactly one income', () => {
    // The game pays income at the start of your turn, so the 61★ already include turn 18's.
    const s = makeState('...\n.C.\n...', { stars: 61, baseIncome: 57, allowNewTech: false });
    s.turn = 18;
    const f = search(s, { objectives: [{ kind: 'weighted', w: 1000 }] });
    const { goal } = resolveGoal({ ...defaultGoalPrefs(), kind: 'bank', bank: { stars: 100, by: 19 } }, turnNow(s), 0);
    expect(goal).toEqual({ kind: 'bank', stars: 100, turns: 1 });
    const r = evaluateGoal(s, f, goal)!;
    expect(r.bankAtDeadline).toBe(61 + 57);
    expect(r.schedule.starsAtTurn[0]).toBe(61);
    expect(r.summary).toMatch(/118★ on turn 19 \(after that turn's income, before you spend\)/);
    const by30 = evaluateGoal(s, f, resolveGoal({ ...defaultGoalPrefs(), kind: 'best-by', 'best-by': { by: 30 } }, 18, 0).goal)!;
    expect(by30.bankAtDeadline).toBe(61 + 12 * 57);
    expect(by30.summary).toMatch(/turn 30/);
  });

  it('income goals name the game turn, with markets already earning', () => {
    // A hut next to the sawmill already: the market makes 1★ now.
    const s = withBuildings(makeState('fff\nf.f\nfC.\n...', { owned: ['hunting', 'forestry'], stars: 3, baseIncome: 3, allowClear: false, allowNewTech: false }), { 0: 'lumberhut', 4: 'sawmill', 8: 'market' });
    s.turn = 18;
    const f = search(s, { objectives: [{ kind: 'atleast', income: 3 }, { kind: 'weighted', w: 1000 }] });
    const r = evaluateGoal(s, f, { kind: 'income', income: 3, turns: 10 })!;
    expect(r.met).toBe(true);
    const t = r.reachedTurn!;
    expect(t).toBeGreaterThan(0);
    expect(r.summary).toBe(`You can be collecting 3★ per turn from markets on turn ${18 + t} (${turnsFromNow(18 + t, 18)}). Markets pay at the start of the turn after they are built.`);
    expect(evaluateGoal(s, f, { kind: 'income', income: 1, turns: 10 })!.summary).toBe('Your markets already make 1★ per turn, which meets 1★. Nothing to build.');
  });
});

describe('saved maps keep the turn and city levels', () => {
  it('round-trips', () => {
    const s = makeState('...\n.C.\n...');
    s.turn = 18;
    s.cities[0].level = 4;
    s.cities[0].population = 2;
    s.settings.cityUpgrades = false;
    const p = parseJson(mapJson(s));
    expect(p.turn).toBe(18);
    expect(p.cities[0]).toEqual({ name: 'City 1', x: 1, y: 1, level: 4, population: 2 });
    expect(p.settings.cityUpgrades).toBe(false);
  });

  it('cleans up bad values', () => {
    const s = JSON.parse(mapJson(makeState('...\n.C.\n...')));
    s.turn = -4;
    s.cities[0].level = 3;
    s.cities[0].population = 9;
    const p = parseJson(JSON.stringify(s));
    expect(p.turn).toBeUndefined();
    expect(p.cities[0]).toMatchObject({ level: 3, population: 3 });
    s.cities[0].population = -3; // below zero after destroying buildings
    expect(parseJson(JSON.stringify(s)).cities[0]).toMatchObject({ level: 3, population: -3 });
    s.cities[0].population = -500;
    expect(parseJson(JSON.stringify(s)).cities[0]).toMatchObject({ level: 3, population: -99 });
    s.cities[0].level = 'big';
    expect(parseJson(JSON.stringify(s)).cities[0]).toEqual({ name: 'City 1', x: 1, y: 1 });
  });
});
