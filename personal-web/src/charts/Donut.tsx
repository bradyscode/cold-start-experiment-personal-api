import { useState } from 'react';
import { CARD } from '../analytics/colors';
import type { Share } from '../analytics/derive';
import { compact, formatValue } from '../analytics/format';

const SIZE = 168;
const R = SIZE / 2;
const INNER = R - 26;

function arc(start: number, end: number): string {
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-6);
  const p = (a: number, r: number) => `${(R + r * Math.sin(a)).toFixed(2)} ${(R - r * Math.cos(a)).toFixed(2)}`;
  const large = sweep > Math.PI ? 1 : 0;
  const e = start + sweep;
  return `M${p(start, R)} A${R} ${R} 0 ${large} 1 ${p(e, R)} L${p(e, INNER)} A${INNER} ${INNER} 0 ${large} 0 ${p(start, INNER)} Z`;
}

function pct(p: number): string {
  return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

export function Donut({ shares, total, unitLabel }: { shares: Share[]; total: number; unitLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  let angle = 0;
  const segments = shares.map((s) => {
    const sweep = total > 0 ? (s.value / total) * Math.PI * 2 : 0;
    const seg = { ...s, d: arc(angle, angle + sweep) };
    angle += sweep;
    return seg;
  });
  const focus = shares.find((s) => s.key === hover);

  return (
    <div className="donut">
      <div className="donut-figure">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
          {segments.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill={s.color}
              stroke={CARD}
              strokeWidth={2}
              opacity={hover && hover !== s.key ? 0.45 : 1}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <b className="display">{compact(focus ? focus.value : total)}</b>
          <span>{focus ? focus.label : unitLabel}</span>
        </div>
      </div>
      <ol className="rank-legend">
        {shares.map((s) => (
          <li key={s.key} className={hover === s.key ? 'is-hot' : undefined} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
            <span className="viz-key viz-key-box" style={{ background: s.color }} aria-hidden="true" />
            <span className="rank-name">
              {s.label}
              {s.top && <small>Top: {s.top}</small>}
            </span>
            <span className="rank-value">{formatValue(s.value)}</span>
            <b className="rank-pct">{pct(s.percent)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
