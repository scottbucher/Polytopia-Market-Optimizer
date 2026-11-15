import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILDING_KINDS, BUILDING_NAMES, type BuildingKind, type CostTable, DEFAULT_COSTS, TRIBE_BY_KEY, TRIBES, type Terrain, type TribeKey } from './data/rules';
import { blankState, exampleState } from './model/defaults';
import { download, loadLocal, mapJson, parseJson, saveLocal } from './model/io';
import { applyTool, type Tool } from './model/paint';
import type { GameState, Goal } from './model/types';
import { parseStateFile, type RawSave } from './parse/stateFile';
import { humanPlayers, toGameState } from './parse/toGameState';
import { currentLayout } from './solver/exact';
import type { GoalResult } from './solver/goals';
import { income } from './solver/income';
import { techPrice } from './solver/options';
import { layoutAfter } from './solver/schedule';
import { plural, where } from './ui/describe';
import { type Backdrop, cityColor, MapView, type Overlay, type View } from './ui/MapView';
import { NumberField } from './ui/NumberField';
import { ResultsPanel } from './ui/ResultsPanel';
import { ScreenshotPanel } from './ui/ScreenshotPanel';
import { TechPicker } from './ui/TechPicker';
import { useOptimizer } from './ui/useOptimizer';

const TERRAINS: [Terrain, string][] = [
  ['field', 'Field'],
  ['forest', 'Forest'],
  ['mountain', 'Mountain'],
  ['water', 'Water'],
  ['ocean', 'Ocean'],
  ['unknown', 'Unexplored'],
];

const BUILD_TOOLS: (BuildingKind | 'none' | 'other')[] = [...BUILDING_KINDS, 'other', 'none'];

export default function App() {
  const [state, setState] = useState<GameState>(() => loadLocal() ?? exampleState());
  const [tool, setTool] = useState<Tool>({ kind: 'look' });
  const [view, setView] = useState<View>({ rot: 0, flip: false });
  const [goal, setGoal] = useState<Goal>({ kind: 'max' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [stepHover, setStepHover] = useState<number | null>(null);
  const [pendingSave, setPendingSave] = useState<{ save: RawSave; name: string } | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [tileOpacity, setTileOpacity] = useState(1);
  const [showPlan, setShowPlan] = useState(true);
  const saveInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const onError = useCallback((m: string) => setError(m), []);
  const opt = useOptimizer(onError);

  useEffect(() => saveLocal(state), [state]);

  // What a solve depends on: the map, settings and the goal.
  const stateKey = useMemo(() => JSON.stringify([state, goal]), [state, goal]);
  const stale = opt.solved !== null && opt.solved.stateKey !== stateKey;
  const s = state.settings;
  const tribe = TRIBE_BY_KEY[s.tribe];
  const curIncome = useMemo(() => income(currentLayout(state), state.width, state.height).total, [state]);

  const update = (fn: (s: GameState) => GameState) => setState((prev) => fn(structuredClone(prev)));
  const setSettings = (patch: Partial<GameState['settings']>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }));

  /** Replace the whole map (new, example, loaded): clears results, banners and the screenshot. */
  const replaceState = (next: GameState, message: string | null) => {
    setState(next);
    opt.reset();
    setPendingSave(null);
    setError(null);
    setNotice(message);
    setHover(null);
    setStepHover(null);
    if (backdrop) URL.revokeObjectURL(backdrop.href);
    setBackdrop(null);
    setTileOpacity(1);
  };

  const paint = (i: number) => {
    if (tool.kind === 'look') return;
    update((st) => applyTool(st, tool, i));
  };

  // ---------- loading ----------
  const loadSaveFile = async (f: File) => {
    setError(null);
    setNotice(null);
    setPendingSave(null);
    try {
      const save = parseStateFile(new Uint8Array(await f.arrayBuffer()));
      const humans = humanPlayers(save);
      if (!humans.length) throw new Error('No human player found in this save.');
      if (humans.length === 1) applySave(save, humans[0].id, f.name);
      else setPendingSave({ save, name: f.name });
    } catch (e) {
      setError(`Couldn't read that save file. ${e instanceof Error ? e.message : String(e)} Make sure it is a .state file from the game's save folder.`);
    }
  };

  const applySave = (save: RawSave, playerId: number, name: string) => {
    try {
      const r = toGameState(save, playerId, name);
      const cur = income(currentLayout(r.state), r.state.width, r.state.height).total;
      replaceState(
        r.state,
        [
          `Loaded turn ${save.header.currentTurn}: ${plural(r.state.cities.length, 'city', 'cities')}.`,
          r.hiddenTiles ? `${plural(r.hiddenTiles, 'tile')} you haven't explored ${r.hiddenTiles === 1 ? 'is' : 'are'} hidden.` : '',
          `Your markets make ${cur}★ now.`,
          `"Income per turn" is an estimate: check it against the +★ number in the game.`,
          ...save.warnings,
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (e) {
      setPendingSave(null);
      setError(`Couldn't use that save. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const loadJson = async (f: File) => {
    try {
      replaceState(parseJson(await f.text()), `Opened ${f.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- results ----------
  const shown: GoalResult | null = opt.picked?.result ?? opt.solved?.result ?? null;
  const selectedIndex = opt.picked?.index ?? (opt.solved && shown ? opt.solved.frontier.plans.indexOf(shown.plan) : -1);

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

  const hoverTile = stepHover ?? hover;
  const hoverInfo = hover !== null ? describeTile(state, hover) : null;
  const unsupported = !tribe.hasMarket;
  const busy = opt.busy === 'solve';

  return (
    <div className="app">
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
              if (f) loadSaveFile(f);
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
          <button type="button" onClick={() => saveInput.current?.click()}>
            Open save file
          </button>
          <button type="button" className="secondary" onClick={() => jsonInput.current?.click()}>
            Open map
          </button>
          <button type="button" className="secondary" onClick={() => download('polytopia-map.json', mapJson(state))}>
            Save map
          </button>
          <NewMap
            onCreate={(w, h) => {
              replaceState(blankState(w, h), null);
              setTool({ kind: 'terrain', v: 'field' });
            }}
            onExample={() => replaceState(exampleState(), null)}
          />
        </div>
      </header>

      {pendingSave && (
        <div className="banner" role="status">
          This save has more than one human player. Who are you?
          {humanPlayers(pendingSave.save).map((p) => (
            <button key={p.id} type="button" onClick={() => applySave(pendingSave.save, p.id, pendingSave.name)}>
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
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
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
            {tribe.hasAquafarm && (
              <ToolBtn active={tool.kind === 'resource' && tool.v === 'aquacrop'} onClick={() => setTool({ kind: 'resource', v: 'aquacrop' })}>
                Water crop
              </ToolBtn>
            )}
            <span className="sep" />
            <select
              aria-label="Building"
              value={tool.kind === 'building' ? tool.v : ''}
              onChange={(e) => setTool({ kind: 'building', v: e.target.value as BuildingKind | 'none' | 'other' })}
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
                  Belongs to {c.name.trim() || `City ${i + 1}`}
                </option>
              ))}
              <option value="null">Not yours</option>
            </select>
            <span className="grow" />
            <button type="button" className="icon" title="Rotate map" aria-label="Rotate map" onClick={() => setView({ ...view, rot: ((view.rot + 1) % 4) as View['rot'] })}>
              ⟳
            </button>
            <button type="button" className="icon" title="Mirror map" aria-label="Mirror map" onClick={() => setView({ ...view, flip: !view.flip })}>
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
              editing={tool.kind !== 'look'}
            />
          </div>
          <div className="mapfoot">
            <span className="muted small">
              {hoverInfo ?? `${state.source ?? ''} · ${state.width}×${state.height}`}
            </span>
            {shown && !stale && (
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
                      aria-label={`Name of city ${i + 1}`}
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
                <NumberField min={1} value={s.cityCount} onChange={(v) => setSettings({ cityCount: v })} />
              </label>
              <label>
                Stars now
                <NumberField min={0} value={s.stars} onChange={(v) => setSettings({ stars: v })} />
              </label>
              <label title="The +★ per turn number shown in the game. The markets you already have are part of it.">
                Income per turn
                <NumberField min={curIncome} value={s.baseIncome + curIncome} onChange={(v) => setSettings({ baseIncome: Math.max(0, v - curIncome) })} />
                <small className="muted">{curIncome > 0 ? `incl. ${curIncome}★ from markets` : 'from everything you have'}</small>
              </label>
            </div>
            {tribe.note && <p className="small warn">{tribe.note}</p>}
            <p className="muted small">Tech costs use {plural(s.cityCount, 'city', 'cities')}. Tap a tech to mark it owned.</p>
            <TechPicker owned={s.owned} tribe={s.tribe} prices={(t) => techPrice(state, t)} onChange={(owned) => setSettings({ owned })} />
          </section>

          <section className="panel open">
            <h2 id="goal-label">What do you want?</h2>
            <div className="goals" role="radiogroup" aria-labelledby="goal-label">
              <GoalOpt checked={goal.kind === 'max'} onSelect={() => setGoal({ kind: 'max' })} title="Most market income" desc="Highest stars per turn, at the lowest cost for that income." />
              <GoalOpt
                checked={goal.kind === 'income'}
                onSelect={() => setGoal({ kind: 'income', income: Math.max(1, curIncome + 4), turns: 10 })}
                title="Reach an income"
                desc="Get to a market income as soon as possible."
              >
                {goal.kind === 'income' && (
                  <span className="inline">
                    <NumberField aria-label="Market income to reach" min={1} max={999} value={goal.income} onChange={(v) => setGoal({ ...goal, income: v })} />★ per turn from markets within
                    <NumberField aria-label="Within how many turns" min={0} max={200} value={goal.turns} onChange={(v) => setGoal({ ...goal, turns: v })} /> turns
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
                    <NumberField aria-label="Stars to have" min={0} max={9999} value={goal.stars} onChange={(v) => setGoal({ ...goal, stars: v })} />★ by turn +
                    <NumberField aria-label="Turns from now" min={0} max={200} value={goal.turns} onChange={(v) => setGoal({ ...goal, turns: v })} />
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
                    by turn +<NumberField aria-label="Turns from now" min={0} max={200} value={goal.turns} onChange={(v) => setGoal({ ...goal, turns: v })} />
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
            <button type="button" className="primary" onClick={() => opt.solve(state, goal, stateKey)} disabled={busy || unsupported || state.cities.length === 0}>
              {busy ? 'Working…' : opt.solved ? 'Solve again' : 'Find the best layout'}
            </button>
            {state.cities.length === 0 && <p className="small muted">Add at least one city to the map first.</p>}
            {stale && <p className="small warn">You changed the map, settings or goal since the last solve. Solve again to update.</p>}
          </section>

          {shown && opt.solved && (
            <section className="panel open">
              <h2>Plan</h2>
              <ResultsPanel
                key={opt.solved.runId}
                state={state}
                result={shown}
                frontier={opt.solved.frontier.plans}
                currentIncome={curIncome}
                selected={selectedIndex}
                onSelect={(i) => opt.pick(state, i, opt.solved!.frontier.plans[i])}
                onHoverTile={setStepHover}
                ms={opt.solved.ms}
                stale={stale}
                loading={opt.busy === 'plan'}
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
        <input type="radio" name="goal" checked={checked} onChange={onSelect} />
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
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  // Close on Escape or a click outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
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
        <button
          type="button"
          onClick={() => {
            onCreate(size, size);
            close();
          }}
        >
          Blank map
        </button>
        <button
          type="button"
          className="secondary"
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
            <NumberField min={0} max={k === 'literacyFactor' ? 1 : 999} step={o?.integer === false ? 0.01 : 1} integer={o?.integer !== false} value={costs[k]} onChange={(v) => onChange({ ...costs, [k]: v })} />
          </label>
        ))}
      </div>
      <button type="button" className="link" onClick={() => onChange({ ...DEFAULT_COSTS })}>
        Reset to defaults
      </button>
    </div>
  );
}
