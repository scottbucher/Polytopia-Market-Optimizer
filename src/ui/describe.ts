import { BUILDING_NAMES, cityReward, isBuildingKind, LEVEL_INCOME, OP_NAMES, type Resource, techName } from '../data/rules';
import type { GameState } from '../model/types';
import type { LevelUp } from '../solver/cities';
import type { Action, Schedule } from '../solver/schedule';
import type { Overlay } from './MapView';

export function where(state: GameState, tile: number) {
  const x = tile % state.width;
  const y = Math.floor(tile / state.width);
  const c = state.tiles[tile].city;
  const city = c !== null ? state.cities[c]?.name : null;
  return `(${x}, ${y})${city ? ` · ${city}` : ''}`;
}

const RESOURCE_NAMES: Record<Resource, string> = {
  none: '',
  crop: 'crop',
  metal: 'metal',
  fruit: 'fruit',
  game: 'wild animal',
  fish: 'fish',
  aquacrop: 'water crop',
  other: 'resource',
};

/**
 * A tile in words, for the map's footer and screen readers:
 * "(3, 4) · Wopix · forest · Lumber Hut · planned Sawmill, step 6".
 */
export function describeTile(state: GameState, i: number, plan?: Pick<Overlay, 'layout' | 'steps' | 'removed'> | null): string | null {
  const t = state.tiles[i];
  if (!t) return null;
  const parts = [where(state, i), t.terrain === 'unknown' ? 'unexplored' : t.terrain];
  if (t.resource !== 'none') parts.push(RESOURCE_NAMES[t.resource]);
  if (t.improvement !== 'none') parts.push(t.improvement === 'other' ? 'other building' : t.improvement === 'city' ? 'city' : BUILDING_NAMES[t.improvement]);
  const steps = plan?.steps.get(i);
  if (plan && steps?.length) {
    const b = plan.layout[i];
    const what = b && b !== t.improvement ? `planned ${BUILDING_NAMES[b]}` : plan.removed.has(i) ? 'removed in the plan' : 'changed in the plan';
    parts.push(`${what}, ${steps.length > 1 ? 'steps' : 'step'} ${steps.join(', ')}`);
  }
  if (t.enemy) parts.push('enemy unit here');
  if (t.city === null && t.terrain !== 'unknown') parts.push('not your territory');
  return parts.join(' · ');
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

/** "+5★ now and +1★ per turn": what one level-up gives. `perTurn` words its stars per turn. */
function levelUpGains(u: LevelUp, perTurn = `+${u.income}★ per turn`): string {
  const r = cityReward(u.level)!;
  return [u.stars ? `+${u.stars}★ now` : '', r.population ? `+${r.population} population` : '', u.income ? perTurn : ''].filter(Boolean).join(' and ');
}

/** "Guarklak reaches level 3: take Resources, +5★ now and +1★ per turn". */
export function describeLevelUp(state: GameState, u: LevelUp): string {
  return `${cityName(state, u.city)} reaches level ${u.level}: take ${cityReward(u.level)!.name}, ${levelUpGains(u)}`;
}

/**
 * What the plan's city level-ups add, for the line above the build order:
 * "Wopix levels up on the way: +2★ per turn (Park +1, level +1)." for one.
 */
export function describeUpgrades(state: GameState, ups: LevelUp[]): string {
  if (ups.length === 1) {
    const [u] = ups;
    const r = cityReward(u.level)!;
    return `${cityName(state, u.city)} levels up on the way: ${levelUpGains(u, `+${u.income}★ per turn (${r.income ? `${r.name} +${r.income}, ` : ''}level +${LEVEL_INCOME})`)}.`;
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

/**
 * How many changes of each kind the map has had: a read of a newer save, a read of the same
 * save again (Refresh, which undoes your edits), and your own edits. A solve keeps the counts
 * from when it started, so its note names only what changed after that.
 */
export interface ChangeCount {
  save: number;
  reread: number;
  you: number;
}

export const NO_CHANGES: ChangeCount = { save: 0, reread: 0, you: 0 };

/** What changed since a plan was solved. */
export type Changes = Partial<Record<keyof ChangeCount, boolean>>;

/** The kinds of change made since the counts were `then`. */
export function changesSince(now: ChangeCount, then: ChangeCount): Changes {
  return { save: now.save > then.save, reread: now.reread > then.reread, you: now.you > then.you };
}

/**
 * The note on a plan that is out of date. `solvedTurn` is the game turn it was solved on;
 * `deadlinePassed` when the goal's deadline has to move before you can solve again.
 */
export function staleNote(by: Changes, solvedTurn: number, now: number, deadlinePassed = false): string {
  let what: string;
  // The turn can go down too (an older save, or a typo fixed).
  if (now !== solvedTurn) what = by.save || by.reread ? `the save is now on turn ${now}` : `the turn is now ${now}`;
  else if (by.save && by.you) what = 'your save changed, and so did your map, settings or goal';
  else if (by.save) what = 'your save changed since this plan was made';
  else if (by.reread && by.you) what = 'Refresh read the save again, and you changed the map, settings or goal';
  else if (by.reread) what = 'Refresh read the save again';
  else what = 'you changed the map, settings or goal';
  return `Out of date: ${what}. ${deadlinePassed ? 'Pick a later turn, then press Solve again.' : 'Press Solve again to update the plan.'}`;
}
