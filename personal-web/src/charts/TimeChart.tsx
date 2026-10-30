import { memo, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Bucket } from '../api/types';
import { compact } from '../analytics/format';
import { labelIndexes, niceTicks, scaleLinear } from './axis';
import { DataTableToggle, Tooltip, useWidth } from './chartKit';
import { axisDate, spanDays, tooltipDate } from './dates';

export type TimeSeries = { key: string; label: string; color: string; values: (number | null)[] };

type Props = {
  dates: string[];
  bucket: Bucket;
  series: TimeSeries[];
  mode: 'stack' | 'line';
  label: string;
  yLabel: string;
  formatValue: (key: string, value: number | null, index: number) => string;
  height?: number;
  includeZero?: boolean;
};

const M = { top: 24, right: 12, bottom: 26, left: 48 };

const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function TimeChartImpl({ dates, bucket, series, mode, label, yLabel, formatValue, height = 240, includeZero = true }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [index, setIndex] = useState<number | null>(null);
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const n = dates.length;

  const geo = useMemo(() => {
    // Stacks grow up from zero for positive values and down for negative ones.
    const sums = (sign: 1 | -1) => dates.map((_, i) => series.reduce((s, x) => { const v = num(x.values[i]) ?? 0; return v * sign > 0 ? s + v : s; }, 0));
    const totals = mode === 'stack' ? [...sums(1), ...sums(-1)] : [];
    const all = mode === 'stack' ? totals : series.flatMap((s) => s.values);
    const ticks = niceTicks(all, 4, includeZero || mode === 'stack');
    const y = scaleLinear([ticks.min, ticks.max], [plotH, 0]);
    const slot = n > 0 ? plotW / n : plotW;
    const x = (i: number) => (mode === 'stack' ? i * slot + slot / 2 : n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    return { ticks, y, x, slot, totals };
  }, [dates, series, mode, includeZero, plotW, plotH, n]);

  const bars = useMemo(() => {
    if (mode !== 'stack') return [];
    const barW = Math.max(1, Math.min(24, geo.slot * 0.72));
    const out: { key: string; x: number; y: number; h: number; w: number; color: string }[] = [];
    for (let i = 0; i < n; i++) {
      let up = 0;
      let down = 0;
      for (const s of series) {
        const v = num(s.values[i]) ?? 0;
        if (v === 0) continue;
        const from = v > 0 ? up : down;
        const to = from + v;
        if (v > 0) up = to;
        else down = to;
        // A 2px surface gap separates stacked segments; the first segment touches the baseline.
        const gap = from !== 0 ? 2 : 0;
        const top = Math.min(geo.y(from), geo.y(to));
        const h = Math.max(0, Math.abs(geo.y(from) - geo.y(to)) - gap);
        if (h > 0) out.push({ key: `${s.key}-${i}`, x: geo.x(i) - barW / 2, y: v > 0 ? top : top + gap, h, w: barW, color: s.color });
      }
    }
    return out;
  }, [mode, series, geo, n]);

  const paths = useMemo(() => {
    if (mode !== 'line') return [];
    return series.map((s) => {
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        const val = num(v);
        if (val === null) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${geo.x(i).toFixed(1)} ${geo.y(val).toFixed(1)}`;
        pen = true;
      });
      // A value with gaps on both sides has no segment, so it gets a dot to stay visible.
      const dots = s.values.flatMap((v, i) => {
        const val = num(v);
        return val !== null && num(s.values[i - 1]) === null && num(s.values[i + 1]) === null ? [{ x: geo.x(i), y: geo.y(val) }] : [];
      });
      return { key: s.key, d, color: s.color, dots };
    });
  }, [mode, series, geo]);

  const span = spanDays(dates);
  const labels = labelIndexes(n, Math.max(2, Math.min(7, Math.floor(plotW / 96))));
  const active = index !== null && index < n ? index : null;

  const rowsAt = (i: number) =>
    series.map((s) => ({ key: s.key, color: s.color, label: s.label, value: formatValue(s.key, num(s.values[i]), i), mark: mode === 'stack' ? ('box' as const) : ('line' as const) }));
  const readout = active === null ? '' : `${tooltipDate(dates[active]!, bucket, span)}: ${rowsAt(active).map((r) => `${r.label} ${r.value}`).join(', ')}`;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    const i = mode === 'stack' ? Math.floor(px / geo.slot) : Math.round((px / plotW) * (n - 1));
    setIndex(Math.max(0, Math.min(n - 1, i)));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setIndex(Math.max(0, Math.min(n - 1, next)));
  };

  return (
    <div className="viz" ref={ref}>
      <div
        className="viz-plot"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use left and right arrow keys to read each ${bucket}.`}
        onKeyDown={onKey}
        onFocus={() => setIndex((i) => i ?? n - 1)}
        onBlur={() => setIndex(null)}
      >
        <svg width={width} height={height} aria-hidden="true" focusable="false" onPointerMove={onMove} onPointerLeave={() => setIndex(null)}>
          <g transform={`translate(${M.left},${M.top})`}>
            {geo.ticks.ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'viz-baseline' : 'viz-grid'} x1={0} x2={plotW} y1={geo.y(t)} y2={geo.y(t)} />
                <text className="viz-axis" x={-8} y={geo.y(t)} dy="0.32em" textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            <text className="viz-axis viz-axis-unit" x={-M.left} y={-14} textAnchor="start">
              {yLabel}
            </text>
            {labels.map((i) => (
              <text key={i} className="viz-axis" x={geo.x(i)} y={plotH + 18} textAnchor={i === 0 && mode === 'line' ? 'start' : i === n - 1 && mode === 'line' ? 'end' : 'middle'}>
                {axisDate(dates[i]!, span)}
              </text>
            ))}
            {active !== null && <line className="viz-crosshair" x1={geo.x(active)} x2={geo.x(active)} y1={0} y2={plotH} />}
            {bars.map((b) => (
              <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.color} rx={1.5} />
            ))}
            {paths.map((p) => (
              <g key={p.key}>
                <path d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {p.dots.map((d, i) => (
                  <circle key={i} className="viz-solo" cx={d.x} cy={d.y} r={2.5} fill={p.color} />
                ))}
              </g>
            ))}
            {mode === 'line' &&
              active !== null &&
              series.map((s) => {
                const v = num(s.values[active]);
                return v === null ? null : <circle key={s.key} className="viz-dot" cx={geo.x(active)} cy={geo.y(v)} r={4} fill={s.color} />;
              })}
          </g>
        </svg>
        {active !== null && (
          <Tooltip x={geo.x(active) + M.left} y={M.top} width={width} title={tooltipDate(dates[active]!, bucket, span)} rows={rowsAt(active)} />
        )}
        <p className="visually-hidden" aria-live="polite">
          {readout}
        </p>
      </div>
      <DataTableToggle
        caption={label}
        head={[bucket === 'week' ? 'Week of' : 'Date', ...series.map((s) => s.label)]}
        rows={() => dates.map((d, i) => [tooltipDate(d, 'day', 400), ...series.map((s) => formatValue(s.key, num(s.values[i]), i))])}
      />
    </div>
  );
}

export const TimeChart = memo(TimeChartImpl);
