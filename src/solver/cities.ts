// City growth: the population a plan's buildings add or take away, and the level-ups it causes.
//
// The search and the per-city enumeration don't know about this (they only look at
// market income, which keeps them exact). It is applied when a build order is
// ordered and simulated, so bank and best-by goals credit the rewards.
//
// Destroying a building takes its population away again, and a producer loses the
// population of the levels it loses. A city never loses a level: its population can
// go below zero (red pips in the game), and each missing population costs 1★ per turn
// of the city's income until it grows back.

import { BUILDING_POPULATION, type CityReward, type CityRewardDef, cityReward, isProducer, LEVEL_INCOME, PRODUCER_POPULATION, PRODUCER_SUPPORT, popToLevelUp } from '../data/rules';
import type { GameState } from '../model/types';
import { type LayoutGet, producerLevelAt } from './income';

export interface LevelUp {
  city: number;
  /** The level the city reaches. */
  level: number;
  reward: CityReward;
  /** Stars right away. */
  stars: number;
  /** Stars per turn it adds (the level's own star plus the reward's). */
  income: number;
}

export interface Growth {
  level: number[];
  /** Population toward the next level; below zero after buildings were destroyed. */
  pop: number[];
  /** Cities whose level is known (others are left out). */
  on: boolean[];
}

/** Where each city stands now, or null when nothing is modelled (no known levels, or turned off). */
export function growthStart(state: GameState): Growth | null {
  if (state.settings.cityUpgrades === false) return null;
  const on = state.cities.map((c) => Number.isInteger(c.level) && c.level! >= 1);
  if (!on.some(Boolean)) return null;
  return {
    level: state.cities.map((c) => c.level ?? 0),
    pop: state.cities.map((c) => c.population ?? 0),
    on,
  };
}

/**
 * Stars per turn a city at `level` loses to negative population: 1 per missing
 * population, down to no income from the city. (Its income is at least its level;
 * Workshops and Parks it already has aren't known, so the cap is the level.)
 */
export const popPenalty = (level: number, pop: number) => Math.min(level * LEVEL_INCOME, Math.max(0, -pop));

/** Stars per turn all cities lose to population below zero, as `g` stands. */
export function penaltyOf(g: Growth): number {
  let n = 0;
  for (let c = 0; c < g.pop.length; c++) if (g.on[c]) n += popPenalty(g.level[c], g.pop[c]);
  return n;
}

const SUPPORT = new Set(Object.values(PRODUCER_SUPPORT).flat());

/** Population the building on `p` gives its city: a support building's own, or a producer's per level. */
export function popAt(get: LayoutGet, nb: number[][], p: number): number {
  const b = get(p);
  if (!b) return 0;
  if (isProducer(b)) return producerLevelAt(get, nb, p) * PRODUCER_POPULATION[b];
  return BUILDING_POPULATION[b] ?? 0;
}

/**
 * Population each city gains (or loses, when negative) when the layout goes from
 * `before` to `after`, where only `tiles` changed (repeats are fine). Support buildings
 * count for their own city; a producer counts its per-level population for its city.
 * `popBefore`, when given, is popAt(before) for every tile (saves working it out again).
 * Adds into `out` (city -> population).
 */
export function popGain(
  state: GameState,
  nb: number[][],
  before: LayoutGet,
  after: LayoutGet,
  tiles: Iterable<number>,
  out: Map<number, number>,
  popBefore?: ArrayLike<number>,
) {
  const seen = new Set<number>();
  const visit = (p: number) => {
    if (seen.has(p)) return;
    seen.add(p);
    const c = state.tiles[p].city;
    if (c === null) return;
    const d = popAt(after, nb, p) - (popBefore ? popBefore[p] : popAt(before, nb, p));
    if (d) out.set(c, (out.get(c) ?? 0) + d);
  };
  const support: number[] = [];
  for (const t of tiles) {
    const b = before(t);
    const a = after(t);
    if (a === b) continue;
    visit(t);
    // Only a support building coming or going moves a neighbouring producer's level.
    if ((b && SUPPORT.has(b)) || (a && SUPPORT.has(a))) support.push(t);
  }
  for (const t of support) for (const p of nb[t]) if (isProducer(after(p)) || isProducer(before(p))) visit(p);
  return out;
}

/**
 * The level-ups from adding `n` population (negative takes it away; a city never loses
 * a level) to a city at `level` with `pop`. Calls `each` per level reached, with the
 * economic reward (Population growth can chain into another level). Returns the new
 * level and population.
 */
function fill(level: number, pop: number, n: number, each: (level: number, r: CityRewardDef) => void): [number, number] {
  pop += n;
  for (let guard = 0; guard < 100 && pop >= popToLevelUp(level); guard++) {
    pop -= popToLevelUp(level);
    level++;
    const r = cityReward(level)!;
    each(level, r);
    pop += r.population;
  }
  return [level, pop];
}

/** Adds (or takes away) population in a city and levels it up each time it fills. Mutates `g`; returns the level-ups. */
export function grow(g: Growth, city: number, pop: number, out: LevelUp[] = []): LevelUp[] {
  if (!g.on[city] || pop === 0) return out;
  [g.level[city], g.pop[city]] = fill(g.level[city], g.pop[city], pop, (level, r) =>
    out.push({ city, level, reward: r.reward, stars: r.stars, income: LEVEL_INCOME + r.income }),
  );
  return out;
}

/** Applies every city's gain; returns the level-ups. */
export function growAll(g: Growth, gains: Map<number, number>): LevelUp[] {
  const out: LevelUp[] = [];
  for (const [c, n] of gains) grow(g, c, n, out);
  return out;
}

/**
 * What the gains would be worth, without changing `g`: stars now, and stars per turn
 * (level-ups, less what negative population would cost).
 */
export function growthValue(g: Growth, gains: Map<number, number>): { stars: number; income: number } {
  let stars = 0;
  let income = 0;
  for (const [c, n] of gains) {
    if (!g.on[c] || n === 0) continue;
    const [level, pop] = fill(g.level[c], g.pop[c], n, (_, r) => {
      stars += r.stars;
      income += LEVEL_INCOME + r.income;
    });
    income -= popPenalty(level, pop) - popPenalty(g.level[c], g.pop[c]);
  }
  return { stars, income };
}
