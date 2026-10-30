import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ApiError, type Kind } from '../api/types';
import { colorForKind } from '../theme/palette';
import { KindForm } from './KindForm';
import './picker.css';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; kinds: Kind[] };

// With this many trackers or fewer the picker stays a plain row of pills; above it, search, groups and a compact header appear.
const COMPACT_ABOVE = 8;
const CATEGORY_ORDER = ['Health', 'Fitness', 'Code', 'Hobbies', 'Reading and media', 'Money', 'Life'];
const OTHER = 'Other';

export type KindGroup = { name: string; kinds: Kind[] };

export function groupKinds(kinds: Kind[], query: string): KindGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (k: Kind) =>
    q === '' || k.displayName.toLowerCase().includes(q) || k.key.toLowerCase().includes(q) || (k.category ?? '').toLowerCase().includes(q);
  const shown = kinds.filter(matches);
  // Without any categories the server's order is kept in a single group.
  if (!kinds.some((k) => k.category?.trim()))
    return shown.length === 0 ? [] : [{ name: OTHER, kinds: shown }];
  const groups = new Map<string, Kind[]>();
  for (const k of shown) {
    const name = k.category?.trim() ? k.category.trim() : OTHER;
    groups.set(name, [...(groups.get(name) ?? []), k]);
  }
  const rank = (name: string) => {
    if (name === OTHER) return CATEGORY_ORDER.length + 1;
    const i = CATEGORY_ORDER.indexOf(name);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, list]) => ({ name, kinds: [...list].sort((a, b) => a.displayName.localeCompare(b.displayName)) }));
}

export function EntryPage() {
  const { api } = useApi();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<boolean | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: 'search' | 'trigger' } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState({ status: 'loading' });
    api.kinds({ signal }).then(
      (kinds) => {
        if (signal.aborted) return;
        setState({ status: 'ready', kinds });
      },
      (e: unknown) => {
        if (signal.aborted) return;
        setState({ status: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong loading your trackers. Try again.' });
      },
    );
    return () => controller.abort();
  }, [api, attempt]);

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.target === 'search' ? searchRef.current : triggerRef.current)?.focus();
  }, [focusRequest]);

  const kinds = state.status === 'ready' ? state.kinds : [];
  const groups = useMemo(() => groupKinds(kinds, query), [kinds, query]);

  let body;
  if (state.status === 'loading') {
    body = (
      <p role="status" aria-label="Loading trackers" className="help">
        Loading…
      </p>
    );
  } else if (state.status === 'error') {
    body = (
      <div className="stack">
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  } else if (state.kinds.length === 0) {
    body = <p className="help">No trackers to log yet.</p>;
  } else {
    const wanted = selected ?? params.get('kind');
    const compact = state.kinds.length > COMPACT_ABOVE;
    // The long picker preselects nothing; the short one starts on the first tracker.
    const current = state.kinds.find((k) => k.key === wanted) ?? (compact ? null : state.kinds[0]!);
    const expanded = !compact || (open ?? current === null);
    const showHeadings = state.kinds.some((k) => k.category?.trim());
    const matchCount = groups.reduce((n, g) => n + g.kinds.length, 0);

    const pill = (k: Kind) => {
      const isSel = k.key === current?.key;
      const c = colorForKind(k.key);
      return (
        <label key={k.key} className="pill" style={isSel ? { backgroundColor: c.bg, color: c.fg } : undefined}>
          <input
            className="visually-hidden"
            type="radio"
            name="kind"
            value={k.key}
            checked={isSel}
            disabled={busy}
            onChange={() => {
              setSelected(k.key);
              if (compact) {
                setOpen(false);
                setQuery('');
                setFocusRequest({ target: 'trigger' });
              }
            }}
          />
          <span>{k.displayName}</span>
        </label>
      );
    };

    body = (
      <>
        {compact && current && (
          <div className="picker-bar">
            <p className="picker-current">
              <span className="help">Logging</span> <strong>{current.displayName}</strong>
              {current.category ? <span className="help"> in {current.category}</span> : null}
            </p>
            <button
              ref={triggerRef}
              type="button"
              className="btn picker-toggle"
              aria-expanded={expanded}
              aria-controls="tracker-picker"
              disabled={busy}
              onClick={() => {
                const next = !expanded;
                setOpen(next);
                if (next) setFocusRequest({ target: 'search' });
              }}
            >
              {expanded ? 'Hide trackers' : 'Change tracker'}
            </button>
          </div>
        )}
        {expanded && (
          <div id="tracker-picker" className="picker">
            {compact && (
              <div className="picker-search">
                <label htmlFor="tracker-search">Find a tracker</label>
                <input
                  id="tracker-search"
                  ref={searchRef}
                  type="search"
                  className="field"
                  value={query}
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query !== '') {
                      e.preventDefault();
                      setQuery('');
                    }
                  }}
                />
                <p role="status" className="visually-hidden">
                  {matchCount === 1 ? '1 tracker' : `${matchCount} trackers`}
                </p>
              </div>
            )}
            {current === null && <p className="help">Pick a tracker to start logging.</p>}
            <div className="picker-groups" role="radiogroup" aria-label="What are you logging?">
              {matchCount === 0 ? (
                <p className="help">No trackers match “{query.trim()}”. Clear the search to see them all.</p>
              ) : (
                groups.map((g, i) => (
                  <div key={g.name} className="picker-group" role="group" aria-labelledby={showHeadings ? `picker-group-${i}` : undefined}>
                    {showHeadings && (
                      <h2 id={`picker-group-${i}`} className="picker-heading">
                        {g.name}
                      </h2>
                    )}
                    <div className="pills">{g.kinds.map(pill)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {current && <KindForm key={current.key} kind={current} onBusyChange={setBusy} />}
      </>
    );
  }

  return (
    <main className="screen entry-page">
      <h1 className="display entry-title">Log something</h1>
      {body}
    </main>
  );
}
