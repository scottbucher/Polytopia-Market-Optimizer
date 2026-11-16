import { useCallback, useEffect, useRef, useState } from 'react';
import { type GameState, type Goal, turnNow } from '../model/types';
import type { Plan } from '../solver/exact';
import type { GoalResult } from '../solver/goals';
import type { OptimizeResult } from '../solver/index';
import type { WorkerRequest, WorkerResponse } from '../solver/protocol';

export interface Solved extends OptimizeResult {
  /** The state this was solved for (JSON), to tell when it is out of date. */
  stateKey: string;
  /** Changes on every solve. */
  runId: number;
  /** The game turn it was solved on: a refresh can move the game on before you solve again. */
  turn: number;
}

/** Runs the optimizer in a worker. One job at a time: a new one cancels the last. */
export function useOptimizer(onError: (msg: string) => void) {
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const [busy, setBusy] = useState<null | 'solve' | 'plan'>(null);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [picked, setPicked] = useState<{ index: number; result: GoalResult } | null>(null);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const run = useCallback(
    (req: WorkerRequest, done: (r: WorkerResponse & { ok: true }) => void) => {
      stop();
      const w = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      setBusy(req.type);
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id !== req.id) return;
        setBusy(null);
        stop();
        if (e.data.ok) done(e.data);
        else onError(`The optimizer hit an error: ${e.data.error}`);
      };
      w.onerror = (e) => {
        setBusy(null);
        stop();
        onError(e.message || 'The optimizer crashed.');
      };
      w.postMessage(req);
    },
    [stop, onError],
  );

  const solve = (state: GameState, goal: Goal, stateKey: string) => {
    setPicked(null);
    const turn = turnNow(state);
    run({ type: 'solve', id: ++reqId.current, state, goal }, (r) => {
      if (r.type === 'solve') setSolved({ ...r.result, stateKey, runId: r.id, turn });
    });
  };

  const pick = (state: GameState, index: number, plan: Plan) => {
    run({ type: 'plan', id: ++reqId.current, state, plan }, (r) => {
      if (r.type === 'plan') setPicked({ index, result: r.result });
    });
  };

  const reset = () => {
    stop();
    setBusy(null);
    setSolved(null);
    setPicked(null);
  };

  return { busy, solved, picked, solve, pick, reset };
}
