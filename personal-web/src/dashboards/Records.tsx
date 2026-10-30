import { Link } from 'react-router-dom';
import { categoryColor } from '../analytics/colors';
import { compact, unitFor } from '../analytics/format';
import { chartHref } from '../analytics/insights';
import type { KindOverview } from '../analytics/types';
import { formatBucketDate } from '../charts/dates';

const TOP = 5;

function Row({ k, days, value, detail }: { k: KindOverview; days: number; value: string; detail?: string }) {
  return (
    <li>
      <Link to={chartHref(k, days)} className="rec-row">
        <span className="viz-key" style={{ background: categoryColor(k.category) }} aria-hidden="true" />
        <span className="rec-name">{k.displayName}</span>
        <b className="rec-value">{value}</b>
        {detail && <small className="rec-detail">{detail}</small>}
      </Link>
    </li>
  );
}

// Streaks are measured over the window the overview fetched (activityDays); best days within the selected range.
export function Records({ kinds, days, windowDays }: { kinds: KindOverview[]; days: number; windowDays: number }) {
  const current = kinds.filter((k) => k.currentStreak > 0).sort((a, b) => b.currentStreak - a.currentStreak).slice(0, TOP);
  const longest = kinds.filter((k) => k.longestStreak > 0).sort((a, b) => b.longestStreak - a.longestStreak).slice(0, TOP);
  const best = kinds
    .filter((k) => k.best)
    .sort((a, b) => b.entries - a.entries)
    .slice(0, TOP);
  const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

  return (
    <div className="records">
      <div>
        <h3 className="rec-title">Current streaks</h3>
        {current.length ? (
          <ol className="rec-list">
            {current.map((k) => (
              <Row key={k.kind} k={k} days={days} value={dayCount(k.currentStreak)} />
            ))}
          </ol>
        ) : (
          <p className="help">No streak is running.</p>
        )}
      </div>
      <div>
        <h3 className="rec-title">Longest streaks, last {windowDays} days</h3>
        {longest.length ? (
          <ol className="rec-list">
            {longest.map((k) => (
              <Row key={k.kind} k={k} days={days} value={dayCount(k.longestStreak)} />
            ))}
          </ol>
        ) : (
          <p className="help">No streaks yet.</p>
        )}
      </div>
      <div>
        <h3 className="rec-title">Best days in range</h3>
        {best.length ? (
          <ol className="rec-list">
            {best.map((k) => {
              const u = unitFor(k.agg, k.unit, k.best!.value);
              return (
                <Row
                  key={k.kind}
                  k={k}
                  days={days}
                  value={`${compact(k.best!.value)}${u ? ` ${u}` : ''}`}
                  detail={`${k.better === 'lower' ? 'lowest' : k.better === 'none' ? 'highest' : 'best'} on ${formatBucketDate(k.best!.date)}`}
                />
              );
            })}
          </ol>
        ) : (
          <p className="help">No values in this range.</p>
        )}
      </div>
    </div>
  );
}
