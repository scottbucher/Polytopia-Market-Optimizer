// The goal you picked and the numbers you typed for each kind, kept across reloads.
//
// Deadlines are stored as game turns ("by turn 30"), so loading a newer save of the
// same game keeps the same deadline. The solver works in turns from now.

import { readPref, writePref } from './prefs';
import type { Goal } from './types';

export { turnNow } from './types';

export type GoalKind = Goal['kind'];

export interface GoalPrefs {
  kind: GoalKind;
  /** Unset values follow the game: the target is 4★ more than your markets make now. */
  income: { income?: number; by?: number };
  bank: { stars: number; by?: number };
  'best-by': { by?: number };
}

/** A deadline you haven't set is this many turns from now. */
export const DEFAULT_TURNS: Record<Exclude<GoalKind, 'max'>, number> = { income: 10, bank: 8, 'best-by': 15 };
export const GOAL_KINDS: GoalKind[] = ['max', 'income', 'bank', 'best-by'];
export const MAX_TURN = 100_000;
const KEY = 'market-planner/goals/v1';

export const defaultGoalPrefs = (): GoalPrefs => ({ kind: 'max', income: {}, bank: { stars: 30 }, 'best-by': {} });

const int = (v: unknown, min: number, max: number): number | undefined => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : undefined);

/** Reads saved goal settings (JSON text, or already parsed). Anything missing or out of range falls back to the default. */
export function parseGoalPrefs(saved: unknown): GoalPrefs {
  const d = defaultGoalPrefs();
  let raw = saved;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return d;
    }
  }
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, Record<string, unknown> | undefined> & { kind?: unknown };
  const by = (o: Record<string, unknown> | undefined) => int(o?.by, 0, MAX_TURN);
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return {
    kind: GOAL_KINDS.includes(r.kind as GoalKind) ? (r.kind as GoalKind) : d.kind,
    income: clean({ income: int(r.income?.income, 1, 999), by: by(r.income) }),
    bank: clean({ stars: int(r.bank?.stars, 0, 9999) ?? d.bank.stars, by: by(r.bank) }),
    'best-by': clean({ by: by(r['best-by']) }),
  };
}

export const goalPrefsJson = (p: GoalPrefs) => JSON.stringify(p);

export const loadGoalPrefs = (): GoalPrefs => parseGoalPrefs(readPref<unknown>(KEY, null));

export const saveGoalPrefs = (p: GoalPrefs) => writePref(KEY, p);

export interface ResolvedGoal {
  /** What the solver gets: deadlines as turns from now. */
  goal: Goal;
  /** The deadline as a game turn (null for "most income"). */
  by: number | null;
  /** Why this goal can't be solved as it stands (a deadline that isn't after this turn). */
  problem: string | null;
}

/** The goal for the solver, given the game's turn now and your market income now. */
export function resolveGoal(p: GoalPrefs, now: number, marketIncome: number): ResolvedGoal {
  if (p.kind === 'max') return { goal: { kind: 'max' }, by: null, problem: null };
  const by = p[p.kind].by ?? now + DEFAULT_TURNS[p.kind];
  const turns = Math.max(0, by - now);
  const problem = by <= now ? `Turn ${by} ${by === now ? 'is this turn' : 'has passed'} (it's turn ${now} now). Pick a later turn.` : null;
  const goal: Goal =
    p.kind === 'income'
      ? { kind: 'income', income: p.income.income ?? Math.max(1, marketIncome + 4), turns }
      : p.kind === 'bank'
        ? { kind: 'bank', stars: p.bank.stars, turns }
        : { kind: 'best-by', turns };
  return { goal, by, problem };
}

/** "(12 turns from now)" for a deadline. */
export function turnsFromNow(by: number, now: number): string {
  const n = by - now;
  if (n === 1) return 'next turn';
  if (n > 1) return `${n} turns from now`;
  return n === 0 ? 'this turn' : `${-n} turn${n === -1 ? '' : 's'} ago`;
}
