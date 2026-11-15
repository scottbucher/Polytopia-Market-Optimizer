import type { GameState, Goal } from '../model/types';
import { runOptimizer } from './index';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState; goal: Goal }>) => {
  const { id, state, goal } = e.data;
  try {
    const r = runOptimizer(state, goal);
    (self as unknown as Worker).postMessage({ id, ok: true, result: r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
