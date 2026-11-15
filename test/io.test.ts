import { describe, expect, it } from 'vitest';
import { exampleState } from '../src/model/defaults';
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
