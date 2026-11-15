import { describe, expect, it } from 'vitest';
import { compressStateLiteral, decompressState, lz4DecompressBlock } from '../src/parse/lz4';
import { parseStateFile } from '../src/parse/stateFile';
import { humanPlayers, toGameState } from '../src/parse/toGameState';
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
