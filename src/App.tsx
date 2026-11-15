import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILDING_NAMES,
  type BuildingKind,
  type CostTable,
  DEFAULT_COSTS,
  type Resource,
  TRIBE_BY_KEY,
  TRIBES,
  type Terrain,
  type TribeKey,
} from './data/rules';
import { blankState, exampleState } from './model/defaults';
import { download, loadLocal, parseJson, saveLocal } from './model/io';
import type { GameState, Goal, Tile } from './model/types';
import { parseStateFile, type RawSave } from './parse/stateFile';
import { humanPlayers, toGameState } from './parse/toGameState';
import { currentLayout, type Plan } from './solver/exact';
import type { GoalResult } from './solver/goals';
import type { OptimizeResult } from './solver/index';
import { income } from './solver/income';
import { techPrice } from './solver/options';
import { orderActions, simulate } from './solver/schedule';
import { type Backdrop, cityColor, MapView, type Overlay, type View } from './ui/MapView';
import { ResultsPanel } from './ui/ResultsPanel';
import { ScreenshotPanel } from './ui/ScreenshotPanel';
import { TechPicker } from './ui/TechPicker';
import { where } from './ui/describe';

type Tool =
  | { kind: 'look' }
  | { kind: 'terrain'; v: Terrain }
  | { kind: 'resource'; v: Resource }
  | { kind: 'building'; v: BuildingKind | 'none' | 'other' }
  | { kind: 'city' }
  | { kind: 'territory'; city: number | null };

const TERRAINS: [Terrain, string][] = [
  ['field', 'Field'],
  ['forest', 'Forest'],
  ['mountain', 'Mountain'],
  ['water', 'Water'],
  ['ocean', 'Ocean'],
  ['unknown', 'Unexplored'],
];

const BUILD_TOOLS: (BuildingKind | 'none' | 'other')[] = ['market', 'sawmill', 'windmill', 'forge', 'lumberhut', 'farm', 'mine', 'other', 'none'];

export default function App() {
  const [state, setState] = useState<GameState>(() => loadLocal() ?? exampleState());
  const [tool, setTool] = useState<Tool>({ kind: 'look' });
  const [view, setView] = useState<View>({ rot: 0, flip: false });
  const [goal, setGoal] = useState<Goal>({ kind: 'max' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opt, setOpt] = useState<(OptimizeResult & { stateKey: string }) | null>(null);
  const [picked, setPicked] = useState<{ index: number; result: GoalResult } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [stepHover, setStepHover] = useState<number | null>(null);
  const [pendingSave, setPendingSave] = useState<{ save: RawSave; name: string } | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [tileOpacity, setTileOpacity] = useState(1);
  const [showPlan, setShowPlan] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const saveInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveLocal(state), [state]);

  const stateKey = useMemo(() => JSON.stringify(state), [state]);
  const stale = opt !== null && opt.stateKey !== stateKey;
  const s = state.settings;
  const tribe = TRIBE_BY_KEY[s.tribe];
  const curIncome = useMemo(() => income(currentLayout(state), state.width, state.height).total, [state]);

  const update = (fn: (s: GameState) => GameState) => setState((prev) => fn(structuredClone(prev)));
  const setSettings = (patch: Partial<GameState['settings']>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }));

  // ---------- painting ----------
  const paint = (i: number) => {
    if (tool.kind === 'look') return;
    update((st) => {
      const t: Tile = st.tiles[i];
      switch (tool.kind) {
        case 'terrain':
          if (t.improvement === 'city') return st;
          t.terrain = tool.v;
          if (t.resource === 'crop' && tool.v !== 'field') t.resource = 'none';
          if (t.resource === 'metal' && tool.v !== 'mountain') t.resource = 'none';
          if (tool.v === 'unknown') {
            t.resource = 'none';
            t.improvement = 'none';
          }
          break;
        case 'resource':
          if (tool.v === 'crop') t.terrain = 'field';
          if (tool.v === 'metal') t.terrain = 'mountain';
          t.resource = t.resource === tool.v ? 'none' : tool.v;
          break;
        case 'building':
          if (t.improvement === 'city') return st;
          t.improvement = tool.v;
          if (tool.v === 'lumberhut') t.terrain = 'forest';
          if (tool.v === 'mine') {
            t.terrain = 'mountain';
            t.resource = 'metal';
          }
          if (tool.v === 'farm') {
            t.terrain = 'field';
            t.resource = 'crop';
          }
          if (['market', 'sawmill', 'windmill'].includes(tool.v) && t.terrain !== 'field') t.terrain = 'field';
          break;
        case 'territory':
          if (t.improvement === 'city') return st;
          t.city = tool.city;
          break;
        case 'city': {
          const existing = st.cities.findIndex((c) => c.y * st.width + c.x === i);
          if (existing >= 0) {
            // remove the city and its territory
            st.cities.splice(existing, 1);
            st.tiles.forEach((x) => {
              if (x.city === existing) x.city = null;
              else if (x.city !== null && x.city > existing) x.city--;
            });
            t.improvement = 'none';
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
          break;
        }
      }
      return st;
    });
  };

  // ---------- loading ----------
  const loadSaveFile = async (f: File) => {
    setError(null);
    try {
      const save = parseStateFile(new Uint8Array(await f.arrayBuffer()));
      const humans = humanPlayers(save);
      if (!humans.length) throw new Error('No human player found in this save.');
      if (humans.length === 1) applySave(save, humans[0].id, f.name);
      else setPendingSave({ save, name: f.name });
    } catch (e) {
      setError(`Couldn't read that save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const applySave = (save: RawSave, playerId: number, name: string) => {
    const r = toGameState(save, playerId, name);
    setState(r.state);
    setOpt(null);
    setPicked(null);
    setPendingSave(null);
    const cur = income(currentLayout(r.state), r.state.width, r.state.height).total;
    setNotice(
      `Loaded turn ${save.header.currentTurn}: ${r.state.cities.length} cities. ${r.hiddenTiles} tiles you haven't explored are hidden` +
        (r.hiddenResources ? `, and ${r.hiddenResources} resources you can't see yet are left out` : '') +
        `. Your markets make ${cur}★ now. Check "Income per turn" below against the number in the game.`,
    );
  };

  const loadJson = async (f: File) => {
    try {
      setState(parseJson(await f.text()));
      setOpt(null);
      setPicked(null);
      setNotice(`Opened ${f.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- solving ----------
  const solve = () => {
    setError(null);
    setBusy(true);
    setPicked(null);
    workerRef.current?.terminate();
    const w = new Worker(new URL('./solver/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const id = ++reqId.current;
    const key = stateKey;
    w.onmessage = (e) => {
      if (e.data.id !== id) return;
      setBusy(false);
      w.terminate();
      if (!e.data.ok) setError(e.data.error);
      else setOpt({ ...(e.data.result as OptimizeResult), stateKey: key });
    };
    w.onerror = (e) => {
      setBusy(false);
      setError(e.message || 'The optimizer crashed.');
    };
    w.postMessage({ id, state, goal });
  };

  const shown: GoalResult | null = picked?.result ?? opt?.result ?? null;
  const selectedIndex = picked?.index ?? (opt && shown ? opt.frontier.plans.indexOf(shown.plan) : -1);

  const pickPlan = (i: number) => {
    if (!opt) return;
    const plan: Plan = opt.frontier.plans[i];
    const bundles = orderActions(state, plan);
    const schedule = simulate(state, bundles);
    setPicked({
      index: i,
      result: { plan, bundles, schedule, met: true, summary: `This plan earns ${plan.income}★ per turn from markets for ${plan.cost}★ in total.` },
    });
  };

  const overlay: Overlay | null = useMemo(() => {
    if (!shown || !showPlan) return null;
    const steps = new Map<number, number[]>();
    shown.schedule.steps.forEach((st, n) => {
      if (st.action.kind === 'tech') return;
      const l = steps.get(st.action.tile) ?? [];
      l.push(n + 1);
      steps.set(st.action.tile, l);
    });
    // Layout after the steps in this schedule (income goals may stop before the full plan).
    const layout = currentLayout(state);
    const removed = new Set<number>();
    for (const st of shown.schedule.steps) {
      const a = st.action;
      if (a.kind === 'op' && a.op === 'destroy') {
        layout[a.tile] = null;
        removed.add(a.tile);
      }
      if (a.kind === 'build') {
        layout[a.tile] = a.build;
        removed.delete(a.tile);
      }
    }
    return { layout, steps, removed, marketIncome: income(layout, state.width, state.height).markets };
  }, [shown, showPlan, state]);

  const hoverTile = stepHover ?? hover;
  const hoverInfo = hover !== null ? describeTile(state, hover) : null;
  const unsupported = !tribe.hasMarket;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Market Planner</h1>
          <span className="tag">for The Battle of Polytopia</span>
        </div>
        <div className="actions">
          <input ref={saveInput} type="file" accept=".state" hidden onChange={(e) => e.target.files?.[0] && loadSaveFile(e.target.files[0])} />
          <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && loadJson(e.target.files[0])} />
          <button type="button" onClick={() => saveInput.current?.click()}>
            Open save file
          </button>
          <button type="button" className="secondary" onClick={() => jsonInput.current?.click()}>
            Open map
          </button>
          <button type="button" className="secondary" onClick={() => download('polytopia-map.json', JSON.stringify(state, null, 1))}>
            Save map
          </button>
          <NewMap
            onCreate={(w, h) => {
              setState(blankState(w, h));
              setOpt(null);
              setPicked(null);
              setTool({ kind: 'terrain', v: 'field' });
            }}
            onExample={() => {
              setState(exampleState());
              setOpt(null);
              setPicked(null);
            }}
          />
        </div>
      </header>

      {pendingSave && (
        <div className="banner">
          This save has more than one human player. Who are you?
          {humanPlayers(pendingSave.save).map((p) => (
            <button key={p.id} type="button" onClick={() => applySave(pendingSave.save, p.id, pendingSave.name)}>
              {p.name || `Player ${p.id}`}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <div className="banner info">
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="banner err">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main>
        <section className="mapcol">
          <div className="toolbar" role="toolbar" aria-label="Map tools">
            <ToolBtn active={tool.kind === 'look'} onClick={() => setTool({ kind: 'look' })}>
              Look
            </ToolBtn>
            <span className="sep" />
            {TERRAINS.map(([v, label]) => (
              <ToolBtn key={v} active={tool.kind === 'terrain' && tool.v === v} onClick={() => setTool({ kind: 'terrain', v })} swatch={`t-${v}`}>
                {label}
              </ToolBtn>
            ))}
            <span className="sep" />
            <ToolBtn active={tool.kind === 'resource' && tool.v === 'crop'} onClick={() => setTool({ kind: 'resource', v: 'crop' })}>
              Crop
            </ToolBtn>
            <ToolBtn active={tool.kind === 'resource' && tool.v === 'metal'} onClick={() => setTool({ kind: 'resource', v: 'metal' })}>
              Metal
            </ToolBtn>
            <span className="sep" />
            <select
              aria-label="Building"
              value={tool.kind === 'building' ? tool.v : ''}
              onChange={(e) => setTool({ kind: 'building', v: e.target.value as BuildingKind | 'none' | 'other' })}
            >
              <option value="" disabled>
                Building…
              </option>
              {BUILD_TOOLS.map((b) => (
                <option key={b} value={b}>
                  {b === 'none' ? 'Remove building' : b === 'other' ? 'Other (temple, port…)' : BUILDING_NAMES[b]}
                </option>
              ))}
            </select>
            <ToolBtn active={tool.kind === 'city'} onClick={() => setTool({ kind: 'city' })}>
              City
            </ToolBtn>
            <select
              aria-label="Territory"
              value={tool.kind === 'territory' ? String(tool.city) : ''}
              onChange={(e) => setTool({ kind: 'territory', city: e.target.value === 'null' ? null : Number(e.target.value) })}
            >
              <option value="" disabled>
                Territory…
              </option>
              {state.cities.map((c, i) => (
                <option key={i} value={i}>
                  Belongs to {c.name}
                </option>
              ))}
              <option value="null">Not yours</option>
            </select>
            <span className="grow" />
            <button type="button" className="icon" title="Rotate map" onClick={() => setView({ ...view, rot: ((view.rot + 1) % 4) as View['rot'] })}>
              ⟳
            </button>
            <button type="button" className="icon" title="Mirror map" onClick={() => setView({ ...view, flip: !view.flip })}>
              ⇋
            </button>
          </div>
          <div className="mapwrap">
            <MapView
              state={state}
              view={view}
              overlay={overlay}
              highlight={hoverTile}
              onPaint={paint}
              onHover={setHover}
              backdrop={backdrop}
              tileOpacity={tileOpacity}
            />
          </div>
          <div className="mapfoot">
            <span className="muted small">{hoverInfo ?? `${state.source ?? ''} · ${state.width}×${state.height}`}</span>
            {shown && (
              <label className="small">
                <input type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} /> Show plan on map
              </label>
            )}
          </div>
          <details className="panel">
            <summary>Import from a screenshot</summary>
            <ScreenshotPanel
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
              <summary>City names</summary>
              <div className="cities">
                {state.cities.map((c, i) => (
                  <label key={i}>
                    <span className="dot" style={{ background: cityColor(i) }} />
                    <input
                      value={c.name}
                      onChange={(e) =>
                        update((st) => {
                          st.cities[i].name = e.target.value;
                          return st;
                        })
                      }
                    />
                  </label>
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
                <input type="number" min={1} value={s.cityCount} onChange={(e) => setSettings({ cityCount: Math.max(1, Number(e.target.value)) })} />
              </label>
              <label>
                Stars now
                <input type="number" min={0} value={s.stars} onChange={(e) => setSettings({ stars: Math.max(0, Number(e.target.value)) })} />
              </label>
              <label title="The +★ per turn number shown in the game. Markets you already have are counted automatically.">
                Income per turn
                <input
                  type="number"
                  min={0}
                  value={s.baseIncome + curIncome}
                  onChange={(e) => setSettings({ baseIncome: Math.max(0, Number(e.target.value) - curIncome) })}
                />
              </label>
            </div>
            {tribe.note && <p className="small warn">{tribe.note}</p>}
            <p className="muted small">Tech costs use {s.cityCount} cities. Tap a tech to mark it owned.</p>
            <TechPicker owned={s.owned} tribe={s.tribe} prices={(t) => techPrice(state, t)} onChange={(owned) => setSettings({ owned })} />
          </section>

          <section className="panel open">
            <h2>What do you want?</h2>
            <div className="goals" role="radiogroup">
              <GoalOpt checked={goal.kind === 'max'} onSelect={() => setGoal({ kind: 'max' })} title="Most market income" desc="Highest stars per turn, at the lowest cost for that income." />
              <GoalOpt
                checked={goal.kind === 'income'}
                onSelect={() => setGoal({ kind: 'income', income: Math.max(1, curIncome + 4), turns: 10 })}
                title="Reach an income"
                desc="Get to a market income as soon as possible."
              >
                {goal.kind === 'income' && (
                  <span className="inline">
                    <input type="number" min={1} value={goal.income} onChange={(e) => setGoal({ ...goal, income: Number(e.target.value) })} />
                    ★ per turn from markets within
                    <input type="number" min={1} value={goal.turns} onChange={(e) => setGoal({ ...goal, turns: Number(e.target.value) })} /> turns
                  </span>
                )}
              </GoalOpt>
              <GoalOpt
                checked={goal.kind === 'bank'}
                onSelect={() => setGoal({ kind: 'bank', stars: 30, turns: 8 })}
                title="Save up stars"
                desc="Have a number of stars on hand by a deadline, investing only where it pays off in time."
              >
                {goal.kind === 'bank' && (
                  <span className="inline">
                    <input type="number" min={1} value={goal.stars} onChange={(e) => setGoal({ ...goal, stars: Number(e.target.value) })} />★ by turn +
                    <input type="number" min={1} value={goal.turns} onChange={(e) => setGoal({ ...goal, turns: Number(e.target.value) })} />
                  </span>
                )}
              </GoalOpt>
              <GoalOpt
                checked={goal.kind === 'best-by'}
                onSelect={() => setGoal({ kind: 'best-by', turns: 15 })}
                title="Best return by a turn"
                desc="Most stars on hand by a turn: only builds that pay for themselves before then."
              >
                {goal.kind === 'best-by' && (
                  <span className="inline">
                    by turn +<input type="number" min={1} value={goal.turns} onChange={(e) => setGoal({ ...goal, turns: Number(e.target.value) })} />
                  </span>
                )}
              </GoalOpt>
            </div>
            <fieldset className="toggles">
              <legend>The plan may</legend>
              <Toggle label="buy new techs" checked={s.allowNewTech} onChange={(v) => setSettings({ allowNewTech: v })} />
              <Toggle label="clear forest" checked={s.allowClear} onChange={(v) => setSettings({ allowClear: v })} disabled={!tribe.canClearForest} />
              <Toggle label="burn forest" checked={s.allowBurn} onChange={(v) => setSettings({ allowBurn: v })} disabled={!tribe.canBurnForest} />
              <Toggle label="grow forest" checked={s.allowGrow} onChange={(v) => setSettings({ allowGrow: v })} />
              <Toggle label="destroy buildings" checked={s.allowDestroy} onChange={(v) => setSettings({ allowDestroy: v })} />
            </fieldset>
            <button type="button" className="primary" onClick={solve} disabled={busy || unsupported || state.cities.length === 0}>
              {busy ? 'Working…' : opt ? 'Solve again' : 'Find the best layout'}
            </button>
            {state.cities.length === 0 && <p className="small muted">Add at least one city to the map first.</p>}
            {stale && <p className="small warn">You changed something since the last solve. Solve again to update.</p>}
          </section>

          {shown && opt && (
            <section className="panel open">
              <h2>Plan</h2>
              <ResultsPanel
                state={state}
                goal={goal}
                result={shown}
                frontier={opt.frontier.plans}
                currentIncome={curIncome}
                selected={selectedIndex}
                onSelect={pickPlan}
                onHoverTile={setStepHover}
                ms={opt.ms}
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
  const parts = [where(state, i), t.terrain === 'unknown' ? 'unexplored' : t.terrain];
  if (t.resource !== 'none') parts.push(t.resource);
  if (t.improvement !== 'none') parts.push(t.improvement === 'other' ? 'other building' : t.improvement);
  if (t.city === null && t.terrain !== 'unknown') parts.push('not your territory');
  return parts.join(' · ');
}

function ToolBtn({ active, onClick, children, swatch }: { active: boolean; onClick: () => void; children: React.ReactNode; swatch?: string }) {
  return (
    <button type="button" className={`tool${active ? ' on' : ''}`} aria-pressed={active} onClick={onClick}>
      {swatch && <span className={`sw ${swatch}`} />}
      {children}
    </button>
  );
}

function GoalOpt({ checked, onSelect, title, desc, children }: { checked: boolean; onSelect: () => void; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className={`goal${checked ? ' on' : ''}`}>
      <label>
        <input type="radio" checked={checked} onChange={onSelect} />
        <span>
          <strong>{title}</strong>
          <small>{desc}</small>
        </span>
      </label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function NewMap({ onCreate, onExample }: { onCreate: (w: number, h: number) => void; onExample: () => void }) {
  const [size, setSize] = useState(16);
  return (
    <details className="newmap">
      <summary className="btn secondary">New map</summary>
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
        <button type="button" onClick={() => onCreate(size, size)}>
          Blank map
        </button>
        <button type="button" className="secondary" onClick={onExample}>
          Example map
        </button>
      </div>
    </details>
  );
}

const COST_LABELS: [keyof CostTable, string][] = [
  ['market', 'Market'],
  ['sawmill', 'Sawmill'],
  ['windmill', 'Windmill'],
  ['forge', 'Forge'],
  ['lumberhut', 'Lumber Hut'],
  ['farm', 'Farm'],
  ['mine', 'Mine'],
  ['clearForestRefund', 'Clear forest (stars back)'],
  ['burnForest', 'Burn forest'],
  ['growForest', 'Grow forest'],
  ['destroy', 'Destroy'],
  ['techBase', 'Tech cost: tier × cities +'],
];

function RulesEditor({ costs, onChange }: { costs: CostTable; onChange: (c: CostTable) => void }) {
  return (
    <div>
      <p className="muted small">
        Defaults come from the game's own data. A market earns 1★ per level of each adjacent sawmill, windmill or forge, up to 8. Each city can have one market, sawmill, windmill and forge.
        With Philosophy, techs cost about a third less. Change these if the game gets patched.
      </p>
      <div className="grid2">
        {COST_LABELS.map(([k, label]) => (
          <label key={k}>
            {label}
            <input type="number" value={costs[k]} step={1} onChange={(e) => onChange({ ...costs, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <button type="button" className="link" onClick={() => onChange({ ...DEFAULT_COSTS })}>
        Reset to defaults
      </button>
    </div>
  );
}
