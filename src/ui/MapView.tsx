import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BUILDING_ABBR, BUILDING_NAMES, type BuildingKind } from '../data/rules';
import type { GameState } from '../model/types';

export const TW = 64;
export const TH = 32;
/** Height of the block sides drawn under the map's front edges. */
const DEPTH = 9;

export interface View {
  rot: 0 | 1 | 2 | 3;
  flip: boolean;
}

/**
 * The game's camera: save tile (0,0) is the bottom corner of the diamond, +x runs
 * up-right and +y up-left on screen.
 */
export const GAME_VIEW: View = { rot: 1, flip: true };
export const isGameView = (v: View) => v.rot === GAME_VIEW.rot && v.flip === GAME_VIEW.flip;

const VIEW_KEY = 'market-planner/map-view/v1';

/** The view picked last time, or the game's view. */
export function loadView(): View {
  const v = readPref<Partial<View> | null>(VIEW_KEY, null);
  if (v && (v.rot === 0 || v.rot === 1 || v.rot === 2 || v.rot === 3) && typeof v.flip === 'boolean') return { rot: v.rot, flip: v.flip };
  return { ...GAME_VIEW };
}
export const saveView = (v: View) => writePref(VIEW_KEY, v);

/** Small per-browser preferences. Storage can be missing or blocked, so failures are ignored. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
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
  /** A paint tool is active: dragging paints instead of moving the map. */
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

const isCoarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const CITY_COLORS = ['#e8590c', '#1c7ed6', '#d6336c', '#37b24d', '#ae3ec9', '#f59f00', '#0ca678', '#4263eb', '#c2255c', '#74b816'];
export const cityColor = (i: number) => CITY_COLORS[i % CITY_COLORS.length];

function diamond(cx: number, cy: number, s = 1) {
  const w = (TW / 2) * s;
  const h = (TH / 2) * s;
  return `${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}`;
}

const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;
/** Largest zoom "Fit" uses, so a one-city empire doesn't fill the screen. */
const FIT_MAX = 1.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The part of the map worth opening on: your territory, else what you've explored. */
function focusBox(state: GameState, centers: [number, number][]) {
  let pick = state.tiles.map((t, i) => (t.city !== null ? i : -1)).filter((i) => i >= 0);
  if (!pick.length) pick = state.tiles.map((t, i) => (t.terrain !== 'unknown' ? i : -1)).filter((i) => i >= 0);
  if (!pick.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of pick) {
    const [x, y] = centers[i];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // A tile's own size, a little margin, and room for city names under the bottom row.
  minX -= TW;
  maxX += TW;
  minY -= TH * 1.25;
  maxY += TH * 1.25 + 14;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/** Point in map coordinates (mx,my) to put at offset (ax,ay) inside the scrolling box. */
interface Anchor {
  mx: number;
  my: number;
  ax: number;
  ay: number;
}

export function MapView({ state, view, overlay, highlight, onPaint, onHover, backdrop, tileOpacity = 1, svgRef, editing = false, flash, onToolKey }: Props) {
  const { width: w, height: h } = state;
  const bounds = useMemo(() => mapBounds(view, w, h), [view, w, h]);
  const centers = useMemo(() => Array.from({ length: w * h }, (_, i) => tileCenter(view, w, h, i)), [view, w, h]);
  const painting = useRef(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  // Focus that comes from a tap or click shouldn't jump the keyboard cursor to the middle.
  const pointerFocus = useRef(false);
  const [coarse] = useState(isCoarse);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgEl = useRef<SVGSVGElement | null>(null);
  const setRef = useCallback(
    (el: SVGSVGElement | null) => {
      svgEl.current = el;
      if (typeof svgRef === 'function') svgRef(el);
      else if (svgRef) (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
    },
    [svgRef],
  );

  // ---------- zoom and scrolling ----------
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  // Scroll position to apply once the drawing has been laid out at zoom z.
  const pending = useRef<(Anchor & { z: number }) | null>(null);

  const limits = () => {
    const sc = scrollRef.current;
    const cw = sc?.clientWidth || 600;
    const ch = sc?.clientHeight || 400;
    const all = Math.min(cw / bounds.w, ch / bounds.h);
    return { cw, ch, all, min: Math.min(all, 0.5) };
  };

  /** Scroll so that map point (mx,my) sits at (ax,ay) inside the scrolling box. */
  const place = (a: Anchor, smooth = false) => {
    const sc = scrollRef.current;
    const svg = svgEl.current;
    if (!sc || !svg) return;
    const sr = svg.getBoundingClientRect();
    const cr = sc.getBoundingClientRect();
    const z = sr.width / bounds.w || zoomRef.current;
    const left = sc.scrollLeft + sr.left + (a.mx - bounds.x) * z - (cr.left + a.ax);
    const top = sc.scrollTop + sr.top + (a.my - bounds.y) * z - (cr.top + a.ay);
    if (smooth && typeof sc.scrollTo === 'function') sc.scrollTo({ left, top, behavior: 'smooth' });
    else {
      sc.scrollLeft = left;
      sc.scrollTop = top;
    }
  };

  /** Map point under a screen point. */
  const mapPoint = (clientX: number, clientY: number): Anchor | null => {
    const sc = scrollRef.current;
    const svg = svgEl.current;
    if (!sc || !svg) return null;
    const sr = svg.getBoundingClientRect();
    const cr = sc.getBoundingClientRect();
    const z = sr.width / bounds.w || zoomRef.current;
    return { mx: bounds.x + (clientX - sr.left) / z, my: bounds.y + (clientY - sr.top) / z, ax: clientX - cr.left, ay: clientY - cr.top };
  };

  const zoomTo = (z: number, anchor?: Anchor | null) => {
    const sc = scrollRef.current;
    const { min } = limits();
    const nz = clamp(z, min, ZOOM_MAX);
    let a = anchor ?? null;
    if (!a && sc) {
      const cr = sc.getBoundingClientRect();
      a = mapPoint(cr.left + sc.clientWidth / 2, cr.top + sc.clientHeight / 2);
    }
    if (Math.abs(nz - zoomRef.current) < 1e-4) {
      // Still waiting for an earlier zoom to be drawn: move the target instead.
      if (pending.current && a) pending.current = { ...a, z: nz };
      else if (a) place(a);
      return;
    }
    pending.current = a ? { ...a, z: nz } : null;
    zoomRef.current = nz;
    setZoom(nz);
  };

  /** "home": frame your territory at a size where labels are readable. "all": the whole map. */
  const frame = (kind: 'home' | 'all') => {
    const { cw, ch, all } = limits();
    const box = kind === 'home' ? focusBox(state, centers) : null;
    if (!box) {
      zoomTo(all, { mx: bounds.x + bounds.w / 2, my: bounds.y + bounds.h / 2, ax: cw / 2, ay: ch / 2 });
      return;
    }
    const fit = Math.min(cw / box.w, ch / box.h);
    zoomTo(Math.max(Math.min(fit, FIT_MAX), coarse ? 0.9 : 1), { mx: box.cx, my: box.cy, ax: cw / 2, ay: ch / 2 });
  };

  /** Scroll a tile into view: just enough (keyboard), or to the middle (build order). */
  const reveal = (i: number, centre: boolean) => {
    const sc = scrollRef.current;
    const svg = svgEl.current;
    if (!sc || !svg || i < 0 || i >= centers.length) return;
    const sr = svg.getBoundingClientRect();
    const cr = sc.getBoundingClientRect();
    const z = sr.width / bounds.w || zoomRef.current;
    const [mx, my] = centers[i];
    const px = sr.left + (mx - bounds.x) * z - cr.left;
    const py = sr.top + (my - bounds.y) * z - cr.top;
    const mX = Math.min(sc.clientWidth / 2, (TW / 2) * z + 8);
    const mY = Math.min(sc.clientHeight / 2, (TH / 2) * z + 24);
    const inside = px >= mX && py >= mY && px <= sc.clientWidth - mX && py <= sc.clientHeight - mY;
    if (inside) return;
    if (centre) place({ mx, my, ax: sc.clientWidth / 2, ay: sc.clientHeight / 2 }, true);
    else place({ mx, my, ax: clamp(px, mX, sc.clientWidth - mX), ay: clamp(py, mY, sc.clientHeight - mY) });
  };

  // Latest versions for the native listeners below.
  const api = useRef({ zoomTo, mapPoint, place });
  api.current = { zoomTo, mapPoint, place };

  // Keep the middle of the view in the middle when the box changes size (expand map, window resize).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || typeof ResizeObserver !== 'function') return;
    let centre: Anchor | null = null;
    const remember = () => {
      const cr = sc.getBoundingClientRect();
      centre = api.current.mapPoint(cr.left + sc.clientWidth / 2, cr.top + sc.clientHeight / 2);
    };
    let size = [sc.clientWidth, sc.clientHeight];
    const ro = new ResizeObserver(() => {
      if (size[0] === sc.clientWidth && size[1] === sc.clientHeight) return;
      size = [sc.clientWidth, sc.clientHeight];
      if (centre) api.current.place({ ...centre, ax: sc.clientWidth / 2, ay: sc.clientHeight / 2 });
      remember();
    });
    remember();
    sc.addEventListener('scroll', remember, { passive: true });
    ro.observe(sc);
    return () => {
      ro.disconnect();
      sc.removeEventListener('scroll', remember);
    };
  }, []);

  // Apply a zoom's scroll position once the new size is laid out.
  useLayoutEffect(() => {
    const a = pending.current;
    if (!a || Math.abs(a.z - zoom) > 1e-4) return;
    pending.current = null;
    place(a);
  });

  // Open (and re-open after a rotate) on your territory.
  useLayoutEffect(() => {
    frame('home');
  }, [view.rot, view.flip]);

  // Show the whole map while a screenshot is being lined up.
  const hasBackdrop = !!backdrop;
  const firstBackdrop = useRef(true);
  useEffect(() => {
    if (firstBackdrop.current) {
      firstBackdrop.current = false;
      return;
    }
    if (hasBackdrop) frame('all');
  }, [hasBackdrop]);

  // A tile picked from the build order scrolls into view; one hovered on the map already is.
  const fromMap = useRef<number | null>(null);
  const hover = (i: number | null) => {
    fromMap.current = i;
    onHover?.(i);
  };
  useEffect(() => {
    if (highlight == null || highlight === fromMap.current) return;
    reveal(highlight, true);
  }, [highlight]);

  // Ctrl/⌘ + wheel (and trackpad pinch) zoom; two-finger pinch on touch screens.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      api.current.zoomTo(zoomRef.current * Math.exp(-clamp(d, -100, 100) * 0.004), api.current.mapPoint(e.clientX, e.clientY));
    };
    let pinch: { d0: number; z0: number; a: Anchor } | null = null;
    const mid = (t: TouchList) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      painting.current = false;
      const [x, y] = mid(e.touches);
      const a = api.current.mapPoint(x, y);
      pinch = a ? { d0: dist(e.touches), z0: zoomRef.current, a } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const [x, y] = mid(e.touches);
      const cr = sc.getBoundingClientRect();
      // Zoom around the fingers and follow them as they move.
      api.current.zoomTo(pinch.z0 * (dist(e.touches) / pinch.d0), { ...pinch.a, ax: x - cr.left, ay: y - cr.top });
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    sc.addEventListener('touchstart', onTouchStart, { passive: true });
    sc.addEventListener('touchmove', onTouchMove, { passive: false });
    sc.addEventListener('touchend', onTouchEnd);
    sc.addEventListener('touchcancel', onTouchEnd);
    return () => {
      sc.removeEventListener('wheel', onWheel);
      sc.removeEventListener('touchstart', onTouchStart);
      sc.removeEventListener('touchmove', onTouchMove);
      sc.removeEventListener('touchend', onTouchEnd);
      sc.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Flash the tile painted last.
  const [flashing, setFlashing] = useState<{ tile: number; n: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    setFlashing(flash);
    const t = setTimeout(() => setFlashing(null), 450);
    return () => clearTimeout(t);
  }, [flash]);

  // Keyboard: arrow keys move a cursor over the tiles (in screen directions), Enter or Space paints.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (e.key in dirs) {
      e.preventDefault();
      const cur = cursor ?? Math.floor(h / 2) * w + Math.floor(w / 2);
      const [cx, cy] = centers[cur];
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
          const [tx, ty] = centers[j];
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
      hover(best);
      requestAnimationFrame(() => reveal(best, false));
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor !== null && onPaint) {
      e.preventDefault();
      onPaint(cursor, true);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      zoomTo(zoom * ZOOM_STEP);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      zoomTo(zoom / ZOOM_STEP);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '0') {
      e.preventDefault();
      frame('home');
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && onToolKey?.(e.key)) {
      e.preventDefault();
    }
  };

  // ---------- pointer: paint, pick, drag to move ----------
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean; tile: number | null } | null>(null);
  const tileOf = (target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.('[data-i]');
    return el ? Number(el.getAttribute('data-i')) : null;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const i = tileOf(e.target);
    const sc = scrollRef.current;
    // Mouse in Move mode: dragging moves the map; a click without dragging picks the tile.
    if (!editing && e.pointerType !== 'touch' && sc) {
      drag.current = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, moved: false, tile: i };
      return;
    }
    if (i === null) return;
    // The ring and the footer follow the finger.
    setCursor(i);
    hover(i);
    if (!onPaint) return;
    painting.current = true;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    onPaint(i, true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const sc = scrollRef.current;
    if (!d || !sc) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5 || !(e.buttons & 1)) return;
      d.moved = true;
      sc.classList.add('panning');
      svgEl.current?.setPointerCapture?.(e.pointerId);
    }
    sc.scrollLeft = d.sl - dx;
    sc.scrollTop = d.st - dy;
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    painting.current = false;
    if (!d) return;
    if (d.moved) scrollRef.current?.classList.remove('panning');
    else if (d.tile !== null) {
      setCursor(d.tile);
      hover(d.tile);
    }
  };
  const onPointerOver = (e: React.PointerEvent) => {
    if (drag.current?.moved) return;
    const i = tileOf(e.target);
    if (i === null) return;
    hover(i);
    if (painting.current && e.buttons === 1) onPaint?.(i, false);
  };

  // ---------- layers (memoised: hovering only redraws the rings) ----------
  const order = useMemo(() => centers.map((_, i) => i).sort((a, b) => centers[a][1] - centers[b][1] || centers[a][0] - centers[b][0]), [centers]);

  // Block sides along the map's front edges, like the game's slab.
  const sides = useMemo(() => {
    const rw = view.rot % 2 ? h : w;
    const rh = view.rot % 2 ? w : h;
    const out: React.ReactNode[] = [];
    for (let i = 0; i < w * h; i++) {
      const [u, v] = rotate(view, w, h, i % w, Math.floor(i / w));
      const [cx, cy] = centers[i];
      const kind = sideKind(state.tiles[i].terrain);
      if (v === rh - 1)
        out.push(<polygon key={`l${i}`} className={`side l ${kind}`} points={`${cx - TW / 2},${cy} ${cx},${cy + TH / 2} ${cx},${cy + TH / 2 + DEPTH} ${cx - TW / 2},${cy + DEPTH}`} />);
      if (u === rw - 1)
        out.push(<polygon key={`r${i}`} className={`side r ${kind}`} points={`${cx},${cy + TH / 2} ${cx + TW / 2},${cy} ${cx + TW / 2},${cy + DEPTH} ${cx},${cy + TH / 2 + DEPTH}`} />);
    }
    return out;
  }, [state.tiles, view, w, h, centers]);

  const tiles = useMemo(
    () =>
      order.map((i) => {
        const t = state.tiles[i];
        const [cx, cy] = centers[i];
        const dim = t.city === null && t.terrain !== 'unknown';
        return (
          <g key={i} data-i={i} className={`tile t-${t.terrain}${dim ? ' dim' : ''}`}>
            <polygon points={diamond(cx, cy)} className="ground" />
            <Terrain t={t.terrain} cx={cx} cy={cy} />
            {(t.resource === 'crop' || t.resource === 'aquacrop') && <Crop cx={cx} cy={cy} />}
            {t.resource === 'metal' && <Metal cx={cx} cy={cy} />}
          </g>
        );
      }),
    [order, state.tiles, centers],
  );

  const borders = useMemo(() => {
    // One path per city.
    const byCity = new Map<number, string>();
    state.tiles.forEach((t, i) => {
      if (t.city === null) return;
      const x = i % w;
      const y = Math.floor(i / w);
      const [cx, cy] = centers[i];
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
        const inset = 0.9;
        const p = sorted.map(({ c }) => [cx + (c[0] - cx) * inset, cy + (c[1] - cy) * inset]);
        byCity.set(t.city, (byCity.get(t.city) ?? '') + `M${p[0][0]},${p[0][1]}L${p[1][0]},${p[1][1]}`);
      }
    });
    return [...byCity].map(([c, d]) => (
      <g key={c}>
        <path d={d} className="under" />
        <path d={d} stroke={cityColor(c)} />
      </g>
    ));
  }, [state.tiles, view, w, h, centers]);

  const markers = useMemo(
    () =>
      order.map((i) => {
        const t = state.tiles[i];
        const [cx, cy] = centers[i];
        const planned = overlay?.layout[i] ?? null;
        const existing = t.improvement;
        const removed = overlay?.removed.has(i) ?? false;
        const els: React.ReactNode[] = [];
        if (existing === 'city') {
          const ci = state.cities.findIndex((c) => c.y * w + c.x === i);
          els.push(<City key="c" cx={cx} cy={cy} color={cityColor(t.city ?? ci)} />);
        } else if (overlay) {
          if (planned) els.push(<Badge key="b" kind={planned} cx={cx} cy={cy} planned={planned !== existing} />);
          else if (removed && existing !== 'none' && existing !== 'other') els.push(<Badge key="b" kind={existing} cx={cx} cy={cy} planned={false} gone />);
          else if (existing === 'other') els.push(<Other key="o" cx={cx} cy={cy} />);
          if (removed) els.push(<Removed key="r" cx={cx} cy={cy} small={!!planned} />);
        } else if (existing !== 'none' && existing !== 'other') {
          els.push(<Badge key="b" kind={existing} cx={cx} cy={cy} planned={false} />);
        } else if (existing === 'other') {
          els.push(<Other key="o" cx={cx} cy={cy} />);
        }
        return els.length ? <g key={i}>{els}</g> : null;
      }),
    [order, state.tiles, state.cities, overlay, centers, w],
  );

  // Step numbers, market income and enemy units, on top of the buildings.
  const labels = useMemo(
    () =>
      order.map((i) => {
        const t = state.tiles[i];
        const [cx, cy] = centers[i];
        const steps = overlay?.steps.get(i);
        const inc = overlay?.marketIncome.get(i);
        if (!steps?.length && inc === undefined && !t.enemy) return null;
        // The step that finishes the tile (its building), with earlier ones listed in the tooltip.
        const last = steps?.[steps.length - 1];
        const isCity = t.improvement === 'city';
        // Steps on the right, enemies on the left (the other way round on a city, whose name sits below).
        const sx = isCity ? cx - 22 : cx + 22;
        const ex = isCity ? cx + 22 : cx - 22;
        return (
          <g key={i}>
            {inc !== undefined && (
              <text className="inc" x={cx} y={cy - 15}>
                +{inc}★
              </text>
            )}
            {t.enemy && <Enemy cx={ex} cy={cy - 10} />}
            {last !== undefined && (
              <g className="stepnum">
                <title>{`Step${steps!.length > 1 ? 's' : ''} ${steps!.join(', ')}`}</title>
                <circle cx={sx} cy={cy - 10} r={9.5} />
                <text x={sx} y={cy - 5.9}>
                  {last}
                </text>
              </g>
            )}
          </g>
        );
      }),
    [order, state.tiles, overlay, centers],
  );

  // City names go below the city, or above it when that would hide fewer buildings and labels.
  const cityNames = useMemo(() => {
    const busy = occupiedRects(state, overlay ?? null, centers);
    return state.cities.map((c, ci) => {
      const i = c.y * w + c.x;
      if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) return null;
      const [cx, cy] = centers[i];
      const name = c.name.trim() || `City ${ci + 1}`;
      const { total, below } = labelSize(name, c.level);
      let best: Rect = [0, 0, 0, 0];
      let bestAt: [number, number] = [0, 21];
      let bestHit = Infinity;
      LABEL_SPOTS.forEach(([dx, dy], k) => {
        const r: Rect = [cx + dx - total / 2, cy + dy - 9, cx + dx + total / 2, cy + dy + 9 + below];
        // The usual spot (under the city) wins unless another one hides clearly less.
        const hit = busy.reduce((a, b) => a + overlap(r, b), 0) + k * 60;
        if (hit < bestHit) {
          bestHit = hit;
          best = r;
          bestAt = [dx, dy];
        }
      });
      busy.push(best);
      return <CityLabel key={ci} cx={cx + bestAt[0]} cy={cy + bestAt[1]} name={name} level={c.level} population={c.population} color={cityColor(state.tiles[i]?.city ?? ci)} />;
    });
  }, [state, overlay, centers, w, h]);

  const hasEnemy = useMemo(() => state.tiles.some((t) => t.enemy), [state.tiles]);
  const z = zoom;

  return (
    <div className="mapview">
      <div ref={scrollRef} className={`mapscroll${editing ? ' editing' : ''}`} style={{ touchAction: editing ? 'none' : 'pan-x pan-y' }}>
        <svg
          ref={setRef}
          className="map"
          viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
          width={Math.round(bounds.w * z)}
          height={Math.round(bounds.h * z)}
          onPointerDownCapture={() => (pointerFocus.current = true)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerOver={onPointerOver}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(e) => {
            if (!drag.current?.moved) painting.current = false;
            // A finger leaving the screen isn't a mouse moving away: keep showing the tapped tile.
            if (e.pointerType !== 'touch' && !drag.current?.moved) hover(null);
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
            hover(c);
          }}
          role="application"
          aria-label={`Map, ${w} by ${h} tiles. Arrow keys move the cursor${onPaint ? ', Enter paints with the selected tool' : ''}. Plus and minus zoom, 0 fits your territory. Keys 1 to 6 pick a terrain, M picks Move.`}
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
            {!backdrop && <g pointerEvents="none">{sides}</g>}
            {tiles}
          </g>
          <g className="borders" pointerEvents="none">
            {borders}
          </g>
          <g pointerEvents="none">{markers}</g>
          <g pointerEvents="none" className="maplabels">
            {labels}
          </g>
          {/* City names on top of the plan labels, so they stay readable. */}
          <g pointerEvents="none" className="citynames">
            {cityNames}
          </g>
          {flashing && flashing.tile < centers.length && <polygon key={flashing.n} className="flash" points={diamond(...centers[flashing.tile])} pointerEvents="none" />}
          {highlight != null && highlight < centers.length && <polygon className="hl-ring" points={diamond(...centers[highlight], 1.08)} pointerEvents="none" />}
          {focused && cursor != null && cursor < centers.length && <polygon className="hl-ring cursor" points={diamond(...centers[cursor], 1.08)} pointerEvents="none" />}
        </svg>
      </div>
      <div className="mapzoom" role="group" aria-label="Zoom">
        <button type="button" className="icon" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= ZOOM_MAX - 1e-3}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
        <button type="button" className="icon" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomTo(zoom / ZOOM_STEP)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button type="button" className="icon" title="Fit your territory (0)" aria-label="Fit your territory" onClick={() => frame('home')}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          </svg>
        </button>
        <button type="button" className="icon" title="Whole map" aria-label="Whole map" onClick={() => frame('all')}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" />
          </svg>
        </button>
      </div>
      {(overlay || hasEnemy) && (
        <div className="maplegend small" aria-hidden="true">
          {overlay && (
            <>
              <LegendItem label="Built">
                <Badge kind="sawmill" cx={18} cy={11} planned={false} />
              </LegendItem>
              <LegendItem label="Planned">
                <Badge kind="sawmill" cx={18} cy={11} planned />
              </LegendItem>
              <LegendItem label="Step" w={24}>
                <g className="stepnum">
                  <circle cx={12} cy={10} r={9} />
                  <text x={12} y={14}>
                    1
                  </text>
                </g>
              </LegendItem>
              <LegendItem label="Removed" w={24}>
                <Removed cx={12} cy={10} small={false} />
              </LegendItem>
            </>
          )}
          {hasEnemy && (
            <LegendItem label="Enemy unit" w={24}>
              <Enemy cx={12} cy={10} />
            </LegendItem>
          )}
        </div>
      )}
    </div>
  );
}

function LegendItem({ label, w = 36, children }: { label: string; w?: number; children: React.ReactNode }) {
  return (
    <span className="lg">
      <svg viewBox={`0 -1 ${w} 22`} width={w} height={22}>
        {children}
      </svg>
      {label}
    </span>
  );
}

function sideKind(t: string) {
  if (t === 'water' || t === 'ocean') return 's-water';
  if (t === 'unknown') return 's-unknown';
  return 's-land';
}

function neighbourScreen(view: View, w: number, h: number, x: number, y: number, dx: number, dy: number, cx: number, cy: number): [number, number] {
  // Screen offset of a +1 step in grid x or y, after rotation.
  const [u0, v0] = rotate(view, w, h, x, y);
  const [u1, v1] = rotate(view, w, h, x + dx, y + dy);
  const du = u1 - u0;
  const dv = v1 - v0;
  return [cx + ((du - dv) * TW) / 2, cy + ((du + dv) * TH) / 2];
}

const tree = (x: number, y: number, s = 1) => `M${x},${y - 15 * s}l${6 * s},${11 * s}h${-3 * s}l${4 * s},${6 * s}h${-14 * s}l${4 * s},${-6 * s}h${-3 * s}z`;

function Terrain({ t, cx, cy }: { t: string; cx: number; cy: number }) {
  if (t === 'forest')
    return (
      <path className="tree" d={`${tree(cx - 13, cy + 3, 0.85)}${tree(cx + 1, cy - 2)}${tree(cx + 14, cy + 4, 0.85)}${tree(cx + 1, cy + 11, 0.7)}`} />
    );
  if (t === 'mountain')
    return (
      <g className="mtn">
        <path d={`M${cx - 20},${cy + 6}L${cx - 5},${cy - 15}L${cx + 3},${cy - 5}L${cx + 9},${cy - 11}L${cx + 20},${cy + 6}Z`} />
        <path className="snow" d={`M${cx - 9.3},${cy - 9}L${cx - 5},${cy - 15}L${cx - 0.9},${cy - 9.9}L${cx - 4},${cy - 7.5}Z`} />
      </g>
    );
  return null;
}

function Crop({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="crop">
      <circle cx={cx - 13} cy={cy + 4} r={3.2} />
      <circle cx={cx - 7} cy={cy + 8} r={3.2} />
      <circle cx={cx - 6} cy={cy + 1} r={3.2} />
    </g>
  );
}

function Metal({ cx, cy }: { cx: number; cy: number }) {
  return <polygon className="metal" points={`${cx + 12},${cy - 1} ${cx + 17},${cy + 4} ${cx + 12},${cy + 9} ${cx + 7},${cy + 4}`} />;
}

const BIG: Partial<Record<BuildingKind, true>> = { market: true, sawmill: true, windmill: true, forge: true };

const badgeSize = (kind: BuildingKind) => (BIG[kind] ? [34, 21] : [28, 18]);

function Badge({ kind, cx, cy, planned, gone }: { kind: BuildingKind; cx: number; cy: number; planned: boolean; gone?: boolean }) {
  const [bw, bh] = badgeSize(kind);
  return (
    <g className={`bld b-${kind}${planned ? ' ghost' : ''}${gone ? ' gone' : ''}`}>
      <title>{`${BUILDING_NAMES[kind]}${planned ? ' (planned)' : gone ? ' (removed)' : ''}`}</title>
      <rect x={cx - bw / 2} y={cy - bh / 2 - 1} width={bw} height={bh} rx={5} />
      <text x={cx} y={cy + (BIG[kind] ? 3.6 : 3.2)} className={BIG[kind] ? 'big' : undefined}>
        {BUILDING_ABBR[kind]}
      </text>
    </g>
  );
}

function Other({ cx, cy }: { cx: number; cy: number }) {
  return (
    <rect className="other" x={cx - 7} y={cy - 7} width={14} height={14} rx={3}>
      <title>Other building</title>
    </rect>
  );
}

function Removed({ cx, cy, small }: { cx: number; cy: number; small: boolean }) {
  // Next to a new building the cross moves to the corner, so the new badge stays readable.
  const x = small ? cx - 20 : cx;
  const y = small ? cy + 4 : cy;
  const r = small ? 4.5 : 7;
  return (
    <g className="removed">
      <title>Removed</title>
      <path d={`M${x - r},${y - r}l${2 * r},${2 * r}M${x + r},${y - r}l${-2 * r},${2 * r}`} className="halo" />
      <path d={`M${x - r},${y - r}l${2 * r},${2 * r}M${x + r},${y - r}l${-2 * r},${2 * r}`} />
    </g>
  );
}

function Enemy({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="enemy">
      <title>Enemy unit</title>
      <circle cx={cx} cy={cy} r={9} />
      <path d={`M${cx},${cy - 5.5}l4.5,1.8v2.6c0,3 -2,4.8 -4.5,6c-2.5,-1.2 -4.5,-3 -4.5,-6v-2.6z`} />
    </g>
  );
}

function City({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <g className="city">
      <path d={`M${cx - 13},${cy + 6} v-16 h5 v4 h4 v-6 h8 v6 h4 v-4 h5 v16 z`} fill={color} />
      <path className="door" d={`M${cx - 2.5},${cy + 6} v-5 a2.5,2.5 0 0 1 5,0 v5 z`} />
    </g>
  );
}

type Rect = [number, number, number, number];
/** Where a city's name may go, relative to the city tile, in order of preference. */
const LABEL_SPOTS: [number, number][] = [
  [0, 21],
  [0, -29],
  [0, 34],
  [-22, 21],
  [22, 21],
  [-22, -29],
  [22, -29],
];
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Screen boxes of everything drawn on top of the tiles (buildings, steps, income, enemies). */
function occupiedRects(state: GameState, overlay: Overlay | null, centers: [number, number][]): Rect[] {
  const out: Rect[] = [];
  state.tiles.forEach((t, i) => {
    const [cx, cy] = centers[i];
    const isCity = t.improvement === 'city';
    const kind = isCity ? null : overlay ? (overlay.layout[i] ?? (overlay.removed.has(i) || t.improvement === 'other' ? t.improvement : null)) : t.improvement;
    if (isCity) out.push([cx - 13, cy - 10, cx + 13, cy + 6]);
    else if (kind === 'other') out.push([cx - 7, cy - 7, cx + 7, cy + 7]);
    else if (kind && kind !== 'none') {
      const [bw, bh] = badgeSize(kind as BuildingKind);
      out.push([cx - bw / 2, cy - bh / 2 - 1, cx + bw / 2, cy + bh / 2 - 1]);
    }
    if (overlay?.steps.get(i)?.length) out.push(isCity ? [cx - 32, cy - 20, cx - 12, cy] : [cx + 12, cy - 20, cx + 32, cy]);
    if (overlay?.marketIncome.has(i)) out.push([cx - 16, cy - 28, cx + 16, cy - 13]);
    if (t.enemy) out.push(isCity ? [cx + 13, cy - 19, cx + 31, cy - 1] : [cx - 31, cy - 19, cx - 13, cy - 1]);
  });
  return out;
}

/** Rough label widths (12px bold name, 11px level): SVG text can't be measured before layout. */
function labelSize(name: string, level?: number) {
  const lv = level !== undefined && level > 0 ? `Lv ${level}` : '';
  const nw = name.length * 7 + 12;
  const lw = lv ? lv.length * 6 + 10 : 0;
  return { lv, nw, lw, total: nw + lw, below: lv ? 7 : 0 };
}

/** Black or white text, whichever reads better on a city colour. */
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#1f2328' : '#ffffff';
}

function CityLabel({ cx, cy, name, level, population, color }: { cx: number; cy: number; name: string; level?: number; population?: number; color: string }) {
  const { lv, nw, lw, total } = labelSize(name, level);
  const x0 = cx - total / 2;
  // Population pips under the label, as in the game: level + 1 to grow.
  const pips = lv ? Math.min(level! + 1, 12) : 0;
  const filled = clamp(population ?? 0, 0, pips);
  return (
    <g className="citylabel">
      <title>{`${name}${lv ? `, level ${level}` : ''}${population !== undefined && lv ? `, population ${population} of ${pips}` : ''}`}</title>
      <rect x={x0} y={cy - 9} width={total} height={18} rx={9} className="pill" stroke={color} />
      {lv && <path d={`M${x0 + nw},${cy - 9}h${lw - 9}a9,9 0 0 1 0,18h${-(lw - 9)}z`} fill={color} />}
      <text x={x0 + nw / 2} y={cy + 4.2} className="nm">
        {name}
      </text>
      {lv && (
        <text x={x0 + nw + lw / 2 - 1} y={cy + 3.8} className="lv" fill={inkOn(color)}>
          {lv}
        </text>
      )}
      {pips > 0 &&
        Array.from({ length: pips }, (_, k) => (
          <rect key={k} x={cx - (pips * 8) / 2 + k * 8 + 0.5} y={cy + 10.5} width={7} height={5} rx={1.5} className={k < filled ? 'pip on' : 'pip'} fill={k < filled ? color : undefined} />
        ))}
    </g>
  );
}
