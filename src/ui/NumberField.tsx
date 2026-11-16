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
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
  /** Called while typing with the number typed so far (null when it isn't one yet), before it's committed. */
  onDraft?: (v: number | null) => void;
}

/**
 * Number input that lets you type freely (empty, "-", "1.") and only commits a
 * cleaned-up value on blur or Enter, so the box never jumps while you type.
 */
export function NumberField({ value, onChange, min = 0, max = Infinity, step = 1, integer = true, className, onDraft, ...rest }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    onDraft?.(null);
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
      // The iPhone number pads have no minus key: below zero needs the default keyboard.
      inputMode={min < 0 ? undefined : integer ? 'numeric' : 'decimal'}
      className={className}
      min={min}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setDraft(e.target.value);
        const v = Number(e.target.value);
        onDraft?.(e.target.value.trim() !== '' && Number.isFinite(v) ? v : null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      aria-label={rest['aria-label']}
      aria-describedby={rest['aria-describedby']}
      aria-invalid={rest['aria-invalid'] || undefined}
    />
  );
}
