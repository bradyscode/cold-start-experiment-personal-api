import { Component, useId, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type PanelState = { kind: 'loading' } | { kind: 'error'; message: string; onRetry: () => void } | { kind: 'empty'; message: string } | { kind: 'ready' };

type PanelProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  state: PanelState;
  className?: string;
  children?: ReactNode;
  dim?: boolean;
};

class Boundary extends Component<{ children: ReactNode; title: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`Panel "${this.props.title}" failed to render`, error, info.componentStack);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="panel-state">
          <p role="alert">This panel could not be drawn.</p>
          <button type="button" className="btn btn-small" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Every panel owns its loading, error and empty states so one failure never blanks the page.
export function Panel({ title, subtitle, actions, state, className, children, dim }: PanelProps) {
  const id = useId();
  return (
    <section className={`panel${className ? ` ${className}` : ''}`} aria-labelledby={id} aria-busy={state.kind === 'loading' || dim ? true : undefined}>
      <header className="panel-head">
        <div className="panel-titles">
          <h2 id={id} className="panel-title">
            {title}
          </h2>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className={dim ? 'panel-body is-dim' : 'panel-body'}>
        {state.kind === 'loading' && <Skeleton label={`Loading ${title.toLowerCase()}`} />}
        {state.kind === 'error' && (
          <div className="panel-state">
            <p role="alert">{state.message}</p>
            <button type="button" className="btn btn-small" onClick={state.onRetry}>
              Try again
            </button>
          </div>
        )}
        {state.kind === 'empty' && (
          <div className="panel-state">
            <p>{state.message}</p>
            <Link className="btn btn-small btn-primary btn-link" to="/add">
              Add a record
            </Link>
          </div>
        )}
        {state.kind === 'ready' && <Boundary title={title}>{children}</Boundary>}
      </div>
    </section>
  );
}

export function Skeleton({ label, lines = 4 }: { label: string; lines?: number }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-bar" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export type Option<T extends string> = { value: T; label: string; title?: string };

// Native radios inside give arrow-key movement and a single tab stop for free.
export function Segmented<T extends string>({ legend, options, value, onChange }: { legend: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="seg">
      <legend className="visually-hidden">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={o.value === value ? 'seg-opt is-on' : 'seg-opt'} title={o.title}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} className="visually-hidden" />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the choice then lasts for this visit only.
  }
}
