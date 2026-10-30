import { memo, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ageColor } from '../analytics/colors';
import { compact } from '../analytics/format';
import { niceTicks, scaleLinear } from './axis';
import { Tooltip, useWidth } from './chartKit';

export type ScatterPoint = { x: number; y: number; label: string; detail: string };

type Props = {
  points: ScatterPoint[];
  color: string;
  xLabel: string;
  yLabel: string;
  slope: number | null;
  intercept: number | null;
  label: string;
  height?: number;
};

const M = { top: 28, right: 16, bottom: 40, left: 52 };

// Points arrive oldest first; older points shift toward gray so recent behavior stands out.
function ScatterImpl({ points, color, xLabel, yLabel, slope, intercept, label, height = 280 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;

  const geo = useMemo(() => {
    const xt = niceTicks(points.map((p) => p.x), 4, false);
    const yt = niceTicks(points.map((p) => p.y), 4, false);
    return { xt, yt, x: scaleLinear([xt.min, xt.max], [0, plotW]), y: scaleLinear([yt.min, yt.max], [plotH, 0]) };
  }, [points, plotW, plotH]);

  // Drawn across the full x range and clipped to the plot, so a steep fit keeps its true slope.
  const line = useMemo(() => {
    if (slope === null || intercept === null || points.length < 2) return null;
    const [x0, x1] = [geo.xt.min, geo.xt.max];
    const ends = { x1: geo.x(x0), y1: geo.y(slope * x0 + intercept), x2: geo.x(x1), y2: geo.y(slope * x1 + intercept) };
    return Object.values(ends).every(Number.isFinite) ? ends : null;
  }, [slope, intercept, geo, points.length]);
  const clipId = `fit-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const n = points.length;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    const py = e.clientY - rect.top - M.top;
    let best = -1;
    let dist = 24 * 24;
    points.forEach((p, i) => {
      const d = (geo.x(p.x) - px) ** 2 + (geo.y(p.y) - py) ** 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setActive(best >= 0 ? best : null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const cur = active ?? n - 1;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, ArrowDown: cur - 1, ArrowUp: cur + 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.max(0, Math.min(n - 1, next)));
  };
  const a = active !== null ? points[active] : undefined;

  return (
    <div className="viz" ref={ref}>
      <div
        className="viz-plot"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use arrow keys to step through points from oldest to newest.`}
        onKeyDown={onKey}
        onFocus={() => setActive((i) => i ?? (n ? n - 1 : null))}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height} aria-hidden="true" focusable="false" onPointerMove={onMove} onPointerLeave={() => setActive(null)}>
          <g transform={`translate(${M.left},${M.top})`}>
            {geo.yt.ticks.map((t) => (
              <g key={`y${t}`}>
                <line className="viz-grid" x1={0} x2={plotW} y1={geo.y(t)} y2={geo.y(t)} />
                <text className="viz-axis" x={-8} y={geo.y(t)} dy="0.32em" textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            {geo.xt.ticks.map((t) => (
              <g key={`x${t}`}>
                <line className="viz-grid" x1={geo.x(t)} x2={geo.x(t)} y1={0} y2={plotH} />
                <text className="viz-axis" x={geo.x(t)} y={plotH + 16} textAnchor="middle">
                  {compact(t)}
                </text>
              </g>
            ))}
            <text className="viz-axis viz-axis-unit" x={plotW} y={plotH + 34} textAnchor="end">
              {xLabel}
            </text>
            <text className="viz-axis viz-axis-unit" x={-M.left} y={-16} textAnchor="start">
              {yLabel}
            </text>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={plotW} height={plotH} />
            </clipPath>
            {line && (
              <g clipPath={`url(#${clipId})`}>
                <line className="viz-fit" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
              </g>
            )}
            {points.map((p, i) => (
              <circle key={i} className="viz-dot" cx={geo.x(p.x)} cy={geo.y(p.y)} r={4} fill={ageColor(color, n > 1 ? 1 - i / (n - 1) : 0)} />
            ))}
            {a && <circle className="viz-dot-focus" cx={geo.x(a.x)} cy={geo.y(a.y)} r={7} />}
          </g>
        </svg>
        {a && (
          <Tooltip x={geo.x(a.x) + M.left} y={geo.y(a.y) + M.top - 10} width={width} title={a.label} rows={[{ key: 'd', color, label: '', value: a.detail }]} />
        )}
        <p className="visually-hidden" aria-live="polite">
          {a ? `${a.label}: ${a.detail}` : ''}
        </p>
      </div>
      <p className="viz-note">Recent points are in full color; older ones fade toward gray. The line is the least-squares fit.</p>
    </div>
  );
}

export const Scatter = memo(ScatterImpl);
