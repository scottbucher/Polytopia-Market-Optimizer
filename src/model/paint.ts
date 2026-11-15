// Map editing: what each paint tool does to a tile. Pure functions on a GameState copy.

import { BUILDING_BY_KIND, type BuildingKind, isBuildingKind, type Resource, type Terrain } from '../data/rules';
import type { GameState } from './types';

export type Tool =
  | { kind: 'look' }
  | { kind: 'terrain'; v: Terrain }
  | { kind: 'resource'; v: Resource }
  | { kind: 'building'; v: BuildingKind | 'none' | 'other' }
  | { kind: 'city' }
  | { kind: 'territory'; city: number | null };

/** The terrain each resource sits on (the first one is used when painting the resource). */
export const RESOURCE_TERRAIN: Partial<Record<Resource, Terrain[]>> = {
  crop: ['field'],
  metal: ['mountain'],
  aquacrop: ['water', 'ocean'],
};

/** Applies a tool to tile `i` of `st` (which the caller has already copied). Returns `st`. */
export function applyTool(st: GameState, tool: Tool, i: number): GameState {
  const t = st.tiles[i];
  switch (tool.kind) {
    case 'look':
      return st;
    case 'terrain': {
      if (t.improvement === 'city') return st;
      t.terrain = tool.v;
      const ok = RESOURCE_TERRAIN[t.resource];
      if (ok && !ok.includes(tool.v)) t.resource = 'none';
      if (isBuildingKind(t.improvement) && !BUILDING_BY_KIND[t.improvement].terrain.includes(tool.v)) t.improvement = 'none';
      if (tool.v === 'unknown') {
        t.resource = 'none';
        t.improvement = 'none';
      }
      return st;
    }
    case 'resource': {
      if (t.improvement === 'city') return st;
      const ok = RESOURCE_TERRAIN[tool.v];
      if (ok && !ok.includes(t.terrain)) t.terrain = ok[0];
      t.resource = t.resource === tool.v ? 'none' : tool.v;
      if (isBuildingKind(t.improvement) && BUILDING_BY_KIND[t.improvement].resource && t.resource !== BUILDING_BY_KIND[t.improvement].resource) t.improvement = 'none';
      return st;
    }
    case 'building': {
      if (t.improvement === 'city') return st;
      t.improvement = tool.v;
      if (isBuildingKind(tool.v)) {
        const def = BUILDING_BY_KIND[tool.v];
        if (!def.terrain.includes(t.terrain)) t.terrain = def.terrain[0];
        if (def.resource) t.resource = def.resource;
      }
      return st;
    }
    case 'territory':
      if (t.improvement === 'city') return st;
      t.city = tool.city;
      return st;
    case 'city': {
      const existing = st.cities.findIndex((c) => c.y * st.width + c.x === i);
      if (existing >= 0) {
        // Remove the city and its territory.
        const before = st.cities.length;
        st.cities.splice(existing, 1);
        st.tiles.forEach((x) => {
          if (x.city === existing) x.city = null;
          else if (x.city !== null && x.city > existing) x.city--;
        });
        t.improvement = 'none';
        // If the count was just the cities on the map, keep it in step.
        if (st.settings.cityCount === before) st.settings.cityCount = Math.max(1, st.cities.length);
      } else {
        const ci = st.cities.length;
        const x = i % st.width;
        const y = Math.floor(i / st.width);
        st.cities.push({ name: `City ${ci + 1}`, x, y });
        t.terrain = 'field';
        t.resource = 'none';
        t.improvement = 'city';
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= st.width || ny >= st.height) continue;
            const n = st.tiles[ny * st.width + nx];
            if (n.city === null) n.city = ci;
          }
        t.city = ci;
        st.settings.cityCount = Math.max(st.settings.cityCount, st.cities.length);
      }
      return st;
    }
  }
}
