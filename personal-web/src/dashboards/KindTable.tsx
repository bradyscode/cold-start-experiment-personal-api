import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { categoryColor } from '../analytics/colors';
import { AGG_NOUN, compact, formatValue, relativeAge, unitFor } from '../analytics/format';
import { chartHref } from '../analytics/insights';
import type { KindOverview } from '../analytics/types';
import { formatBucketDate } from '../charts/dates';
import { Sparkline } from '../charts/Sparkline';

type Col = 'name' | 'value' | 'perDay' | 'best' | 'latest' | 'last';
const COLS: { key: Col; label: string }[] = [
  { key: 'name', label: 'Tracker' },
  { key: 'value', label: 'Total' },
  { key: 'perDay', label: 'Per day' },
  { key: 'best', label: 'Best day' },
  { key: 'latest', label: 'Latest' },
  { key: 'last', label: 'Last entry' },
];

const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
const n = (v: number | null | undefined) => (v === null || v === undefined ? Number.NEGATIVE_INFINITY : v);

function sortValue(k: KindOverview, col: Col): number | string {
  switch (col) {
    case 'name':
      return k.displayName.toLowerCase();
    case 'value':
      return n(k.value);
    case 'perDay':
      return n(k.avgPerDay);
    case 'best':
      return n(k.best?.value);
    case 'latest':
      return n(k.latest?.value);
    case 'last':
      return time(k.lastEntryAt);
  }
}

export function sortKinds(kinds: KindOverview[], col: Col, dir: 'ascending' | 'descending'): KindOverview[] {
  const sign = dir === 'ascending' ? 1 : -1;
  return [...kinds].sort((a, b) => {
    const [x, y] = [sortValue(a, col), sortValue(b, col)];
    if (x === y) return a.displayName.localeCompare(b.displayName);
    return (x < y ? -1 : 1) * sign;
  });
}

const withUnit = (v: number | null | undefined, k: KindOverview) => {
  if (v === null || v === undefined) return '–';
  const u = unitFor(k.agg, k.unit, v);
  return `${compact(v)}${u ? ` ${u}` : ''}`;
};

export function KindTable({ kinds, days, now }: { kinds: KindOverview[]; days: number; now: number }) {
  const [sort, setSort] = useState<{ col: Col; dir: 'ascending' | 'descending' }>({ col: 'last', dir: 'descending' });
  const rows = useMemo(() => sortKinds(kinds, sort.col, sort.dir), [kinds, sort]);
  const click = (col: Col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'ascending' ? 'descending' : 'ascending' } : { col, dir: col === 'name' ? 'ascending' : 'descending' }));

  return (
    <div className="table-wrap">
      <table className="dense-table kind-table">
        <caption className="visually-hidden">Every tracker in the selected range. Column headers sort the table.</caption>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort.col === c.key ? sort.dir : undefined}>
                <button type="button" className="sort-btn" onClick={() => click(c.key)}>
                  {c.label}
                  <span className="sort-mark" aria-hidden="true">
                    {sort.col === c.key ? (sort.dir === 'ascending' ? '↑' : '↓') : ''}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => {
            const lower = k.better === 'lower';
            if (k.error) {
              return (
                <tr key={k.kind} className="row-failed">
                  <th scope="row" data-label="Tracker">
                    <Link to={chartHref(k, days)} className="table-link">
                      <span className="viz-key" style={{ background: categoryColor(k.category) }} aria-hidden="true" />
                      {k.displayName}
                    </Link>
                  </th>
                  <td colSpan={6} data-label="Status">
                    {k.error}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={k.kind}>
                <th scope="row" data-label="Tracker">
                  <Link to={chartHref(k, days)} className="table-link">
                    <span className="viz-key" style={{ background: categoryColor(k.category) }} aria-hidden="true" />
                    {k.displayName}
                  </Link>
                </th>
                <td data-label={k.agg === 'avg' || k.agg === 'max' ? AGG_NOUN[k.agg] : 'Total'} title={formatValue(k.value)}>
                  {withUnit(k.value, k)}
                  {(k.agg === 'avg' || k.agg === 'max') && <small> {AGG_NOUN[k.agg]}</small>}
                </td>
                <td data-label="Per day">{k.avgPerDay === null ? '–' : withUnit(k.avgPerDay, k)}</td>
                <td data-label={lower ? 'Lowest day' : k.better === 'none' ? 'Highest day' : 'Best day'}>
                  {k.best ? (
                    <>
                      {withUnit(k.best.value, k)} <small>{formatBucketDate(k.best.date)}</small>
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td data-label="Latest">
                  {k.latest ? (
                    <>
                      {withUnit(k.latest.value, k)} <small>{formatBucketDate(k.latest.date)}</small>
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td data-label="Last entry">{relativeAge(k.lastEntryAt, now)}</td>
                <td data-label="Trend" className="table-spark">
                  <Sparkline values={k.agg === 'count' ? k.counts : k.values} color={categoryColor(k.category)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
