import { useId, useMemo, useState } from 'react';
import type { Kind } from '../api/types';
import { categoryColor, slotColor } from '../analytics/colors';
import { groupByCategory } from '../analytics/derive';
import { MAX_COMPARE } from './state';

// Selected trackers show as removable chips in their series color; the search list adds more, grouped by category.
export function KindPicker({ kinds, selected, onChange }: { kinds: Kind[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(selected.length < 2);
  const [query, setQuery] = useState('');
  const listId = useId();
  const byKey = useMemo(() => new Map(kinds.map((k) => [k.key, k])), [kinds]);
  const groups = useMemo(() => groupByCategory(kinds.map((k) => ({ ...k, category: k.category ?? null }))), [kinds]);
  const full = selected.length >= MAX_COMPARE;
  const q = query.trim().toLowerCase();

  return (
    <div className="picker">
      <div className="picker-row">
        <ul className="chips" aria-label="Selected trackers">
          {selected.map((key, i) => (
            <li key={key}>
              <span className="chip chip-on">
                <span className="viz-key viz-key-line" style={{ background: slotColor(i) }} aria-hidden="true" />
                {byKey.get(key)?.displayName ?? key}
                <button type="button" className="chip-x" aria-label={`Remove ${byKey.get(key)?.displayName ?? key}`} onClick={() => onChange(selected.filter((k) => k !== key))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="chip chip-ghost" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close tracker list' : 'Add trackers'}
        </button>
      </div>
      <p className="help">
        {selected.length < 2 ? 'Pick at least two trackers.' : full ? `That is the maximum of ${MAX_COMPARE}. Remove one to add another.` : `${selected.length} of ${MAX_COMPARE} picked.`}
      </p>
      {open && (
        <div className="kind-picker" id={listId}>
          <label className="kind-search">
            <span className="visually-hidden">Search trackers</span>
            <input type="search" className="field" placeholder="Search trackers" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="kind-groups">
            {groups.map(({ category, items }) => {
              const matches = items.filter((k) => !q || k.displayName.toLowerCase().includes(q) || k.key.includes(q));
              if (!matches.length) return null;
              return (
                <fieldset key={category} className="kind-group">
                  <legend>
                    <span className="viz-key" style={{ background: categoryColor(category) }} aria-hidden="true" />
                    {category}
                  </legend>
                  {matches.map((k) => {
                    const on = selected.includes(k.key);
                    return (
                      <label key={k.key} className="kind-check">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && full}
                          onChange={() => onChange(on ? selected.filter((s) => s !== k.key) : [...selected, k.key])}
                        />
                        {k.displayName}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
