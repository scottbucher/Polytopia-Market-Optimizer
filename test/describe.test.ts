import { describe, expect, it } from 'vitest';
import { type ChangeCount, changesSince, NO_CHANGES, staleNote } from '../src/ui/describe';

describe('the note on an out-of-date plan', () => {
  const end = ' Press Solve again to update the plan.';
  it('says what changed, without blaming you for the save', () => {
    expect(staleNote({ save: true }, 5, 5)).toBe(`Out of date: your save changed since this plan was made.${end}`);
    expect(staleNote({ you: true }, 5, 5)).toBe(`Out of date: you changed the map, settings or goal.${end}`);
    expect(staleNote({ save: true, you: true }, 5, 5)).toBe(`Out of date: your save changed, and so did your map, settings or goal.${end}`);
    // The turn can go down too.
    expect(staleNote({ save: true }, 5, 7)).toBe(`Out of date: the save is now on turn 7.${end}`);
    expect(staleNote({ save: true, you: true }, 5, 3)).toBe(`Out of date: the save is now on turn 3.${end}`);
    expect(staleNote({ you: true }, 5, 6)).toBe(`Out of date: the turn is now 6.${end}`);
  });

  it("doesn't call reading the same file again a change to the save", () => {
    expect(staleNote({ reread: true }, 5, 5)).toBe(`Out of date: Refresh read the save again.${end}`);
    expect(staleNote({ reread: true, you: true }, 5, 5)).toBe(`Out of date: Refresh read the save again, and you changed the map, settings or goal.${end}`);
    expect(staleNote({ reread: true, save: true }, 5, 5)).toBe(`Out of date: your save changed since this plan was made.${end}`);
    expect(staleNote({ reread: true }, 5, 4)).toBe(`Out of date: the save is now on turn 4.${end}`);
  });

  it('asks for a later turn first when the deadline has passed', () => {
    expect(staleNote({ save: true }, 5, 9, true)).toBe('Out of date: the save is now on turn 9. Pick a later turn, then press Solve again.');
    expect(staleNote({ save: true }, 5, 9, false)).toBe(`Out of date: the save is now on turn 9.${end}`);
  });

  it('names only what changed after the solve started', () => {
    const atSolve: ChangeCount = { save: 2, reread: 1, you: 5 };
    expect(changesSince(atSolve, atSolve)).toEqual({ save: false, reread: false, you: false });
    expect(changesSince({ ...atSolve, you: 6 }, atSolve)).toEqual({ save: false, reread: false, you: true });
    expect(changesSince({ ...atSolve, save: 3 }, atSolve)).toEqual({ save: true, reread: false, you: false });
    expect(changesSince({ ...atSolve, reread: 2 }, atSolve)).toEqual({ save: false, reread: true, you: false });
    expect(changesSince({ save: 3, reread: 2, you: 6 }, atSolve)).toEqual({ save: true, reread: true, you: true });
    expect(changesSince(NO_CHANGES, NO_CHANGES)).toEqual({ save: false, reread: false, you: false });
  });
});
