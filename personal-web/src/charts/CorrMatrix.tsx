import { useRef, type KeyboardEvent } from 'react';
import { DIVERGING, divergingColor, inkOn } from '../analytics/colors';
import { formatR } from '../analytics/format';
import type { PairResult } from '../analytics/types';

type Item = { key: string; label: string; color: string };

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function cellName(a: Item, b: Item, p: PairResult | undefined, noun: string): string {
  if (!p) return `${a.label} vs ${b.label}: not computed`;
  if (p.r === null) return `${a.label} vs ${b.label}: no r, ${p.reason ?? 'not enough data'}`;
  return `${a.label} vs ${b.label}: r ${formatR(p.r)} over ${p.n} ${noun}`;
}

// A grid of buttons with roving focus: arrow keys move between cells, Enter or click selects the pair.
export function CorrMatrix({
  items,
  pairs,
  selected,
  onSelect,
  noun,
}: {
  items: Item[];
  pairs: PairResult[];
  selected: [string, string] | null;
  onSelect: (a: string, b: string) => void;
  noun: string;
}) {
  const byKey = new Map(pairs.map((p) => [pairKey(p.a, p.b), p]));
  const grid = useRef<HTMLDivElement>(null);
  const n = items.length;
  const sel = selected ? pairKey(selected[0], selected[1]) : null;
  const firstOff = n > 1 ? [1, 0] : [0, 0];
  const focusRow = selected ? Math.max(0, items.findIndex((i) => i.key === selected[1])) : firstOff[0]!;
  const focusCol = selected ? Math.max(0, items.findIndex((i) => i.key === selected[0])) : firstOff[1]!;

  const move = (e: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    const delta: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const d = delta[e.key];
    let next: [number, number] | null = d ? [row + d[0], col + d[1]] : null;
    if (e.key === 'Home') next = [row, 0];
    if (e.key === 'End') next = [row, n - 1];
    if (!next) return;
    e.preventDefault();
    const [r, c] = [Math.max(0, Math.min(n - 1, next[0])), Math.max(0, Math.min(n - 1, next[1]))];
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${r}-${c}"]`)?.focus();
  };

  return (
    <div className="matrix-wrap">
      <div ref={grid} role="grid" aria-label="Correlation matrix (Pearson r)" className="matrix" style={{ gridTemplateColumns: `minmax(88px, 140px) repeat(${n}, minmax(44px, 1fr))` }}>
        <div role="row" className="matrix-row matrix-head">
          <span role="columnheader" className="matrix-corner" />
          {items.map((it) => (
            <span role="columnheader" key={it.key} className="matrix-col" title={it.label}>
              <span className="viz-key" style={{ background: it.color }} aria-hidden="true" />
              <span className="matrix-col-text">{it.label}</span>
            </span>
          ))}
        </div>
        {items.map((row, ri) => (
          <div role="row" className="matrix-row" key={row.key}>
            <span role="rowheader" className="matrix-rowhead" title={row.label}>
              <span className="viz-key" style={{ background: row.color }} aria-hidden="true" />
              {row.label}
            </span>
            {items.map((col, ci) => {
              const tab = ri === focusRow && ci === focusCol ? 0 : -1;
              if (ri === ci) {
                return (
                  <span role="gridcell" key={col.key}>
                    <button type="button" className="matrix-cell matrix-self" data-cell={`${ri}-${ci}`} tabIndex={tab} aria-label={`${row.label} with itself`} onKeyDown={(e) => move(e, ri, ci)} aria-disabled="true" />
                  </span>
                );
              }
              const p = byKey.get(pairKey(row.key, col.key));
              const fill = divergingColor(p?.r ?? null);
              const isSel = sel === pairKey(row.key, col.key);
              return (
                <span role="gridcell" key={col.key} aria-selected={isSel}>
                  <button
                    type="button"
                    className={isSel ? 'matrix-cell is-selected' : 'matrix-cell'}
                    data-cell={`${ri}-${ci}`}
                    tabIndex={tab}
                    style={{ background: fill, color: inkOn(fill) }}
                    aria-label={cellName(row, col, p, noun)}
                    aria-pressed={isSel}
                    title={p?.r === null ? (p.reason ?? undefined) : undefined}
                    onClick={() => onSelect(col.key, row.key)}
                    onKeyDown={(e) => move(e, ri, ci)}
                  >
                    {formatR(p?.r ?? null)}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="matrix-scale" aria-hidden="true">
        <span>−1</span>
        <span className="matrix-ramp" style={{ background: `linear-gradient(90deg, ${DIVERGING.negative}, ${DIVERGING.neutral}, ${DIVERGING.positive})` }} />
        <span>+1</span>
        <span className="matrix-scale-note">Orange moved in opposite directions, blue moved together. A dash means not enough data.</span>
      </div>
    </div>
  );
}
