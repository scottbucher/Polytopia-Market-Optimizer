import { BUILDING_NAMES, techName } from '../data/rules';
import type { GameState } from '../model/types';
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
    const label =
      a.op === 'clear' ? 'Clear forest' : a.op === 'burn' ? 'Burn forest' : a.op === 'grow' ? 'Grow forest' : `Destroy ${t.improvement !== 'none' && t.improvement !== 'other' && t.improvement !== 'city' ? BUILDING_NAMES[t.improvement] : 'building'}`;
    return { title: label, detail: where(state, a.tile) };
  }
  return { title: `Build ${BUILDING_NAMES[a.build]}`, detail: where(state, a.tile) };
}

export function starText(cost: number) {
  if (cost < 0) return `+${-cost}★`;
  return `${cost}★`;
}
