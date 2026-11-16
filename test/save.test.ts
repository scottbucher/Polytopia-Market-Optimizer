import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { parseStateFile } from '../src/parse/stateFile';
import { humanPlayers, toGameState } from '../src/parse/toGameState';
import { runOptimizer } from '../src/solver';

// Put your own save at test/fixtures/game.state to run this (*.state is git-ignored).
const FIXTURE = ['test/fixtures/game.state', 'test/fixtures/scott-singleplayer.state'].find((f) => existsSync(f));

describe.skipIf(!FIXTURE)('real save file', () => {
  it('parses, hides fog, reads units, and optimizes', () => {
    const save = parseStateFile(new Uint8Array(readFileSync(FIXTURE!)));
    const [me] = humanPlayers(save);
    expect(me).toBeDefined();
    const r = toGameState(save, me.id);
    // every unexplored tile is blanked out
    const unseen = save.tiles.flat().filter((t) => !t.visibility.includes(me.id)).length;
    expect(r.hiddenTiles).toBe(unseen);
    expect(r.state.tiles.filter((t) => t.terrain === 'unknown').length).toBeGreaterThanOrEqual(unseen);
    // Units line up: owners are players and each unit stands on its own tile.
    const ids = new Set(save.players.map((p) => p.id));
    const units = save.tiles.flat().filter((t) => t.unit);
    for (const t of units) expect(ids.has(t.unit!.owner) && t.unit!.x === t.x && t.unit!.y === t.y).toBe(true);
    for (const t of units) if (t.passenger) expect(t.passenger.owner).toBe(t.unit!.owner);
    // Enemy units only on explored tiles.
    expect(r.state.tiles.some((t) => t.enemy && t.terrain === 'unknown')).toBe(false);
    const out = runOptimizer(r.state, { kind: 'max' });
    expect(out.result!.plan.changes.some((c) => r.state.tiles[c.tile].enemy)).toBe(false);
    expect(out.result).not.toBeNull();
    expect(out.ms).toBeLessThan(10000);
  });

  it('reads the turn and city levels, and plans with level-ups', () => {
    const save = parseStateFile(new Uint8Array(readFileSync(FIXTURE!)));
    const r = toGameState(save, humanPlayers(save)[0].id);
    expect(r.state.turn).toBe(save.header.currentTurn);
    for (const c of r.state.cities) {
      expect(c.level).toBeGreaterThanOrEqual(1);
      expect(c.population).toBeGreaterThanOrEqual(0);
      expect(c.population).toBeLessThanOrEqual(c.level!);
    }
    const out = runOptimizer(r.state, { kind: 'best-by', turns: 12 });
    expect(out.result).not.toBeNull();
    expect(out.ms).toBeLessThan(10000);
  });
});
