// City growth: the population a plan's buildings add, and the level-ups it causes.
//
// The search and the per-city enumeration don't know about this (they only look at
// market income, which keeps them exact). It is applied when a build order is
// ordered and simulated, so bank and best-by goals credit the rewards.

import { BUILDING_POPULATION, type CityReward, cityReward, isProducer, LEVEL_INCOME, PRODUCER_POPULATION, popToLevelUp } from '../data/rules';
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
    pop: state.cities.map((c) => Math.max(0, c.population ?? 0)),
    on,
  };
}

export const copyGrowth = (g: Growth): Growth => ({ level: [...g.level], pop: [...g.pop], on: g.on });

/**
 * Population each city gains when the layout goes from `before` to `after`, where only
 * `tiles` changed. Support buildings give theirs to their own city; a producer gives
 * its per-level population to its city for each level it gains. Losses (a destroyed
 * building) are not counted. Adds into `out` (city -> population).
 */
export function popGain(state: GameState, nb: number[][], before: LayoutGet, after: LayoutGet, tiles: Iterable<number>, out: Map<number, number>) {
  const add = (t: number, n: number) => {
    const c = state.tiles[t].city;
    if (c !== null && n > 0) out.set(c, (out.get(c) ?? 0) + n);
  };
  const seen = new Set<number>();
  for (const t of tiles) {
    const a = after(t);
    if (a && a !== before(t)) add(t, BUILDING_POPULATION[a] ?? 0);
    for (const p of [t, ...nb[t]]) {
      if (seen.has(p)) continue;
      seen.add(p);
      const pa = after(p);
      if (!isProducer(pa)) continue;
      const gained = producerLevelAt(after, nb, p) - (before(p) === pa ? producerLevelAt(before, nb, p) : 0);
      if (gained > 0) add(p, gained * PRODUCER_POPULATION[pa]);
    }
  }
  return out;
}

/**
 * Adds population to a city and levels it up each time it fills, taking the economic
 * reward (Population growth can chain into another level). Mutates `g`; returns the level-ups.
 */
export function grow(g: Growth, city: number, pop: number, out: LevelUp[] = []): LevelUp[] {
  if (!g.on[city] || pop <= 0) return out;
  g.pop[city] += pop;
  for (let guard = 0; guard < 100 && g.pop[city] >= popToLevelUp(g.level[city]); guard++) {
    g.pop[city] -= popToLevelUp(g.level[city]);
    g.level[city]++;
    const r = cityReward(g.level[city])!;
    out.push({ city, level: g.level[city], reward: r.reward, stars: r.stars, income: LEVEL_INCOME + r.income });
    g.pop[city] += r.population;
  }
  return out;
}

/** Applies every city's gain; returns the level-ups. */
export function growAll(g: Growth, gains: Map<number, number>): LevelUp[] {
  const out: LevelUp[] = [];
  for (const [c, n] of gains) grow(g, c, n, out);
  return out;
}

/** What the gains would be worth, without changing `g`: stars now and stars per turn. */
export function growthValue(g: Growth, gains: Map<number, number>): { stars: number; income: number } {
  let stars = 0;
  let income = 0;
  for (const [c, n] of gains) {
    if (!g.on[c]) continue;
    const one: Growth = { level: [g.level[c]], pop: [g.pop[c]], on: [true] };
    for (const u of grow(one, 0, n)) {
      stars += u.stars;
      income += u.income;
    }
  }
  return { stars, income };
}
