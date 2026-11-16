import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  /** A paint tool is active: dragging paints instead of scrolling the map. */
  editing?: boolean;
  /** Tile painted last, flashed briefly so a tap shows it did something. */
  flash?: { tile: number; n: number } | null;
  /** Tool shortcut keys while the map has focus; returns true when the key was used. */
  onToolKey?: (key: string) => boolean;
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

/** Touch screens get bigger tiles (the map scrolls instead of shrinking). */
const isCoarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const CITY_COLORS = ['#e8590c', '#1c7ed6', '#d6336c', '#37b24d', '#ae3ec9', '#f59f00', '#0ca678', '#4263eb', '#c2255c', '#74b816'];
export const cityColor = (i: number) => CITY_COLORS[i % CITY_COLORS.length];

function diamond(cx: number, cy: number, s = 1) {
  const w = (TW / 2) * s;
  const h = (TH / 2) * s;
  return `${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}`;
}

export function MapView({ state, view, overlay, highlight, onPaint, onHover, backdrop, tileOpacity = 1, svgRef, editing = false, flash, onToolKey }: Props) {
  const { width: w, height: h } = state;
  const bounds = useMemo(() => mapBounds(view, w, h), [view, w, h]);
  const painting = useRef(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const cursorRef = useRef<SVGPolygonElement>(null);
  const [focused, setFocused] = useState(false);
  // Focus that comes from a tap or click shouldn't jump the keyboard cursor to the middle.
  const pointerFocus = useRef(false);
  const [coarse] = useState(isCoarse);
  const ownRef = useRef<SVGSVGElement | null>(null);
  const setRef = useCallback(
    (el: SVGSVGElement | null) => {
      ownRef.current = el;
      if (typeof svgRef === 'function') svgRef(el);
      else if (svgRef) (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
    },
    [svgRef],
  );
  // Open (and re-open after a rotate) with the middle of the map in view, not its left corner.
  useLayoutEffect(() => {
    const wrap = ownRef.current?.parentElement;
    if (!wrap) return;
    wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
    wrap.scrollTop = (wrap.scrollHeight - wrap.clientHeight) / 2;
  }, [w, h, view.rot]);
  // Flash the tile painted last.
  const [flashing, setFlashing] = useState<number | null>(null);
  useEffect(() => {
    if (!flash) return;
    setFlashing(flash.tile);
    const t = setTimeout(() => setFlashing(null), 450);
    return () => clearTimeout(t);
  }, [flash]);

  // Keyboard: arrow keys move a cursor over the tiles (in screen directions), Enter or Space paints.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (e.key in dirs) {
      e.preventDefault();
      const cur = cursor ?? Math.floor(h / 2) * w + Math.floor(w / 2);
      const [cx, cy] = tileCenter(view, w, h, cur);
      const [dx, dy] = dirs[e.key];
      // The neighbour whose screen position is most in that direction.
      let best = cur;
      let bestScore = -Infinity;
      for (let ny = -1; ny <= 1; ny++)
        for (let nx = -1; nx <= 1; nx++) {
          const x = (cur % w) + nx;
          const y = Math.floor(cur / w) + ny;
          if ((!nx && !ny) || x < 0 || y < 0 || x >= w || y >= h) continue;
          const j = y * w + x;
          const [tx, ty] = tileCenter(view, w, h, j);
          const vx = (tx - cx) / TW;
          const vy = (ty - cy) / TH;
          const len = Math.hypot(vx, vy);
          const score = (vx * dx + vy * dy) / len - 0.01 * len;
          if (score > bestScore) {
            bestScore = score;
            best = j;
          }
        }
      setCursor(best);
      onHover?.(best);
      requestAnimationFrame(() => cursorRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor !== null && onPaint) {
      e.preventDefault();
      onPaint(cursor, true);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && onToolKey?.(e.key)) {
      e.preventDefault();
    }
  };

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
    if (e.button !== 0) return;
    // The ring and the footer follow the finger.
    setCursor(i);
    onHover?.(i);
    if (!onPaint) return;
    painting.current = true;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    onPaint(i, true);
  };

  return (
    <svg
      ref={setRef}
      className="map"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
      // Keep tiles big enough to tap on small screens; the map scrolls instead.
      style={{ minWidth: Math.round(bounds.w * (coarse ? 0.85 : 0.55)), touchAction: editing ? 'none' : 'auto' }}
      onPointerDownCapture={() => (pointerFocus.current = true)}
      onPointerUp={() => (painting.current = false)}
      onPointerLeave={(e) => {
        painting.current = false;
        // A finger leaving the screen isn't a mouse moving away: keep showing the tapped tile.
        if (e.pointerType !== 'touch') onHover?.(null);
      }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setFocused(false)}
      onFocus={() => {
        const byPointer = pointerFocus.current;
        pointerFocus.current = false;
        if (byPointer) return;
        setFocused(true);
        // Show the keyboard cursor straight away (where it was last, or the middle of the map).
        const c = cursor ?? Math.floor(h / 2) * w + Math.floor(w / 2);
        setCursor(c);
        onHover?.(c);
      }}
      role="application"
      aria-label={`Map, ${w} by ${h} tiles. Arrow keys move the cursor${onPaint ? ', Enter paints with the selected tool' : ''}. Keys 1 to 6 pick a terrain, M picks Move.`}
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
              className={`tile t-${t.terrain}${dim ? ' dim' : ''}${highlight === i ? ' hl' : ''}${flashing === i ? ' just-painted' : ''}`}
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
          const els: React.ReactNode[] = [];
          if (existing === 'city') {
            const ci = state.cities.findIndex((c) => c.y * w + c.x === i);
            els.push(<City key="c" cx={cx} cy={cy} color={cityColor(t.city ?? ci)} />);
          } else if (overlay) {
            if (planned) {
              const isNew = planned !== existing;
              els.push(<Badge key="b" kind={planned} cx={cx} cy={cy} ghost={isNew} />);
            } else if (existing === 'other') {
              els.push(<Other key="o" cx={cx} cy={cy} />);
            }
            if (removed) els.push(<Removed key="r" cx={cx} cy={cy} />);
          } else if (existing !== 'none' && existing !== 'other') {
            els.push(<Badge key="b" kind={existing} cx={cx} cy={cy} ghost={false} />);
          } else if (existing === 'other') {
            els.push(<Other key="o" cx={cx} cy={cy} />);
          }
          return els.length ? <g key={i}>{els}</g> : null;
        })}
      </g>
      {/* Step numbers and market income on top of everything, with a halo. */}
      {overlay && (
        <g pointerEvents="none" className="maplabels">
          {order.map((i) => {
            const [cx, cy] = tileCenter(view, w, h, i);
            const steps = overlay.steps.get(i);
            const inc = overlay.marketIncome.get(i);
            if (!steps?.length && inc === undefined) return null;
            // The step that finishes the tile (its building), with earlier ones listed in the tooltip.
            const last = steps?.[steps.length - 1];
            // On a city tile the name sits underneath, so the bubble goes to the left of the badge.
            const bx = state.tiles[i].improvement === 'city' ? cx - 18 : cx + 18;
            return (
              <g key={i}>
                {inc !== undefined && (
                  <text className="inc" x={cx} y={cy - 12}>
                    +{inc}★
                  </text>
                )}
                {last !== undefined && (
                  <g className="stepnum">
                    <title>{`Step${steps!.length > 1 ? 's' : ''} ${steps!.join(', ')}`}</title>
                    <circle cx={bx} cy={cy - 11} r={9} />
                    <text x={bx} y={cy - 7.5}>
                      {last}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      )}
      {/* City names on top of the plan labels, so they stay readable. */}
      <g pointerEvents="none" className="citynames">
        {state.cities.map((c, ci) => {
          const i = c.y * w + c.x;
          if (i < 0 || i >= state.tiles.length) return null;
          const [cx, cy] = tileCenter(view, w, h, i);
          return (
            <text key={ci} x={cx} y={cy + 22}>
              {c.name}
            </text>
          );
        })}
      </g>
      {highlight != null && (
        <polygon className="hl-ring" points={diamond(...tileCenter(view, w, h, highlight), 1.08)} pointerEvents="none" />
      )}
      {focused && cursor != null && cursor < state.tiles.length && (
        <polygon ref={cursorRef} className="hl-ring cursor" points={diamond(...tileCenter(view, w, h, cursor), 1.08)} pointerEvents="none" />
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

function Badge({ kind, cx, cy, ghost }: { kind: BuildingKind; cx: number; cy: number; ghost: boolean }) {
  return (
    <g className={`bld b-${kind}${ghost ? ' ghost' : ''}`}>
      <title>{BUILDING_NAMES[kind]}</title>
      <rect x={cx - 13} y={cy - 9} width={26} height={16} rx={4} />
      <text x={cx} y={cy + 3}>
        {BUILDING_ABBR[kind]}
      </text>
    </g>
  );
}

function Other({ cx, cy }: { cx: number; cy: number }) {
  return <rect className="other" x={cx - 5} y={cy - 5} width={10} height={10} rx={2} />;
}

function Removed({ cx, cy }: { cx: number; cy: number }) {
  return <path className="removed" d={`M${cx - 7},${cy - 7} l14,14 M${cx + 7},${cy - 7} l-14,14`} />;
}

function City({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <g className="city">
      <path d={`M${cx - 10},${cy + 5} v-14 h4 v4 h4 v-4 h4 v4 h4 v-4 h4 v14 z`} fill={color} />
    </g>
  );
}
