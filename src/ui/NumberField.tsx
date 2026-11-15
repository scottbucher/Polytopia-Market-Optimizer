import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Round to a whole number (default true). */
  integer?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * Number input that lets you type freely (empty, "-", "1.") and only commits a
 * cleaned-up value on blur or Enter, so the box never jumps while you type.
 */
export function NumberField({ value, onChange, min = 0, max = Infinity, step = 1, integer = true, className, ...rest }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    let v = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(v)) {
      setDraft(String(value));
      return;
    }
    if (integer) v = Math.round(v);
    v = Math.min(max, Math.max(min, v));
    setDraft(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <input
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      className={className}
      min={min}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      aria-label={rest['aria-label']}
    />
  );
}
