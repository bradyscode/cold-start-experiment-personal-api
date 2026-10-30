import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { HEAT_COLORS, heatLevel } from '../analytics/colors';
import type { HeatDay } from '../analytics/derive';
import { formatValue } from '../analytics/format';
import { Tooltip, useWidth } from './chartKit';
import { tooltipDate } from './dates';

type Props = { days: HeatDay[]; max: number; columns: number; label: string };

const LEFT = 30;
const TOP = 18;
const ROW_LABELS: [number, string][] = [
  [0, 'Mon'],
  [2, 'Wed'],
  [4, 'Fri'],
];
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });

function entries(n: number) {
  return `${formatValue(n)} ${n === 1 ? 'entry' : 'entries'}`;
}

function HeatmapImpl({ days, max, columns, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pitch = Math.max(6, Math.min(26, Math.floor((width - LEFT) / Math.max(1, columns))));
  const cell = Math.max(4, pitch - 3);
  const height = TOP + pitch * 7;
  const span = 400;

  const months = useMemo(() => {
    const out: { column: number; text: string }[] = [];
    let last = '';
    for (const d of days) {
      const m = d.date.slice(0, 7);
      if (m !== last && d.row === 0) {
        last = m;
        const [y, mo] = m.split('-').map(Number);
        out.push({ column: d.column, text: MONTH.format(new Date(Date.UTC(y!, mo! - 1, 1))) });
      } else if (last === '') last = m;
    }
    // Drop labels that would crowd each other.
    return out.filter((m, i) => i === 0 || m.column - out[i - 1]!.column >= 3);
  }, [days]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!days.length) return;
    const cur = active ?? days.length - 1;
    const next = { ArrowLeft: cur - 7, ArrowRight: cur + 7, ArrowUp: cur - 1, ArrowDown: cur + 1, Home: 0, End: days.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.max(0, Math.min(days.length - 1, next)));
  };

  const a = active !== null ? days[active] : undefined;
  const describe = (d: HeatDay) => `${tooltipDate(d.date, 'day', span)}: ${entries(d.value)}${d.top ? `, mostly ${d.top}` : ''}`;

  return (
    <div className="viz" ref={ref}>
      <div
        className="viz-plot"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use arrow keys to move by day or week.`}
        onKeyDown={onKey}
        onFocus={() => setActive((i) => i ?? days.length - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <svg width={Math.min(width, LEFT + columns * pitch)} height={height} aria-hidden="true" focusable="false">
          {months.map((m) => (
            <text key={`${m.column}-${m.text}`} className="viz-axis" x={LEFT + m.column * pitch} y={11}>
              {m.text}
            </text>
          ))}
          {ROW_LABELS.map(([row, text]) => (
            <text key={text} className="viz-axis" x={LEFT - 6} y={TOP + row * pitch + cell / 2} dy="0.32em" textAnchor="end">
              {text}
            </text>
          ))}
          {days.map((d, i) => (
            <rect
              key={d.date}
              x={LEFT + d.column * pitch}
              y={TOP + d.row * pitch}
              width={cell}
              height={cell}
              rx={2}
              fill={HEAT_COLORS[heatLevel(d.value, max)]}
              onPointerEnter={() => setActive(i)}
            />
          ))}
          {a && <rect className="viz-cell-focus" x={LEFT + a.column * pitch - 1.5} y={TOP + a.row * pitch - 1.5} width={cell + 3} height={cell + 3} rx={3} />}
        </svg>
        {a && (
          <Tooltip
            x={LEFT + a.column * pitch + cell}
            y={TOP + a.row * pitch - 8}
            width={width}
            title={tooltipDate(a.date, 'day', span)}
            rows={[{ key: 'n', color: HEAT_COLORS[Math.max(1, heatLevel(a.value, max))]!, label: a.top ? `top: ${a.top}` : 'no entries', value: entries(a.value), mark: 'box' }]}
          />
        )}
        <p className="visually-hidden" aria-live="polite">
          {a ? describe(a) : ''}
        </p>
      </div>
      <div className="heat-scale" aria-hidden="true">
        <span>Less</span>
        {HEAT_COLORS.map((c) => (
          <span key={c} className="heat-swatch" style={{ background: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export const Heatmap = memo(HeatmapImpl);
