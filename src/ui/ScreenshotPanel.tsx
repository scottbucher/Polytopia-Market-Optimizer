import { useRef, useState } from 'react';
import type { Terrain } from '../data/rules';
import type { GameState } from '../model/types';
import { type Backdrop, mapBounds, tileCenter, type View } from './MapView';

interface Props {
  state: GameState;
  view: View;
  backdrop: Backdrop | null;
  setBackdrop: (b: Backdrop | null) => void;
  tileOpacity: number;
  setTileOpacity: (v: number) => void;
  onGuess: (guesses: Map<number, Terrain>) => void;
}

/**
 * Screenshot import, best effort: the screenshot goes under the map, you line the
 * grid up with it, paint a few tiles of each terrain, and the rest are guessed from
 * the screenshot's colours (nearest painted example).
 */
export function ScreenshotPanel({ state, view, backdrop, setBackdrop, tileOpacity, setTileOpacity, onGuess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = (f: File) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const b = mapBounds(view, state.width, state.height);
      const scale = b.w / img.naturalWidth;
      setBackdrop({ href: url, w: img.naturalWidth, h: img.naturalHeight, x: b.x, y: b.y, scale, opacity: 1 });
      setTileOpacity(0.45);
      setMsg('Line the grid up with the screenshot, paint one or two tiles of each terrain, then press Guess.');
    };
    img.src = url;
  };

  const guess = async () => {
    if (!backdrop) return;
    const img = new Image();
    img.src = backdrop.href;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = backdrop.w;
    canvas.height = backdrop.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const sample = (i: number): [number, number, number] | null => {
      const [cx, cy] = tileCenter(view, state.width, state.height, i);
      const px = Math.round((cx - backdrop.x) / backdrop.scale);
      const py = Math.round((cy - backdrop.y) / backdrop.scale);
      const r = Math.max(2, Math.round(6 / backdrop.scale));
      if (px - r < 0 || py - r < 0 || px + r >= backdrop.w || py + r >= backdrop.h) return null;
      const d = ctx.getImageData(px - r, py - r, r * 2, r * 2).data;
      let R = 0, G = 0, B = 0;
      for (let k = 0; k < d.length; k += 4) {
        R += d[k];
        G += d[k + 1];
        B += d[k + 2];
      }
      const n = d.length / 4;
      return [R / n, G / n, B / n];
    };
    const examples: { c: [number, number, number]; t: Terrain }[] = [];
    state.tiles.forEach((t, i) => {
      if (t.terrain === 'unknown') return;
      const c = sample(i);
      if (c) examples.push({ c, t: t.terrain });
    });
    const kinds = new Set(examples.map((e) => e.t));
    if (kinds.size < 2) {
      setMsg('Paint at least one tile of two or more terrains first, so there is something to compare against.');
      return;
    }
    const out = new Map<number, Terrain>();
    state.tiles.forEach((t, i) => {
      if (t.terrain !== 'unknown') return;
      const c = sample(i);
      if (!c) return;
      let best: Terrain = 'unknown';
      let bd = Infinity;
      for (const e of examples) {
        const d = (e.c[0] - c[0]) ** 2 + (e.c[1] - c[1]) ** 2 + (e.c[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = e.t;
        }
      }
      out.set(i, best);
    });
    onGuess(out);
    setMsg(`Guessed ${out.size} tiles. Check them against the screenshot and fix any mistakes, then add crops, metal and buildings.`);
  };

  return (
    <div className="shot">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      {!backdrop ? (
        <>
          <p className="muted small">
            Best effort: put a screenshot under the map, line up the grid, and the app guesses terrain from the colours. You still add crops, metal and buildings by hand.
          </p>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Choose screenshot
          </button>
        </>
      ) : (
        <>
          <Slider label="Left / right" min={-2000} max={2000} value={backdrop.x} onChange={(x) => setBackdrop({ ...backdrop, x })} />
          <Slider label="Up / down" min={-2000} max={2000} value={backdrop.y} onChange={(y) => setBackdrop({ ...backdrop, y })} />
          <Slider label="Size" min={0.05} max={4} step={0.01} value={backdrop.scale} onChange={(scale) => setBackdrop({ ...backdrop, scale })} />
          <Slider label="Map see-through" min={0} max={1} step={0.05} value={tileOpacity} onChange={setTileOpacity} />
          <div className="row">
            <button type="button" onClick={guess}>
              Guess terrain
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setBackdrop(null);
                setTileOpacity(1);
                setMsg(null);
              }}
            >
              Remove screenshot
            </button>
          </div>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

function Slider({ label, min, max, step = 1, value, onChange }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
