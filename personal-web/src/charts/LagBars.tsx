import { formatR } from '../analytics/format';
import type { PairResult } from '../analytics/types';
import { useWidth } from './chartKit';

const POS = '#4A7FFF';
const NEG = '#E8541C';
const H = 96;

// r for each lag around a zero baseline; pointer users can click a bar, the slider next to it is the keyboard control.
export function LagBars({ lags, selected, best, onSelect, noun }: { lags: PairResult[]; selected: number; best: number | null; onSelect: (lag: number) => void; noun: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const slot = width / Math.max(1, lags.length);
  const barW = Math.max(3, Math.min(20, slot * 0.6));
  const mid = H / 2;
  return (
    <div className="lag" ref={ref}>
      <svg width={width} height={H + 18} aria-hidden="true" focusable="false">
        <line className="viz-baseline" x1={0} x2={width} y1={mid} y2={mid} />
        {lags.map((l, i) => {
          const x = i * slot + slot / 2;
          const h = l.r === null ? 0 : Math.abs(l.r) * (mid - 6);
          return (
            <g key={l.lag} onClick={() => onSelect(l.lag)} className="lag-col">
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {l.lag === selected && <rect className="lag-sel" x={x - barW / 2 - 3} y={2} width={barW + 6} height={H - 4} rx={4} />}
              {l.r === null ? (
                <line className="viz-grid" x1={x - barW / 2} x2={x + barW / 2} y1={mid} y2={mid} />
              ) : (
                <rect x={x - barW / 2} y={l.r >= 0 ? mid - h : mid} width={barW} height={Math.max(1, h)} rx={2} fill={l.r >= 0 ? POS : NEG} />
              )}
              {(l.lag === 0 || l.lag === lags[0]!.lag || l.lag === lags[lags.length - 1]!.lag || l.lag === best) && (
                <text className="viz-axis" x={i === 0 ? i * slot : i === lags.length - 1 ? (i + 1) * slot : x} y={H + 14} textAnchor={i === 0 ? 'start' : i === lags.length - 1 ? 'end' : 'middle'}>
                  {l.lag > 0 ? `+${l.lag}` : l.lag}
                  {l.lag === best ? ' best' : ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="visually-hidden">
        {lags.map((l) => (
          <li key={l.lag}>
            Lag {l.lag} {noun}: {l.r === null ? `no r, ${l.reason ?? 'not enough data'}` : `r ${formatR(l.r)} over ${l.n} ${noun}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
