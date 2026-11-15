import type { GameState, Goal } from '../model/types';
import { type Frontier, type Plan } from './exact';
import { type Action, orderActions, type Schedule, simulate } from './schedule';

export interface GoalResult {
  plan: Plan;
  bundles: Action[][];
  schedule: Schedule;
  /** Did the plan meet the goal within the turn limit? (always true for "max") */
  met: boolean;
  summary: string;
  /** For income goals: turn the target income is first collected. */
  reachedTurn?: number;
  /** For bank goals: stars on hand at the start of the deadline turn. */
  bankAtDeadline?: number;
  /** Stars you would have at the deadline by building nothing. */
  bankIfNothing?: number;
}

function firstIncomeTurn(s: Schedule, target: number) {
  const t = s.incomeAtTurn.findIndex((v) => v >= target);
  return t < 0 ? Infinity : t;
}

export function evaluateGoal(state: GameState, frontier: Frontier, goal: Goal): GoalResult | null {
  const plans = frontier.plans;
  if (!plans.length) return null;

  if (goal.kind === 'max') {
    const plan = plans[plans.length - 1];
    const bundles = orderActions(state, plan);
    const schedule = simulate(state, bundles);
    return {
      plan,
      bundles,
      schedule,
      met: true,
      summary: `Maximum market income is ${plan.income}★ per turn for ${plan.cost}★.`,
    };
  }

  if (goal.kind === 'income') {
    let best: GoalResult | null = null;
    for (const plan of plans) {
      if (plan.income < goal.income) continue;
      const all = orderActions(state, plan);
      // Stop once the target is reached: later bundles are not needed for this goal.
      const bundles: Action[][] = [];
      for (const b of all) {
        bundles.push(b);
        const sch = simulate(state, bundles, goal.turns);
        if (sch.finalIncome >= goal.income) break;
      }
      const schedule = simulate(state, bundles, goal.turns);
      const reachedTurn = firstIncomeTurn(schedule, goal.income);
      const cost = bundles.flat().reduce((s, a) => s + a.cost, 0);
      const r: GoalResult = {
        plan,
        bundles,
        schedule,
        met: reachedTurn <= goal.turns,
        reachedTurn,
        summary: '',
      };
      const better =
        !best ||
        reachedTurn < (best.reachedTurn ?? Infinity) ||
        (reachedTurn === best.reachedTurn && cost < best.bundles.flat().reduce((s, a) => s + a.cost, 0));
      if (better) best = r;
    }
    if (!best) {
      const top = plans[plans.length - 1];
      const bundles = orderActions(state, top);
      return {
        plan: top,
        bundles,
        schedule: simulate(state, bundles, goal.turns),
        met: false,
        summary: `${goal.income}★ per turn from markets isn't possible here. The most you can get is ${top.income}★.`,
      };
    }
    const t = best.reachedTurn!;
    best.summary = best.met
      ? `You can be collecting ${goal.income}★ per turn from markets on turn ${t} (${t === 1 ? 'next turn' : `${t} turns from now`}).`
      : t === Infinity
        ? `Not reachable with your current income.`
        : `Not reachable in ${goal.turns} turns. The fastest plan gets there on turn ${t}.`;
    return best;
  }

  // Bank goals: most stars on hand at the deadline.
  const T = goal.turns;
  const bankIfNothing = simulate(state, [], T).starsAtTurn[T];
  let best: GoalResult | null = null;
  for (const plan of plans) {
    const all = orderActions(state, plan);
    for (let k = 0; k <= all.length; k++) {
      const bundles = all.slice(0, k);
      const schedule = simulate(state, bundles, T);
      // Stars are counted at the start of the deadline turn, so every step must be done before it.
      if (schedule.steps.length < bundles.flat().length || schedule.steps.some((s) => s.turn >= T)) continue;
      const bank = schedule.starsAtTurn[T];
      if (!best || bank > (best.bankAtDeadline ?? -Infinity)) {
        best = { plan, bundles, schedule, met: true, bankAtDeadline: bank, bankIfNothing, summary: '' };
      }
    }
  }
  if (!best) return null;
  const bank = best.bankAtDeadline!;
  const built = best.bundles.length > 0;
  if (goal.kind === 'bank') {
    best.met = bank >= goal.stars;
    best.summary = best.met
      ? built
        ? `You can have ${bank}★ on turn ${T} (goal ${goal.stars}★). Building nothing would leave you ${bankIfNothing}★.`
        : `Build nothing: you'll have ${bank}★ on turn ${T}, which already meets ${goal.stars}★. No market pays for itself in time.`
      : `The most you can have on turn ${T} is ${bank}★, short of ${goal.stars}★.`;
  } else {
    best.summary = built
      ? `Best for turn ${T}: ${bank}★ on hand, versus ${bankIfNothing}★ if you build nothing.`
      : `Nothing pays for itself within ${T} turns. Save your stars (${bank}★ on turn ${T}).`;
  }
  return best;
}

