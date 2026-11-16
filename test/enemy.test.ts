// Enemy units: the plan never builds, destroys or changes terrain on a tile with one.
import { describe, expect, it } from 'vitest';
import { exampleState } from '../src/model/defaults';
import { mapJson, parseJson } from '../src/model/io';
import { applyTool } from '../src/model/paint';
import type { GameState } from '../src/model/types';
import { runOptimizer } from '../src/solver';
import { enemyBlocked, tileOptions } from '../src/solver/options';
import { search } from '../src/solver/search';
import { enemyNote } from '../src/ui/describe';
import { bruteFrontier, rng } from './brute';
import { makeState, withBuildings } from './helpers';

const withEnemies = (s: GameState, tiles: number[]) => {
  for (const i of tiles) s.tiles[i].enemy = true;
  return s;
};
const full = (s: GameState) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });
const touched = (s: GameState, plans: { changes: { tile: number }[] }[]) => plans.flatMap((p) => p.changes.map((c) => c.tile)).filter((t) => s.tiles[t].enemy);

describe('enemy units in the solver', () => {
  it('leaves the tile as it is', () => {
    const s = withEnemies(withBuildings(makeState('f.f\n.C.\nff.', { allowDestroy: true }), { 0: 'lumberhut' }), [0, 1]);
    for (const i of [0, 1]) expect(tileOptions(s, i)).toEqual([{ build: i === 0 ? 'lumberhut' : null, ops: [], keep: true, cost: 0, techs: [] }]);
    expect(tileOptions(s, 2).length).toBeGreaterThan(1);
  });

  it('keeps counting its building, and never builds a second one-per-city building around it', () => {
    // Market (3) next to a sawmill (1) with a lumber hut (0): 1★ now. The market tile has an enemy.
    const s = withEnemies(
      withBuildings(makeState('f.f\n.C.\nff.', { allowDestroy: true, owned: ['hunting', 'forestry', 'riding', 'roads', 'trade', 'mathematics'] }), { 0: 'lumberhut', 1: 'sawmill', 3: 'market' }),
      [3, 2],
    );
    for (const goal of [{ kind: 'max' as const }, { kind: 'income' as const, income: 3, turns: 20 }, { kind: 'best-by' as const, turns: 20 }]) {
      const out = runOptimizer(s, goal);
      const plans = out.frontier.plans;
      expect(touched(s, plans)).toEqual([]);
      for (const p of plans) {
        expect(p.layout[3]).toBe('market');
        expect(p.changes.some((c) => c.option.build === 'market')).toBe(false);
      }
      const steps = out.result!.schedule.steps.flatMap((x) => (x.action.kind === 'tech' ? [] : [x.action.tile]));
      expect(steps.filter((t) => s.tiles[t].enemy)).toEqual([]);
    }
    expect(runOptimizer(s, { kind: 'max' }).frontier.plans.at(-1)!.income).toBeGreaterThan(1);
  });

  const owned = ['hunting', 'riding', 'organization', 'climbing', 'forestry'] as never[];
  const maps = [`f.f\nfC,\n.ff`, `ff.\nfCf\n,fM`, `.f,\nfCf\nMf.`];
  for (const m of maps) {
    it(`matches brute force with enemies: ${m.replace(/\n/g, '/')}`, () => {
      const r = rng(m.length * 31 + m.charCodeAt(0));
      let mattered = false;
      for (let n = 0; n < 4; n++) {
        const s = makeState(m, { owned, allowDestroy: n % 2 === 1 });
        if (n % 2 === 1) withBuildings(s, { 1: s.tiles[1].terrain === 'forest' ? 'lumberhut' : 'market' });
        const enemies = [0, 1, 2, 3, 5, 6, 7, 8].filter(() => r() < 0.3);
        const free = bruteFrontier(s)!;
        withEnemies(s, enemies);
        const b = bruteFrontier(s)!;
        const f = full(s);
        expect(f.plans.map((p) => `${p.income}:${p.cost}`)).toEqual(b.map((x) => `${x.inc}:${x.cost}`));
        expect(touched(s, f.plans)).toEqual([]);
        if (JSON.stringify(free) !== JSON.stringify(b)) mattered = true;
      }
      expect(mattered).toBe(true);
    });
  }

  it('two cities: never plans a change on an enemy tile', () => {
    const r = rng(11);
    const chars = '..,,ffffmM~';
    for (let n = 0; n < 6; n++) {
      const rows = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => chars[Math.floor(r() * chars.length)]));
      rows[1][0] = 'C';
      rows[1][3] = 'C';
      const s = makeState(rows.map((x) => x.join('')).join('\n'), { owned: ['riding', 'roads', 'trade', 'hunting', 'forestry', 'mathematics'] as never[], allowDestroy: true }, (x) => (x < 2 ? 0 : 1));
      withEnemies(s, [1, 2, 9, 10].filter(() => r() < 0.5));
      const b = bruteFrontier(s, 4e6);
      const f = full(s);
      expect(touched(s, f.plans)).toEqual([]);
      if (b) for (const p of f.plans) expect(p.cost).toBeGreaterThanOrEqual(b.filter((x) => x.inc >= p.income)[0]?.cost ?? Infinity);
    }
  });

  it('notes the tiles it had to leave alone', () => {
    const s = withEnemies(withBuildings(makeState('f.f\n.C.\nff.'), { 0: 'lumberhut' }), [0, 1, 4]);
    // The lumber hut can't be destroyed (destroy is off) and the city centre never changes,
    // so only the empty field counts.
    expect(enemyBlocked(s)).toEqual([1]);
    expect(enemyNote(1)).toBe('1 of your tiles has an enemy unit on it, so the plan leaves it alone. Refresh your save once they move.');
    expect(enemyNote(2)).toMatch(/^2 of your tiles have enemy units on them/);
    expect(enemyNote(0)).toBe('');
  });
});

describe('enemy units on the map', () => {
  it('paint tool toggles, and not on unexplored tiles', () => {
    const s = makeState('...\n.C.\n...');
    applyTool(s, { kind: 'enemy' }, 0);
    expect(s.tiles[0].enemy).toBe(true);
    applyTool(s, { kind: 'enemy' }, 0);
    expect(s.tiles[0]).not.toHaveProperty('enemy');
    s.tiles[2].terrain = 'unknown';
    applyTool(s, { kind: 'enemy' }, 2);
    expect(s.tiles[2]).not.toHaveProperty('enemy');
    applyTool(s, { kind: 'enemy' }, 5);
    applyTool(s, { kind: 'terrain', v: 'unknown' }, 5);
    expect(s.tiles[5]).not.toHaveProperty('enemy');
  });

  it('round-trips in saved maps', () => {
    const s = exampleState();
    const i = s.tiles.findIndex((t) => t.terrain !== 'unknown');
    s.tiles[i].enemy = true;
    const text = mapJson(s);
    expect(text.match(/"enemy"/g)).toHaveLength(1);
    expect(parseJson(text)).toEqual(s);
    const raw = JSON.parse(text);
    raw.tiles[i].enemy = 'yes';
    raw.tiles[i + 1].enemy = 1;
    expect(parseJson(JSON.stringify(raw)).tiles.filter((t) => 'enemy' in t)).toEqual([]);
    const u = s.tiles.findIndex((t) => t.terrain === 'unknown');
    if (u >= 0) {
      raw.tiles[u].enemy = true;
      expect(parseJson(JSON.stringify(raw)).tiles[u]).not.toHaveProperty('enemy');
    }
  });
});
