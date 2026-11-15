// Writes a synthetic .state file in the layout the reader expects (game version 124),
// so the parser can be tested in CI without a real (private) save.
import { compressState } from './lz4Writer';

export interface FakeTile {
  terrain: number; // 3 field, 4 mountain, 5 forest, 1 water
  owner?: number;
  ruling?: [number, number];
  resource?: number; // 2 crop, 5 metal, 9 aquacrop
  improvement?: number; // 1 city, 50 market, ...
  cityName?: string;
  production?: number;
  seenBy?: number[];
}

export interface FakePlayer {
  id: number;
  name: string;
  tribe: number;
  stars: number;
  techs: number[];
  ai?: boolean;
  cities?: number;
}

class W {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 255); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  i32(v: number) { this.u32(v >>> 0); }
  str(s: string) { const e = new TextEncoder().encode(s); this.u8(e.length); for (const c of e) this.u8(c); }
  zeros(n: number) { for (let i = 0; i < n; i++) this.u8(0); }
}

function block(w: W, version: number, turn: number, size: number, tiles: FakeTile[][], players: FakePlayer[]) {
  w.u32(version);
  w.u16(0); // actions
  w.u32(turn);
  w.zeros(27); // game settings (the reader looks for the map name at +37)
  w.str('Test map');
  w.u32(size); // square size
  w.u16(size);
  w.u16(size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = tiles[y][x];
      w.u32(x);
      w.u32(y);
      w.u16(t.terrain);
      w.u16(1); // climate
      w.u16(0); // altitude
      w.u8(t.owner ?? 0);
      w.u8(0); // capital of
      w.i32(t.ruling?.[0] ?? -1);
      w.i32(t.ruling?.[1] ?? -1);
      if (t.resource !== undefined) {
        w.u8(1);
        w.u16(t.resource);
      } else w.u8(0);
      if (t.improvement !== undefined) {
        w.u8(1);
        w.u16(t.improvement);
        w.u16(1); // level
        w.u16(0); // founded
        w.u16(1); // population
        w.u16(1); // total population
        w.u16(t.production ?? 0);
        w.u16(0); // base score
        w.u16(1); // border size
        w.u16(0); // upgrades
        w.u8(1); // connected
        if (t.cityName) {
          w.u8(1);
          w.str(t.cityName);
        } else w.u8(0);
        w.u8(0); // founded tribe
        w.u16(0); // rewards
        w.u16(0); // rebellion
      } else w.u8(0);
      w.u8(0); // no unit
      const seen = t.seenBy ?? [];
      w.u8(seen.length);
      for (const p of seen) w.u8(p);
      w.u8(0); // road
      w.u8(0); // water route
      w.u16(0); // skin
      w.zeros(2);
      w.u8(0); // flood flag (v >= 105)
    }
  w.u16(players.length);
  for (const p of players) {
    w.u8(p.id);
    w.str(p.name);
    w.str('');
    w.u8(p.ai ? 1 : 0);
    w.i32(0);
    w.i32(0);
    w.u16(p.tribe);
    w.u8(0);
    w.u32(0); // handicap
    w.u32(p.stars);
    w.u32(0); // score
    w.u32(0);
    w.u16(p.cities ?? 1);
    w.u16(p.techs.length);
    for (const t of p.techs) w.u16(t);
    w.u16(0); // encountered
    w.u16(0); // tasks (i16)
    w.i32(0);
    w.i32(0);
    w.i32(0);
    w.zeros(4);
    w.u8(0);
    w.u16(0); // units
    w.u16(0); // diplomacy
    w.u16(0); // messages
    w.u8(0);
    w.u32(0);
    w.zeros(4);
    w.i32(0);
    w.u16(0);
    w.zeros(4);
    w.u8(0); // trailing byte (v >= 120)
  }
}

export function makeSave(opts: { version?: number; turn?: number; tiles: FakeTile[][]; players: FakePlayer[] }): Uint8Array {
  const version = opts.version ?? 124;
  const size = opts.tiles.length;
  const w = new W();
  w.u32(version);
  block(w, version, 0, size, opts.tiles, opts.players);
  // Real saves have about 11 bytes here, the last few non-zero.
  w.zeros(7);
  for (const b of [0x12, 0x34, 0x56, 0x78]) w.u8(b);
  block(w, version, opts.turn ?? 7, size, opts.tiles, opts.players);
  return compressState(new Uint8Array(w.b));
}
