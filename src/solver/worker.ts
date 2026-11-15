import { planResult } from './goals';
import { runOptimizer } from './index';
import type { WorkerRequest, WorkerResponse } from './protocol';

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'solve') post({ type: 'solve', id: req.id, ok: true, result: runOptimizer(req.state, req.goal) });
    else post({ type: 'plan', id: req.id, ok: true, result: planResult(req.state, req.plan) });
  } catch (err) {
    post({ type: req.type, id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
