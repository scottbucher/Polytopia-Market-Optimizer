import { TECH_BY_KEY, TECH_ROOTS, TECHS, type TechKey, type TribeKey, techName } from '../data/rules';

function children(t: TechKey) {
  return TECHS.filter((x) => x.parent === t).map((x) => x.key);
}

function descendants(t: TechKey): TechKey[] {
  return children(t).flatMap((c) => [c, ...descendants(c)]);
}

function ancestors(t: TechKey): TechKey[] {
  const out: TechKey[] = [];
  let p = TECH_BY_KEY[t].parent;
  while (p) {
    out.push(p);
    p = TECH_BY_KEY[p].parent;
  }
  return out;
}

export function TechPicker({ owned, tribe, prices, onChange }: { owned: TechKey[]; tribe: TribeKey; prices: (t: TechKey) => number; onChange: (o: TechKey[]) => void }) {
  const has = new Set(owned);
  const toggle = (t: TechKey) => {
    const next = new Set(has);
    if (has.has(t)) for (const d of [t, ...descendants(t)]) next.delete(d);
    else for (const a of [t, ...ancestors(t)]) next.add(a);
    onChange([...next]);
  };
  const Btn = ({ t }: { t: TechKey }) => (
    <button type="button" className={`tech${has.has(t) ? ' on' : ''}`} onClick={() => toggle(t)} aria-pressed={has.has(t)} title={has.has(t) ? 'Owned' : `Costs ${prices(t)}★ now`}>
      <span>{techName(t, tribe)}</span>
      {!has.has(t) && <small>{prices(t)}★</small>}
    </button>
  );
  return (
    <div className="techtree">
      {TECH_ROOTS.map((r) => (
        <div className="branch" key={r}>
          <Btn t={r} />
          <div className="kids">
            {children(r).map((c) => (
              <div className="pair" key={c}>
                <Btn t={c} />
                {children(c).map((g) => (
                  <Btn t={g} key={g} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="techtree-actions">
        <button type="button" className="link" onClick={() => onChange(TECHS.map((t) => t.key))}>
          All
        </button>
        <button type="button" className="link" onClick={() => onChange([])}>
          None
        </button>
      </div>
    </div>
  );
}
