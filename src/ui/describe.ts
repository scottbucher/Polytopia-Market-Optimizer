import { BUILDING_NAMES, cityReward, isBuildingKind, OP_NAMES, techName } from '../data/rules';
import type { GameState } from '../model/types';
import type { LevelUp } from '../solver/cities';
import type { Action } from '../solver/schedule';

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
  return `${tiles} Refresh your save once they move.`;
}

/** "Guarklak reaches level 3: take Resources, +5★ now and +1★ per turn". */
export function describeLevelUp(state: GameState, u: LevelUp): string {
  const name = state.cities[u.city]?.name.trim() || `City ${u.city + 1}`;
  const r = cityReward(u.level)!;
  const gains = [u.stars ? `+${u.stars}★ now` : '', r.population ? `+${r.population} population` : '', u.income ? `+${u.income}★ per turn` : ''].filter(Boolean);
  return `${name} reaches level ${u.level}: take ${r.name}, ${gains.join(' and ')}`;
}
