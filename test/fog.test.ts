import { describe, expect, it } from 'vitest';
import type { RawSave, RawTile } from '../src/parse/stateFile';
import { toGameState } from '../src/parse/toGameState';

function tile(x: number, y: number, p: Partial<RawTile>): RawTile {
  return { x, y, terrain: 3, climate: 1, owner: 0, capitalOf: 0, rulingCity: [-1, -1], resource: -1, improvement: -1, improvementLevel: 0, city: null, visibility: [], ...p };
}

describe('no spoilers', () => {
  const save = (techs: number[]): RawSave => ({
    header: { version: 124, currentTurn: 3, mapName: 'x', width: 3, height: 1 },
    players: [{ id: 1, name: 'me', autoPlay: false, tribe: 4, stars: 5, score: 0, numCities: 1, techs }],
    warnings: [],
    tiles: [
      [
        tile(0, 0, { improvement: 1, owner: 1, rulingCity: [0, 0], visibility: [1], city: { level: 1, population: 0, production: 2, borderSize: 1, name: 'Home' } }),
        tile(1, 0, { owner: 1, rulingCity: [0, 0], resource: 2, visibility: [1] }),
        tile(2, 0, { terrain: 4, resource: 5, visibility: [2] }),
      ],
    ],
  });

  it('hides unexplored tiles and resources you cannot see yet', () => {
    const r = toGameState(save([]), 1);
    expect(r.state.tiles[2].terrain).toBe('unknown');
    expect(r.state.tiles[2].resource).toBe('none');
    expect(r.state.tiles[1].resource).toBe('none'); // crop needs Organization
  });

  it('shows crops once you have Organization', () => {
    const r = toGameState(save([6]), 1);
    expect(r.state.tiles[1].resource).toBe('crop');
    expect(r.state.tiles[1].city).toBe(0);
  });
});
