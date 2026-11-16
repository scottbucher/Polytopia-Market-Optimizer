import { describe, expect, it } from 'vitest';
import { CITY_REWARDS, cityReward, popToLevelUp } from '../src/data/rules';
import type { GameState } from '../src/model/types';
import { grow, type Growth, growthStart, popGain } from '../src/solver/cities';
import { currentLayout } from '../src/solver/exact';
import { evaluateGoal } from '../src/solver/goals';
import { type Layout, neighborTable } from '../src/solver/income';
import { orderActions, simulate } from '../src/solver/schedule';
import { search } from '../src/solver/search';
import { makeState, withBuildings } from './helpers';

const one = (level: number, pop: number): Growth => ({ level: [level], pop: [pop], on: [true] });

describe('city level rules', () => {
  it('a city at level L needs L + 1 population', () => {
    expect([1, 2, 3, 4, 5].map(popToLevelUp)).toEqual([2, 3, 4, 5, 6]);
  });

  it('takes the economic reward at each level', () => {
    expect(cityReward(1)).toBeNull();
    expect([2, 3, 4, 5, 6, 9].map((l) => cityReward(l)!.reward)).toEqual(['workshop', 'resources', 'popgrowth', 'park', 'park', 'park']);
    expect(CITY_REWARDS.map((r) => [r.stars, r.income, r.population])).toEqual([
      [0, 1, 0], // Workshop: +1★ per turn
      [5, 0, 0], // Resources: +5★ now
      [0, 0, 3], // Population growth: +3 population
      [0, 1, 0], // Park: +1★ per turn
    ]);
  });
});

describe('population and level-ups', () => {
  const at = (s: GameState, x: number, y: number) => y * s.width + x;

  it('support buildings add their population, producers add theirs per level', () => {
    const s = makeState('f.f\n.C.\n...');
    const nb = neighborTable(s.width, s.height);
    const before: Layout = currentLayout(s);
    const after = [...before];
    after[at(s, 0, 0)] = 'lumberhut';
    after[at(s, 2, 0)] = 'lumberhut';
    after[at(s, 1, 0)] = 'sawmill'; // level 2
    const gains = popGain(s, nb, (i) => before[i], (i) => after[i], [at(s, 0, 0), at(s, 2, 0), at(s, 1, 0)], new Map());
    expect(gains.get(0)).toBe(1 + 1 + 2);
    // One more hut next to the sawmill: +1 for the hut, +1 for the sawmill's new level.
    const next = [...after];
    next[at(s, 0, 1)] = 'lumberhut';
    expect(popGain(s, nb, (i) => after[i], (i) => next[i], [at(s, 0, 1)], new Map()).get(0)).toBe(2);
  });

  it('forges add 2 population per level, farms and mines 2', () => {
    const s = makeState(',.M\n.C.\n...');
    const nb = neighborTable(s.width, s.height);
    const before: Layout = currentLayout(s);
    const after = [...before];
    after[at(s, 0, 0)] = 'farm';
    after[at(s, 2, 0)] = 'mine';
    after[at(s, 1, 0)] = 'forge'; // level 1
    expect(popGain(s, nb, (i) => before[i], (i) => after[i], [at(s, 0, 0), at(s, 2, 0), at(s, 1, 0)], new Map()).get(0)).toBe(2 + 2 + 2);
  });

  it('a filled city levels up and extra population carries over', () => {
    const g = one(2, 2);
    const ups = grow(g, 0, 2);
    expect(ups).toEqual([{ city: 0, level: 3, reward: 'resources', stars: 5, income: 1 }]);
    expect([g.level[0], g.pop[0]]).toEqual([3, 1]);
  });

  it('population growth can chain into another level-up', () => {
    const g = one(3, 3);
    const ups = grow(g, 0, 3); // 6 of 4: level 4 with 2, +3 = 5 of 5: level 5 with 0
    expect(ups.map((u) => [u.level, u.reward])).toEqual([
      [4, 'popgrowth'],
      [5, 'park'],
    ]);
    expect([g.level[0], g.pop[0]]).toEqual([5, 0]);
    expect(ups.reduce((n, u) => n + u.income, 0)).toBe(1 + 2);
  });

  it('cities with an unknown level are left out', () => {
    const s = makeState('...\n.C.\n...');
    expect(growthStart(s)).toBeNull();
    s.cities[0].level = 2;
    expect(growthStart(s)).not.toBeNull();
    s.settings.cityUpgrades = false;
    expect(growthStart(s)).toBeNull();
  });
});

describe('plans count level-up rewards', () => {
  // A market and a sawmill already stand; lumber huts around the sawmill each add 1★.
  const base = () => {
    const s = withBuildings(
      makeState(
        `
fff
f.f
fC.
...`,
        { owned: ['hunting', 'forestry'], stars: 3, baseIncome: 3, allowClear: false, allowNewTech: false },
      ),
      { 4: 'sawmill', 8: 'market' },
    );
    return s;
  };

  it('the build order shows the level-up and the bank goal gets its 5★', () => {
    const plain = base();
    const grown = base();
    grown.cities[0].level = 2;
    grown.cities[0].population = 2;
    const f = search(plain, { objectives: [{ kind: 'weighted', w: 1000 }] });
    const top = f.plans.at(-1)!;
    expect(top.changes.length).toBeGreaterThan(0);

    // The first hut adds 2 population (the hut and the sawmill's new level): level 3, take Resources.
    const sch = simulate(grown, orderActions(grown, top).bundles, 10);
    const first = sch.steps.find((x) => x.levelUps)!;
    expect(first.levelUps![0]).toMatchObject({ city: 0, level: 3, reward: 'resources', stars: 5 });
    expect(first.starsAfter).toBe(first.starsBefore - first.action.cost + 5);
    expect(sch.upgradeStars).toBeGreaterThanOrEqual(5);

    // The same plan without known levels: the difference is the +5★ and the extra stars per turn.
    const plainSch = simulate(plain, orderActions(plain, top).bundles, 10);
    expect(plainSch.steps.some((x) => x.levelUps)).toBe(false);
    expect(sch.starsAtTurn[10]).toBeGreaterThanOrEqual(plainSch.starsAtTurn[10] + 5);

    const goal = { kind: 'best-by', turns: 10 } as const;
    const withUps = evaluateGoal(grown, f, goal)!;
    const without = evaluateGoal(plain, f, goal)!;
    expect(withUps.bankAtDeadline!).toBeGreaterThanOrEqual(without.bankAtDeadline! + 5);
    // Building nothing levels nothing.
    expect(withUps.bankIfNothing).toBe(without.bankIfNothing);
  });

  it('turning the rewards off gives the plain numbers', () => {
    const plain = base();
    const off = base();
    off.cities[0].level = 2;
    off.cities[0].population = 2;
    off.settings.cityUpgrades = false;
    const f = search(plain, { objectives: [{ kind: 'weighted', w: 1000 }] });
    const goal = { kind: 'best-by', turns: 10 } as const;
    expect(evaluateGoal(off, f, goal)!.bankAtDeadline).toBe(evaluateGoal(plain, f, goal)!.bankAtDeadline);
  });
});
