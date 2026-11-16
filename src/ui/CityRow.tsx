import { MIN_POPULATION } from '../data/rules';
import type { City } from '../model/types';
import { cityColor } from './MapView';
import { NumberField } from './NumberField';

/** One city under "Cities": its name, level and population. `onChange` edits a copy of the city. */
export function CityRow({ city: c, index: i, onChange }: { city: City; index: number; onChange: (edit: (city: City) => void) => void }) {
  const label = c.name || `city ${i + 1}`;
  return (
    <div className="city-row">
      <label>
        <span className="dot" style={{ background: cityColor(i) }} />
        <input value={c.name} aria-label={`Name of city ${i + 1}`} onChange={(e) => onChange((city) => (city.name = e.target.value))} />
      </label>
      <span className="city-growth">
        <select
          aria-label={`Level of ${label}`}
          value={c.level ?? ''}
          onChange={(e) =>
            onChange((city) => {
              if (e.target.value === '') {
                delete city.level;
                delete city.population;
              } else {
                city.level = Number(e.target.value);
                city.population = Math.min(city.level, city.population ?? 0);
              }
            })
          }
        >
          <option value="">Level ?</option>
          {Array.from({ length: Math.max(12, c.level ?? 0) }, (_, k) => k + 1).map((l) => (
            <option key={l} value={l}>
              Level {l}
            </option>
          ))}
        </select>
        {c.level !== undefined && (
          <label className="pop" title="Below zero after destroying buildings (red pips in the game)">
            <NumberField aria-label={`Population of ${label}`} min={MIN_POPULATION} max={c.level} value={c.population ?? 0} onChange={(v) => onChange((city) => (city.population = v))} />/{c.level + 1}
          </label>
        )}
      </span>
    </div>
  );
}
