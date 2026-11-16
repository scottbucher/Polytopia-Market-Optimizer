import { Fragment, useEffect, useMemo, useState } from 'react';
import { techName } from '../data/rules';
import { type GameState, turnNow } from '../model/types';
import type { Plan } from '../solver/exact';
import type { GoalResult } from '../solver/goals';
import { enemyBlocked } from '../solver/options';
import type { Step } from '../solver/schedule';
import { describeAction, describeLevelUp, describeUpgrades, enemyNote, paybackTurns, starText } from './describe';

interface Props {
  state: GameState;
  result: GoalResult;
  frontier: Plan[];
  currentIncome: number;
  selected: number;
  onSelect: (i: number) => void;
  onHoverTile: (t: number | null) => void;
  /** A step was tapped or clicked: show its tile on the map. */
  onShowTile: (t: number) => void;
  /** The game turn the plan was solved on (its build order counts from it). */
  turn: number;
  /** The map changed since this was solved: other plans can't be picked. */
  stale: boolean;
  /** A plan's build order is being worked out. */
  loading: boolean;
}

export function ResultsPanel({ state, result, frontier, currentIncome, selected, onSelect, onHoverTile, onShowTile, turn: now, stale, loading }: Props) {
  const [done, setDone] = useState<Set<number>>(new Set());
  // A different plan or result starts with nothing ticked.
  useEffect(() => setDone(new Set()), [result]);
  const steps = result.schedule.steps;
  const spend = steps.reduce((s, x) => s + x.action.cost, 0);
  // Techs actually in this build order (a goal can stop before the whole plan).
  const techSteps = steps.filter((x) => x.action.kind === 'tech');
  const techCost = techSteps.reduce((s, x) => s + x.action.cost, 0);
  const finalIncome = result.schedule.finalIncome;
  const gain = finalIncome - currentIncome;
  const { popPenalty } = result.schedule;
  const payback = paybackTurns(result.schedule, spend, gain);
  const blockedNote = useMemo(() => enemyNote(enemyBlocked(state).length), [state]);
  const levelUps = steps.flatMap((x) => x.levelUps ?? []);
  // A refresh moved the game on: the plan's turn numbers are from when it was solved.
  const movedOn = stale && turnNow(state) !== now;

  const byTurn = useMemo(() => {
    const m = new Map<number, { step: Step; n: number }[]>();
    steps.forEach((s, n) => {
      if (!m.has(s.turn)) m.set(s.turn, []);
      m.get(s.turn)!.push({ step: s, n: n + 1 });
    });
    return [...m.entries()];
  }, [steps]);

  return (
    <section className={`results${stale ? ' stale' : ''}`}>
      {stale && (
        <p className="small note warn stale-note">
          {movedOn ? `Out of date: the game moved on to turn ${turnNow(state)}. Press Solve again to update the plan.` : 'Out of date: you changed the map, settings or goal. Press Solve again to update the plan.'}
        </p>
      )}
      <p className={`summary${result.met ? '' : ' warn'}`} aria-live="polite">
        {result.summary}
      </p>
      {blockedNote && !stale && <p className="small note">{blockedNote}</p>}
      <div className="stats">
        <Stat label="Market income" value={`${currentIncome} → ${finalIncome}★`} sub={gain > 0 ? `+${gain} per turn` : 'no change'} />
        <Stat
          label={spend < 0 ? 'Stars back' : 'Stars to spend'}
          value={spend < 0 ? `+${-spend}★` : `${spend}★`}
          sub={techSteps.length ? `${techCost}★ of it on techs` : 'no new techs'}
        />
        <Stat label="Pays for itself" value={payback === null ? '—' : payback === 0 ? 'right away' : `${payback} turn${payback === 1 ? '' : 's'}`} sub={steps.length ? (result.schedule.doneTurn === 0 ? 'all built this turn' : `last step on turn ${now + result.schedule.doneTurn}`) : ''} />
      </div>
      {techSteps.length > 0 && (
        <p className="techs-line">
          Techs to research: {techSteps.map((x) => (x.action.kind === 'tech' ? techName(x.action.tech, state.settings.tribe) : '')).join(', ')}
        </p>
      )}
      {levelUps.length > 0 && <p className="upgrades">{describeUpgrades(state, levelUps)}</p>}
      {popPenalty > 0 && <p className="small warn">Destroying buildings takes population away: your cities make {popPenalty}★ less per turn until they grow back.</p>}
      {result.skipped.length > 0 && (
        <p className="small warn">
          {result.skipped.length} step{result.skipped.length === 1 ? '' : 's'} of this plan could not be put in a valid order and {result.skipped.length === 1 ? 'is' : 'are'} left out.
        </p>
      )}
      {result.schedule.unaffordable > 0 && (
        <p className="small warn">The last {result.schedule.unaffordable === 1 ? 'step is' : `${result.schedule.unaffordable} steps are`} never affordable with this income, so the list stops early.</p>
      )}

      <h3>Build order</h3>
      {steps.length === 0 ? (
        <p className="muted">Nothing to build.</p>
      ) : (
        <ol className="todo">
          {byTurn.map(([turn, items]) => (
            <li key={turn} className="turn">
              <div className="turn-head">
                <span>{turn === 0 ? `Turn ${now} (this turn)` : `Turn ${now + turn}`}</span>
                <span className="muted">{items[0].step.starsBefore}★ available</span>
              </div>
              <ul>
                {items.map(({ step, n }) => {
                  const d = describeAction(state, step.action);
                  const tile = step.action.kind === 'tech' ? null : step.action.tile;
                  const isDone = done.has(n);
                  return (
                    <Fragment key={n}>
                      <li
                        className={`step${isDone ? ' done' : ''}`}
                        onMouseEnter={() => onHoverTile(tile)}
                        onMouseLeave={() => onHoverTile(null)}
                      >
                        <span className="check">
                          <input
                            type="checkbox"
                            checked={isDone}
                            aria-label={`Mark step ${n} done`}
                            onChange={() => {
                              const s = new Set(done);
                              if (isDone) s.delete(n);
                              else s.add(n);
                              setDone(s);
                            }}
                          />
                        </span>
                        <button
                          type="button"
                          className="steprow"
                          disabled={tile === null}
                          title={tile === null ? undefined : 'Show on the map'}
                          onFocus={() => onHoverTile(tile)}
                          onBlur={() => onHoverTile(null)}
                          onClick={() => tile !== null && onShowTile(tile)}
                        >
                          <span className="n" aria-hidden="true">
                            {n}
                          </span>
                          <span className="what">
                            <span className="sr-only">Step {n}: </span>
                            {d.title}
                            {d.detail && <small>{d.detail}</small>}
                          </span>
                          <span className="cost">{starText(step.action.cost)}</span>
                          <span className="after">
                            <span className="sr-only">market income after this step </span>→ {step.incomeAfter}★<span className="unit"> per turn</span>
                          </span>
                        </button>
                      </li>
                      {step.levelUps?.map((u) => (
                        <li key={`${u.city}:${u.level}`} className="levelup">
                          <span className="icon-up" aria-hidden="true">
                            ▲
                          </span>
                          <span>{describeLevelUp(state, u)}</span>
                        </li>
                      ))}
                    </Fragment>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {frontier.length > 1 && (
        <>
          <h3>Other plans</h3>
          <p className="muted small">
            {stale ? 'The map changed since this was solved. Solve again to pick from these.' : 'The cheapest layout found for each income level. Pick one to see its build order.'}
          </p>
          <table className="frontier">
            <thead>
              <tr>
                <th>Market income</th>
                <th>Total cost</th>
                <th>Techs</th>
              </tr>
            </thead>
            <tbody>
              {frontier.map((p, i) => (
                <tr key={i} className={`${i === selected ? 'sel' : ''}${stale || loading ? ' off' : ''}`} onClick={() => !stale && !loading && onSelect(i)}>
                  <td>
                    <button
                      type="button"
                      className="pickbtn"
                      aria-pressed={i === selected}
                      disabled={stale}
                      aria-disabled={loading || undefined}
                      aria-label={p.changes.length === 0 ? 'Show building nothing' : `Show the ${p.income}★ plan`}
                    >
                      {p.income}★
                    </button>
                  </td>
                  <td>{p.changes.length === 0 ? 'Build nothing' : `${p.cost}★`}</td>
                  <td>{p.techs.map((t) => techName(t, state.settings.tribe)).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
