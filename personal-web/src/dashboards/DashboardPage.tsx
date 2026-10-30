import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { categoryColor } from '../analytics/colors';
import { activityStack, byRecentActivity, categoryShares, heatmapDays } from '../analytics/derive';
import { deltaOf, formatValue, rangeLabel, unitFor } from '../analytics/format';
import { buildInsights, chartHref, compareHref } from '../analytics/insights';
import type { Compare, Overview } from '../analytics/types';
import { useResource } from '../analytics/useResource';
import { Legend } from '../charts/chartKit';
import { Donut } from '../charts/Donut';
import { Heatmap } from '../charts/Heatmap';
import { PeriodBars, type PeriodRow } from '../charts/PeriodBars';
import { TimeChart } from '../charts/TimeChart';
import { KindFilter } from './KindFilter';
import { KindTable } from './KindTable';
import { KpiStrip } from './KpiStrip';
import { Records } from './Records';
import { Panel, Segmented, readStored, writeStored, type Option } from './ui';

export const RANGE_KEY = 'pa.dashboards.range';
const RANGES = ['7', '30', '90', '365'] as const;
type Range = (typeof RANGES)[number];
const RANGE_OPTIONS: Option<Range>[] = [
  { value: '7', label: '7D', title: 'Last 7 days' },
  { value: '30', label: '30D', title: 'Last 30 days' },
  { value: '90', label: '90D', title: 'Last 90 days' },
  { value: '365', label: '1Y', title: 'Last year' },
];
const CORRELATE_TOP = 12;
const PERIOD_ROWS = 10;
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const ARROWS = { up: '▲', down: '▼', flat: '■', new: '▲', none: '' } as const;

export function DashboardPage() {
  const { api } = useApi();
  const [range, setRange] = useState<Range>(() => readStored(RANGE_KEY, RANGES, '30'));
  const days = Number(range);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(() => new Set());
  const [heatKind, setHeatKind] = useState<string>('');

  const overview = useResource<Overview>((signal) => api.overview({ days }, { signal }), [api, days], 'Something went wrong loading your dashboards. Try again.');
  const data = overview.data;
  const now = overview.loadedAt ?? Date.now();

  const kinds = useMemo(() => byRecentActivity((data?.kinds ?? []).filter((k) => !excluded.has(k.kind))), [data, excluded]);
  // Trackers the API could not compute stay in the KPI strip and table with their message, but never in combined charts.
  const okKinds = useMemo(() => kinds.filter((k) => !k.error), [kinds]);
  const skipped = kinds.length - okKinds.length;
  const skippedNote = skipped > 0 && (
    <p className="panel-note" role="note">
      {skipped} {skipped === 1 ? 'tracker' : 'trackers'} skipped: too much data
    </p>
  );
  const anyData = okKinds.some((k) => k.activity.some((c) => c > 0));
  // The 12 most active trackers in range feed the correlation insight in one request.
  const corrKinds = useMemo(
    () => okKinds.filter((k) => k.entries > 0).sort((a, b) => b.entries - a.entries).slice(0, CORRELATE_TOP).map((k) => k.kind),
    [okKinds],
  );
  const corrKey = corrKinds.join(',');
  const correlation = useResource<Compare | null>(
    (signal) => (corrKinds.length >= 2 ? api.compare({ kinds: corrKinds, days, bucket: 'day' }, { signal }) : Promise.resolve(null)),
    [api, corrKey, days],
    'Could not compute correlations.',
  );

  const changeRange = (r: Range) => {
    setRange(r);
    writeStored(RANGE_KEY, r);
  };

  const stack = useMemo(() => (data ? activityStack(okKinds, data.dates, days) : null), [data, okKinds, days]);
  const layers = useMemo(() => stack?.layers.filter((l) => !hiddenLayers.has(l.key)) ?? [], [stack, hiddenLayers]);
  const heat = useMemo(
    () => (data ? heatmapDays(data.activityDates, okKinds, heatKind && okKinds.some((k) => k.kind === heatKind) ? heatKind : null) : null),
    [data, okKinds, heatKind],
  );
  const shares = useMemo(() => categoryShares(okKinds), [okKinds]);
  const totalEntries = shares.reduce((s, x) => s + x.value, 0);
  const periodRows = useMemo<PeriodRow[]>(
    () =>
      [...okKinds]
        .filter((k) => k.entries + k.previousEntries > 0)
        .sort((a, b) => b.entries + b.previousEntries - (a.entries + a.previousEntries))
        .slice(0, PERIOD_ROWS)
        .map((k) => {
          const d = deltaOf(k, days);
          return {
            key: k.kind,
            label: k.displayName,
            color: categoryColor(k.category),
            current: k.value,
            previous: k.previousValue,
            unit: unitFor(k.agg, k.unit, k.value),
            deltaText: d.sentence,
            deltaShort: d.short,
            tone: d.tone,
            arrow: ARROWS[d.direction],
            href: chartHref(k, days),
          };
        }),
    [okKinds, days],
  );
  const insights = useMemo(
    () => (data ? buildInsights(okKinds, correlation.data?.pairs ?? null, days, now) : []),
    [data, okKinds, correlation.data, days, now],
  );

  const formatEntries = useCallback((_k: string, v: number | null) => (v === null ? '–' : `${formatValue(v)} ${v === 1 ? 'entry' : 'entries'}`), []);

  const base = overview.status === 'loading' ? ({ kind: 'loading' } as const) : overview.status === 'error' && !data ? ({ kind: 'error', message: overview.error ?? '', onRetry: overview.reload } as const) : null;
  const state = (empty: boolean, message: string) => base ?? (empty ? ({ kind: 'empty', message } as const) : ({ kind: 'ready' } as const));
  const dim = overview.refreshing;
  const rangeText = rangeLabel(days);
  const allKinds = data?.kinds ?? [];

  return (
    <main className="screen dash">
      <header className="dash-head">
        <div className="dash-titles">
          <h1 className="dash-title display">Dashboards</h1>
          <p className="dash-meta" aria-live="polite">
            {overview.status === 'error' && data ? (
              <span role="alert">Refresh failed: {overview.error}</span>
            ) : overview.loadedAt ? (
              <>Updated {TIME.format(overview.loadedAt)}</>
            ) : overview.status === 'error' ? (
              'Not loaded'
            ) : (
              'Loading'
            )}
          </p>
        </div>
        <div className="dash-controls">
          <Segmented legend="Date range" options={RANGE_OPTIONS} value={range} onChange={changeRange} />
          <button type="button" className="btn btn-small btn-icon" onClick={overview.reload} aria-label="Refresh dashboards" disabled={overview.refreshing}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
            </svg>
            <span className="btn-icon-label">Refresh</span>
          </button>
          <Link to={compareHref(corrKinds.slice(0, 3), days === 7 ? 30 : days)} className="btn btn-small btn-link">
            Compare trackers
          </Link>
        </div>
      </header>

      {allKinds.length > 0 && <KindFilter items={allKinds} excluded={excluded} onChange={setExcluded} />}

      <section className="kpi-section" aria-label="Key numbers">
        {base ? (
          <Panel title="Key numbers" state={base} className="panel-flat" />
        ) : kinds.length === 0 ? (
          <Panel title="Key numbers" state={{ kind: 'empty', message: allKinds.length ? 'Every tracker is filtered out. Pick at least one above.' : 'No trackers yet.' }} />
        ) : (
          <div className={dim ? 'is-dim' : undefined}>
            <KpiStrip kinds={kinds} days={days} now={now} />
          </div>
        )}
      </section>

      <div className="dash-grid">
        <Panel
          className="span-8"
          title="Activity over time"
          subtitle={`Entries per ${stack?.bucket ?? 'day'} by category, last ${rangeText}`}
          state={state(!okKinds.some((k) => k.entries > 0), `Nothing logged in the last ${rangeText}.`)}
          dim={dim}
        >
          {skippedNote}
          {stack && data && (
            <>
              <Legend
                label="Categories"
                items={stack.layers.map((l) => ({ key: l.key, label: l.label, color: l.color }))}
                hidden={hiddenLayers}
                onToggle={(k) => setHiddenLayers((h) => toggle(h, k))}
              />
              <TimeChart
                dates={stack.dates}
                bucket={stack.bucket}
                series={layers}
                mode="stack"
                yLabel="entries"
                label={`Stacked bar chart of entries per ${stack.bucket} by category, last ${rangeText}, ${formatValue(totalEntries)} entries in total`}
                formatValue={formatEntries}
              />
            </>
          )}
        </Panel>

        <Panel className="span-4" title="Share of entries" subtitle={`By category, last ${rangeText}`} state={state(totalEntries === 0, `Nothing logged in the last ${rangeText}.`)} dim={dim}>
          {skippedNote}
          <Donut shares={shares} total={totalEntries} unitLabel="entries" />
        </Panel>

        <Panel
          className="span-8"
          title="Activity calendar"
          subtitle={heat ? `Entries per day, last ${Math.round((data?.activityDays ?? 0) / 7)} weeks` : undefined}
          state={state(!anyData, 'No entries in the last six months.')}
          dim={dim}
          actions={
            data && (
              <label className="inline-select">
                <span className="visually-hidden">Calendar tracker</span>
                <select className="field field-small" value={heatKind} onChange={(e) => setHeatKind(e.target.value)}>
                  <option value="">All trackers</option>
                  {[...okKinds].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
        >
          {skippedNote}
          {heat && (
            <Heatmap
              days={heat.days}
              max={heat.max}
              columns={heat.columns}
              label={heatSummary(heat.days, okKinds.find((k) => k.kind === heatKind)?.displayName ?? 'all trackers')}
            />
          )}
        </Panel>

        <Panel className="span-4" title="Insights" subtitle="Patterns found in this range" state={state(insights.length === 0, 'Log a few more days to see patterns here.')} dim={dim}>
          {skippedNote}
          <ul className="insights">
            {insights.map((i) => (
              <li key={i.id}>
                <p>{i.text}</p>
                <Link to={i.href} className="insight-link" aria-label={i.linkLabel}>
                  {i.id.startsWith('correlation') ? 'Compare' : 'Open chart'}
                </Link>
              </li>
            ))}
          </ul>
          {correlation.status === 'error' && (
            <p className="help">
              Correlations are unavailable right now.{' '}
              <button type="button" className="link-btn" onClick={correlation.reload}>
                Try again
              </button>
            </p>
          )}
        </Panel>

        <Panel
          className="span-6"
          title="This period vs previous"
          subtitle={`Last ${rangeText} against the ${rangeText} before, scaled per tracker`}
          state={state(periodRows.length === 0, `Nothing logged in the last ${2 * days} days.`)}
          dim={dim}
        >
          <PeriodBars rows={periodRows} currentLabel="This period" previousLabel="Previous period" />
        </Panel>

        <Panel className="span-6" title="Records and streaks" subtitle="Consecutive days with at least one entry" state={state(!anyData, 'No streaks yet.')} dim={dim}>
          {data && <Records kinds={okKinds} days={days} windowDays={Math.max(2 * days, data.activityDays)} />}
        </Panel>

        <Panel className="span-12" title="All trackers" subtitle={`${kinds.length} trackers, last ${rangeText}`} state={state(kinds.length === 0, 'No trackers to show.')} dim={dim}>
          <KindTable kinds={kinds} days={days} now={now} />
        </Panel>
      </div>
    </main>
  );
}

function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function heatSummary(days: { date: string; value: number }[], who: string): string {
  const active = days.filter((d) => d.value > 0);
  const total = active.reduce((s, d) => s + d.value, 0);
  const busiest = active.reduce<{ date: string; value: number } | null>((b, d) => (!b || d.value > b.value ? d : b), null);
  return `Calendar heatmap for ${who}: ${formatValue(total)} entries on ${active.length} of ${days.length} days${busiest ? `, busiest day ${busiest.date} with ${busiest.value}` : ''}`;
}
