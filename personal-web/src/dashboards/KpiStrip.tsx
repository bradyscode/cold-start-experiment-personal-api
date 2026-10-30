import { memo, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { categoryColor } from '../analytics/colors';
import { AGG_NOUN, compact, deltaOf, formatValue, rangeLabel, relativeAge, unitFor, type Delta } from '../analytics/format';
import { chartHref } from '../analytics/insights';
import type { KindOverview } from '../analytics/types';
import { Sparkline } from '../charts/Sparkline';

const VISIBLE = 8;
const ARROW: Record<Delta['direction'], string> = { up: '▲', down: '▼', flat: '■', new: '▲', none: '' };

export function kpiName(k: KindOverview, days: number, now: number): string {
  if (k.error) return `${k.displayName}: ${k.error}`;
  const d = deltaOf(k, days);
  const unit = unitFor(k.agg, k.unit, k.value);
  const what = k.agg === 'count' ? '' : ` ${AGG_NOUN[k.agg]}`;
  const value = k.value === null ? 'no data' : `${formatValue(k.value)}${unit ? ` ${unit}` : ''}${what}`;
  return `${k.displayName}: ${value} in the last ${rangeLabel(days)}, ${d.sentence}, last entry ${relativeAge(k.lastEntryAt, now)}`;
}

const AGG_LINE: Record<KindOverview['agg'], string> = { sum: 'total', avg: 'average', max: 'highest', count: 'count' };

function KpiCard({ k, days, now }: { k: KindOverview; days: number; now: number }) {
  const color = categoryColor(k.category);
  if (k.error) {
    return (
      <li className="kpi">
        <Link to={chartHref(k, days)} className="kpi-link kpi-failed" aria-label={kpiName(k, days, now)}>
          <span className="kpi-top" aria-hidden="true">
            <span className="viz-key" style={{ background: color }} />
            <span className="kpi-name">{k.displayName}</span>
          </span>
          <span className="kpi-error" aria-hidden="true">
            {k.error}
          </span>
        </Link>
      </li>
    );
  }
  const d = deltaOf(k, days);
  const unit = unitFor(k.agg, k.unit, k.value);
  const full = formatValue(k.value);
  // Cards are narrow: six characters is the most that fits beside the unit, so longer values abbreviate (full value in the name).
  const big = full.length > 6 ? compact(k.value) : full;
  return (
    <li className="kpi">
      <Link to={chartHref(k, days)} className="kpi-link" aria-label={kpiName(k, days, now)} title={k.value === null ? undefined : `${full}${unit ? ` ${unit}` : ''}`}>
        <span className="kpi-top" aria-hidden="true">
          <span className="viz-key" style={{ background: color }} />
          <span className="kpi-name">{k.displayName}</span>
          <span className="kpi-age">{relativeAge(k.lastEntryAt, now)}</span>
        </span>
        <span className="kpi-mid" aria-hidden="true">
          <span className="kpi-value display">{big}</span>
          <span className="kpi-unit">{unit}</span>
        </span>
        <span className="kpi-agg" aria-hidden="true">
          {AGG_LINE[k.agg]}, last {rangeLabel(days)}
        </span>
        <span className="kpi-bottom" aria-hidden="true">
          <span className={`kpi-delta tone-${d.tone}`}>
            {ARROW[d.direction] && <span className="kpi-arrow">{ARROW[d.direction]}</span>}
            {d.short}
          </span>
          <span className="kpi-spark">
            <Sparkline values={k.agg === 'count' ? k.counts : k.values} color={color} />
          </span>
        </span>
      </Link>
    </li>
  );
}

function KpiStripImpl({ kinds, days, now }: { kinds: KindOverview[]; days: number; now: number }) {
  const [all, setAll] = useState(false);
  const id = useId();
  const shown = all ? kinds : kinds.slice(0, VISIBLE);
  return (
    <div className="kpis">
      <ul className="kpi-strip" id={id} aria-label="Key numbers per tracker">
        {shown.map((k) => (
          <KpiCard key={k.kind} k={k} days={days} now={now} />
        ))}
      </ul>
      {kinds.length > VISIBLE && (
        <button type="button" className="btn btn-small kpi-more" aria-expanded={all} aria-controls={id} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${kinds.length} trackers`}
        </button>
      )}
    </div>
  );
}

export const KpiStrip = memo(KpiStripImpl);
