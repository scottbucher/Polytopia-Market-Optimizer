// Exhaustive search for small maps: the exact cheapest cost for every income level.
import { LIMITED, type TechKey } from '../src/data/rules';
import type { GameState } from '../src/model/types';
import { income, neighborTable } from '../src/solver/income';
import { makeTechBiller, tileOptions } from '../src/solver/options';

type Opt = ReturnType<typeof tileOptions>[number];

export interface BruteLevel {
  inc: number;
  cost: number;
  layout?: string;
}

/** Pareto frontier (cost strictly rising with income), or null when the map is too big. */
export function bruteFrontier(s: GameState, limit = 3e6, debug = false): BruteLevel[] | null {
  // Drop options another option of the same tile beats outright (same building, no more
  // cost, no extra unowned techs): they can never be part of a cheaper layout.
  const unowned = (o: Opt) => o.techs.filter((t) => !s.settings.owned.includes(t));
  const dominated = (o: Opt, by: Opt) =>
    by !== o && by.build === o.build && by.cost <= o.cost && unowned(by).every((t) => unowned(o).includes(t)) && (by.cost < o.cost || unowned(by).length < unowned(o).length || by.keep);
  const to = s.tiles
    .map((t, i) => {
      const all = tileOptions(s, i);
      return { tile: i, city: t.city, options: all.filter((o, k) => !all.some((b, j) => dominated(o, b) || (j < k && b.build === o.build && b.cost === o.cost && unowned(b).join() === unowned(o).join()))) };
    })
    .filter((x) => x.options.length);
  let prod = 1;
  for (const t of to) prod *= t.options.length;
  if (prod > limit) return null;
  const bill = makeTechBiller(s);
  const nb = neighborTable(s.width, s.height);
  const layout = s.tiles.map(() => null as ReturnType<typeof tileOptions>[number]['build']);
  const counts = new Map<string, number>();
  const techCnt = new Map<TechKey, number>();
  const billCache = new Map<string, number>();
  const best = new Map<number, number>();
  const bestLayout = new Map<number, string>();
  let bcost = 0;
  const rec = (k: number) => {
    if (k === to.length) {
      const inc = income(layout, s.width, s.height, nb).total;
      const need = [...techCnt].filter(([, n]) => n > 0).map(([t]) => t).sort();
      const key = need.join();
      let tc = billCache.get(key);
      if (tc === undefined) billCache.set(key, (tc = bill(need).cost));
      const cost = bcost + tc;
      if (cost < (best.get(inc) ?? Infinity)) {
        best.set(inc, cost);
        if (debug) bestLayout.set(inc, to.map((x) => `${x.tile}:${layout[x.tile] ?? '-'}`).join(' ') + ' techs ' + key);
      }
      return;
    }
    for (const o of to[k].options) {
      let key = '';
      if (o.build && LIMITED.includes(o.build)) {
        key = `${to[k].city}:${o.build}`;
        if (counts.get(key)) continue;
        counts.set(key, 1);
      }
      layout[to[k].tile] = o.build;
      bcost += o.cost;
      for (const t of o.techs) techCnt.set(t, (techCnt.get(t) ?? 0) + 1);
      rec(k + 1);
      for (const t of o.techs) techCnt.set(t, techCnt.get(t)! - 1);
      bcost -= o.cost;
      if (key) counts.set(key, 0);
    }
    layout[to[k].tile] = null;
  };
  rec(0);
  const e = [...best.entries()].sort((a, b) => a[0] - b[0]);
  const out: BruteLevel[] = [];
  let last = Infinity;
  for (let i = e.length - 1; i >= 0; i--) {
    if (e[i][1] >= last) continue;
    last = e[i][1];
    out.unshift({ inc: e[i][0], cost: e[i][1], ...(debug ? { layout: bestLayout.get(e[i][0]) } : {}) });
  }
  return out;
}

/** Small deterministic random generator for property tests. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
