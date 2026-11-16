import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILDING_KINDS, BUILDING_NAMES, type BuildingKind, type CostTable, DEFAULT_COSTS, TRIBE_BY_KEY, TRIBES, type Terrain, type TribeKey } from './data/rules';
import { blankState, exampleState } from './model/defaults';
import { type GoalKind, type GoalPrefs, loadGoalPrefs, MAX_TURN, resolveGoal, saveGoalPrefs, turnNow } from './model/goalPrefs';
import { download, loadLocal, mapJson, parseJson, saveLocal } from './model/io';
import { applyTool, type Tool } from './model/paint';
import { readPref, writePref } from './model/prefs';
import type { GameState } from './model/types';
import type { RawSave } from './parse/stateFile';
import { humanPlayers, toGameState } from './parse/toGameState';
import { currentLayout } from './solver/exact';
import type { GoalResult } from './solver/goals';
import { income } from './solver/income';
import { techPrice } from './solver/options';
import { layoutAfter } from './solver/schedule';
import { plural, where } from './ui/describe';
import { type Backdrop, cityColor, GAME_VIEW, isGameView, loadView, MapView, type Overlay, saveView, type View } from './ui/MapView';
import { CityRow } from './ui/CityRow';
import { GoalPicker, SolveHint } from './ui/GoalPicker';
import { NumberField } from './ui/NumberField';
import { ResultsPanel } from './ui/ResultsPanel';
import { ScreenshotPanel } from './ui/ScreenshotPanel';
import { TechPicker } from './ui/TechPicker';
import { useOptimizer } from './ui/useOptimizer';
import { LoadSave, SyncBar } from './ui/LoadSave';
import { loadNotice, makeLink, mergeRefresh, routeSave } from './ui/saveSync';
import { type SaveRead, type SyncWhy, useSaveSync } from './ui/useSaveSync';

const TERRAINS: [Terrain, string][] = [
  ['field', 'Field'],
  ['forest', 'Forest'],
  ['mountain', 'Mountain'],
  ['water', 'Water'],
  ['ocean', 'Ocean'],
  ['unknown', 'Unexplored'],
];

const BUILD_TOOLS: (BuildingKind | 'none' | 'other')[] = [...BUILDING_KINDS, 'other', 'none'];

const TERRAIN_KEYS: Record<string, Terrain> = { '1': 'field', '2': 'forest', '3': 'mountain', '4': 'water', '5': 'ocean', '6': 'unknown' };

const WIDE_KEY = 'market-planner/map-wide/v1';

const FIRST_RUN =
  'This is an example map. Press Find the best layout to see a plan, or start your own: Load game save reads your game, New map lets you paint one.';

export default function App() {
  const [initial] = useState(() => {
    const saved = loadLocal();
    return { state: saved ?? exampleState(), firstRun: !saved };
  });
  const [state, setState] = useState<GameState>(initial.state);
  const [tool, setTool] = useState<Tool>({ kind: 'look' });
  const [view, setView] = useState<View>(loadView);
  useEffect(() => saveView(view), [view]);
  const [wideMap, setWideMap] = useState(() => readPref<unknown>(WIDE_KEY, false) === true);
  // The goal kind and the numbers typed for each kind, kept across goal switches, reloads
  // and loading a newer save (deadlines are game turns).
  const [goalPrefs, setGoalPrefs] = useState<GoalPrefs>(loadGoalPrefs);
  useEffect(() => saveGoalPrefs(goalPrefs), [goalPrefs]);
  const setGoalKind = (kind: GoalKind) => setGoalPrefs((p) => ({ ...p, kind }));
  const editGoal = <K extends Exclude<GoalKind, 'max'>>(kind: K, patch: Partial<GoalPrefs[K]>) => setGoalPrefs((p) => ({ ...p, [kind]: { ...p[kind], ...patch } }));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initial.firstRun ? FIRST_RUN : null);
  // The map a replace (new, example, opened file) threw away, for one step of undo.
  const [undo, setUndo] = useState<GameState | null>(null);
  // Changes whenever the whole map is replaced, to reset panels that belong to the old one.
  const [mapId, setMapId] = useState(0);
  // Last painted tile: flashed on the map and announced to screen readers.
  const [lastPaint, setLastPaint] = useState<{ tile: number; n: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // The tile under the keyboard cursor, said by screen readers as it moves.
  const [cursorSay, setCursorSay] = useState('');
  const [stepHover, setStepHover] = useState<number | null>(null);
  // A step tapped in the build order stays highlighted on the map until the next tap.
  const [pinTile, setPinTile] = useState<number | null>(null);
  const [pendingSave, setPendingSave] = useState<{ save: RawSave; name: string; read: SaveRead; note?: string } | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [tileOpacity, setTileOpacity] = useState(1);
  const [showPlan, setShowPlan] = useState(true);
  const saveInput = useRef<HTMLInputElement>(null);
  const sync = useSaveSync({
    onSave: (save, read, why) => ingestSave(save, read, why),
    onLoadError: (m) => {
      setNotice(null);
      setPendingSave(null);
      setError(m);
    },
    openInput: () => saveInput.current?.click(),
  });
  const jsonInput = useRef<HTMLInputElement>(null);
  const onError = useCallback((m: string) => setError(m), []);
  const opt = useOptimizer(onError);

  useEffect(() => saveLocal(state), [state]);

  const s = state.settings;
  const tribe = TRIBE_BY_KEY[s.tribe];
  const curIncome = useMemo(() => income(currentLayout(state), state.width, state.height).total, [state]);
  const now = turnNow(state);
  const { goal, by: deadline, problem: goalProblem } = useMemo(() => resolveGoal(goalPrefs, now, curIncome), [goalPrefs, now, curIncome]);
  // What a solve depends on: the map, settings and the goal.
  const stateKey = useMemo(() => JSON.stringify([state, goal]), [state, goal]);
  const stale = opt.solved !== null && opt.solved.stateKey !== stateKey;

  const update = (fn: (s: GameState) => GameState) => setState((prev) => fn(structuredClone(prev)));
  const setSettings = (patch: Partial<GameState['settings']>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }));

  /** Replace the whole map (new, example, loaded): clears results, banners and the screenshot. */
  const replaceState = (next: GameState, message: string | null, undoable = true, fromSave = false) => {
    if (!fromSave) sync.unlink();
    setUndo(undoable ? state : null);
    setState(next);
    setMapId((n) => n + 1);
    setLastPaint(null);
    setTool({ kind: 'look' }); // a territory tool may name a city the new map doesn't have
    opt.reset();
    setPendingSave(null);
    setError(null);
    setNotice(message);
    setHover(null);
    setStepHover(null);
    setPinTile(null);
    if (backdrop) URL.revokeObjectURL(backdrop.href);
    setBackdrop(null);
    setTileOpacity(1);
  };

  /**
   * A fresh read of the game on screen (Refresh, auto-update): takes the map from the save
   * but keeps the tool, view, screenshot, goal and the plan (which goes stale), with no undo or banner.
   */
  const refreshState = (fn: (prev: GameState) => GameState, cities: number) => {
    setState((prev) => fn(prev));
    setLastPaint(null);
    setTool((t) => (t.kind === 'territory' && t.city !== null && t.city >= cities ? { kind: 'look' } : t));
  };

  const paint = (i: number, first: boolean) => {
    if (first) setPinTile(null);
    if (tool.kind === 'look' || i < 0 || i >= state.tiles.length) return;
    // Cities, resources and enemy units toggle, so dragging would flip them on every tile it passes.
    if (!first && (tool.kind === 'city' || tool.kind === 'resource' || tool.kind === 'enemy')) return;
    update((st) => applyTool(st, tool, i));
    setLastPaint((p) => ({ tile: i, n: (p?.n ?? 0) + 1 }));
  };

  const pickTool = (t: Tool) => {
    setTool(t);
    setLastPaint(null);
  };
  const onToolKey = (key: string) => {
    const k = key.toLowerCase();
    if (TERRAIN_KEYS[k]) pickTool({ kind: 'terrain', v: TERRAIN_KEYS[k] });
    else if (k === 'm') pickTool({ kind: 'look' });
    else return false;
    return true;
  };

  // ---------- loading ----------
  /** A save was read: a new load, or a refresh that keeps your settings when it's the same game. */
  const ingestSave = (save: RawSave, read: SaveRead, why: SyncWhy) => {
    const route = routeSave(sync.link, save, read.stamp.name, why);
    if (route.kind === 'error') setError(route.message);
    else if (route.kind === 'refresh') refreshSave(save, route.playerId, read);
    else if (route.kind === 'replace') applySave(save, route.playerId, read, route.note);
    else {
      setError(null);
      setPendingSave({ save, name: read.stamp.name, read, note: route.note });
    }
  };

  const refreshSave = (save: RawSave, playerId: number, read: SaveRead) => {
    const link = sync.link!;
    try {
      const r = toGameState(save, playerId, read.stamp.name);
      refreshState((prev) => mergeRefresh(prev, link.incomeEstimate, r.state), r.state.cities.length);
      sync.linked(makeLink(read.kind, read.stamp, save, playerId, r.incomeEstimate), read);
      // The banners were about the read before this one.
      setNotice(null);
      setUndo(null);
      setError(null);
    } catch (e) {
      setError(`Couldn't use that save. (Details: ${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const applySave = (save: RawSave, playerId: number, read: SaveRead, note?: string) => {
    try {
      const r = toGameState(save, playerId, read.stamp.name);
      const cur = income(currentLayout(r.state), r.state.width, r.state.height).total;
      replaceState(r.state, loadNotice(save, r, cur, note), true, true);
      sync.linked(makeLink(read.kind, read.stamp, save, playerId, r.incomeEstimate), read);
    } catch (e) {
      setPendingSave(null);
      setError(`Couldn't use that save. (Details: ${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const loadJson = async (f: File) => {
    try {
      replaceState(parseJson(await f.text()), `Opened ${f.name}.`);
    } catch (e) {
      setNotice(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- results ----------
  const shown: GoalResult | null = opt.picked?.result ?? opt.solved?.result ?? null;
  // A goal can stop part way through a plan; then mark the plan the build order really ends at.
  const selectedIndex =
    opt.picked?.index ??
    (opt.solved && shown
      ? shown.schedule.finalIncome === shown.plan.income
        ? opt.solved.frontier.plans.indexOf(shown.plan)
        : opt.solved.frontier.plans.findIndex((p) => p.income === shown.schedule.finalIncome && (p.changes.length > 0) === (shown.bundles.length > 0))
      : -1);

  const overlay: Overlay | null = useMemo(() => {
    if (!shown || !showPlan || stale) return null;
    const steps = new Map<number, number[]>();
    shown.schedule.steps.forEach((st, n) => {
      if (st.action.kind === 'tech') return;
      const l = steps.get(st.action.tile) ?? [];
      l.push(n + 1);
      steps.set(st.action.tile, l);
    });
    // Layout after the steps in this schedule (income goals may stop before the full plan).
    const { layout, removed } = layoutAfter(state, shown.schedule.steps.map((x) => x.action));
    return { layout, steps, removed, marketIncome: income(layout, state.width, state.height).markets };
  }, [shown, showPlan, state, stale]);

  const hoverTile = stepHover ?? hover ?? pinTile;
  const hoverInfo = hover !== null ? describeTile(state, hover) : null;
  const unsupported = !tribe.hasMarket;
  const busy = opt.busy === 'solve';
  // Tiles a market could use: explored land inside your territory.
  const mappedTiles = useMemo(() => state.tiles.filter((t) => t.city !== null && t.terrain !== 'unknown').length, [state.tiles]);
  const canSolve = !unsupported && state.cities.length > 0 && mappedTiles > 0;
  // Both Solve buttons (the plan panel's and the save bar's) run only when this is true.
  const canRun = canSolve && !busy && goalProblem === null;
  const painted = lastPaint ? describeTile(state, lastPaint.tile) : null;
  const [coarse] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

  return (
    <div className="app">
      <a className="skip" href="#goal-label">
        Skip to goal and solve
      </a>
      <header>
        <div className="brand">
          <h1>Market Planner</h1>
          <span className="tag">for The Battle of Polytopia</span>
        </div>
        <div className="actions">
          <input
            ref={saveInput}
            type="file"
            accept=".state"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) sync.fromInput(f);
            }}
          />
          <input
            ref={jsonInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) loadJson(f);
            }}
          />
          <LoadSave sync={sync} />
          <button type="button" title="Open a map .json file you downloaded before" onClick={() => jsonInput.current?.click()}>
            Open map file
          </button>
          <button type="button" title="Save this map as a .json file you can open later" onClick={() => download('polytopia-map.json', mapJson(state))}>
            Download map
          </button>
          <NewMap
            onCreate={(w, h) => {
              replaceState(blankState(w, h), `Started a blank ${w}×${h} map. Paint the terrain first, then add your cities.`);
              setTool({ kind: 'terrain', v: 'field' });
            }}
            onExample={() => replaceState(exampleState(), 'Opened the example map.')}
          />
        </div>
      </header>

      <SyncBar sync={sync} planStale={stale} onSolve={canRun ? () => opt.solve(state, goal, stateKey) : null} />
      {pendingSave && (
        <div className="banner" role="status">
          {pendingSave.note ? `${pendingSave.note} ` : ''}This save has more than one human player. Who are you?
          {humanPlayers(pendingSave.save).map((p) => (
            <button key={p.id} type="button" className="accent" onClick={() => applySave(pendingSave.save, p.id, pendingSave.read, pendingSave.note)}>
              {p.name || `Player ${p.id}`}
            </button>
          ))}
          <button type="button" className="link" onClick={() => setPendingSave(null)}>
            Cancel
          </button>
        </div>
      )}
      {notice && (
        <div className="banner info" role="status">
          <span>{notice}</span>
          <span className="banner-actions">
            {undo && (
              <button
                type="button"
                onClick={() => {
                  replaceState(undo, 'Your previous map is back.', false);
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="link"
              onClick={() => {
                setNotice(null);
                setUndo(null);
              }}
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
      {error && (
        <div className="banner err" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main>
        <section className={`mapcol${wideMap ? ' wide' : ''}`}>
          <div className="toolbar">
            <div className="tools" role="group" aria-label="Map tools">
              <ToolBtn active={tool.kind === 'look'} onClick={() => pickTool({ kind: 'look' })} title="Look around without changing the map: drag to move, Ctrl + wheel to zoom (M)">
                Move
              </ToolBtn>
              <span className="sep" />
              {TERRAINS.map(([v, label]) => (
                <ToolBtn key={v} active={tool.kind === 'terrain' && tool.v === v} onClick={() => pickTool({ kind: 'terrain', v })} swatch={`t-${v}`} title={`Paint ${label.toLowerCase()} (${TERRAINS.findIndex((x) => x[0] === v) + 1})`}>
                  {label}
                </ToolBtn>
              ))}
              <span className="sep" />
              <ToolBtn active={tool.kind === 'resource' && tool.v === 'crop'} onClick={() => pickTool({ kind: 'resource', v: 'crop' })}>
                Crop
              </ToolBtn>
              <ToolBtn active={tool.kind === 'resource' && tool.v === 'metal'} onClick={() => pickTool({ kind: 'resource', v: 'metal' })}>
                Metal
              </ToolBtn>
              {tribe.hasAquafarm && (
                <ToolBtn active={tool.kind === 'resource' && tool.v === 'aquacrop'} onClick={() => pickTool({ kind: 'resource', v: 'aquacrop' })}>
                  Water crop
                </ToolBtn>
              )}
              <span className="sep" />
              <select
                aria-label="Building"
                value={tool.kind === 'building' ? tool.v : ''}
                onChange={(e) => pickTool({ kind: 'building', v: e.target.value as BuildingKind | 'none' | 'other' })}
              >
                <option value="" disabled>
                  Building…
                </option>
                {BUILD_TOOLS.filter((b) => b !== 'aquafarm' || tribe.hasAquafarm).map((b) => (
                  <option key={b} value={b}>
                    {b === 'none' ? 'Remove building' : b === 'other' ? 'Other (temple, port…)' : BUILDING_NAMES[b]}
                  </option>
                ))}
              </select>
              <ToolBtn active={tool.kind === 'city'} onClick={() => pickTool({ kind: 'city' })} title="Tap a tile to add or remove a city">
                City
              </ToolBtn>
              <ToolBtn active={tool.kind === 'enemy'} onClick={() => pickTool({ kind: 'enemy' })} title="Tap a tile to add or remove an enemy unit. The plan leaves those tiles alone.">
                Enemy unit
              </ToolBtn>
              <select
                aria-label="Territory"
                value={tool.kind === 'territory' ? String(tool.city) : ''}
                onChange={(e) => pickTool({ kind: 'territory', city: e.target.value === 'null' ? null : Number(e.target.value) })}
              >
                <option value="" disabled>
                  Territory…
                </option>
                {state.cities.map((c, i) => (
                  <option key={i} value={i}>
                    Belongs to {c.name.trim() || `City ${i + 1}`}
                  </option>
                ))}
                <option value="null">Not yours</option>
              </select>
            </div>
            <div className="viewctl" role="group" aria-label="Map view">
              <ToolBtn active={isGameView(view)} onClick={() => setView({ ...GAME_VIEW })} title="Turn the map the way the game shows it">
                Game view
              </ToolBtn>
              <button type="button" className="icon" title="Rotate map" aria-label="Rotate map" onClick={() => setView({ ...view, rot: ((view.rot + 1) % 4) as View['rot'] })}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
                </svg>
              </button>
              <button type="button" className="icon" title="Mirror map" aria-label="Mirror map" onClick={() => setView({ ...view, flip: !view.flip })}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M8 1.5v13" />
                  <path className="solid" d="M6 4 2 8l4 4V4zM10 4l4 4-4 4V4z" />
                </svg>
              </button>
              <button
                type="button"
                className="icon widebtn"
                title={wideMap ? 'Narrow map' : 'Expand map'}
                aria-label="Expand map"
                aria-pressed={wideMap}
                onClick={() => {
                  setWideMap(!wideMap);
                  writePref(WIDE_KEY, !wideMap);
                }}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  {wideMap ? <path d="M1.5 8h4.5M14.5 8H10M4 5.5 6.5 8 4 10.5M12 5.5 9.5 8l2.5 2.5" /> : <path d="M1.5 8h13M4.5 5 1.5 8l3 3M11.5 5l3 3-3 3" />}
                </svg>
              </button>
            </div>
          </div>
          {coarse && tool.kind !== 'look' && <p className="paint-hint small">Painting: dragging paints tiles. Choose Move to scroll the map. Pinch to zoom.</p>}
          <div className="mapwrap">
            <MapView
              key={`${mapId}-${state.width}x${state.height}`}
              state={state}
              view={view}
              overlay={overlay}
              highlight={hoverTile}
              onPaint={tool.kind === 'look' ? undefined : paint}
              onHover={setHover}
              backdrop={backdrop}
              tileOpacity={tileOpacity}
              editing={tool.kind !== 'look'}
              flash={lastPaint}
              onToolKey={onToolKey}
              onKeyCursor={(i) => setCursorSay(describeTile(state, i) ?? '')}
            />
          </div>
          <div className="mapfoot">
            <span className="muted small">{hoverInfo ?? [state.source, `${state.width}×${state.height}`].filter(Boolean).join(' · ')}</span>
            <span className="sr-only" aria-live="polite">
              {painted ? `Painted ${painted}` : ''}
            </span>
            <span className="sr-only" aria-live="polite">
              {cursorSay}
            </span>
            {shown && !stale && (
              <label className="small">
                <input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} /> Show plan on map
              </label>
            )}
          </div>
          <details className="panel shot-panel">
            <summary>Import from a screenshot</summary>
            <ScreenshotPanel
              key={mapId}
              state={state}
              view={view}
              backdrop={backdrop}
              setBackdrop={setBackdrop}
              tileOpacity={tileOpacity}
              setTileOpacity={setTileOpacity}
              onGuess={(g) =>
                update((st) => {
                  for (const [i, t] of g) st.tiles[i].terrain = t;
                  return st;
                })
              }
            />
          </details>
          {state.cities.length > 0 && (
            <details className="panel">
              <summary>Cities</summary>
              <p className="muted small">Level and population (the filled pips under the city's name) let the plan count the rewards when its buildings level a city up.</p>
              <div className="cities">
                {state.cities.map((c, i) => (
                  <CityRow
                    key={i}
                    city={c}
                    index={i}
                    onChange={(edit) =>
                      update((st) => {
                        edit(st.cities[i]);
                        return st;
                      })
                    }
                  />
                ))}
              </div>
            </details>
          )}
        </section>

        <aside>
          <section className="panel open">
            <h2>Your game</h2>
            <div className="grid2">
              <label>
                Tribe
                <select value={s.tribe} onChange={(e) => setSettings({ tribe: e.target.value as TribeKey })}>
                  {TRIBES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cities you own
                <NumberField min={1} max={999} value={s.cityCount} onChange={(v) => setSettings({ cityCount: v })} />
              </label>
              <label title="The turn number at the top of the game screen. Goal deadlines are game turns.">
                Turn now
                <NumberField min={0} max={MAX_TURN} value={now} onChange={(v) => update((st) => ({ ...st, turn: v }))} />
              </label>
              <label>
                Stars now
                <NumberField min={0} max={9999} value={s.stars} onChange={(v) => setSettings({ stars: v })} />
              </label>
              <label title="The +★ per turn number shown in the game. The markets you already have are part of it.">
                Income per turn
                <NumberField min={curIncome} max={9999} value={s.baseIncome + curIncome} onChange={(v) => setSettings({ baseIncome: Math.max(0, v - curIncome) })} />
                <small className="muted">{curIncome > 0 ? `incl. ${curIncome}★ from markets` : 'from everything you have'}</small>
              </label>
            </div>
            {tribe.note && <p className="small warn">{tribe.note}</p>}
            <p className="muted small">Select the techs you already have. Prices are for {plural(s.cityCount, 'city', 'cities')}.</p>
            <TechPicker owned={s.owned} tribe={s.tribe} prices={(t) => techPrice(state, t)} onChange={(owned) => setSettings({ owned })} />
          </section>

          <section className="panel open">
            <h2 id="goal-label">What do you want?</h2>
            <GoalPicker goal={goal} deadline={deadline} now={now} problem={goalProblem} onKind={setGoalKind} onEdit={editGoal} />
            <fieldset className="toggles">
              <legend>The plan may</legend>
              <Toggle label="buy new techs" checked={s.allowNewTech} onChange={(v) => setSettings({ allowNewTech: v })} />
              <Toggle label={tribe.canClearForest ? 'clear forest' : `clear forest (not for ${tribe.name})`} checked={s.allowClear} onChange={(v) => setSettings({ allowClear: v })} disabled={!tribe.canClearForest} />
              <Toggle label={tribe.canBurnForest ? 'burn forest' : `burn forest (not for ${tribe.name})`} checked={s.allowBurn} onChange={(v) => setSettings({ allowBurn: v })} disabled={!tribe.canBurnForest} />
              <Toggle label="grow forest" checked={s.allowGrow} onChange={(v) => setSettings({ allowGrow: v })} />
              <Toggle label="destroy buildings" checked={s.allowDestroy} onChange={(v) => setSettings({ allowDestroy: v })} />
              <Toggle
                label="count city upgrade rewards"
                title="When the plan's farms, huts, mines and producers level up a city, take the economic reward (Workshop, Resources, Population growth, Park). Needs city levels: they come from your save, or set them under Cities."
                checked={s.cityUpgrades !== false}
                onChange={(v) => setSettings({ cityUpgrades: v })}
              />
            </fieldset>
            <button type="button" className="primary" onClick={() => canRun && opt.solve(state, goal, stateKey)} aria-disabled={busy || undefined} disabled={!canSolve || goalProblem !== null}>
              {busy ? 'Working…' : opt.solved ? 'Solve again' : 'Find the best layout'}
            </button>
            <SolveHint cities={state.cities.length} mappedTiles={mappedTiles} />
            <p className="sr-only" role="status" aria-live="polite">
              {busy ? 'Finding the best layout…' : shown && !stale ? shown.summary : ''}
            </p>
          </section>

          {shown && opt.solved && (
            <section className="panel open" aria-busy={opt.busy !== null || undefined}>
              <h2 title={`Solved in ${opt.solved.ms} ms`}>Plan</h2>
              <ResultsPanel
                key={opt.solved.runId}
                state={state}
                result={shown}
                frontier={opt.solved.frontier.plans}
                currentIncome={curIncome}
                selected={selectedIndex}
                onSelect={(i) => opt.pick(state, i, opt.solved!.frontier.plans[i])}
                onHoverTile={setStepHover}
                onShowTile={(t) => {
                  setPinTile(t);
                  setHover(null);
                  const wrap = document.querySelector('.mapwrap');
                  const r = wrap?.getBoundingClientRect();
                  if (wrap && r && (r.bottom < 0 || r.top > window.innerHeight)) wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
                turn={opt.solved.turn}
                stale={stale}
                loading={opt.busy !== null}
              />
            </section>
          )}

          <details className="panel">
            <summary>Rules and costs</summary>
            <RulesEditor costs={s.costs} onChange={(costs) => setSettings({ costs })} />
          </details>
        </aside>
      </main>
      <footer>
        Fan-made tool, not affiliated with Midjiwan. Save loading reads only tiles you have explored. Save format reading is based on polytopiamapmodelgo (MIT).
      </footer>
    </div>
  );
}

function describeTile(state: GameState, i: number) {
  const t = state.tiles[i];
  if (!t) return null;
  const parts = [where(state, i), t.terrain === 'unknown' ? 'unexplored' : t.terrain];
  if (t.resource !== 'none') parts.push(t.resource);
  if (t.improvement !== 'none') parts.push(t.improvement === 'other' ? 'other building' : t.improvement);
  if (t.enemy) parts.push('enemy unit here');
  if (t.city === null && t.terrain !== 'unknown') parts.push('not your territory');
  return parts.join(' · ');
}

function ToolBtn({ active, onClick, children, swatch, title }: { active: boolean; onClick: () => void; children: React.ReactNode; swatch?: string; title?: string }) {
  return (
    <button type="button" className={`tool${active ? ' on' : ''}`} aria-pressed={active} onClick={onClick} title={title}>
      {swatch && <span className={`sw ${swatch}`} />}
      {children}
    </button>
  );
}

function Toggle({ label, checked, onChange, disabled, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`} title={title}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function NewMap({ onCreate, onExample }: { onCreate: (w: number, h: number) => void; onExample: () => void }) {
  const [size, setSize] = useState(16);
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  // Close on Escape or a click outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !ref.current?.open) return;
      close();
      ref.current.querySelector('summary')?.focus();
    };
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);
  return (
    <details className="newmap" ref={ref}>
      <summary className="btn">New map</summary>
      <div className="pop">
        <label>
          Size
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[11, 14, 16, 18, 20, 24, 30].map((n) => (
              <option key={n} value={n}>
                {n}×{n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="accent"
          onClick={() => {
            onCreate(size, size);
            close();
          }}
        >
          Blank map
        </button>
        <button
          type="button"
         
          onClick={() => {
            onExample();
            close();
          }}
        >
          Example map
        </button>
      </div>
    </details>
  );
}

const COST_LABELS: [keyof CostTable, string, { min?: number; integer?: boolean }?][] = [
  ...BUILDING_KINDS.map((k): [keyof CostTable, string] => [k, BUILDING_NAMES[k]]),
  ['clearForestRefund', 'Clear forest (stars back)'],
  ['burnForest', 'Burn forest'],
  ['growForest', 'Grow forest'],
  ['destroy', 'Destroy'],
  ['techBase', 'Tech cost: tier × cities +'],
  ['literacyFactor', 'Tech price with Philosophy (×)', { integer: false }],
];

function RulesEditor({ costs, onChange }: { costs: CostTable; onChange: (c: CostTable) => void }) {
  return (
    <div>
      <p className="muted small">
        Defaults come from the game's own data. A market earns 1★ per level of each adjacent sawmill, windmill or forge, up to 8. Each city can have one market, sawmill, windmill and forge.
        With Philosophy, techs cost about a third less. Change these if the game gets patched.
      </p>
      <div className="grid2">
        {COST_LABELS.map(([k, label, o]) => (
          <label key={k}>
            {label}
            <NumberField min={0} max={k === 'literacyFactor' ? 1 : 999} step={o?.integer === false ? 0.01 : 1} integer={o?.integer !== false} value={Math.round(costs[k] * 1000) / 1000} onChange={(v) => onChange({ ...costs, [k]: v })} />
          </label>
        ))}
      </div>
      <button type="button" className="link" onClick={() => onChange({ ...DEFAULT_COSTS })}>
        Reset to defaults
      </button>
    </div>
  );
}
