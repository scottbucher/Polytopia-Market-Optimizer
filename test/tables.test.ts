// Tables and hand-computed values that pin the game rules, save ids and the turn simulation.
import { describe, expect, it } from 'vitest';
import { LIMITED, TECHS, TRIBES, type TechKey } from '../src/data/rules';
import { mapJson, parseJson } from '../src/model/io';
import type { GameState } from '../src/model/types';
import { techsFromIdx, toGameState } from '../src/parse/toGameState';
import type { RawSave, RawTile } from '../src/parse/stateFile';
import { missingChain, techPrice, tileOptions } from '../src/solver/options';
import { simulate } from '../src/solver/schedule';
import { search } from '../src/solver/search';
import { bruteFrontier } from './brute';
import { makeState, withBuildings } from './helpers';

const S = (s: GameState) => search(s, { objectives: [{ kind: 'weighted', w: 1000 }, { kind: 'weighted', w: 3 }] });
const builds = (s: GameState, i: number) => Object.fromEntries(tileOptions(s, i).map((o) => [String(o.build), [o.cost, [...o.techs].sort().join()]]));

describe('pinned rules and tables', () => {
  it('one market, sawmill, windmill and forge per city in every plan', () => {
    const s = withBuildings(makeState('ffffM\nf.fff\nfMCff\n..,ff\nf.fff', { owned: ['hunting', 'riding', 'organization', 'climbing', 'chivalry', 'freespirit'], allowDestroy: true, stars: 15 }), { 1: 'forge', 15: 'sawmill' });
    for (const p of S(s).plans) for (const k of LIMITED) expect(p.layout.filter((b) => b === k).length, `${k} in ${p.income}:${p.cost}`).toBeLessThanOrEqual(1);
  });

  it('the turn simulation, by hand', () => {
    const s = withBuildings(makeState('f..\nC..', { stars: 3, baseIncome: 2 }), { 0: 'lumberhut', 1: 'sawmill' });
    const sch = simulate(s, [[{ id: 0, kind: 'build', build: 'market', tile: 2, cost: 5 }]], 3);
    expect(sch.starsAtTurn).toEqual([3, 5, 3, 6]);
    expect(sch.incomeAtTurn).toEqual([0, 0, 1, 1]);
    expect(sch.steps.map((x) => [x.turn, x.starsBefore, x.starsAfter, x.incomeAfter])).toEqual([[1, 5, 0, 1]]);
  });

  it('Aquarion aquafarms feed windmills', () => {
    const s = makeState('~~.\n~.C', { tribe: 'aquarion', owned: ['riding', 'roads', 'trade', 'organization', 'farming', 'construction', 'fishing'] });
    for (const i of [0, 1, 3]) s.tiles[i].resource = 'aquacrop';
    const f = S(s);
    expect(f.plans.map((p) => `${p.income}:${p.cost}`)).toEqual(['0:0', '1:21', '2:26', '3:31']);
    expect(f.plans.at(-1)!.techs).toEqual(['ramming']);
    expect(bruteFrontier(s)!.map((x) => `${x.inc}:${x.cost}`)).toEqual(['0:0', '1:21', '2:26', '3:31']);
  });

  it('what can be built where, for how much, with which tech', () => {
    expect(builds(makeState('fC', { allowClear: false, allowBurn: false }), 0)).toEqual({ null: [0, ''], forge: [5, 'smithery'], lumberhut: [3, 'forestry'] });
    expect(builds(makeState('.C'), 0)).toEqual({ null: [0, ''], market: [5, 'trade'], sawmill: [5, 'mathematics'], windmill: [5, 'construction'], forge: [5, 'smithery'] });
    expect(builds(makeState(',C'), 0).farm).toEqual([5, 'farming']);
    expect(builds(makeState('MC'), 0)).toEqual({ null: [0, ''], mine: [5, 'mining'] });
    expect(builds(makeState('mC'), 0)).toEqual({ null: [0, ''] });
    const d = withBuildings(makeState('.C', { allowDestroy: true, costs: { ...makeState('.').settings.costs, destroy: 2 } }), { 0: 'farm' });
    expect(tileOptions(d, 0).find((o) => o.ops.join() === 'destroy' && !o.build)).toMatchObject({ cost: 2, techs: ['chivalry'] });
  });

  it('tech tree: tiers and parents', () => {
    const want: Record<string, [number, string | null]> = {
      riding: [1, null], roads: [2, 'riding'], trade: [3, 'roads'], freespirit: [2, 'riding'], chivalry: [3, 'freespirit'],
      organization: [1, null], farming: [2, 'organization'], construction: [3, 'farming'], shields: [2, 'organization'], diplomacy: [3, 'shields'],
      fishing: [1, null], sailing: [2, 'fishing'], navigation: [3, 'sailing'], ramming: [2, 'fishing'], aquatism: [3, 'ramming'],
      hunting: [1, null], forestry: [2, 'hunting'], mathematics: [3, 'forestry'], archery: [2, 'hunting'], spiritualism: [3, 'archery'],
      climbing: [1, null], mining: [2, 'climbing'], smithery: [3, 'mining'], meditation: [2, 'climbing'], philosophy: [3, 'meditation'],
    };
    const s = makeState('.C');
    for (const [k, [tier, parent]] of Object.entries(want)) {
      expect(techPrice(s, k as TechKey), k).toBe(tier + 4);
      expect(missingChain(s, k as TechKey).at(-2) ?? null, k).toBe(parent);
    }
    expect(TECHS.length).toBe(25);
  });

  it('save ids for techs and tribes', () => {
    const std: Record<number, string> = { 1: 'riding', 2: 'freespirit', 3: 'chivalry', 4: 'roads', 5: 'trade', 6: 'organization', 7: 'shields', 8: 'farming', 9: 'construction', 10: 'fishing', 12: 'aquatism', 13: 'sailing', 14: 'navigation', 15: 'hunting', 16: 'forestry', 17: 'mathematics', 18: 'archery', 19: 'spiritualism', 20: 'climbing', 21: 'meditation', 22: 'philosophy', 23: 'mining', 24: 'smithery', 38: 'diplomacy', 44: 'ramming',
      28: 'hunting', 27: 'riding', 25: 'freespirit', 26: 'chivalry', 48: 'roads', 47: 'fishing', 39: 'ramming', 46: 'sailing', 40: 'fishing', 30: 'fishing', 42: 'ramming', 31: 'navigation', 32: 'aquatism', 41: 'sailing', 36: 'construction', 35: 'chivalry', 49: 'meditation', 50: 'philosophy' };
    for (const [id, k] of Object.entries(std)) expect(techsFromIdx([Number(id)]), id).toEqual([k]);
    expect(Object.fromEntries(TRIBES.filter((t) => t.idx >= 0).map((t) => [t.idx, t.key]))).toEqual({ 2: 'aimo', 3: 'aquarion', 4: 'bardur', 5: 'elyrion', 6: 'hoodrick', 7: 'imperius', 8: 'kickoo', 9: 'luxidoor', 10: 'oumaji', 11: 'quetzali', 12: 'vengir', 13: 'xinxi', 14: 'yadakk', 15: 'zebasi', 16: 'polaris', 17: 'cymanti' });
  });

  it('saved maps keep every setting', () => {
    const s = makeState('...\n.C.\n...', { allowNewTech: false, allowClear: false, allowBurn: false, allowGrow: true, allowDestroy: true, tribe: 'elyrion', stars: 17, baseIncome: 9, cityCount: 4, owned: ['riding'] });
    s.settings.costs = { ...s.settings.costs, market: 7, lumberhut: 2, destroy: 1, literacyFactor: 0.5 };
    expect(parseJson(mapJson(s)).settings).toEqual(s.settings);
  });

  it('tiles stay with their ruling city, not the nearest', () => {
    const t = (x: number, p: Partial<RawTile>): RawTile => ({ x, y: 0, terrain: 3, climate: 1, owner: 1, capitalOf: 0, rulingCity: [0, 0], resource: -1, improvement: -1, improvementLevel: 0, city: null, visibility: [1], ...p });
    const city = { level: 1, population: 0, production: 0, borderSize: 1, name: '' };
    const save: RawSave = { header: { version: 124, currentTurn: 1, mapName: 'x', width: 5, height: 1 }, warnings: [],
      players: [{ id: 1, name: 'me', autoPlay: false, tribe: 4, stars: 0, score: 0, numCities: 2, techs: [] }],
      tiles: [[t(0, { improvement: 1, city }), t(1, {}), t(2, {}), t(3, {}), t(4, { improvement: 1, rulingCity: [4, 0], city })]] };
    expect(toGameState(save, 1).state.tiles.map((x) => x.city)).toEqual([0, 0, 0, 0, 1]);
  });
});
