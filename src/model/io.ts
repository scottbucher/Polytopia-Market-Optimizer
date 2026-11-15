import type { GameState } from './types';
import { defaultSettings } from './defaults';

const KEY = 'market-planner/state/v1';

export function saveLocal(state: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export function loadLocal(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseJson(raw) : null;
  } catch {
    return null;
  }
}

export function parseJson(text: string): GameState {
  const s = JSON.parse(text) as GameState;
  if (!s || typeof s.width !== 'number' || !Array.isArray(s.tiles) || s.tiles.length !== s.width * s.height) {
    throw new Error('This file is not a market planner map.');
  }
  s.settings = { ...defaultSettings(), ...s.settings, costs: { ...defaultSettings().costs, ...(s.settings?.costs ?? {}) } };
  s.cities = s.cities ?? [];
  return s;
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
