import { describe, expect, it } from 'vitest';
import { decompressState, lz4DecompressBlock } from '../src/parse/lz4';
import { compressState, compressStateLiteral, lz4CompressBlock } from './lz4Writer';
import { parseStateFile, type RawSave, type RawTile } from '../src/parse/stateFile';
import { humanPlayers, techsFromIdx, toGameState } from '../src/parse/toGameState';

function fogTile(x: number, y: number, p: Partial<RawTile>): RawTile {
  return { x, y, terrain: 3, climate: 1, owner: 0, capitalOf: 0, rulingCity: [-1, -1], resource: -1, improvement: -1, improvementLevel: 0, city: null, visibility: [1], ...p };
}
import { type FakeTile, makeSave } from './saveWriter';

describe('LZ4', () => {
  it('round-trips the save container', () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 7) & 255);
    expect([...decompressState(compressStateLiteral(data))]).toEqual([...data]);
  });

  it('decodes matches', () => {
    // literal "ab", then a match of 6 bytes at offset 2 -> "abababab"
    const block = new Uint8Array([0x22, 97, 98, 2, 0, 0x00]);
    expect(new TextDecoder().decode(lz4DecompressBlock(block.subarray(0, 5), 16))).toBe('abababab');
  });

  it('rejects truncated and tiny files', () => {
    const data = new Uint8Array(500).fill(65);
    const full = compressStateLiteral(data);
    expect(() => decompressState(full.subarray(0, 200))).toThrow(/cut short|LZ4|size/);
    expect(() => decompressState(new Uint8Array(5))).toThrow(/too small/);
    expect(() => lz4DecompressBlock(new Uint8Array([0x10]), 10)).toThrow(/cut short/);
  });
});

// A 6×6 map: my city at (1,1) with crop, metal, a market; an enemy city at (4,4)
// that I have seen; a corner I haven't explored.
function world(): FakeTile[][] {
  const tiles: FakeTile[][] = [];
  for (let y = 0; y < 6; y++) {
    const row: FakeTile[] = [];
    for (let x = 0; x < 6; x++) {
      const mine = x <= 2 && y <= 2;
      const enemy = x >= 3 && y >= 3;
      row.push({ terrain: 3, owner: mine ? 1 : enemy ? 2 : 0, ruling: mine ? [1, 1] : enemy ? [4, 4] : undefined, seenBy: x === 5 && y === 0 ? [2] : [1, 2] });
    }
    tiles.push(row);
  }
  tiles[1][1] = { ...tiles[1][1], improvement: 1, cityName: 'Home', production: 3 };
  tiles[4][4] = { ...tiles[4][4], improvement: 1, cityName: 'Their Town' };
  tiles[0][0] = { ...tiles[0][0], resource: 2 }; // crop
  tiles[0][2] = { ...tiles[0][2], terrain: 4, resource: 5 }; // metal
  tiles[2][0] = { ...tiles[2][0], terrain: 1, resource: 9 }; // aquacrop
  tiles[2][2] = { ...tiles[2][2], improvement: 50 }; // market
  tiles[3][3] = { ...tiles[3][3], improvement: 50 }; // their market
  tiles[0][5] = { terrain: 4, resource: 5, seenBy: [2], owner: 0 }; // unexplored metal
  return tiles;
}

const players = (techs: number[], tribe = 4) => [
  { id: 1, name: 'Me', tribe, stars: 9, techs },
  { id: 2, name: 'Bot', tribe: 7, stars: 50, techs: [1, 2, 3], ai: true },
];

describe('save file', () => {
  it('reads a version 124 save', () => {
    const save = parseStateFile(makeSave({ tiles: world(), players: players([6]) }));
    expect(save.header).toMatchObject({ version: 124, currentTurn: 7, width: 6, height: 6, mapName: 'Test map' });
    expect(save.players.map((p) => p.name)).toEqual(['Me', 'Bot']);
    expect(save.warnings).toEqual([]);
    expect(humanPlayers(save).map((p) => p.id)).toEqual([1]);
  });

  it('keeps only what you can see', () => {
    const r = toGameState(parseStateFile(makeSave({ tiles: world(), players: players([]) })), 1, 'x.state');
    const at = (x: number, y: number) => r.state.tiles[y * 6 + x];
    expect(at(5, 0)).toMatchObject({ terrain: 'unknown', resource: 'none' });
    expect(r.hiddenTiles).toBe(1);
    expect(at(0, 0).resource).toBe('none'); // crop needs Organization
    expect(at(2, 0).resource).toBe('none'); // metal needs Climbing
    expect(at(0, 2).resource).toBe('none'); // aquacrop only for Aquarion
    expect(at(2, 2).improvement).toBe('market');
    expect(at(3, 3)).toMatchObject({ improvement: 'other', city: null }); // their market is no use to you
    expect(at(4, 4)).toMatchObject({ improvement: 'other', city: null });
    expect(r.state.cities).toEqual([{ name: 'Home', x: 1, y: 1 }]);
    expect(r.state.settings).toMatchObject({ stars: 9, baseIncome: 3, tribe: 'bardur' });
    // nothing about the other player leaks into the state
    expect(JSON.stringify(r.state)).not.toMatch(/Their Town|Bot/);
    expect(r).not.toHaveProperty('hiddenResources');
  });

  it('shows resources once you have the tech', () => {
    const r = toGameState(parseStateFile(makeSave({ tiles: world(), players: players([6, 20]) })), 1);
    expect(r.state.tiles[0].resource).toBe('crop');
    expect(r.state.tiles[2].resource).toBe('metal');
    expect(r.state.settings.owned).toEqual(expect.arrayContaining(['organization', 'climbing']));
  });

  it('Zebasi see crops with Farming alone', () => {
    const r = toGameState(parseStateFile(makeSave({ tiles: world(), players: players([8], 15) })), 1);
    expect(r.state.settings.tribe).toBe('zebasi');
    expect(r.state.tiles[0].resource).toBe('crop');
  });

  it('Aquarion see water crops', () => {
    const r = toGameState(parseStateFile(makeSave({ tiles: world(), players: players([], 3) })), 1);
    expect(r.state.tiles[12].resource).toBe('aquacrop');
  });

  it('warns about game versions it has not been tested with', () => {
    const save = parseStateFile(makeSave({ version: 125, tiles: world(), players: players([]) }));
    expect(save.warnings[0]).toMatch(/125/);
  });

  it('gives a clear error for a damaged file', () => {
    const bytes = makeSave({ tiles: world(), players: players([]) });
    expect(() => parseStateFile(bytes.subarray(0, Math.floor(bytes.length / 2)))).toThrow();
    const junk = new Uint8Array(400).fill(0x41);
    junk[0] = 0x40;
    expect(() => parseStateFile(junk)).toThrow();
  });
});

describe('LZ4 back-references', () => {
  const sample = () => {
    // Repetitive with some noise: long runs, short repeats and literal stretches.
    const out: number[] = [];
    for (let i = 0; i < 3000; i++) out.push(...[1, 2, 3, 4, 5]);
    for (let i = 0; i < 700; i++) out.push((i * 131) & 255);
    for (let i = 0; i < 400; i++) out.push(9);
    return new Uint8Array(out);
  };

  it('round-trips compressed data with long matches', () => {
    const data = sample();
    const block = lz4CompressBlock(data);
    expect(block.length).toBeLessThan(data.length / 4);
    expect([...lz4DecompressBlock(block, data.length)]).toEqual([...data]);
  });

  it('reads both container sizes', () => {
    const data = sample();
    expect([...decompressState(compressState(data, 2))]).toEqual([...data]);
    expect([...decompressState(compressState(data, 4))]).toEqual([...data]);
  });

  it('reads stored (uncompressed) and 1-byte-size containers', () => {
    const data = new Uint8Array(40).map((_, i) => i);
    expect([...decompressState(new Uint8Array([0x00, ...data]))]).toEqual([...data]);
    // 40 noisy bytes then a short run: compresses by well under 256 bytes.
    const small = new Uint8Array([...Array.from({ length: 40 }, (_, i) => (i * 97) & 255), ...Array(100).fill(7)]);
    const block = lz4CompressBlock(small);
    expect(small.length - block.length).toBeLessThan(256);
    expect([...decompressState(new Uint8Array([0x40, small.length - block.length, ...block]))]).toEqual([...small]);
  });

  it('handles lengths on the 15 and 255 boundaries', () => {
    for (const n of [14, 15, 16, 15 + 254, 15 + 255, 15 + 256, 15 + 510]) {
      // n literals, then a match of n + 4 bytes copying the start.
      const lit = Array.from({ length: n }, (_, i) => (i * 37 + 1) & 255);
      const data = new Uint8Array([...lit, ...lit, 0, 0, 0, 0].slice(0, 2 * n + 4));
      for (let i = n; i < data.length; i++) data[i] = data[i - n];
      expect([...lz4DecompressBlock(lz4CompressBlock(data), data.length)], `n=${n}`).toEqual([...data]);
    }
  });

  it('rejects offsets of 0 or before the start', () => {
    expect(() => lz4DecompressBlock(new Uint8Array([0x10, 65, 0, 0, 0x00]), 64)).toThrow(/bad offset/);
    expect(() => lz4DecompressBlock(new Uint8Array([0x10, 65, 2, 0, 0x00]), 64)).toThrow(/bad offset/);
  });

  it('rejects output larger than promised', () => {
    const data = sample();
    expect(() => lz4DecompressBlock(lz4CompressBlock(data), data.length - 1)).toThrow(/overflow/);
  });

  it('the literal-only writer still works', () => {
    const data = sample();
    expect([...decompressState(compressStateLiteral(data))]).toEqual([...data]);
  });
});

describe('id tables', () => {
  const raw = (over: Partial<RawTile>[], tribe = 4, techs = [6, 20], numCities = 1): RawSave => ({
    header: { version: 124, currentTurn: 1, mapName: 'x', width: over.length + 1, height: 1 },
    players: [{ id: 1, name: 'me', autoPlay: false, tribe, stars: 0, score: 0, numCities, techs }],
    warnings: [],
    tiles: [
      [
        fogTile(0, 0, { improvement: 1, owner: 1, rulingCity: [0, 0], city: { level: 1, population: 0, production: 0, borderSize: 1, name: 'Home' } }),
        ...over.map((p, i) => fogTile(i + 1, 0, { owner: 1, rulingCity: [0, 0], ...p })),
      ],
    ],
  });

  it('maps every terrain id', () => {
    const ids = { 1: 'water', 2: 'ocean', 3: 'field', 4: 'mountain', 5: 'forest', 6: 'ice', 7: 'wetland', 8: 'wetland', 99: 'unknown' };
    const s = toGameState(raw(Object.keys(ids).map((k) => ({ terrain: Number(k) }))), 1).state;
    expect(s.tiles.slice(1).map((t) => t.terrain)).toEqual(Object.values(ids));
  });

  it('maps every resource id (unknown ids are hidden)', () => {
    const ids = { 1: 'game', 2: 'crop', 3: 'fish', 5: 'metal', 6: 'fruit', 7: 'none', 9: 'aquacrop', 42: 'none' };
    const s = toGameState(raw(Object.keys(ids).map((k) => ({ resource: Number(k) })), 3), 1).state;
    expect(s.tiles.slice(1).map((t) => t.resource)).toEqual(Object.values(ids));
  });

  it('maps every improvement id', () => {
    const ids = { 3: 'none', 5: 'farm', 6: 'windmill', 12: 'lumberhut', 13: 'sawmill', 21: 'mine', 22: 'forge', 49: 'aquafarm', 50: 'market', 17: 'other' };
    const s = toGameState(raw(Object.keys(ids).map((k) => ({ improvement: Number(k) }))), 1).state;
    expect(s.tiles.slice(1).map((t) => t.improvement)).toEqual(Object.values(ids));
  });

  it('maps tribe tech ids to their slot', () => {
    expect(techsFromIdx([28, 27, 39]).sort()).toEqual(['hunting', 'ramming', 'riding']);
    expect(techsFromIdx([42, 41, 50]).sort()).toEqual(['philosophy', 'ramming', 'sailing']);
    expect(techsFromIdx([9999])).toEqual([]);
  });

  it('prices techs by all your cities, not just the ones in view', () => {
    expect(toGameState(raw([{}], 4, [], 3), 1).state.settings.cityCount).toBe(3);
  });
});

describe('variable-length save fields', () => {
  it('reads units, passengers, city rewards, rebellions, floods, tasks and long names', () => {
    const plain = world();
    const busy = world();
    busy[1][1] = { ...busy[1][1], rewards: 2, rebellion: 1, unit: {} };
    busy[0][1] = { ...busy[0][1], unit: { passenger: true } };
    busy[2][1] = { ...busy[2][1], flooded: true };
    const longName = 'N'.repeat(200);
    const ps = players([6]);
    const busyPlayers = [{ ...ps[0], name: longName, tasks: [1, 5, 3] }, ps[1]];
    const a = parseStateFile(makeSave({ tiles: plain, players: ps }));
    const b = parseStateFile(makeSave({ tiles: busy, players: busyPlayers }));
    expect(b.players[0].name).toBe(longName);
    expect(b.players.map((p) => ({ ...p, name: '' }))).toEqual(a.players.map((p) => ({ ...p, name: '' })));
    expect(b.tiles).toEqual(a.tiles);
  });
});
