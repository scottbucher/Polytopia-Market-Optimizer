import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS, type BuildingKind } from '../src/data/rules';
import { blankState, exampleState } from '../src/model/defaults';
import type { GameState } from '../src/model/types';
import { currentLayout } from '../src/solver/exact';
import { describeTile } from '../src/ui/describe';
import { rng } from './brute';
import {
  badgeRect,
  cityColor,
  cityLabelTitle,
  contrastOf,
  enemyR,
  enemySpot,
  GAME_VIEW,
  inkOn,
  isGameView,
  loadView,
  nearbyEnemies,
  type Overlay,
  pipsOf,
  placeLabels,
  type Rect,
  stepRect,
  tileCenter,
  type View,
} from '../src/ui/MapView';

// Screen coordinates: x grows to the right, y grows downwards.
describe('map view', () => {
  it('opens in the game view when nothing is stored', () => {
    expect(isGameView(loadView())).toBe(true);
  });

  for (const [w, h] of [
    [18, 18],
    [11, 16],
  ]) {
    it(`game view puts (0,0) at the bottom corner, +x up-right, +y up-left (${w}×${h})`, () => {
      const v: View = GAME_VIEW;
      const at = (x: number, y: number) => tileCenter(v, w, h, y * w + x);
      const centres = Array.from({ length: w * h }, (_, i) => tileCenter(v, w, h, i));
      const [x0, y0] = at(0, 0);
      // Bottom corner: lowest on screen, and no other tile is as low.
      expect(centres.filter(([, y]) => y >= y0)).toHaveLength(1);
      // The far corner is the top one.
      const [, yTop] = at(w - 1, h - 1);
      expect(Math.min(...centres.map(([, y]) => y))).toBe(yTop);
      // +x: up and to the right.
      const [x1, y1] = at(1, 0);
      expect(x1).toBeGreaterThan(x0);
      expect(y1).toBeLessThan(y0);
      // +y: up and to the left.
      const [x2, y2] = at(0, 1);
      expect(x2).toBeLessThan(x0);
      expect(y2).toBeLessThan(y0);
      // So (w-1, 0) is the right corner and (0, h-1) the left one.
      const xs = centres.map(([x]) => x);
      expect(at(w - 1, 0)[0]).toBe(Math.max(...xs));
      expect(at(0, h - 1)[0]).toBe(Math.min(...xs));
    });
  }
});

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

describe('map marks', () => {
  // Screen offsets of the eight neighbours of a tile, in any view.
  const v: View = GAME_VIEW;
  const [cx, cy] = tileCenter(v, 5, 5, 12);
  const neighbours = [6, 7, 8, 11, 13, 16, 17, 18].map((i) => tileCenter(v, 5, 5, i));

  it("a step number never covers a neighbour's building, and neighbours' buildings never overlap", () => {
    for (const n of [1, 9, 28, 105])
      for (const own of BUILDING_KINDS)
        for (const kind of BUILDING_KINDS)
          for (const [nx, ny] of neighbours) {
            expect(overlapArea(stepRect(cx, cy, n), badgeRect(kind, nx, ny))).toBe(0);
            expect(overlapArea(badgeRect(own, cx, cy), badgeRect(kind, nx, ny))).toBe(0);
          }
  });

  it('a step number touches its own building without covering it', () => {
    for (const n of [1, 9, 28, 105])
      for (const own of BUILDING_KINDS) {
        const step = stepRect(cx, cy, n);
        const badge = badgeRect(own, cx, cy);
        expect(overlapArea(step, badge)).toBe(0);
        expect(step[0] - badge[2]).toBeLessThanOrEqual(2);
      }
  });

  it('an enemy beside a building covers neither the building nor its step number', () => {
    const st = blankState(5, 5);
    for (const kind of BUILDING_KINDS) {
      st.tiles[12].improvement = kind;
      for (const n of [undefined, 1, 9, 28, 105]) {
        const overlay: Overlay = { layout: Array(25).fill(null), steps: new Map(n ? [[12, [n]]] : []), removed: new Set(), marketIncome: new Map() };
        overlay.layout[12] = kind;
        for (const o of [overlay, ...(n ? [] : [null])]) {
          const e = enemySpot(st.tiles[12], 12, o, cx, cy);
          expect(e.small).toBe(true);
          const r = enemyR(e.small);
          const circle: Rect = [e.x - r, e.y - r, e.x + r, e.y + r];
          expect(overlapArea(circle, badgeRect(kind, cx, cy))).toBe(0);
          if (n) expect(overlapArea(circle, stepRect(cx, cy, n))).toBe(0);
        }
      }
    }
  });

  it('city levels use whichever text colour has more contrast, at least 4.5:1', () => {
    expect(inkOn('#37b24d')).toBe('#000000');
    expect(inkOn('#ae3ec9')).toBe('#ffffff');
    expect(inkOn('#f59f00')).toBe('#000000');
    for (let i = 0; i < 10; i++) {
      expect(['#ffffff', '#000000']).toContain(inkOn(cityColor(i)));
      expect(contrastOf(inkOn(cityColor(i)), cityColor(i))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('population pips: filled ones, and red ones below zero', () => {
    expect(pipsOf(undefined, 2)).toEqual({ count: 0, filled: 0, below: 0 });
    expect(pipsOf(3, 2)).toEqual({ count: 4, filled: 2, below: 0 });
    expect(pipsOf(3, -2)).toEqual({ count: 4, filled: 0, below: 2 });
    expect(pipsOf(2, -5)).toEqual({ count: 5, filled: 0, below: 5 });
    expect(pipsOf(20, 15)).toEqual({ count: 12, filled: 12, below: 0 });
    expect(pipsOf(1, -40)).toEqual({ count: 12, filled: 0, below: 12 });
    expect(cityLabelTitle('Wopix')).toBe('Wopix');
    expect(cityLabelTitle('Wopix', 3)).toBe('Wopix, level 3');
    expect(cityLabelTitle('Wopix', 3, 2)).toBe('Wopix, level 3, population 2 of 4');
    expect(cityLabelTitle('Wopix', 20, 15)).toBe('Wopix, level 20, population 15 of 21');
    expect(cityLabelTitle('Wopix', 2, -3)).toBe('Wopix, level 2, population -3 (below zero)');
  });

  it('shows enemy units only in and next to your territory', () => {
    const st = blankState(6, 6);
    st.tiles[0].city = 0; // (0,0)
    for (const i of [1, 7, 2, 14, 35]) st.tiles[i].enemy = true; // (1,0) (1,1) next to it; (2,0) (2,2) (5,5) not
    st.tiles[0].enemy = true;
    expect([...nearbyEnemies(st)].sort((a, b) => a - b)).toEqual([0, 1, 7]);
  });
});

describe('city names on the map', () => {
  const centersOf = (st: GameState, v: View) => st.tiles.map((_, i) => tileCenter(v, st.width, st.height, i));

  /** Everything a name must never hide: cities, markets, planned buildings, step numbers and enemy units. */
  const mustSee = (st: GameState, overlay: Overlay | null, centers: [number, number][]) => {
    const out: Rect[] = [];
    const enemies = nearbyEnemies(st);
    st.tiles.forEach((t, i) => {
      const [x, y] = centers[i];
      if (t.improvement === 'city') out.push([x - 13, y - 10, x + 13, y + 6]);
      const kind = overlay?.layout[i] ?? t.improvement;
      if (kind === 'market' || (overlay && overlay.layout[i] && overlay.layout[i] !== t.improvement)) out.push(badgeRect(kind as BuildingKind, x, y));
      const steps = overlay?.steps.get(i);
      if (steps?.length) out.push(stepRect(x, y, steps[steps.length - 1]));
      if (enemies.has(i)) {
        const e = enemySpot(t, i, overlay, x, y);
        const r = enemyR(e.small);
        out.push([e.x - r, e.y - r, e.x + r, e.y + r]);
      }
    });
    return out;
  };
  const expectClear = (st: GameState, overlay: Overlay | null, v: View) => {
    const centers = centersOf(st, v);
    const placed = placeLabels(st, overlay, centers, nearbyEnemies(st));
    expect(placed.every(Boolean)).toBe(true);
    for (const p of placed) for (const r of mustSee(st, overlay, centers)) expect(overlapArea(p!.rect, r)).toBe(0);
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) expect(overlapArea(placed[a]!.rect, placed[b]!.rect)).toBe(0);
  };

  // Four cities two tiles apart with long names, every other tile built on, and a plan.
  const crowded = () => {
    const st = blankState(9, 9);
    st.tiles.forEach((t) => (t.terrain = 'field'));
    const spots = [
      [2, 2],
      [5, 2],
      [2, 5],
      [5, 6],
    ];
    spots.forEach(([x, y], c) => {
      st.cities.push({ name: ['Guarklak', 'Oumaji-Bay', 'Lirrikath', 'Xin-xi'][c], x, y, level: 3 + c, population: c - 1 });
      st.tiles[y * 9 + x].improvement = 'city';
    });
    st.tiles.forEach((t, i) => {
      const x = i % 9;
      const y = Math.floor(i / 9);
      let best = 0;
      let bd = Infinity;
      spots.forEach(([sx, sy], c) => {
        const d = Math.max(Math.abs(sx - x), Math.abs(sy - y));
        if (d < bd) [bd, best] = [d, c];
      });
      if (bd <= 2) t.city = best;
      if (t.improvement === 'none' && (x + y) % 2 === 0 && bd >= 1) t.improvement = (['farm', 'lumberhut', 'mine', 'other'] as const)[(x * 3 + y) % 4];
    });
    for (const [x, y] of [
      [3, 2],
      [6, 3],
      [2, 6],
    ])
      st.tiles[y * 9 + x].improvement = 'market';
    st.tiles[4 * 9 + 4].enemy = true;
    st.tiles[1 * 9 + 2].enemy = true;
    const layout = currentLayout(st);
    const steps = new Map<number, number[]>();
    let n = 0;
    for (const i of [1 * 9 + 1, 3 * 9 + 3, 2 * 9 + 4, 6 * 9 + 6, 5 * 9 + 3, 7 * 9 + 5]) {
      layout[i] = (['sawmill', 'windmill', 'forge', 'market'] as const)[n % 4];
      steps.set(i, [++n]);
    }
    const overlay: Overlay = { layout, steps, removed: new Set(), marketIncome: new Map() };
    return { st, overlay };
  };

  for (const [what, v] of [
    ['game view', GAME_VIEW],
    ['turned', { rot: 2, flip: false }],
  ] as [string, View][]) {
    it(`never hide a city, market, planned building, step number, enemy or another name (${what})`, () => {
      const { st, overlay } = crowded();
      for (const ov of [overlay, null]) expectClear(st, ov, v);
    });
  }

  it('the same on random maps, in every view', () => {
    const r = rng(5);
    const kinds = ['farm', 'lumberhut', 'mine', 'sawmill', 'windmill', 'market', 'other'] as const;
    for (let n = 0; n < 12; n++) {
      const st = blankState(8, 8);
      st.tiles.forEach((t) => (t.terrain = 'field'));
      for (let c = 0; c < 3; c++) {
        const x = 1 + 3 * c - (c === 2 ? 1 : 0);
        const y = 1 + Math.floor(r() * 6);
        st.cities.push({ name: ['Wopix', 'Guarklak', 'Oumaji'][c], x, y, level: 1 + Math.floor(r() * 6), population: Math.floor(r() * 5) - 2 });
        st.tiles[y * 8 + x].improvement = 'city';
      }
      st.tiles.forEach((t, i) => {
        t.city = Math.min(2, Math.floor((i % 8) / 3));
        if (t.improvement === 'none' && r() < 0.2) t.improvement = kinds[Math.floor(r() * kinds.length)];
        if (r() < 0.04) t.enemy = true;
      });
      const layout = currentLayout(st);
      const steps = new Map<number, number[]>();
      st.tiles.forEach((t, i) => {
        if (t.improvement === 'none' && r() < 0.1) {
          layout[i] = kinds[Math.floor(r() * 5)] as BuildingKind; // not "other"
          steps.set(i, [steps.size + 1]);
        }
      });
      const overlay: Overlay = { layout, steps, removed: new Set(), marketIncome: new Map() };
      for (let k = 0; k < 8; k++) for (const ov of [overlay, null]) expectClear(st, ov, { rot: (k % 4) as View['rot'], flip: k >= 4 });
    }
  });

  it('stays near its city: within a tile and a half with room around, within two on a crowded map', () => {
    const st = exampleState();
    const centers = centersOf(st, GAME_VIEW);
    const placed = placeLabels(st, null, centers, nearbyEnemies(st));
    placed.forEach((p, ci) => {
      const c = st.cities[ci];
      const [x, y] = centers[c.y * st.width + c.x];
      expect(Math.hypot(p!.x - x, p!.y - y)).toBeLessThanOrEqual(48);
    });
    const { st: busy, overlay } = crowded();
    const bc = centersOf(busy, GAME_VIEW);
    placeLabels(busy, overlay, bc, nearbyEnemies(busy)).forEach((p, ci) => {
      const c = busy.cities[ci];
      const [x, y] = bc[c.y * busy.width + c.x];
      expect(Math.hypot(p!.x - x, p!.y - y)).toBeLessThanOrEqual(112);
    });
    // Off the map: no name.
    st.cities.push({ name: 'Gone', x: 40, y: 0 });
    expect(placeLabels(st, null, centers, new Set()).at(-1)).toBeNull();
  });

  it('two long names side by side never share a spot', () => {
    // Two tiles apart on the same screen row, each name wider than the gap.
    const st = blankState(7, 7);
    st.tiles.forEach((t) => (t.terrain = 'field'));
    for (const [x, y] of [
      [2, 4],
      [4, 2],
    ]) {
      st.cities.push({ name: 'Kalamazoo-Lakes', x, y, level: 4 });
      st.tiles[y * 7 + x].improvement = 'city';
    }
    const centers = centersOf(st, GAME_VIEW);
    expect(centers[4 * 7 + 2][1]).toBe(centers[2 * 7 + 4][1]);
    const [a, b] = placeLabels(st, null, centers, new Set());
    expect(overlapArea(a!.rect, b!.rect)).toBe(0);
  });
});

describe('a tile in words', () => {
  it('names buildings and resources the way the app shows them, and the plan for the tile', () => {
    const st = blankState(3, 1);
    st.tiles.forEach((t) => {
      t.terrain = 'forest';
      t.city = 0;
    });
    st.cities.push({ name: 'Wopix', x: 1, y: 0 });
    st.tiles[1].improvement = 'city';
    st.tiles[0].improvement = 'lumberhut';
    st.tiles[2].resource = 'aquacrop';
    st.tiles[2].enemy = true;
    expect(describeTile(st, 0)).toBe('(0, 0) · Wopix · forest · Lumber Hut');
    expect(describeTile(st, 1)).toBe('(1, 0) · Wopix · forest · city');
    expect(describeTile(st, 2)).toBe('(2, 0) · Wopix · forest · water crop · enemy unit here');
    const plan = { layout: ['sawmill', null, null] as Overlay['layout'], steps: new Map([[0, [2, 6]]]), removed: new Set<number>() };
    expect(describeTile(st, 0, plan)).toBe('(0, 0) · Wopix · forest · Lumber Hut · planned Sawmill, steps 2, 6');
    plan.layout[0] = null;
    plan.removed.add(0);
    plan.steps.set(0, [3]);
    expect(describeTile(st, 0, plan)).toBe('(0, 0) · Wopix · forest · Lumber Hut · removed in the plan, step 3');
    expect(describeTile(st, 9)).toBeNull();
  });
});
