// Pure parts of keeping the planner in step with a save file: which file in the folder
// is the current game, whether a re-read is the same game, and what to keep on a refresh.
// The browser side (file handles, watching) is in saveSource.ts.

import type { GameState } from '../model/types';
import type { RawSave } from '../parse/stateFile';

/** How a save was opened: a plain file input (can't be re-read), a file handle, or a folder handle. */
export type SourceKind = 'input' | 'file' | 'folder';

/** What tells two reads apart without parsing them. */
export interface FileStamp {
  name: string;
  lastModified: number;
  size: number;
}

/** The game a save holds, as far as we can tell from outside. */
export interface GameKey {
  fileName: string;
  mapName: string;
  width: number;
  height: number;
}

/** The save the map on screen came from. */
export interface LinkedSave extends GameKey {
  kind: SourceKind;
  /** The player picked for this file (a save can have several human players). */
  playerId: number;
  /** The save's own estimate of non-market income when last read (see LoadReport.incomeEstimate). */
  incomeEstimate: number;
  turn: number;
  lastModified: number;
  size: number;
  /** When the map last matched the file (Date.now()). */
  syncedAt: number;
}

export function isStateFile(name: string) {
  return /\.state$/i.test(name) && !name.startsWith('.');
}

/**
 * The file of the game being played: the most recently changed .state file.
 * (A new game is a new file, and the game deletes the file when a game ends.)
 * On a tie, `prefer` (the file we follow now) wins, so a tie doesn't flip games.
 */
export function newestStateFile<T extends { name: string; lastModified: number }>(files: readonly T[], prefer?: string): T | null {
  let best: T | null = null;
  for (const f of files) {
    if (!isStateFile(f.name)) continue;
    if (!best || f.lastModified > best.lastModified || (f.lastModified === best.lastModified && (f.name === prefer || (best.name !== prefer && f.name > best.name)))) best = f;
  }
  return best;
}

export function gameKeyOf(save: RawSave, fileName: string): GameKey {
  return { fileName, mapName: save.header.mapName, width: save.header.width, height: save.header.height };
}

/**
 * Whether a new read is the game we already show. Each game has its own file (named by
 * game id), so a different file name is a different game; the map name and size guard
 * against a file that was replaced by another game.
 */
export function sameGame(a: GameKey | null | undefined, b: GameKey): boolean {
  return !!a && a.fileName === b.fileName && a.mapName === b.mapName && a.width === b.width && a.height === b.height;
}

export function changed(a: FileStamp | null | undefined, b: FileStamp): boolean {
  return !a || a.name !== b.name || a.lastModified !== b.lastModified || a.size !== b.size;
}

export function makeLink(kind: SourceKind, stamp: FileStamp, save: RawSave, playerId: number, incomeEstimate: number, now = Date.now()): LinkedSave {
  return {
    ...gameKeyOf(save, stamp.name),
    kind,
    playerId,
    incomeEstimate,
    turn: save.header.currentTurn,
    lastModified: stamp.lastModified,
    size: stamp.size,
    syncedAt: now,
  };
}

/**
 * A refreshed read of the same game. Everything the save knows (stars, techs, map,
 * cities, turn, tribe) comes from `fresh`; what the save doesn't know stays as the user set it:
 * what the plan may do, the rules and costs, and any correction to "Income per turn"
 * (kept as the same offset from the save's estimate, since the estimate moves with the game).
 */
export function mergeRefresh(prev: GameState, prevEstimate: number, fresh: GameState): GameState {
  const p = prev.settings;
  const offset = p.baseIncome - prevEstimate;
  return {
    ...fresh,
    settings: {
      ...fresh.settings,
      baseIncome: Math.min(9999, Math.max(0, fresh.settings.baseIncome + offset)),
      allowClear: p.allowClear,
      allowBurn: p.allowBurn,
      allowGrow: p.allowGrow,
      allowDestroy: p.allowDestroy,
      allowNewTech: p.allowNewTech,
      cityUpgrades: p.cityUpgrades,
      costs: { ...p.costs },
    },
  };
}

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export function formatAgo(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * Runs `attempt` until it succeeds or `tries` runs out, waiting `delayMs` between tries.
 * The game writes its save in place, so a read right after a change can catch half a file.
 */
export async function withRetry<T>(attempt: () => Promise<T>, tries: number, delayMs: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < Math.max(1, tries); i++) {
    if (i > 0) await sleep(delayMs);
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'NotAllowedError')) throw e; // won't fix itself
      last = e;
    }
  }
  throw last;
}
