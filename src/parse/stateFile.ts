// Reader for Polytopia .state save files.
// Ported from samuelyuan/polytopiamapmodelgo (MIT License, Copyright (c) 2024 Samuel Yuan).

import { decompressState } from './lz4';

class Reader {
  pos = 0;
  private dv: DataView;
  constructor(private buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number) {
    if (this.pos + n > this.buf.length) throw new Error(`Save file ended early at byte ${this.pos}`);
  }
  u8() { this.need(1); return this.dv.getUint8(this.pos++); }
  u16() { this.need(2); const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  bytes(n: number) { this.need(n); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  skip(n: number) { this.need(n); this.pos += n; }
  str() {
    const n = this.u8();
    return new TextDecoder().decode(this.bytes(n));
  }
}

export interface RawHeader {
  version: number;
  currentTurn: number;
  mapName: string;
  width: number;
  height: number;
}

export interface RawCity {
  level: number;
  population: number;
  production: number;
  borderSize: number;
  name: string;
}

export interface RawTile {
  x: number;
  y: number;
  terrain: number;
  climate: number;
  owner: number;
  capitalOf: number;
  /** Coordinates of the city this tile belongs to. */
  rulingCity: [number, number];
  resource: number; // -1 none
  improvement: number; // -1 none
  improvementLevel: number;
  city: RawCity | null;
  /** Player ids that have seen this tile. */
  visibility: number[];
}

export interface RawPlayer {
  id: number;
  name: string;
  autoPlay: boolean;
  tribe: number;
  stars: number;
  score: number;
  numCities: number;
  techs: number[];
}

export interface RawSave {
  header: RawHeader;
  tiles: RawTile[][]; // [y][x]
  players: RawPlayer[];
}

function readHeader(r: Reader, knownVersion?: number): RawHeader {
  if (knownVersion !== undefined) {
    // Skip the few separator bytes between the initial and current blocks.
    const from = r.pos;
    for (let off = from; off < from + 16; off++) {
      r.pos = off;
      if (r.u32() === knownVersion) {
        r.pos = off;
        break;
      }
      r.pos = from;
    }
  }
  const start = r.pos;
  const version = r.u32();
  r.u16(); // total actions
  const currentTurn = r.u32();
  // The rest of the fixed header (game settings) has grown across game versions, so
  // instead of trusting a fixed layout we look for the map name string: a length
  // byte followed by that many printable characters.
  let nameAt = -1;
  for (let off = start + 31; off < start + 60; off++) {
    r.pos = off;
    const n = r.u8();
    if (n === 0 || n > 64) continue;
    const bytes = r.bytes(Math.min(n, 64));
    if (bytes.every((c) => c >= 32 && c < 127) && isSquareSizeNext(r)) {
      nameAt = off;
      break;
    }
  }
  if (nameAt < 0) throw new Error('Could not find the map header. This save version may not be supported.');
  r.pos = nameAt;
  const mapName = r.str();
  // Width and height sit right before the first tile, which starts with x=0, y=0.
  const after = r.pos;
  for (let off = after + 4; off < after + 400; off++) {
    r.pos = off;
    const w = r.u16();
    const h = r.u16();
    if (w < 4 || h < 4 || w > 64 || h > 64) continue;
    if (r.u32() === 0 && r.u32() === 0) {
      const terrain = r.u16();
      if (terrain <= 8) {
        r.pos = off + 4;
        return { version, currentTurn, mapName, width: w, height: h };
      }
    }
  }
  throw new Error('Could not find the map size. This save version may not be supported.');
}

function isSquareSizeNext(r: Reader) {
  const save = r.pos;
  try {
    const sq = r.u32();
    return sq >= 4 && sq <= 64;
  } catch {
    return false;
  } finally {
    r.pos = save;
  }
}

function readImprovementData(r: Reader): RawCity {
  const level = r.u16();
  r.u16(); // founded turn
  const population = r.i16();
  r.u16(); // total population
  const production = r.i16();
  r.i16(); // base score
  const borderSize = r.i16();
  r.i16(); // upgrade count
  r.u8(); // connected to capital
  const hasName = r.u8();
  const name = hasName === 1 ? r.str() : '';
  r.u8(); // founded tribe
  const rewards = r.u16();
  r.skip(rewards * 2);
  const rebellion = r.u16();
  if (rebellion !== 0) r.skip(2);
  return { level, population, production, borderSize, name };
}

const UNIT_SIZE = 42;

function readTile(r: Reader, ex: number, ey: number, version: number): RawTile {
  const x = r.u32();
  const y = r.u32();
  if (x !== ex || y !== ey) throw new Error(`Unexpected tile (${x},${y}), expected (${ex},${ey}). This save version may not be supported.`);
  const terrain = r.u16();
  const climate = r.u16();
  r.i16(); // altitude
  const owner = r.u8();
  const capitalOf = r.u8();
  const rulingCity: [number, number] = [r.i32(), r.i32()];
  const resource = r.u8() === 1 ? r.u16() : -1;
  const improvement = r.u8() === 1 ? r.u16() : -1;
  let city: RawCity | null = null;
  let improvementLevel = 0;
  if (improvement !== -1) {
    city = readImprovementData(r);
    improvementLevel = city.level;
  }
  if (r.u8() === 1) {
    r.skip(UNIT_SIZE);
    if (r.u8() === 1) {
      r.skip(UNIT_SIZE);
      if (r.u8() !== 0) throw new Error('Unexpected passenger flag');
      r.skip(r.u16() * 2);
      r.skip(5);
    }
    r.skip(r.u16() * 2);
    r.skip(5);
  }
  const visN = r.u8();
  const visibility = Array.from(r.bytes(visN));
  r.u8(); // road
  r.u8(); // water route
  r.u16(); // skin
  r.skip(2);
  if (version >= 105) {
    if (r.u8() === 1) r.u32();
  }
  return {
    x, y, terrain, climate, owner, capitalOf, rulingCity, resource, improvement, improvementLevel,
    city: improvement === 1 ? city : null,
    visibility,
  };
}

function readPlayer(r: Reader, version: number, trailingByte: boolean): RawPlayer {
  const id = r.u8();
  const name = r.str();
  r.str(); // account id
  const autoPlay = r.u8() !== 0;
  r.i32();
  r.i32(); // start tile
  const tribe = r.u16();
  r.u8();
  r.u32(); // handicap
  if (version < 114) {
    const n = r.u16();
    r.skip(n * 5);
  }
  const stars = r.u32();
  const score = r.u32();
  r.u32();
  const numCities = r.u16();
  const nt = r.u16();
  const techs: number[] = [];
  for (let i = 0; i < nt; i++) techs.push(r.u16());
  const ne = r.u16();
  r.skip(ne);
  const nTasks = r.i16();
  for (let i = 0; i < nTasks; i++) {
    const type = r.i16();
    if (type === 1 || type === 5) r.skip(6);
    else if (type >= 1 && type <= 8) r.skip(2);
    else throw new Error(`Unknown task type ${type}`);
  }
  r.i32();
  r.i32();
  r.i32(); // kills, losses, destroyed
  r.skip(4); // override colour
  r.u8(); // override tribe
  const nu = r.u16();
  r.skip(nu * 2);
  const nd = r.u16();
  r.skip(nd * 23);
  const nm = r.u16();
  r.skip(nm * 2);
  r.u8(); // destroyed by
  r.u32(); // destroyed turn
  r.skip(4);
  r.i32(); // end score
  r.u16(); // skin
  r.skip(4);
  if (trailingByte) r.u8(); // newer game versions add one byte per player
  return { id, name, autoPlay, tribe, stars, score, numCities, techs };
}

function readBlock(r: Reader, knownVersion?: number) {
  const header = readHeader(r, knownVersion);
  if (knownVersion !== undefined) header.version = knownVersion;
  const tiles: RawTile[][] = [];
  for (let y = 0; y < header.height; y++) {
    const row: RawTile[] = [];
    for (let x = 0; x < header.width; x++) row.push(readTile(r, x, y, header.version));
    tiles.push(row);
  }
  const np = r.u16();
  const start = r.pos;
  let players: RawPlayer[] = [];
  let ok = false;
  for (const trailing of [header.version >= 120, header.version < 120]) {
    r.pos = start;
    try {
      players = [];
      for (let i = 0; i < np; i++) players.push(readPlayer(r, header.version, trailing));
      if (players.every((p) => p.tribe < 64 && p.numCities < 1000)) {
        ok = true;
        break;
      }
    } catch {
      // try the other layout
    }
  }
  if (!ok) throw new Error('Could not read the player list. This save version may not be supported.');
  return { header, tiles, players };
}

/** Parse a .state file. Returns the current game state (not the initial one). */
export function parseStateFile(bytes: Uint8Array): RawSave {
  const data = decompressState(bytes);
  const r = new Reader(data);
  r.u32(); // file format version (same as the game state version)
  const initial = readBlock(r); // initial state, only used for the version number
  // A few bytes separate the two blocks; readHeader finds the next header by itself.
  return readBlock(r, initial.header.version);
}
