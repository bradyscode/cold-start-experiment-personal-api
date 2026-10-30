import { useId, useMemo, useState } from 'react';
import { categoryColor } from '../analytics/colors';
import { groupByCategory } from '../analytics/derive';

type Item = { kind: string; displayName: string; category: string | null };

// Category chips toggle whole groups; the tracker list below allows picking single trackers with search.
export function KindFilter({ items, excluded, onChange }: { items: Item[]; excluded: ReadonlySet<string>; onChange: (next: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const groups = useMemo(() => groupByCategory(items), [items]);
  const shown = items.length - items.filter((i) => excluded.has(i.kind)).length;

  // From the full set a chip solos its category; within a subset it toggles; clicking the only category shown restores all.
  const toggleGroup = (keys: string[]) => {
    const group = new Set(keys);
    const others = items.filter((i) => !group.has(i.kind));
    if (excluded.size === 0 && others.length > 0) {
      onChange(new Set(others.map((i) => i.kind)));
      return;
    }
    const groupOn = keys.every((k) => !excluded.has(k));
    const onlyThisShown = groupOn && others.every((i) => excluded.has(i.kind));
    if (onlyThisShown) {
      onChange(new Set());
      return;
    }
    const next = new Set(excluded);
    for (const k of keys) {
      if (groupOn) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  };
  const toggleOne = (k: string) => {
    const next = new Set(excluded);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(next);
  };
  const q = query.trim().toLowerCase();

  return (
    <div className="kind-filter">
      <div className="chips" role="group" aria-label="Filter by category">
        <button type="button" className="chip" aria-pressed={excluded.size === 0} onClick={() => onChange(new Set())}>
          All trackers <span className="chip-count">{items.length}</span>
        </button>
        {groups.map(({ category, items: list }) => {
          const on = list.filter((i) => !excluded.has(i.kind)).length;
          const pressed = on === list.length ? true : on === 0 ? false : 'mixed';
          return (
            <button
              type="button"
              key={category}
              className="chip"
              aria-pressed={pressed}
              aria-label={`${category}, ${on} of ${list.length} shown`}
              onClick={() => toggleGroup(list.map((i) => i.kind))}
            >
              <span className="viz-key" style={{ background: categoryColor(category) }} aria-hidden="true" />
              {category}
              <span className="chip-count" aria-hidden="true">
                {on === list.length ? list.length : `${on}/${list.length}`}
              </span>
            </button>
          );
        })}
        <button type="button" className="chip chip-ghost" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide tracker list' : `Choose trackers (${shown} shown)`}
        </button>
      </div>
      {open && (
        <div className="kind-picker" id={listId}>
          <label className="kind-search">
            <span className="visually-hidden">Search trackers</span>
            <input type="search" className="field" placeholder="Search trackers" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="kind-groups">
            {groups.map(({ category, items: list }) => {
              const matches = list.filter((i) => !q || i.displayName.toLowerCase().includes(q) || i.kind.includes(q));
              if (!matches.length) return null;
              return (
                <fieldset key={category} className="kind-group">
                  <legend>
                    <span className="viz-key" style={{ background: categoryColor(category) }} aria-hidden="true" />
                    {category}
                  </legend>
                  {matches.map((i) => (
                    <label key={i.kind} className="kind-check">
                      <input type="checkbox" checked={!excluded.has(i.kind)} onChange={() => toggleOne(i.kind)} />
                      {i.displayName}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
