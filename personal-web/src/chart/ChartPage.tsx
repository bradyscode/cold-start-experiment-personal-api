import { useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ApiError, type Agg, type Bucket, type Kind, type Series } from '../api/types';
import { categoryColor } from '../analytics/colors';
import { AGG_NOUN, compact, formatValue, unitFor } from '../analytics/format';
import { useResource } from '../analytics/useResource';
import { formatBucketDate } from '../charts/dates';
import { TimeChart } from '../charts/TimeChart';
import { Segmented, Skeleton, type Option } from '../dashboards/ui';

const AGGS: Agg[] = ['sum', 'avg', 'max', 'count'];
const AGG_LABEL: Record<Agg, string> = { sum: 'Total', avg: 'Average', max: 'Highest', count: 'Entries' };
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const RANGE_OPTIONS: Option<string>[] = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '365', label: '1Y' },
];
const BUCKET_OPTIONS: Option<Bucket>[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
];

type Loaded = { series: Series; kind: Kind | null; agg: Agg };

export function parseDays(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

// The URL wins; otherwise the kind's own defaultAgg, then sum for value kinds and count for the rest.
export function aggForKind(kind: Kind | null, raw: string | null): Agg {
  const fromUrl = AGGS.find((a) => a === raw);
  if (fromUrl) return fromUrl;
  if (kind?.defaultAgg && AGGS.includes(kind.defaultAgg)) return kind.defaultAgg;
  return kind && !kind.valueField ? 'count' : 'sum';
}

export function ChartPage() {
  const { kind = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { api } = useApi();
  const bucket: Bucket = params.get('bucket') === 'week' ? 'week' : 'day';
  const rawAgg = params.get('agg');
  const days = parseDays(params.get('days'));

  const res = useResource<Loaded>(
    async (signal) => {
      // A missing tracker list only costs the display name, but an unreachable API should fail now, not after a second timeout.
      const kinds = await api.kinds({ signal }).catch((e: unknown) => {
        if (signal.aborted || (e instanceof ApiError && e.status === 0)) throw e;
        return null;
      });
      const def = kinds?.find((k) => k.key === kind) ?? null;
      const agg = aggForKind(def, rawAgg);
      const series = await api.series(kind, { days, bucket, agg }, { signal });
      return { series, kind: def, agg };
    },
    [api, kind, bucket, rawAgg, days],
    'Something went wrong loading this chart. Try again.',
  );

  const set = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) next.set(k, v);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const notFound = res.status === 'error' && !res.data && res.errorStatus === 404;
  const name = res.data?.kind?.displayName ?? kind;

  return (
    <main className="screen chart-page">
      <BackLink />
      {res.status === 'loading' && <Skeleton label="Loading chart" lines={6} />}
      {res.status === 'error' && !res.data && (
        <div className="stack">
          <p role="alert" className="notice notice-error">
            {notFound ? 'That tracker was not found.' : res.error}
          </p>
          {notFound ? (
            <Link className="btn btn-link" to="/dashboards">
              Go to dashboards
            </Link>
          ) : (
            <button type="button" className="btn" onClick={res.reload}>
              Try again
            </button>
          )}
        </div>
      )}
      {res.data && (
        <Ready
          loaded={res.data}
          name={name}
          bucket={bucket}
          days={days}
          dim={res.refreshing}
          onRange={(v) => set({ days: v })}
          onBucket={(v) => set({ bucket: v })}
          onAgg={(v) => set({ agg: v })}
        />
      )}
    </main>
  );
}

// Goes back when the previous page is inside the app; a fresh tab falls back to the dashboards.
function BackLink() {
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== 'default';
  return (
    <Link
      className="back-link"
      to="/dashboards"
      onClick={(e) => {
        if (!canGoBack) return;
        e.preventDefault();
        navigate(-1);
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      Back
    </Link>
  );
}

type ReadyProps = {
  loaded: Loaded;
  name: string;
  bucket: Bucket;
  days: number;
  dim: boolean;
  onRange: (v: string) => void;
  onBucket: (v: Bucket) => void;
  onAgg: (v: Agg) => void;
};

function Ready({ loaded, name, bucket, days, dim, onRange, onBucket, onAgg }: ReadyProps) {
  const { series, kind, agg } = loaded;
  const keep = bucket === 'week' ? Math.ceil(days / 7) : days;
  const points = series.points.slice(-keep);
  const color = categoryColor(kind?.category);
  const unit = unitFor(agg, series.unit, 2);
  const hasData = points.some((p) => p.count > 0);
  const noun = bucket === 'week' ? 'week' : 'day';
  const range = bucket === 'week' ? `last ${points.length} weeks (current week partial)` : `last ${days} days`;
  const aggs = kind && !kind.valueField ? (['count'] as Agg[]) : AGGS;

  const controls = (
    <div className="chart-controls">
      <Segmented legend="Date range" options={RANGE_OPTIONS} value={String(days)} onChange={onRange} />
      <Segmented legend="Bucket" options={BUCKET_OPTIONS} value={bucket} onChange={onBucket} />
      {aggs.length > 1 && (
        <label className="inline-select">
          <span className="visually-hidden">Aggregation</span>
          <select className="field field-small" value={agg} onChange={(e) => onAgg(e.target.value as Agg)}>
            {aggs.map((a) => (
              <option key={a} value={a}>
                {AGG_LABEL[a]} per {noun}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );

  if (!hasData) {
    return (
      <div className="stack">
        <h1 className="display chart-title">{name}</h1>
        {controls}
        <p>
          Nothing logged for {name} in the last {days} days.
        </p>
        <Link className="btn btn-primary btn-link" to="/add">
          Add a record
        </Link>
      </div>
    );
  }

  const value = (p: (typeof points)[number]) => (agg === 'count' ? p.count : p.value);
  const withData = points.filter((p) => p.count > 0 && value(p) !== null);
  const sum = withData.reduce((s, p) => s + (value(p) ?? 0), 0);
  const activeAvg = withData.length ? sum / withData.length : null;
  const additive = agg === 'sum' || agg === 'count';
  const last = points[points.length - 1]!;
  const lastValue = last.count > 0 ? value(last) : null;
  const lastLabel = bucket === 'week' ? `Week of ${formatBucketDate(last.date)}` : formatBucketDate(last.date);
  const lower = kind?.better === 'lower';
  const bestPoint = withData.reduce<(typeof points)[number] | null>((b, p) => (!b || (lower ? value(p)! < value(b)! : value(p)! > value(b)!) ? p : b), null);
  const label = `${additive ? 'Bar' : 'Line'} chart of ${AGG_LABEL[agg].toLowerCase()} per ${noun}, ${points.length} ${noun}s, ${withData.length} with data`;

  return (
    <div className={dim ? 'stack is-dim' : 'stack'}>
      <div className="chart-head">
        <h1 className="display chart-title">{name}</h1>
        <p className="help">
          {AGG_LABEL[agg]} per {noun}, {range}
        </p>
      </div>
      {controls}
      <section className="chart-card">
        <TimeChart
          dates={points.map((p) => p.date)}
          bucket={bucket}
          series={[{ key: series.kind, label: name, color, values: points.map((p) => (p.count > 0 ? value(p) : agg === 'count' || agg === 'sum' ? 0 : null)) }]}
          mode={additive ? 'stack' : 'line'}
          includeZero={additive}
          yLabel={unit ?? ''}
          label={label}
          formatValue={(_k, v, i) => (points[i]!.count === 0 ? 'no entries' : v === null ? 'no value' : `${formatValue(v)}${unitFor(agg, series.unit, v) ? ` ${unitFor(agg, series.unit, v)}` : ''}`)}
          height={260}
        />
      </section>
      <div className="stats">
        <Stat
          label={`Latest: ${lastLabel}`}
          value={lastValue}
          unit={unitFor(agg, series.unit, lastValue)}
          empty={bucket === 'week' ? 'No entries this week yet' : 'No entries on this day yet'}
        />
        <Stat label={`Average per ${noun} with data`} value={activeAvg} unit={unitFor(agg, series.unit, activeAvg)} note={`${withData.length} of ${points.length} ${noun}s had entries`} />
        {additive && <Stat label={`${AGG_LABEL[agg]} in range`} value={sum} unit={unitFor(agg, series.unit, sum)} note={`${formatValue(sum / points.length)} per ${noun} including empty ${noun}s`} />}
        {bestPoint && (
          <Stat
            label={lower ? `Lowest ${noun}` : kind?.better === 'none' ? `Highest ${noun}` : `Best ${noun}`}
            value={value(bestPoint)}
            unit={unitFor(agg, series.unit, value(bestPoint))}
            note={bucket === 'week' ? `Week of ${formatBucketDate(bestPoint.date)}` : formatBucketDate(bestPoint.date)}
          />
        )}
      </div>
      <p className="help">{AGG_NOUN[agg] === 'entries' ? 'Counts every entry.' : `Each ${noun} shows the ${AGG_NOUN[agg]} of that ${noun}'s values.`}</p>
    </div>
  );
}

function Stat({ label, value, unit, note, empty }: { label: string; value: number | null; unit: string | null; note?: string; empty?: string }) {
  const full = formatValue(value);
  const shown = value === null ? '–' : full.length > 8 ? compact(value) : full;
  return (
    <div className="stat-block" aria-label={`${label}: ${value === null ? (empty ?? 'no value') : `${full}${unit ? ` ${unit}` : ''}`}${note ? `, ${note}` : ''}`} role="group">
      <small>{label}</small>
      <b className="display stat-value" title={value === null ? undefined : full}>
        {shown}
      </b>
      {value === null ? empty && <small>{empty}</small> : unit && <small>{unit}</small>}
      {note && <small className="stat-note">{note}</small>}
    </div>
  );
}
