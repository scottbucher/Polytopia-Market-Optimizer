import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from '../src/data/rules';
import { blankState } from '../src/model/defaults';
import { badgeRect, cityColor, GAME_VIEW, inkOn, isGameView, loadView, nearbyEnemies, type Rect, stepRect, tileCenter, type View } from '../src/ui/MapView';

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

  it('city levels use whichever text colour has more contrast', () => {
    expect(inkOn('#37b24d')).toBe('#1f2328');
    expect(inkOn('#1c7ed6')).toBe('#ffffff');
    expect(inkOn('#f59f00')).toBe('#1f2328');
    for (let i = 0; i < 10; i++) expect(['#ffffff', '#1f2328']).toContain(inkOn(cityColor(i)));
  });

  it('shows enemy units only in and next to your territory', () => {
    const st = blankState(6, 6);
    st.tiles[0].city = 0; // (0,0)
    for (const i of [1, 7, 2, 14, 35]) st.tiles[i].enemy = true; // (1,0) (1,1) next to it; (2,0) (2,2) (5,5) not
    st.tiles[0].enemy = true;
    expect([...nearbyEnemies(st)].sort((a, b) => a - b)).toEqual([0, 1, 7]);
  });
});
