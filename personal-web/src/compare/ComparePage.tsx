import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import type { Bucket, Kind } from '../api/types';
import { slotColor } from '../analytics/colors';
import { compact, formatR, formatValue, unitFor } from '../analytics/format';
import { normalize, NORMALIZATION_LABEL, type Normalization } from '../analytics/normalize';
import type { Compare, CompareSeries, PairDetail } from '../analytics/types';
import { useResource } from '../analytics/useResource';
import { Legend } from '../charts/chartKit';
import { CorrMatrix } from '../charts/CorrMatrix';
import { tooltipDate } from '../charts/dates';
import { LagBars } from '../charts/LagBars';
import { Scatter, type ScatterPoint } from '../charts/Scatter';
import { Sparkline } from '../charts/Sparkline';
import { TimeChart } from '../charts/TimeChart';
import { Panel, Segmented, type Option } from '../dashboards/ui';
import { KindPicker } from './KindPicker';
import { COMPARE_RANGES, lagSentence, MAX_LAG, parseCompare, serializeCompare, type CompareRange, type CompareState } from './state';

const RANGE_OPTIONS: Option<string>[] = COMPARE_RANGES.map((r) => ({ value: String(r), label: r === 365 ? '1Y' : `${r}D` }));
const BUCKET_OPTIONS: Option<Bucket>[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
];
const NORM_OPTIONS: Option<Normalization>[] = (['raw', 'index', 'z'] as const).map((n) => ({ value: n, label: NORMALIZATION_LABEL[n] }));
const NORM_HELP: Record<Normalization, string> = {
  raw: 'Raw values on one axis. Trackers with big numbers will flatten the rest.',
  index: 'Each line starts at 100 at its first meaningful value (at least 1% of its largest) and moves by percent of it, so trends with different units compare.',
  z: 'Each value shown as standard deviations from its own average.',
};
const Y_LABEL: Record<Normalization, string> = { raw: 'value', index: 'index', z: 'z' };

const valueText = (s: CompareSeries, v: number | null) => {
  if (v === null) return 'no data';
  const u = unitFor(s.agg, s.unit, v);
  return `${formatValue(v)}${u ? ` ${u}` : ''}`;
};

export function ComparePage() {
  const { api } = useApi();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseCompare(params), [params]);
  const update = useCallback((patch: Partial<CompareState>) => setParams(serializeCompare({ ...parseCompare(params), ...patch }), { replace: true }), [params, setParams]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const kinds = useResource<Kind[]>((signal) => api.kinds({ signal }), [api], 'Could not load your trackers.');
  // The notice belongs to the cleaned link it produced, so it disappears when the user moves on to another selection.
  const [ignored, setIgnored] = useState<{ names: string[]; forKinds: string } | null>(null);
  // Until the tracker list arrives (or fails) the analytics calls wait, so an unknown key never produces a 404 panel.
  const kindsSettled = kinds.status !== 'loading';
  const unknown = useMemo(() => (kinds.data ? state.kinds.filter((k) => !kinds.data!.some((x) => x.key === k)) : []), [kinds.data, state.kinds]);
  useEffect(() => {
    if (unknown.length === 0) return;
    const kept = state.kinds.filter((k) => !unknown.includes(k));
    setIgnored({ names: unknown, forKinds: kept.join(',') });
    update({ kinds: kept });
  }, [unknown, state.kinds, update]);
  const ready = kindsSettled && unknown.length === 0;
  const kindsKey = state.kinds.join(',');
  const compare = useResource<Compare | null>(
    (signal) => (ready && state.kinds.length >= 2 ? api.compare({ kinds: state.kinds, days: state.range, bucket: state.bucket }, { signal }) : Promise.resolve(null)),
    [api, ready, kindsKey, state.range, state.bucket],
    'Could not load the comparison.',
  );
  const pairKey = state.pair?.join(',') ?? '';
  const pair = useResource<PairDetail | null>(
    (signal) =>
      ready && state.pair
        ? api.pair({ a: state.pair[0], b: state.pair[1], days: state.range, bucket: state.bucket, lagMin: -MAX_LAG, lagMax: MAX_LAG }, { signal })
        : Promise.resolve(null),
    [api, ready, pairKey, state.range, state.bucket],
    'Could not load the pair detail.',
  );

  const colorOf = useCallback((key: string) => slotColor(Math.max(0, state.kinds.indexOf(key))), [state.kinds]);
  const cmp = compare.data;
  const noun = state.bucket === 'week' ? 'weeks' : 'days';

  const lines = useMemo(
    () =>
      (cmp?.series ?? []).map((s) => ({
        key: s.kind,
        label: s.displayName,
        color: colorOf(s.kind),
        values: normalize(s.values, state.norm),
      })),
    [cmp, state.norm, colorOf],
  );
  const raw = useMemo(() => new Map((cmp?.series ?? []).map((s) => [s.kind, s])), [cmp]);
  const formatLine = useCallback(
    (key: string, v: number | null, i: number) => {
      const s = raw.get(key);
      if (!s) return '–';
      const rawText = valueText(s, s.values[i] ?? null);
      return state.norm === 'raw' || v === null ? rawText : `${rawText} (${state.norm === 'z' ? `z ${v.toFixed(2)}` : `index ${Math.round(v)}`})`;
    },
    [raw, state.norm],
  );

  const pd = pair.data;
  const lagStats = pd?.lags.find((l) => l.lag === state.lag) ?? null;
  const best = pd && pd.bestLag !== null ? pd.lags.find((l) => l.lag === pd.bestLag) ?? null : null;
  const points = useMemo<ScatterPoint[]>(() => {
    if (!pd) return [];
    const out: ScatterPoint[] = [];
    pd.dates.forEach((d, i) => {
      const j = i + state.lag;
      const x = pd.a.values[i];
      const y = pd.b.values[j];
      if (j < 0 || j >= pd.dates.length || x === null || x === undefined || y === null || y === undefined) return;
      out.push({
        x,
        y,
        label: tooltipDate(d, pd.bucket, state.range),
        detail: `${pd.a.displayName} ${valueText(pd.a, x)}, ${pd.b.displayName} ${valueText(pd.b, y)}${state.lag ? ` (${tooltipDate(pd.dates[j]!, pd.bucket, state.range)})` : ''}`,
      });
    });
    return out;
  }, [pd, state.lag, state.range]);

  const known = kinds.data ?? [];
  const items = (cmp?.series ?? []).map((s) => ({ key: s.kind, label: s.displayName, color: colorOf(s.kind) }));
  const loadingState = (r: { status: string; error: string | null; reload: () => void; data: unknown }) =>
    r.status === 'loading' || !ready ? ({ kind: 'loading' } as const) : r.status === 'error' && !r.data ? ({ kind: 'error', message: r.error ?? '', onRetry: r.reload } as const) : null;
  const needTwo = state.kinds.length < 2;
  const empty = !!cmp && cmp.series.every((s) => s.stats.n === 0 || (s.stats.max === 0 && s.stats.min === 0));

  return (
    <main className="screen dash compare">
      <header className="dash-head">
        <div className="dash-titles">
          <h1 className="dash-title display">Compare</h1>
          <p className="dash-meta">See how trackers move together. Every setting is saved in the link.</p>
        </div>
        <div className="dash-controls">
          <Segmented legend="Date range" options={RANGE_OPTIONS} value={String(state.range)} onChange={(v) => update({ range: Number(v) as CompareRange })} />
          <Segmented legend="Bucket" options={BUCKET_OPTIONS} value={state.bucket} onChange={(v) => update({ bucket: v })} />
          <Segmented legend="Scale" options={NORM_OPTIONS} value={state.norm} onChange={(v) => update({ norm: v })} />
        </div>
      </header>

      {ignored && ignored.forKinds === kindsKey && (
        <p className="notice compare-notice" role="status">
          Ignored unknown trackers: {ignored.names.join(', ')}
          <button type="button" className="link-btn" onClick={() => setIgnored(null)}>
            Dismiss
          </button>
        </p>
      )}

      {kinds.status === 'error' ? (
        <Panel title="Trackers" state={{ kind: 'error', message: kinds.error ?? '', onRetry: kinds.reload }} />
      ) : (
        <KindPicker
          kinds={known}
          selected={state.kinds}
          onChange={(next) => update({ kinds: next, pair: null, lag: 0 })}
        />
      )}

      <div className="dash-grid">
        <Panel
          className="span-7"
          title="Overlay"
          subtitle={NORM_HELP[state.norm]}
          state={needTwo ? { kind: 'empty', message: 'Pick at least two trackers to compare.' } : loadingState(compare) ?? (empty ? { kind: 'empty', message: 'These trackers have no data in this range.' } : { kind: 'ready' })}
          dim={compare.refreshing}
        >
          {cmp && (
            <>
              <Legend label="Series" mark="line" items={items} hidden={hidden} onToggle={(k) => setHidden((h) => toggled(h, k))} />
              <TimeChart
                dates={cmp.dates}
                bucket={cmp.bucket}
                series={lines.filter((l) => !hidden.has(l.key))}
                mode="line"
                yLabel={Y_LABEL[state.norm]}
                includeZero={state.norm !== 'index'}
                label={`Line chart of ${items.map((i) => i.label).join(', ')}, ${NORMALIZATION_LABEL[state.norm].toLowerCase()} values per ${cmp.bucket}`}
                formatValue={formatLine}
                height={300}
              />
            </>
          )}
        </Panel>

        <Panel
          className="span-5"
          title="Correlation matrix"
          subtitle={`Pearson r per pair of ${noun}. Only days after both trackers started. Select a cell for detail.`}
          state={needTwo ? { kind: 'empty', message: 'Pick at least two trackers to compare.' } : loadingState(compare) ?? { kind: 'ready' }}
          dim={compare.refreshing}
        >
          {cmp && <CorrMatrix items={items} pairs={cmp.pairs} selected={state.pair} noun={noun} onSelect={(a, b) => update({ pair: [a, b], lag: 0 })} />}
        </Panel>

        <Panel
          className="span-12"
          title={pd ? `${pd.a.displayName} vs ${pd.b.displayName}` : 'Pair detail'}
          subtitle={pd ? `Each point is one ${pd.bucket}: ${pd.a.displayName} across, ${pd.b.displayName} ${state.lag ? `${Math.abs(state.lag)} ${noun} ${state.lag > 0 ? 'later' : 'earlier'}` : 'the same ' + pd.bucket} up` : undefined}
          state={needTwo ? { kind: 'empty', message: 'Pick two trackers to see how they relate.' } : loadingState(pair) ?? { kind: 'ready' }}
          dim={pair.refreshing}
        >
          {pd && (
            <div className="pair">
              <div className="pair-plot">
                <Scatter
                  points={points}
                  color={colorOf(pd.a.kind)}
                  xLabel={`${pd.a.displayName} (${unitFor(pd.a.agg, pd.a.unit) ?? 'value'})`}
                  yLabel={`${pd.b.displayName} (${unitFor(pd.b.agg, pd.b.unit) ?? 'value'})`}
                  slope={lagStats?.slope ?? null}
                  intercept={lagStats?.intercept ?? null}
                  label={`Scatter plot of ${pd.a.displayName} against ${pd.b.displayName}, ${points.length} points, r ${formatR(lagStats?.r ?? null)}`}
                />
              </div>
              <div className="pair-side">
                <dl className="pair-stats">
                  <div>
                    <dt>r</dt>
                    <dd>{formatR(lagStats?.r ?? null)}</dd>
                  </div>
                  <div>
                    <dt>r squared</dt>
                    <dd>{lagStats?.r2 === null || lagStats?.r2 === undefined ? '–' : lagStats.r2.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>n</dt>
                    <dd>{lagStats?.n ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Slope</dt>
                    <dd title={lagStats?.slope === null || lagStats?.slope === undefined ? undefined : String(lagStats.slope)}>{compact(lagStats?.slope ?? null)}</dd>
                  </div>
                </dl>
                {lagStats?.r === null && lagStats.reason && <p className="pair-reason">No r: {lagStats.reason}.</p>}
                <div className="lag-control">
                  <label htmlFor="lag" className="lag-label">
                    Lag: <b>{state.lag > 0 ? `+${state.lag}` : state.lag} {Math.abs(state.lag) === 1 ? noun.slice(0, -1) : noun}</b>
                    <small>{state.lag === 0 ? 'same bucket' : state.lag > 0 ? `${pd.b.displayName} later` : `${pd.b.displayName} earlier`}</small>
                  </label>
                  <input
                    id="lag"
                    type="range"
                    min={-MAX_LAG}
                    max={MAX_LAG}
                    step={1}
                    value={state.lag}
                    onChange={(e) => update({ lag: Number(e.target.value) })}
                    aria-valuetext={`${state.lag} ${Math.abs(state.lag) === 1 ? noun.slice(0, -1) : noun}, r ${formatR(lagStats?.r ?? null)}`}
                  />
                  <LagBars lags={pd.lags} selected={state.lag} best={pd.bestLag} onSelect={(lag) => update({ lag })} noun={noun} />
                </div>
                <p className="pair-best">
                  {lagSentence(pd.a.displayName, pd.b.displayName, best && pd.bestLag !== null ? { lag: pd.bestLag, r: best.r, n: best.n } : null, pd.bucket, pd.lags.length)}
                  {pd.bestLag !== null && pd.bestLag !== state.lag && (
                    <button type="button" className="link-btn" onClick={() => update({ lag: pd.bestLag! })}>
                      Show strongest lag
                    </button>
                  )}
                </p>
                <p className="pair-caution">
                  Correlation is not causation. Small samples mislead. {pd.lags.length} lags were tried, so the strongest looks better than chance.
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          className="span-12"
          title="Summary"
          subtitle={`Per ${state.bucket}, last ${state.range === 365 ? 'year' : `${state.range} days`}`}
          state={needTwo ? { kind: 'empty', message: 'Pick at least two trackers to compare.' } : loadingState(compare) ?? { kind: 'ready' }}
          dim={compare.refreshing}
        >
          {cmp && <SummaryTable series={cmp.series} colorOf={colorOf} bucket={cmp.bucket} />}
        </Panel>
      </div>
    </main>
  );
}

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// Slope of a least-squares line through the buckets; tiny slopes read as flat rather than "+0".
export function trendText(s: CompareSeries, bucket: Bucket): string {
  const slope = s.stats.slope;
  if (slope === null) return '–';
  const scale = Math.max(Math.abs(s.stats.mean ?? 0), 1e-9);
  if (Math.abs(slope) / scale < 0.001) return 'Flat';
  const u = unitFor(s.agg, s.unit, 2);
  const abs = Math.abs(slope);
  const text = abs < 0.01 ? abs.toPrecision(1) : abs < 10 ? abs.toFixed(2).replace(/0$/, '') : compact(abs);
  return `${slope > 0 ? '+' : '−'}${text}${u ? ` ${u}` : ''} per ${bucket}`;
}

function SummaryTable({ series, colorOf, bucket }: { series: CompareSeries[]; colorOf: (k: string) => string; bucket: Bucket }) {
  const cell = (s: CompareSeries, v: number | null) => {
    if (v === null) return '–';
    const u = unitFor(s.agg, s.unit, v);
    return `${compact(v)}${u ? ` ${u}` : ''}`;
  };
  return (
    <div className="table-wrap">
      <table className="dense-table kind-table">
        <caption className="visually-hidden">Summary statistics per selected tracker</caption>
        <thead>
          <tr>
            {['Tracker', 'Total', 'Mean', 'Min', 'Max', 'Std dev', 'Trend', ''].map((h, i) => (
              <th key={i} scope="col">
                {h || <span className="visually-hidden">Sparkline</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.kind}>
              <th scope="row" data-label="Tracker">
                <span className="viz-key viz-key-line" style={{ background: colorOf(s.kind) }} aria-hidden="true" />
                {s.displayName}
              </th>
              <td data-label="Total">{s.agg === 'avg' || s.agg === 'max' ? '–' : cell(s, s.stats.total)}</td>
              <td data-label="Mean">{cell(s, s.stats.mean)}</td>
              <td data-label="Min">{cell(s, s.stats.min)}</td>
              <td data-label="Max">{cell(s, s.stats.max)}</td>
              <td data-label="Std dev">{cell(s, s.stats.stdDev)}</td>
              <td data-label="Trend">{trendText(s, bucket)}</td>
              <td data-label="Sparkline" className="table-spark">
                <Sparkline values={s.values} color={colorOf(s.kind)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
