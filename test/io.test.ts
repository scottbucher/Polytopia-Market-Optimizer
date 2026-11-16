import { describe, expect, it } from 'vitest';
import { defaultSettings, exampleState } from '../src/model/defaults';
import { mapJson, parseJson } from '../src/model/io';
import { applyTool } from '../src/model/paint';
import { tileOptions } from '../src/solver/options';
import { makeState } from './helpers';

describe('saved maps', () => {
  it('round-trips', () => {
    const s = exampleState();
    expect(parseJson(mapJson(s))).toEqual({ ...s });
  });

  it('cleans up bad values instead of breaking later', () => {
    const s = JSON.parse(mapJson(exampleState()));
    s.settings.tribe = 'atlantis';
    s.settings.owned = ['riding', 'teleportation'];
    s.settings.costs.market = 'cheap';
    s.settings.stars = -5;
    s.tiles[0] = { terrain: 'lava', resource: 'gold', improvement: 'castle', city: 99 };
    const p = parseJson(JSON.stringify(s));
    expect(p.settings.tribe).toBe('generic');
    expect(p.settings.owned).toEqual(['riding']);
    expect(p.settings.costs.market).toBe(5);
    expect(p.settings.stars).toBe(0);
    expect(p.tiles[0]).toEqual({ terrain: 'unknown', resource: 'none', improvement: 'none', city: null });
  });

  it('rejects files that are not maps', () => {
    expect(() => parseJson('nope')).toThrow(/not valid JSON/);
    expect(() => parseJson('{"width":3,"height":3,"tiles":[]}')).toThrow(/not a market planner map/);
    const s = JSON.parse(mapJson(exampleState()));
    s.format = 99;
    expect(() => parseJson(JSON.stringify(s))).toThrow(/newer version/);
  });
});

describe('painting', () => {
  it('puts buildings on the terrain they need', () => {
    const s = makeState('...\n.C.\n...');
    applyTool(s, { kind: 'building', v: 'mine' }, 0);
    expect(s.tiles[0]).toMatchObject({ terrain: 'mountain', resource: 'metal', improvement: 'mine' });
    applyTool(s, { kind: 'terrain', v: 'forest' }, 0);
    expect(s.tiles[0]).toMatchObject({ terrain: 'forest', resource: 'none', improvement: 'none' });
  });

  it('removing a city keeps the city count in step', () => {
    const s = makeState('C..\n...\n..C');
    expect(s.settings.cityCount).toBe(2);
    applyTool(s, { kind: 'city' }, 8);
    expect(s.cities.length).toBe(1);
    expect(s.settings.cityCount).toBe(1);
  });
});

describe('tile options', () => {
  it('never tears down temples and other buildings', () => {
    const s = makeState('...\n.C.\n...', { allowDestroy: true });
    s.tiles[0].improvement = 'other';
    expect(tileOptions(s, 0)).toHaveLength(1);
  });

  it('offers burning forest for a market even when clearing is possible', () => {
    const s = makeState('f..\n.C.\n...', { owned: ['organization', 'farming', 'construction'] });
    const ops = tileOptions(s, 0).filter((o) => o.build === 'market').map((o) => o.ops.join());
    expect(ops).toEqual(expect.arrayContaining(['clear', 'burn']));
  });

  it('Elyrion cannot clear or burn', () => {
    const s = makeState('f..\n.C.\n...', { tribe: 'elyrion' });
    expect(tileOptions(s, 0).some((o) => o.ops.length > 0)).toBe(false);
  });
});

describe('saved maps: limits', () => {
  const base = () => JSON.parse(mapJson(makeState('...\n.C.\n...')));

  it('keeps tiles with their city when an earlier city is dropped', () => {
    const s = base();
    s.cities = [{ name: 'Gone', x: 99, y: 0 }, { name: 'Home', x: 1, y: 1 }];
    for (const t of s.tiles) t.city = 1;
    s.tiles[0].city = 0; // belonged to the dropped city
    const p = parseJson(JSON.stringify(s));
    expect(p.cities.map((c) => c.name)).toEqual(['Home']);
    expect(p.tiles[4].city).toBe(0);
    expect(p.tiles[0].city).toBe(null);
  });

  it('caps the map size and keeps settings sane', () => {
    const big = { width: 129, height: 1, tiles: Array(129).fill({}) };
    expect(() => parseJson(JSON.stringify(big))).toThrow(/not a market planner map/);
    const s = base();
    s.settings.cityCount = 0;
    s.settings.allowDestroy = 'yes';
    s.settings.allowGrow = 1;
    const p = parseJson(JSON.stringify(s));
    expect(p.settings.cityCount).toBe(1);
    expect(p.settings.allowDestroy).toBe(defaultSettings().allowDestroy);
    expect(p.settings.allowGrow).toBe(defaultSettings().allowGrow);
    const t = base();
    t.settings.costs.market = 1e9;
    t.settings.costs.literacyFactor = 5;
    t.settings.cityCount = 1e9;
    const q = parseJson(JSON.stringify(t));
    expect([q.settings.costs.market, q.settings.costs.literacyFactor, q.settings.cityCount]).toEqual([999, 1, 999]);
  });
});

describe('painting tools', () => {
  const paint = (s: ReturnType<typeof makeState>, tool: Parameters<typeof applyTool>[1], x: number, y: number) => applyTool(s, tool, y * s.width + x);

  it('painting a resource twice removes it', () => {
    const s = makeState('...\n.C.\n...');
    paint(s, { kind: 'resource', v: 'crop' }, 0, 0);
    expect(s.tiles[0].resource).toBe('crop');
    s.tiles[0].improvement = 'farm';
    paint(s, { kind: 'resource', v: 'crop' }, 0, 0);
    expect(s.tiles[0].resource).toBe('none');
    expect(s.tiles[0].improvement).toBe('none'); // no crop, no farm
    paint(s, { kind: 'resource', v: 'metal' }, 0, 0);
    expect(s.tiles[0]).toMatchObject({ terrain: 'mountain', resource: 'metal' });
  });

  it('territory leaves city tiles alone', () => {
    const s = makeState('...\n.C.\n...');
    paint(s, { kind: 'territory', city: null }, 1, 1);
    expect(s.tiles[4].city).toBe(0);
    paint(s, { kind: 'territory', city: null }, 0, 0);
    expect(s.tiles[0].city).toBe(null);
  });

  it('painting unknown clears the resource and building', () => {
    const s = makeState(',..\n.C.\n...');
    s.tiles[0].improvement = 'farm';
    paint(s, { kind: 'terrain', v: 'unknown' }, 0, 0);
    expect(s.tiles[0]).toMatchObject({ terrain: 'unknown', resource: 'none', improvement: 'none' });
  });

  it('a new city claims only unowned tiles, and removing one renumbers the rest', () => {
    const s = makeState('......\n......\n......', {}, () => null);
    paint(s, { kind: 'city' }, 1, 1);
    paint(s, { kind: 'city' }, 3, 1);
    expect(s.tiles[2].city).toBe(0); // (2,0) touches both, first city keeps it
    expect(s.tiles[4].city).toBe(1);
    paint(s, { kind: 'city' }, 1, 1); // remove the first city
    expect(s.cities.map((c) => c.x)).toEqual([3]);
    expect(s.tiles[2].city).toBe(null);
    expect(s.tiles[4].city).toBe(0);
    expect(s.tiles[1 * 6 + 3].city).toBe(0);
  });
});

describe('painting tools: bad input', () => {
  it('territory for a city that does not exist does nothing', () => {
    const s = makeState('...\n.C.\n...');
    applyTool(s, { kind: 'territory', city: 2 }, 0);
    expect(s.tiles[0].city).toBe(0);
  });
});
