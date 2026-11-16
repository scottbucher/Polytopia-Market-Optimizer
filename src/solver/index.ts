import type { GameState, Goal } from '../model/types';
import type { Frontier } from './exact';
import { evaluateGoal, type GoalResult } from './goals';
import { type Objective, search } from './search';

export interface OptimizeResult {
  frontier: Frontier;
  result: GoalResult | null;
  ms: number;
}

export function objectivesFor(goal: Goal): Objective[] {
  const max: Objective = { kind: 'weighted', w: 1000 };
  switch (goal.kind) {
    case 'max':
      // Cheaper objectives too: they reach layouts the income-only climb can miss, so the
      // maximum agrees with what the other goals' searches find.
      return [max, { kind: 'weighted', w: 10 }, { kind: 'weighted', w: 5 }];
    case 'income':
      return [{ kind: 'atleast', income: goal.income }, max];
    case 'bank':
    case 'best-by':
      return [
        { kind: 'weighted', w: Math.max(1, goal.turns / 2) },
        { kind: 'weighted', w: Math.max(1, goal.turns / 4) },
        max,
      ];
  }
}

export function runOptimizer(state: GameState, goal: Goal): OptimizeResult {
  const t = performance.now();
  const frontier = search(state, { objectives: objectivesFor(goal) });
  const result = evaluateGoal(state, frontier, goal);
  return { frontier, result, ms: Math.round(performance.now() - t) };
}
