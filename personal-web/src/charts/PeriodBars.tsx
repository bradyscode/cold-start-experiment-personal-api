import { Link } from 'react-router-dom';
import { compact, formatValue } from '../analytics/format';

export type PeriodRow = {
  key: string;
  label: string;
  color: string;
  current: number | null;
  previous: number | null;
  unit: string | null;
  deltaText: string;
  deltaShort: string;
  tone: 'good' | 'bad' | 'neutral';
  arrow: string;
  href: string;
};

// Each row has its own scale because trackers use different units; values are always printed.
export function PeriodBars({ rows, currentLabel, previousLabel }: { rows: PeriodRow[]; currentLabel: string; previousLabel: string }) {
  return (
    <div className="period">
      <div className="period-key" aria-hidden="true">
        <span>
          <span className="viz-key viz-key-box period-key-current" /> {currentLabel}
        </span>
        <span>
          <span className="viz-key viz-key-box period-key-prev" /> {previousLabel}
        </span>
      </div>
      <ul className="period-rows">
        {rows.map((r) => {
          const max = Math.max(Math.abs(r.current ?? 0), Math.abs(r.previous ?? 0));
          const w = (v: number | null) => (max > 0 && v !== null ? `${(Math.abs(v) / max) * 100}%` : '0%');
          const name = `${r.label}: ${formatValue(r.current)}${r.unit ? ` ${r.unit}` : ''} ${currentLabel.toLowerCase()}, ${formatValue(r.previous)} ${previousLabel.toLowerCase()}, ${r.deltaText}`;
          return (
            <li key={r.key}>
              <Link to={r.href} className="period-row" aria-label={name}>
                <span className="period-name">{r.label}</span>
                <span className="period-bars" aria-hidden="true">
                  <span className="period-bar" style={{ width: w(r.current), background: r.color }} />
                  <span className="period-bar period-bar-prev" style={{ width: w(r.previous) }} />
                </span>
                <span className="period-value" aria-hidden="true">
                  <b>{compact(r.current)}</b>
                  <small className={`tone-${r.tone}`}>
                    {r.arrow} {r.deltaShort}
                  </small>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
