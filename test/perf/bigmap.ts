import { makeState } from '../helpers';
import { rng } from '../brute';

/** A random N×N map with `cities` 5×5 cities (touching at the default spacing), used for timing. */
export function bigMap(cities: number, seed = 9, N = 30, spacing = 5) {
  const r = rng(seed);
  const CH = ['.', '.', ',', 'f', 'f', 'f', 'M', 'm', '~'];
  const rows: string[][] = [];
  for (let y = 0; y < N; y++) rows.push(Array.from({ length: N }, () => CH[Math.floor(r() * CH.length)]));
  const centers: [number, number][] = [];
  for (let cy = 3; cy < N - 2; cy += spacing) for (let cx = 3; cx < N - 2; cx += spacing) centers.push([cx, cy]);
  const cs = centers.slice(0, cities);
  for (const [x, y] of cs) rows[y][x] = 'C';
  const map = rows.map((row) => row.join('')).join('\n');
  return makeState(map, { owned: ['hunting', 'riding', 'organization', 'climbing'], allowDestroy: true, allowGrow: true, stars: 20, baseIncome: 15 }, (x, y) => {
    const i = cs.findIndex(([cx, cy]) => Math.abs(cx - x) <= 2 && Math.abs(cy - y) <= 2);
    return i < 0 ? null : i;
  });
}
