import { type BuildingKind, MAX_LEVEL, PRODUCER_SUPPORT, PRODUCERS, type Producer } from '../data/rules';
import { neighbors } from '../model/types';

export type Layout = (BuildingKind | null)[];

export interface IncomeBreakdown {
  total: number;
  /** tile index -> stars per turn for each market */
  markets: Map<number, number>;
  /** tile index -> level for each producer */
  producers: Map<number, number>;
}

function isProducer(b: BuildingKind | null): b is Producer {
  return b === 'sawmill' || b === 'windmill' || b === 'forge';
}

export function producerLevel(layout: Layout, width: number, height: number, i: number): number {
  const b = layout[i];
  if (!isProducer(b)) return 0;
  const sup = PRODUCER_SUPPORT[b];
  let n = 0;
  for (const j of neighbors(width, height, i)) {
    const nb = layout[j];
    if (nb && sup.includes(nb)) n++;
  }
  return Math.min(MAX_LEVEL, n);
}

export function marketIncome(layout: Layout, width: number, height: number, i: number, levels?: Map<number, number>): number {
  if (layout[i] !== 'market') return 0;
  let sum = 0;
  for (const j of neighbors(width, height, i)) {
    if (isProducer(layout[j])) sum += levels?.get(j) ?? producerLevel(layout, width, height, j);
  }
  return Math.min(MAX_LEVEL, sum);
}

export function income(layout: Layout, width: number, height: number): IncomeBreakdown {
  const producers = new Map<number, number>();
  const markets = new Map<number, number>();
  layout.forEach((b, i) => {
    if (isProducer(b)) producers.set(i, producerLevel(layout, width, height, i));
  });
  let total = 0;
  layout.forEach((b, i) => {
    if (b === 'market') {
      const v = marketIncome(layout, width, height, i, producers);
      markets.set(i, v);
      total += v;
    }
  });
  return { total, markets, producers };
}

export { PRODUCERS };
