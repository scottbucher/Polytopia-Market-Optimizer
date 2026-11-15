import { useMemo, useRef } from 'react';
import { BUILDING_ABBR, BUILDING_NAMES, type BuildingKind } from '../data/rules';
import type { GameState } from '../model/types';

export const TW = 64;
export const TH = 32;

export interface View {
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
}

export interface Overlay {
  /** Final building per tile for the shown plan. */
  layout: (BuildingKind | null)[];
  /** tile -> step numbers that touch it */
  steps: Map<number, number[]>;
  /** tiles whose building gets removed */
  removed: Set<number>;
  /** market tile -> income */
  marketIncome: Map<number, number>;
}

export interface Backdrop {
  href: string;
  /** natural image size in pixels */
  w: number;
  h: number;
  /** top-left position in map coordinates */
  x: number;
  y: number;
  /** map units per image pixel */
  scale: number;
  opacity: number;
}

interface Props {
  state: GameState;
  view: View;
  overlay?: Overlay | null;
  highlight?: number | null;
  onPaint?: (tile: number, first: boolean) => void;
  onHover?: (tile: number | null) => void;
  backdrop?: Backdrop | null;
  tileOpacity?: number;
  svgRef?: React.Ref<SVGSVGElement>;
}

/** Grid (x,y) -> rotated grid (u,v). */
export function rotate(view: View, w: number, h: number, x: number, y: number): [number, number] {
  let u = view.flip ? w - 1 - x : x;
  let v = y;
  let W = w;
  let H = h;
  for (let i = 0; i < view.rot; i++) {
    const nu = H - 1 - v;
    const nv = u;
    u = nu;
    v = nv;
    [W, H] = [H, W];
  }
  return [u, v];
}

export function tileCenter(view: View, w: number, h: number, i: number): [number, number] {
  const [u, v] = rotate(view, w, h, i % w, Math.floor(i / w));
  return [((u - v) * TW) / 2, ((u + v) * TH) / 2];
}

export function mapBounds(view: View, w: number, h: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < w * h; i++) {
    const [x, y] = tileCenter(view, w, h, i);
    minX = Math.min(minX, x - TW / 2);
    maxX = Math.max(maxX, x + TW / 2);
    minY = Math.min(minY, y - TH / 2);
    maxY = Math.max(maxY, y + TH / 2);
  }
  const pad = 24;
  return { x: minX - pad, y: minY - pad - 20, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + 20 };
}

const CITY_COLORS = ['#e8590c', '#1c7ed6', '#d6336c', '#37b24d', '#ae3ec9', '#f59f00', '#0ca678', '#4263eb', '#c2255c', '#74b816'];
export const cityColor = (i: number) => CITY_COLORS[i % CITY_COLORS.length];

function diamond(cx: number, cy: number, s = 1) {
  const w = (TW / 2) * s;
  const h = (TH / 2) * s;
  return `${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}`;
}

export function MapView({ state, view, overlay, highlight, onPaint, onHover, backdrop, tileOpacity = 1, svgRef }: Props) {
  const { width: w, height: h } = state;
  const bounds = useMemo(() => mapBounds(view, w, h), [view, w, h]);
  const painting = useRef(false);

  const order = useMemo(() => {
    const idx = state.tiles.map((_, i) => i);
    return idx.sort((a, b) => {
      const [, ya] = tileCenter(view, w, h, a);
      const [, yb] = tileCenter(view, w, h, b);
      return ya - yb;
    });
  }, [state.tiles, view, w, h]);

  const borders = useMemo(() => {
    const segs: { d: string; color: string }[] = [];
    state.tiles.forEach((t, i) => {
      if (t.city === null) return;
      const x = i % w;
      const y = Math.floor(i / w);
      const [cx, cy] = tileCenter(view, w, h, i);
      const corners: [number, number][] = [
        [cx, cy - TH / 2],
        [cx + TW / 2, cy],
        [cx, cy + TH / 2],
        [cx - TW / 2, cy],
      ];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const inside = nx >= 0 && ny >= 0 && nx < w && ny < h;
        const nCity = inside ? state.tiles[ny * w + nx].city : null;
        if (nCity === t.city) continue;
        const [bx, by] = neighbourScreen(view, w, h, x, y, dx, dy, cx, cy);
        const sorted = corners
          .map((c) => ({ c, d: (c[0] - bx) ** 2 + (c[1] - by) ** 2 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 2);
        const inset = 0.88;
        const p = sorted.map(({ c }) => [cx + (c[0] - cx) * inset, cy + (c[1] - cy) * inset]);
        segs.push({ d: `M${p[0][0]},${p[0][1]}L${p[1][0]},${p[1][1]}`, color: cityColor(t.city) });
      }
    });
    return segs;
  }, [state.tiles, view, w, h]);

  const handleDown = (i: number) => (e: React.PointerEvent) => {
    if (!onPaint || e.button !== 0) return;
    painting.current = true;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    onPaint(i, true);
  };

  return (
    <svg
      ref={svgRef}
      className="map"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      onPointerUp={() => (painting.current = false)}
      onPointerLeave={() => {
        painting.current = false;
        onHover?.(null);
      }}
      role="img"
      aria-label="Map"
    >
      {backdrop && (
        <image
          href={backdrop.href}
          x={backdrop.x}
          y={backdrop.y}
          width={backdrop.w * backdrop.scale}
          height={backdrop.h * backdrop.scale}
          opacity={backdrop.opacity}
          preserveAspectRatio="none"
        />
      )}
      <g opacity={tileOpacity}>
        {order.map((i) => {
          const t = state.tiles[i];
          const [cx, cy] = tileCenter(view, w, h, i);
          const dim = t.city === null && t.terrain !== 'unknown';
          return (
            <g
              key={i}
              className={`tile t-${t.terrain}${dim ? ' dim' : ''}${highlight === i ? ' hl' : ''}`}
              onPointerDown={handleDown(i)}
              onPointerEnter={(e) => {
                onHover?.(i);
                if (painting.current && e.buttons === 1) onPaint?.(i, false);
              }}
            >
              <polygon points={diamond(cx, cy)} className="ground" />
              <Terrain t={t.terrain} cx={cx} cy={cy} />
              {t.resource === 'crop' && <Crop cx={cx} cy={cy} />}
              {t.resource === 'metal' && <Metal cx={cx} cy={cy} />}
              {t.resource === 'aquacrop' && <Crop cx={cx} cy={cy} />}
            </g>
          );
        })}
      </g>
      <g className="borders" pointerEvents="none">
        {borders.map((b, k) => (
          <path key={k} d={b.d} stroke={b.color} />
        ))}
      </g>
      <g pointerEvents="none">
        {order.map((i) => {
          const t = state.tiles[i];
          const [cx, cy] = tileCenter(view, w, h, i);
          const planned = overlay?.layout[i] ?? null;
          const existing = t.improvement;
          const removed = overlay?.removed.has(i);
          const steps = overlay?.steps.get(i);
          const els: React.ReactNode[] = [];
          if (existing === 'city') {
            const ci = state.cities.findIndex((c) => c.y * w + c.x === i);
            els.push(<City key="c" cx={cx} cy={cy} name={state.cities[ci]?.name ?? ''} color={cityColor(t.city ?? ci)} />);
          } else if (overlay) {
            if (planned) {
              const isNew = planned !== existing;
              els.push(<Badge key="b" kind={planned} cx={cx} cy={cy} ghost={isNew} income={overlay.marketIncome.get(i)} />);
            } else if (existing === 'other') {
              els.push(<Other key="o" cx={cx} cy={cy} />);
            }
            if (removed) els.push(<Removed key="r" cx={cx} cy={cy} />);
          } else if (existing !== 'none' && existing !== 'other') {
            els.push(<Badge key="b" kind={existing} cx={cx} cy={cy} ghost={false} />);
          } else if (existing === 'other') {
            els.push(<Other key="o" cx={cx} cy={cy} />);
          }
          if (steps?.length) {
            els.push(
              <g key="s" className="stepnum">
                <circle cx={cx + 17} cy={cy - 11} r={8} />
                <text x={cx + 17} y={cy - 7.5}>
                  {steps[0]}
                </text>
              </g>,
            );
          }
          return els.length ? <g key={i}>{els}</g> : null;
        })}
      </g>
      {highlight != null && (
        <polygon className="hl-ring" points={diamond(...tileCenter(view, w, h, highlight), 1.08)} pointerEvents="none" />
      )}
    </svg>
  );
}

function neighbourScreen(view: View, w: number, h: number, x: number, y: number, dx: number, dy: number, cx: number, cy: number): [number, number] {
  // Screen offset of a +1 step in grid x or y, after rotation.
  const [u0, v0] = rotate(view, w, h, x, y);
  const [u1, v1] = rotate(view, w, h, x + dx, y + dy);
  const du = u1 - u0;
  const dv = v1 - v0;
  return [cx + ((du - dv) * TW) / 2, cy + ((du + dv) * TH) / 2];
}

function Terrain({ t, cx, cy }: { t: string; cx: number; cy: number }) {
  if (t === 'forest')
    return (
      <g className="tree">
        <path d={`M${cx - 12},${cy + 4} l7,-15 l7,15 z`} />
        <path d={`M${cx + 1},${cy + 7} l7,-15 l7,15 z`} />
      </g>
    );
  if (t === 'mountain') return <path className="mtn" d={`M${cx - 16},${cy + 6} l13,-20 l6,8 l4,-5 l10,17 z`} />;
  if (t === 'unknown') return <text className="fog" x={cx} y={cy + 4}>?</text>;
  return null;
}

function Crop({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="crop">
      <circle cx={cx - 8} cy={cy + 3} r={2.6} />
      <circle cx={cx - 3} cy={cy + 6} r={2.6} />
      <circle cx={cx + 2} cy={cy + 3} r={2.6} />
    </g>
  );
}

function Metal({ cx, cy }: { cx: number; cy: number }) {
  return <polygon className="metal" points={`${cx + 9},${cy - 2} ${cx + 13},${cy + 2} ${cx + 9},${cy + 6} ${cx + 5},${cy + 2}`} />;
}

function Badge({ kind, cx, cy, ghost, income }: { kind: BuildingKind; cx: number; cy: number; ghost: boolean; income?: number }) {
  return (
    <g className={`bld b-${kind}${ghost ? ' ghost' : ''}`}>
      <title>{BUILDING_NAMES[kind]}</title>
      <rect x={cx - 13} y={cy - 9} width={26} height={16} rx={4} />
      <text x={cx} y={cy + 3}>
        {BUILDING_ABBR[kind]}
      </text>
      {income !== undefined && (
        <text className="inc" x={cx} y={cy - 12}>
          +{income}★
        </text>
      )}
    </g>
  );
}

function Other({ cx, cy }: { cx: number; cy: number }) {
  return <rect className="other" x={cx - 5} y={cy - 5} width={10} height={10} rx={2} />;
}

function Removed({ cx, cy }: { cx: number; cy: number }) {
  return <path className="removed" d={`M${cx - 7},${cy - 7} l14,14 M${cx + 7},${cy - 7} l-14,14`} />;
}

function City({ cx, cy, name, color }: { cx: number; cy: number; name: string; color: string }) {
  return (
    <g className="city">
      <path d={`M${cx - 10},${cy + 5} v-14 h4 v4 h4 v-4 h4 v4 h4 v-4 h4 v14 z`} fill={color} />
      <text x={cx} y={cy + 18}>
        {name}
      </text>
    </g>
  );
}
