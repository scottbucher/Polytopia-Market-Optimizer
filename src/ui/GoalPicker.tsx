import { useId, useState } from 'react';
import { type GoalKind, type GoalPrefs, MAX_TURN, pastTurn, turnsFromNow } from '../model/goalPrefs';
import type { Goal } from '../model/types';
import { NumberField } from './NumberField';

type EditGoal = <K extends Exclude<GoalKind, 'max'>>(kind: K, patch: Partial<GoalPrefs[K]>) => void;

interface Props {
  goal: Goal;
  /** The deadline as a game turn (null for "most income"). */
  deadline: number | null;
  now: number;
  /** Why the goal can't be solved as it stands. */
  problem: string | null;
  onKind: (kind: GoalKind) => void;
  onEdit: EditGoal;
}

/** The "What do you want?" choices, with the numbers for the picked one. */
export function GoalPicker({ goal, deadline, now, problem, onKind, onEdit }: Props) {
  const by = deadline ?? now;
  return (
    <div className="goals" role="radiogroup" aria-labelledby="goal-label">
      <GoalOpt checked={goal.kind === 'max'} onSelect={() => onKind('max')} title="Most market income" desc="Highest stars per turn, at the lowest cost for that income." />
      <GoalOpt checked={goal.kind === 'income'} onSelect={() => onKind('income')} title="Reach an income" desc="Get to a market income as soon as possible.">
        {goal.kind === 'income' && (
          <span className="inline">
            <NumberField aria-label="Market income to reach" min={1} max={999} value={goal.income} onChange={(v) => onEdit('income', { income: v })} />
            ★ per turn from markets
            <Deadline by={by} now={now} problem={problem} onChange={(v) => onEdit('income', { by: v })} />
          </span>
        )}
      </GoalOpt>
      <GoalOpt
        checked={goal.kind === 'bank'}
        onSelect={() => onKind('bank')}
        title="Save up stars"
        desc="Have a number of stars on hand on a turn, after that turn's income and before you spend. Invests only where it pays off in time."
      >
        {goal.kind === 'bank' && (
          <span className="inline">
            <NumberField aria-label="Stars to have" min={0} max={9999} value={goal.stars} onChange={(v) => onEdit('bank', { stars: v })} />★
            <Deadline by={by} now={now} problem={problem} onChange={(v) => onEdit('bank', { by: v })} />
          </span>
        )}
      </GoalOpt>
      <GoalOpt
        checked={goal.kind === 'best-by'}
        onSelect={() => onKind('best-by')}
        title="Best return by a turn"
        desc="Most stars on hand by a turn: only builds that pay for themselves before then."
      >
        {goal.kind === 'best-by' && (
          <span className="inline">
            <Deadline by={by} now={now} problem={problem} onChange={(v) => onEdit('best-by', { by: v })} />
          </span>
        )}
      </GoalOpt>
    </div>
  );
}

/** Why the plan can't be worked out yet, if the map is missing what it needs. */
export function SolveHint({ cities, mappedTiles }: { cities: number; mappedTiles: number }) {
  if (cities === 0) return <p className="small muted">Add at least one city to the map first: pick the City tool and tap a tile.</p>;
  if (mappedTiles === 0) return <p className="small muted">Paint the terrain around your cities first: none of your territory is explored yet.</p>;
  return null;
}

function GoalOpt({ checked, onSelect, title, desc, children }: { checked: boolean; onSelect: () => void; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className={`goal${checked ? ' on' : ''}`}>
      <label>
        <input type="radio" name="goal" checked={checked} onChange={onSelect} />
        <span>
          <strong>{title}</strong>
          <small>{desc}</small>
        </span>
      </label>
      {children}
    </div>
  );
}

/** "by turn [30]" with how far away that is, or why it can't be used. Follows the number while you type. */
function Deadline({ by, now, problem, onChange }: { by: number; now: number; problem: string | null; onChange: (v: number) => void }) {
  const id = useId();
  const [typed, setTyped] = useState<number | null>(null);
  const shown = typed === null ? by : Math.round(typed);
  // Said the same way as the goal's own check.
  const issue = typed === null ? problem : shown <= now ? pastTurn(shown, now) : null;
  return (
    <>
      <span className="by">
        by turn{' '}
        <NumberField aria-label="Deadline turn" aria-describedby={id} aria-invalid={issue !== null} min={0} max={MAX_TURN} value={by} onChange={onChange} onDraft={setTyped} />
      </span>
      {issue ? (
        <small id={id} className="deadline warn" role={typed === null ? 'alert' : undefined}>
          {issue}
        </small>
      ) : (
        <small id={id} className="deadline">
          ({turnsFromNow(shown, now)})
        </small>
      )}
    </>
  );
}
