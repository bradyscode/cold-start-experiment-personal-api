import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

// Measures the container so SVG text renders at its real pixel size instead of being scaled with a viewBox.
export function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export type TipRow = { key: string; color: string; label: string; value: string; mark?: 'line' | 'box' };

export function Tooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: TipRow[] }) {
  const flip = x > width * 0.6;
  return (
    <div className="viz-tip" style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y) }} aria-hidden="true">
      <div className="viz-tip-title">{title}</div>
      {rows.map((r) => (
        <div className="viz-tip-row" key={r.key}>
          <span className={r.mark === 'box' ? 'viz-key viz-key-box' : 'viz-key'} style={{ background: r.color }} />
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export type LegendItem = { key: string; label: string; color: string; detail?: string };

// Toggle buttons: the swatch carries identity, the label and aria-pressed carry state.
export function Legend({
  items,
  hidden,
  onToggle,
  mark = 'box',
  label,
}: {
  items: LegendItem[];
  hidden: ReadonlySet<string>;
  onToggle?: (key: string) => void;
  mark?: 'box' | 'line';
  label: string;
}) {
  return (
    <ul className="viz-legend" aria-label={label}>
      {items.map((it) => {
        const off = hidden.has(it.key);
        const body = (
          <>
            <span className={mark === 'line' ? 'viz-key' : 'viz-key viz-key-box'} style={{ background: off ? 'transparent' : it.color, borderColor: it.color }} />
            <span>{it.label}</span>
            {it.detail && <span className="viz-legend-detail">{it.detail}</span>}
          </>
        );
        return (
          <li key={it.key}>
            {onToggle ? (
              <button type="button" className="viz-legend-btn" aria-pressed={!off} onClick={() => onToggle(it.key)}>
                {body}
              </button>
            ) : (
              <span className="viz-legend-btn viz-legend-static">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Hidden by default; rendering the rows only when opened keeps big ranges light on DOM nodes.
export function DataTableToggle({ caption, head, rows }: { caption: string; head: string[]; rows: () => ReactNode[][] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="viz-data" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Show data table</summary>
      {open && (
        <div className="viz-data-scroll">
          <table className="dense-table">
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows().map((cells, i) => (
                <tr key={i}>
                  {cells.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
