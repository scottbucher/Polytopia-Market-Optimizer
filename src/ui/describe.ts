import { BUILDING_NAMES, cityReward, isBuildingKind, LEVEL_INCOME, OP_NAMES, techName } from '../data/rules';
import type { GameState } from '../model/types';
import type { LevelUp } from '../solver/cities';
import type { Action, Schedule } from '../solver/schedule';

export function where(state: GameState, tile: number) {
  const x = tile % state.width;
  const y = Math.floor(tile / state.width);
  const c = state.tiles[tile].city;
  const city = c !== null ? state.cities[c]?.name : null;
  return `(${x}, ${y})${city ? ` · ${city}` : ''}`;
}

export function describeAction(state: GameState, a: Action): { title: string; detail: string } {
  if (a.kind === 'tech') return { title: `Research ${techName(a.tech, state.settings.tribe)}`, detail: '' };
  if (a.kind === 'op') {
    const t = state.tiles[a.tile];
    const label = a.op === 'destroy' ? `Destroy ${isBuildingKind(t.improvement) ? BUILDING_NAMES[t.improvement] : 'building'}` : OP_NAMES[a.op];
    return { title: label, detail: where(state, a.tile) };
  }
  return { title: `Build ${BUILDING_NAMES[a.build]}`, detail: where(state, a.tile) };
}

export function starText(cost: number) {
  if (cost < 0) return `+${-cost}★`;
  if (cost === 0) return 'free';
  return `${cost}★`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Note for the plan when enemy units stand on tiles the plan could otherwise change. */
export function enemyNote(n: number) {
  if (n <= 0) return '';
  const tiles = n === 1 ? '1 of your tiles has an enemy unit on it, so the plan leaves it alone.' : `${n} of your tiles have enemy units on them, so the plan leaves them alone.`;
  return `${tiles} Refresh your save once ${n === 1 ? 'it moves' : 'they move'}.`;
}

const cityName = (state: GameState, c: number) => state.cities[c]?.name.trim() || `City ${c + 1}`;

/** "Guarklak reaches level 3: take Resources, +5★ now and +1★ per turn". */
export function describeLevelUp(state: GameState, u: LevelUp): string {
  const name = cityName(state, u.city);
  const r = cityReward(u.level)!;
  const gains = [u.stars ? `+${u.stars}★ now` : '', r.population ? `+${r.population} population` : '', u.income ? `+${u.income}★ per turn` : ''].filter(Boolean);
  return `${name} reaches level ${u.level}: take ${r.name}, ${gains.join(' and ')}`;
}

/**
 * What the plan's city level-ups add, for the line above the build order:
 * "Wopix levels up on the way: +2★ per turn (Park +1, level +1)." for one.
 */
export function describeUpgrades(state: GameState, ups: LevelUp[]): string {
  if (ups.length === 1) {
    const [u] = ups;
    const r = cityReward(u.level)!;
    const income = u.income ? `+${u.income}★ per turn (${r.income ? `${r.name} +${r.income}, ` : ''}level +${LEVEL_INCOME})` : '';
    const gains = [u.stars ? `+${u.stars}★ now` : '', r.population ? `+${r.population} population` : '', income].filter(Boolean);
    return `${cityName(state, u.city)} levels up on the way: ${gains.join(' and ')}.`;
  }
  const stars = ups.reduce((n, u) => n + u.stars, 0);
  const income = ups.reduce((n, u) => n + u.income, 0);
  const gains = [stars ? `${stars}★` : '', income ? `+${income}★ per turn (each level adds ${LEVEL_INCOME}★ itself)` : ''].filter(Boolean);
  return `${ups.length} city upgrades on the way add ${gains.join(' and ')}: take the economic reward each time.`;
}

/**
 * Turns until the plan has paid for itself (0 = right away), or null when it never does.
 * City level-ups count: their stars come off the cost, their stars per turn add to the
 * market income gained (`marketGain`), less what negative population costs.
 */
export function paybackTurns(sch: Pick<Schedule, 'upgradeStars' | 'upgradeIncome' | 'popPenalty'>, spend: number, marketGain: number): number | null {
  const perTurn = marketGain + sch.upgradeIncome - sch.popPenalty;
  return perTurn > 0 ? Math.max(0, Math.ceil((spend - sch.upgradeStars) / perTurn)) : null;
}
