import { describe, expect, it } from 'vitest';
import { type BuildingKind, CITY_REWARDS, cityReward, LIMITED, popToLevelUp, TECHS } from '../src/data/rules';
import type { GameState } from '../src/model/types';
import { grow, type Growth, growthStart, growthValue, penaltyOf, popGain, popPenalty } from '../src/solver/cities';
import { currentLayout, type Plan } from '../src/solver/exact';
import type { Op } from '../src/solver/options';
import { evaluateGoal } from '../src/solver/goals';
import { describeUpgrades, paybackTurns } from '../src/ui/describe';
import { type Layout, neighborTable } from '../src/solver/income';
import { orderActions, simulate } from '../src/solver/schedule';
import { search } from '../src/solver/search';
import { rng } from './brute';
import { makeState, withBuildings } from './helpers';

/** One city; `income` is what it makes (defaults to its level, as on a hand-drawn map). */
const one = (level: number, pop: number, income = level): Growth => ({ level: [level], pop: [pop], income: [income], on: [true] });

/** A plan of just these changes (tile, building, terrain actions first). */
const planOf = (changes: [number, BuildingKind | null, Op[]?][]): Plan => ({
  changes: changes.map(([tile, build, ops = []]) => ({ tile, option: { build, ops, keep: false, cost: 0, techs: [] } })),
  layout: [],
  techs: [],
  income: 0,
  cost: 0,
  techCost: 0,
  techPrices: {},
});
const ALL_TECHS = TECHS.map((t) => t.key);
const buildTiles = (bundles: { kind: string; tile?: number }[][]) => bundles.flat().flatMap((a) => (a.kind === 'build' ? [a.tile!] : []));

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

  it('counts each changed tile once, however often the bundle lists it', () => {
    const s = makeState('f.f\n.C.\n...');
    const nb = neighborTable(s.width, s.height);
    const before: Layout = currentLayout(s);
    const after = [...before];
    after[at(s, 0, 0)] = 'lumberhut';
    after[at(s, 1, 0)] = 'sawmill';
    // A burn then a build lists the tile twice.
    const tiles = [at(s, 0, 0), at(s, 0, 0), at(s, 1, 0), at(s, 1, 0)];
    expect(popGain(s, nb, (i) => before[i], (i) => after[i], tiles, new Map()).get(0)).toBe(1 + 1);
  });

  it('destroying takes the population away, and a new producer counts its own kind', () => {
    const s = makeState('fff\n.CM\n...');
    const nb = neighborTable(s.width, s.height);
    const before: Layout = currentLayout(s);
    before[at(s, 0, 0)] = 'lumberhut';
    before[at(s, 1, 0)] = 'lumberhut';
    before[at(s, 2, 0)] = 'lumberhut';
    before[at(s, 2, 1)] = 'mine';
    before[at(s, 1, 2)] = 'sawmill'; // level 0: no hut next to it
    before[at(s, 0, 1)] = 'sawmill'; // level 2
    const get = (l: Layout) => (i: number) => l[i];
    // Destroying a hut: -1 for the hut, -1 for the level the sawmill loses.
    const noHut = [...before];
    noHut[at(s, 0, 0)] = null;
    expect(popGain(s, nb, get(before), get(noHut), [at(s, 0, 0)], new Map()).get(0)).toBe(-2);
    // A sawmill at level 2 (2 population) replaced by a forge with no mine next to it.
    const forge = [...before];
    forge[at(s, 0, 1)] = 'forge';
    expect(popGain(s, nb, get(before), get(forge), [at(s, 0, 1)], new Map()).get(0)).toBe(-2);
    const forge2 = [...before];
    forge2[at(s, 1, 2)] = 'forge'; // level 1 (the mine): +2, the level-0 sawmill gave nothing
    expect(popGain(s, nb, get(before), get(forge2), [at(s, 1, 2)], new Map()).get(0)).toBe(2);
  });

  it('population can go below zero without losing a level, and costs 1★ per turn each', () => {
    const g = one(2, 1);
    expect(grow(g, 0, -3)).toEqual([]);
    expect([g.level[0], g.pop[0]]).toEqual([2, -2]);
    expect(popPenalty(2, -2)).toBe(2);
    // Never more than the city makes (at least its level).
    expect(popPenalty(2, -5)).toBe(2);
    expect(popPenalty(2, 1)).toBe(0);
    expect(growthValue(one(1, 0), new Map([[0, -2]]))).toEqual({ stars: 0, income: -1 });
    // Growing back from below zero levels up only once the city is full again.
    expect(growthValue(one(2, -2), new Map([[0, 4]]))).toEqual({ stars: 0, income: 2 });
    expect(growthValue(one(2, -2), new Map([[0, 5]]))).toEqual({ stars: 5, income: 3 });
  });

  it("the most it costs is the city's whole income, Workshops, Parks and capital included", () => {
    // Level 2 with a Workshop, the capital: 4★ per turn.
    expect(growthValue(one(2, 0, 4), new Map([[0, -6]]))).toEqual({ stars: 0, income: -4 });
    expect(growthValue(one(2, 0), new Map([[0, -6]]))).toEqual({ stars: 0, income: -2 });
    // A level-up first raises what the city makes, and so what it can lose.
    const g = one(1, 1);
    expect(grow(g, 0, 1).map((u) => u.reward)).toEqual(['workshop']);
    expect(g.income).toEqual([3]);
    grow(g, 0, -5);
    expect([g.level[0], g.pop[0], penaltyOf(g)]).toEqual([2, -5, 3]);
    const s = makeState('.C.');
    s.cities[0].level = 2;
    expect(growthStart(s)!.income).toEqual([2]);
    s.cities[0].income = 5;
    expect(growthStart(s)!.income).toEqual([5]);
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
    expect(first.levelUps).toEqual([{ city: 0, level: 3, reward: 'resources', stars: 5, income: 1 }]);
    expect(first.starsAfter).toBe(first.starsBefore - first.action.cost + 5);
    expect(sch.steps.flatMap((x) => x.levelUps ?? []).map((u) => u.level)).toEqual([3, 4, 5]);
    expect([sch.upgradeStars, sch.upgradeIncome, sch.popPenalty]).toEqual([5, 4, 0]);

    // The same plan without known levels: the difference is the +5★ and the extra stars per turn.
    const plainSch = simulate(plain, orderActions(plain, top).bundles, 10);
    expect(plainSch.steps.some((x) => x.levelUps)).toBe(false);
    expect([plainSch.upgradeStars, plainSch.upgradeIncome]).toEqual([0, 0]);
    expect(sch.starsAtTurn[10] - plainSch.starsAtTurn[10]).toBe(47);

    const goal = { kind: 'best-by', turns: 10 } as const;
    const withUps = evaluateGoal(grown, f, goal)!;
    const without = evaluateGoal(plain, f, goal)!;
    expect(withUps.bankAtDeadline! - without.bankAtDeadline!).toBe(47);
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

describe('ordering with level-ups', () => {
  // One row: each group is a market and a sawmill with a lumber hut to build next to the sawmill.
  // Every hut is worth +1★ per turn from the market for 3★; what differs is the level-ups.
  const row = (map: string, cityOf: (x: number) => number, b: Record<number, 'market' | 'sawmill'>) =>
    withBuildings(makeState(map, { owned: ALL_TECHS, stars: 3, baseIncome: 0 }, (x) => cityOf(x)), b);

  it('a bundle that levels a city up goes first', () => {
    const s = row('...C.....C....', (x) => (x < 7 ? 0 : 1), { 0: 'market', 1: 'sawmill', 12: 'sawmill', 13: 'market' });
    s.cities[0].level = 2;
    s.cities[0].population = 2; // the hut's +2 fills it: Resources, +5★
    s.cities[1].level = 5; // +2 of 6: nothing
    const plan = planOf([
      [11, 'lumberhut'],
      [2, 'lumberhut'],
    ]);
    expect(buildTiles(orderActions(s, plan).bundles)).toEqual([2, 11]);
    s.settings.cityUpgrades = false;
    expect(buildTiles(orderActions(s, plan).bundles)).toEqual([11, 2]);
  });

  it("a level-up re-scores the city's other bundles, also through a producer across the border", () => {
    // City 0 owns both groups' markets and sawmills; the right-hand hut stands in city 2.
    const cityOf = (x: number) => (x === 7 ? 2 : x <= 9 ? 0 : x <= 15 ? 1 : 2);
    const s = row('...C.......C....C.', cityOf, { 0: 'market', 1: 'sawmill', 8: 'sawmill', 9: 'market', 14: 'sawmill', 15: 'market' });
    s.cities[0].level = 2;
    s.cities[0].population = 2; // either left or right fills it (Resources: the hut is free)
    s.cities[1].level = 1; // its hut levels it up too: Workshop, +2★ per turn
    s.cities[2].level = 9;
    const plan = planOf([
      [2, 'lumberhut'],
      [7, 'lumberhut'],
      [13, 'lumberhut'],
    ]);
    // After the left hut, the right one no longer levels city 0 up, so city 1's hut is better.
    expect(buildTiles(orderActions(s, plan).bundles)).toEqual([2, 13, 7]);
  });

  it('level-up income can pay for a step that market income never would', () => {
    const s = row('...C....', () => 0, { 5: 'sawmill' });
    s.cities[0].level = 1;
    s.cities[0].population = 1;
    const plan = planOf([
      [4, 'lumberhut'], // +2 population: level 2, Workshop
      [6, 'market'], // 5★, and no market income comes in to pay for it
    ]);
    const { bundles } = orderActions(s, plan);
    const sch = simulate(s, bundles, 1);
    expect(sch.unaffordable).toBe(0);
    expect([sch.upgradeStars, sch.upgradeIncome, sch.popPenalty]).toEqual([0, 2, 0]);
    // The hut on turn 0; the Workshop and the level pay 2★ a turn, so the 5★ market waits for turn 3.
    expect(sch.steps.map((x) => x.turn)).toEqual([0, 3]);
  });

  it('destroying a farm leaves the city below zero and costs stars each turn', () => {
    const s = withBuildings(makeState(',C.', { owned: ALL_TECHS, stars: 0, baseIncome: 2, allowDestroy: true }), { 0: 'farm' });
    s.cities[0].level = 1;
    s.cities[0].population = 0;
    const sch = simulate(s, [orderActions(s, planOf([[0, null, ['destroy']]])).bundles.flat()], 3);
    expect(sch.steps).toHaveLength(1);
    // -2 population costs 1★ per turn: all a level-1 city makes.
    expect(sch.popPenalty).toBe(1);
    expect(sch.starsAtTurn).toEqual([0, 1, 2, 3]);
    s.settings.cityUpgrades = false;
    expect(simulate(s, [orderActions(s, planOf([[0, null, ['destroy']]])).bundles.flat()], 3).starsAtTurn).toEqual([0, 2, 4, 6]);
    // Read from a save as the capital with a Workshop (3★ per turn): it loses 2.
    s.settings.cityUpgrades = true;
    s.cities[0].income = 3;
    expect(simulate(s, [orderActions(s, planOf([[0, null, ['destroy']]])).bundles.flat()], 3).popPenalty).toBe(2);
  });

  it('population already below zero counts only by how much the plan changes it', () => {
    // City 0 is 2 below zero already (in the income you have); city 1 gets a hut.
    const s = makeState('..C..C..', { owned: ALL_TECHS, stars: 9, baseIncome: 2, allowClear: false }, (x) => (x < 4 ? 0 : 1));
    s.tiles[7].terrain = 'forest';
    s.tiles[0].terrain = 'forest';
    s.cities[0].level = 2;
    s.cities[0].population = -2;
    s.cities[1].level = 3;
    s.cities[1].population = 0;
    const elsewhere = simulate(s, orderActions(s, planOf([[7, 'lumberhut']])).bundles, 3);
    expect(elsewhere.steps[0].levelUps).toBeUndefined();
    expect(elsewhere.popPenalty).toBe(0);
    expect(elsewhere.starsAtTurn).toEqual([9, 8, 10, 12]);
    // A hut in city 0 itself wins back 1★ per turn.
    const here = simulate(s, orderActions(s, planOf([[0, 'lumberhut']])).bundles, 3);
    expect(here.popPenalty).toBe(-1);
    expect(here.starsAtTurn).toEqual([9, 9, 12, 15]);
  });
});

describe('the build order with city growth on random maps', () => {
  // Two cities near their next level, some buildings already up: the order works out
  // population from caches and the draft each bundle grew from. Doing it all from
  // scratch must give the same order.
  const chars = '..,,fffmM~';
  const kinds = ['sawmill', 'lumberhut', 'farm', 'windmill', 'mine', 'forge'] as const;
  const maps = () => {
    const r = rng(21);
    const out: GameState[] = [];
    for (let n = 0; n < 10; n++) {
      const rows = Array.from({ length: 5 }, () => Array.from({ length: 7 }, () => chars[Math.floor(r() * chars.length)]));
      rows[2][1] = 'C';
      rows[2][5] = 'C';
      const s = makeState(rows.map((x) => x.join('')).join('\n'), { owned: ALL_TECHS, allowDestroy: n % 2 === 0, allowClear: n % 3 !== 0, stars: 4 + n }, (x) => (x < 4 ? 0 : 1));
      for (let k = 0; k < 4; k++) {
        const i = Math.floor(r() * s.tiles.length);
        if (s.tiles[i].improvement === 'none' && s.tiles[i].terrain === 'field') s.tiles[i].improvement = kinds[Math.floor(r() * kinds.length)];
      }
      for (const c of [0, 1])
        for (const k of LIMITED) {
          const tiles = s.tiles.map((t, i) => (t.city === c && t.improvement === k ? i : -1)).filter((i) => i >= 0);
          for (const i of tiles.slice(1)) s.tiles[i].improvement = 'none';
        }
      s.cities.forEach((c, i) => {
        c.level = 1 + Math.floor(r() * 3);
        c.population = Math.floor(r() * (c.level + 1)) - (n % 4 === 1 && i === 0 ? 3 : 0);
      });
      out.push(s);
    }
    return out;
  };
  const orderOf = (bundles: { kind: string; id: number }[][]) => bundles.map((b) => b.map((a) => a.id).join(',')).join(' | ');

  it('caching population gives the same order as working it out from scratch', () => {
    let levelUps = 0;
    for (const s of maps()) {
      for (const plan of search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] }).plans) {
        const o = orderActions(s, plan);
        expect(orderOf(o.bundles)).toBe(orderOf(orderActions(s, plan, { fresh: true }).bundles));
        levelUps += simulate(s, o.bundles, 1).steps.filter((x) => x.levelUps).length;
      }
    }
    // The maps do level cities up.
    expect(levelUps).toBeGreaterThan(20);
  }, 60000);
});

describe('the plan says what level-ups add', () => {
  const s = makeState('...\n.C.\n...');
  s.cities[0].name = 'Wopix';
  const up = (level: number) => {
    const r = cityReward(level)!;
    return { city: 0, level, reward: r.reward, stars: r.stars, income: 1 + r.income };
  };

  it('one level-up by name, with where its stars come from', () => {
    expect(describeUpgrades(s, [up(5)])).toBe('Wopix levels up on the way: +2★ per turn (Park +1, level +1).');
    expect(describeUpgrades(s, [up(3)])).toBe('Wopix levels up on the way: +5★ now and +1★ per turn (level +1).');
    expect(describeUpgrades(s, [up(4)])).toBe('Wopix levels up on the way: +3 population and +1★ per turn (level +1).');
  });

  it('several in total', () => {
    expect(describeUpgrades(s, [up(2), up(3)])).toBe('2 city upgrades on the way add 5★ and +3★ per turn (each level adds 1★ itself): take the economic reward each time.');
  });

  it('pays for itself counting level-ups', () => {
    const none = { upgradeStars: 0, upgradeIncome: 0, popPenalty: 0 };
    expect(paybackTurns(none, 10, 2)).toBe(5);
    expect(paybackTurns(none, 10, 0)).toBeNull();
    expect(paybackTurns({ ...none, upgradeIncome: 3 }, 10, 2)).toBe(2);
    expect(paybackTurns({ ...none, upgradeStars: 5 }, 10, 2)).toBe(3);
    expect(paybackTurns({ ...none, upgradeStars: 12 }, 10, 2)).toBe(0);
    expect(paybackTurns({ ...none, popPenalty: 2 }, 10, 2)).toBeNull();
  });
});
