// Messages between the page and the optimizer worker.
import type { GameState, Goal } from '../model/types';
import type { Plan } from './exact';
import type { GoalResult } from './goals';
import type { OptimizeResult } from './index';

export type WorkerRequest =
  | { type: 'solve'; id: number; state: GameState; goal: Goal }
  /** Build order for one frontier plan ("Other plans"). */
  | { type: 'plan'; id: number; state: GameState; plan: Plan };

export type WorkerResponse =
  | { type: 'solve'; id: number; ok: true; result: OptimizeResult }
  | { type: 'plan'; id: number; ok: true; result: GoalResult }
  | { type: 'solve' | 'plan'; id: number; ok: false; error: string };
