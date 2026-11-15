import { useMemo, useState } from 'react';
import { techName } from '../data/rules';
import type { GameState, Goal } from '../model/types';
import type { Plan } from '../solver/exact';
import type { GoalResult } from '../solver/goals';
import type { Step } from '../solver/schedule';
import { describeAction, starText } from './describe';

interface Props {
  state: GameState;
  goal: Goal;
  result: GoalResult;
  frontier: Plan[];
  currentIncome: number;
  selected: number;
  onSelect: (i: number) => void;
  onHoverTile: (t: number | null) => void;
  ms: number;
}

export function ResultsPanel({ state, result, frontier, currentIncome, selected, onSelect, onHoverTile, ms }: Props) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const steps = result.schedule.steps;
  const spend = steps.reduce((s, x) => s + x.action.cost, 0);
  const finalIncome = result.schedule.finalIncome;
  const gain = finalIncome - currentIncome;
  const payback = gain > 0 ? Math.ceil(spend / gain) : null;

  const byTurn = useMemo(() => {
    const m = new Map<number, { step: Step; n: number }[]>();
    steps.forEach((s, n) => {
      if (!m.has(s.turn)) m.set(s.turn, []);
      m.get(s.turn)!.push({ step: s, n: n + 1 });
    });
    return [...m.entries()];
  }, [steps]);

  return (
    <section className="results" aria-live="polite">
      <p className={`summary${result.met ? '' : ' warn'}`}>{result.summary}</p>
      <div className="stats">
        <Stat label="Market income" value={`${currentIncome} → ${finalIncome}★`} sub={gain > 0 ? `+${gain} per turn` : 'no change'} />
        <Stat label="Stars to spend" value={`${spend}★`} sub={result.plan.techs.length ? `${result.plan.techCost}★ of it on techs` : 'no new techs'} />
        <Stat label="Pays for itself" value={payback === null ? '—' : `${payback} turns`} sub={steps.length ? `last step on turn ${result.schedule.doneTurn}` : ''} />
      </div>
      {result.plan.techs.length > 0 && (
        <p className="techs-line">
          Techs to research: {result.plan.techs.map((t) => techName(t, state.settings.tribe)).join(', ')}
        </p>
      )}

      <h3>Build order</h3>
      {steps.length === 0 ? (
        <p className="muted">Nothing to build.</p>
      ) : (
        <ol className="todo">
          {byTurn.map(([turn, items]) => (
            <li key={turn} className="turn">
              <div className="turn-head">
                <span>{turn === 0 ? 'This turn' : `Turn +${turn}`}</span>
                <span className="muted">{items[0].step.starsBefore}★ available</span>
              </div>
              <ul>
                {items.map(({ step, n }) => {
                  const d = describeAction(state, step.action);
                  const tile = step.action.kind === 'tech' ? null : step.action.tile;
                  const isDone = done.has(n);
                  return (
                    <li
                      key={n}
                      className={`step${isDone ? ' done' : ''}`}
                      onMouseEnter={() => onHoverTile(tile)}
                      onMouseLeave={() => onHoverTile(null)}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => {
                            const s = new Set(done);
                            if (isDone) s.delete(n);
                            else s.add(n);
                            setDone(s);
                          }}
                        />
                        <span className="n">{n}</span>
                        <span className="what">
                          {d.title}
                          {d.detail && <small>{d.detail}</small>}
                        </span>
                        <span className="cost">{starText(step.action.cost)}</span>
                        <span className="after" title="Market income after this step">
                          {step.incomeAfter}★/t
                        </span>
                      </label>
                    </li>
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
          <p className="muted small">The cheapest layout found for each income level. Pick one to see its build order.</p>
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
                <tr key={i} className={i === selected ? 'sel' : ''} onClick={() => onSelect(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(i)}>
                  <td>{p.income}★</td>
                  <td>{p.cost}★</td>
                  <td>{p.techs.map((t) => techName(t, state.settings.tribe)).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small">Solved in {ms} ms.</p>
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
