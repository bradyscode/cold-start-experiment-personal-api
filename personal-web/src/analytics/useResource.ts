import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiError } from '../api/types';

export type Resource<T> = {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
  // HTTP status of the last failure (0 for network errors), so callers can treat 404 differently.
  errorStatus: number | null;
  // True while a newer request runs and older data is still shown.
  refreshing: boolean;
  loadedAt: number | null;
  reload: () => void;
};

type Inner<T> = Omit<Resource<T>, 'reload'>;

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

// Each run owns an AbortController; cleanup aborts it, so a stale response can never overwrite a newer one.
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList, fallbackError: string): Resource<T> {
  const [state, setState] = useState<Inner<T>>({ status: 'loading', data: null, error: null, errorStatus: null, refreshing: false, loadedAt: null });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastAttempt = useRef(attempt);

  // A reload keeps the old data on screen (dimmed); new inputs clear it, so old numbers never sit under new labels.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const isReload = lastAttempt.current !== attempt;
    lastAttempt.current = attempt;
    setState((s) =>
      isReload && s.data !== null
        ? { ...s, refreshing: true, error: null }
        : { status: 'loading', data: null, error: null, errorStatus: null, refreshing: false, loadedAt: s.loadedAt },
    );
    loadRef.current(signal).then(
      (data) => {
        if (signal.aborted) return;
        setState({ status: 'ready', data, error: null, errorStatus: null, refreshing: false, loadedAt: Date.now() });
      },
      (e: unknown) => {
        if (signal.aborted) return;
        setState((s) => ({ ...s, status: 'error', error: errorMessage(e, fallbackError), errorStatus: e instanceof ApiError ? e.status : null, refreshing: false }));
      },
    );
    return () => controller.abort();
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
