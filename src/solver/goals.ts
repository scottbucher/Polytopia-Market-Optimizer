import type { GameState, Goal } from '../model/types';
import { currentLayout, type Frontier, type Plan } from './exact';
import { income, neighborTable } from './income';
import { type Action, orderActions, type Schedule, simulate } from './schedule';

export interface GoalResult {
  plan: Plan;
  bundles: Action[][];
  schedule: Schedule;
  /** Did the plan meet the goal within the turn limit? (always true for "max") */
  met: boolean;
  summary: string;
  /** For income goals: turn the target income is first collected (0 = already). */
  reachedTurn?: number;
  /** For bank goals: stars on hand at the start of the deadline turn. */
  bankAtDeadline?: number;
  /** Stars you would have at the deadline by building nothing. */
  bankIfNothing?: number;
  /** Plan actions the build order could not place (a bug if this is ever non-empty). */
  skipped: Action[];
}

const totalCost = (bundles: Action[][]) => bundles.flat().reduce((s, a) => s + a.cost, 0);

/** Market income after each prefix of the bundles: result[k] = income after bundles[0..k). */
function incomeAfterBundles(state: GameState, bundles: Action[][]): number[] {
  const layout = currentLayout(state);
  const nb = neighborTable(state.width, state.height);
  const out = [income(layout, state.width, state.height, nb).total];
  for (const b of bundles) {
    for (const a of b) {
      if (a.kind === 'op' && a.op === 'destroy') layout[a.tile] = null;
      if (a.kind === 'build') layout[a.tile] = a.build;
    }
    out.push(income(layout, state.width, state.height, nb).total);
  }
  return out;
}

/** A few plans spread over the frontier (always the first and last), for the costlier goals. */
function spread(plans: Plan[], n: number): Plan[] {
  if (plans.length <= n) return plans;
  const out = new Set<Plan>();
  for (let i = 0; i < n; i++) out.add(plans[Math.round((i * (plans.length - 1)) / (n - 1))]);
  return [...out];
}

/** The full build order for one plan (used for "max" and when picking another plan). */
export function planResult(state: GameState, plan: Plan, summary?: string): GoalResult {
  const { bundles, skipped } = orderActions(state, plan);
  const schedule = simulate(state, bundles);
  return {
    plan,
    bundles,
    schedule,
    met: true,
    skipped,
    summary: summary ?? `This plan earns ${plan.income}★ per turn from markets for ${plan.cost}★ in total.`,
  };
}

export function evaluateGoal(state: GameState, frontier: Frontier, goal: Goal): GoalResult | null {
  const plans = frontier.plans;
  if (!plans.length) return null;
  const top = plans[plans.length - 1];

  if (goal.kind === 'max') {
    const r = planResult(state, top);
    r.summary =
      top.changes.length === 0
        ? `Your markets already make the most they can here: ${top.income}★ per turn.`
        : `Maximum market income is ${top.income}★ per turn, for ${top.cost}★ in total.`;
    return r;
  }

  if (goal.kind === 'income') {
    const target = goal.income;
    const now = income(currentLayout(state), state.width, state.height).total;
    if (now >= target) {
      const r = planResult(state, plans[0]);
      return { ...r, bundles: [], schedule: simulate(state, [], goal.turns), met: true, reachedTurn: 0, summary: `Your markets already make ${now}★ per turn, which meets ${target}★. Nothing to build.` };
    }
    // The cheapest few plans that reach the target (frontier cost rises with income).
    const cands = plans.filter((p) => p.income >= target).slice(0, 4);
    let best: GoalResult | null = null;
    for (const plan of cands) {
      const { bundles: all, skipped } = orderActions(state, plan);
      // Stop once the target is reached: later bundles are not needed for this goal.
      const after = incomeAfterBundles(state, all);
      const k = after.findIndex((v) => v >= target);
      const bundles = all.slice(0, k < 0 ? all.length : k);
      const schedule = simulate(state, bundles, goal.turns);
      const t = schedule.incomeAtTurn.findIndex((v) => v >= target);
      const reachedTurn = t < 0 ? Infinity : t;
      const r: GoalResult = { plan, bundles, schedule, met: reachedTurn <= goal.turns, reachedTurn, skipped, summary: '' };
      const better =
        !best ||
        reachedTurn < best.reachedTurn! ||
        (reachedTurn === best.reachedTurn && totalCost(bundles) < totalCost(best.bundles));
      if (better) best = r;
    }
    if (!best) {
      const r = planResult(state, top);
      r.met = false;
      r.summary = `${target}★ per turn from markets isn't possible here. The most you can get is ${top.income}★.`;
      return r;
    }
    const t = best.reachedTurn!;
    best.summary = best.met
      ? `You can be collecting ${target}★ per turn from markets on turn ${t} (${t === 1 ? 'next turn' : `${t} turns from now`}).`
      : t === Infinity
        ? `You can't afford to get there with your current income.`
        : `Not possible within ${goal.turns} turns. The fastest plan gets there on turn ${t}.`;
    return best;
  }

  // Bank goals: most stars on hand at the deadline.
  const T = goal.turns;
  const bankIfNothing = simulate(state, [], T).starsAtTurn[T];
  let best: GoalResult | null = null;
  for (const plan of spread(plans, 6)) {
    const { bundles: all, skipped } = orderActions(state, plan);
    for (let k = 0; k <= all.length; k++) {
      const bundles = all.slice(0, k);
      const schedule = simulate(state, bundles, T);
      // Stars are counted at the start of the deadline turn, so every step must be done before it.
      if (schedule.unaffordable > 0 || schedule.steps.some((s) => s.turn >= T)) break;
      const bank = schedule.starsAtTurn[T];
      if (!best || bank > best.bankAtDeadline! || (bank === best.bankAtDeadline && schedule.finalIncome > best.schedule.finalIncome)) {
        best = { plan, bundles, schedule, met: true, bankAtDeadline: bank, bankIfNothing, skipped, summary: '' };
      }
    }
  }
  if (!best) return null;
  const bank = best.bankAtDeadline!;
  const built = best.bundles.length > 0;
  const turnText = T === 0 ? 'this turn' : `turn ${T}`;
  if (goal.kind === 'bank') {
    best.met = bank >= goal.stars;
    best.summary = best.met
      ? built
        ? `You can have ${bank}★ on ${turnText} (goal ${goal.stars}★). Building nothing would leave you ${bankIfNothing}★.`
        : `Build nothing: you'll have ${bank}★ on ${turnText}, which already meets ${goal.stars}★. No market pays for itself in time.`
      : `The most you can have on ${turnText} is ${bank}★, short of ${goal.stars}★.`;
  } else {
    best.summary = built
      ? `Best for ${turnText}: ${bank}★ on hand, versus ${bankIfNothing}★ if you build nothing.`
      : `Nothing pays for itself by ${turnText}. Save your stars (${bank}★ on ${turnText}).`;
  }
  return best;
}
