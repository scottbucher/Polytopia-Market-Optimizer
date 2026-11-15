// Market income: the one place that knows how markets, producers and support
// buildings add up.
//
// A producer (sawmill / windmill / forge) has one level per adjacent support building
// of its kind, up to MAX_LEVEL. A market earns the sum of the levels of the producers
// next to it, up to MAX_LEVEL. "Adjacent" = the 8 surrounding tiles.

import { type BuildingKind, isProducer, MAX_LEVEL, PRODUCER_SUPPORT } from '../data/rules';
import { neighbors } from '../model/types';

export type Layout = (BuildingKind | null)[];

/** Read access to a layout, so callers can overlay pending changes without copying. */
export type LayoutGet = (i: number) => BuildingKind | null;

export interface IncomeBreakdown {
  total: number;
  /** tile index -> stars per turn for each market */
  markets: Map<number, number>;
  /** tile index -> level for each producer */
  producers: Map<number, number>;
}

/** Neighbour lists for a map, computed once. */
export function neighborTable(width: number, height: number): number[][] {
  return Array.from({ length: width * height }, (_, i) => neighbors(width, height, i));
}

export function producerLevelAt(get: LayoutGet, nb: number[][], i: number): number {
  const b = get(i);
  if (!isProducer(b)) return 0;
  const sup = PRODUCER_SUPPORT[b];
  let n = 0;
  for (const j of nb[i]) {
    const x = get(j);
    if (x && sup.includes(x)) n++;
  }
  return Math.min(MAX_LEVEL, n);
}

export function marketIncomeAt(get: LayoutGet, nb: number[][], i: number): number {
  if (get(i) !== 'market') return 0;
  let sum = 0;
  for (const j of nb[i]) if (isProducer(get(j))) sum += producerLevelAt(get, nb, j);
  return Math.min(MAX_LEVEL, sum);
}

/** Tiles within 2 steps of each tile (including itself): where a change there can move income. */
export function radius2Table(nb: number[][]): number[][] {
  return nb.map((_, t) => [...marketsAround(nb, [t])]);
}

/** Markets whose income can change when the given tiles change (within 2 tiles). */
export function marketsAround(nb: number[][], tiles: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const t of tiles) {
    out.add(t);
    for (const n of nb[t]) {
      out.add(n);
      for (const m of nb[n]) out.add(m);
    }
  }
  return out;
}

export function income(layout: Layout, width: number, height: number, nb = neighborTable(width, height)): IncomeBreakdown {
  const get: LayoutGet = (i) => layout[i];
  const producers = new Map<number, number>();
  const markets = new Map<number, number>();
  let total = 0;
  layout.forEach((b, i) => {
    if (isProducer(b)) producers.set(i, producerLevelAt(get, nb, i));
  });
  layout.forEach((b, i) => {
    if (b === 'market') {
      const v = marketIncomeAt(get, nb, i);
      markets.set(i, v);
      total += v;
    }
  });
  return { total, markets, producers };
}

/** Total income of the markets on `tiles`. */
export function incomeOf(get: LayoutGet, nb: number[][], tiles: Iterable<number>): number {
  let total = 0;
  for (const t of tiles) total += marketIncomeAt(get, nb, t);
  return total;
}
