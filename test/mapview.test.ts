import { describe, expect, it } from 'vitest';
import { GAME_VIEW, isGameView, loadView, tileCenter, type View } from '../src/ui/MapView';

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
