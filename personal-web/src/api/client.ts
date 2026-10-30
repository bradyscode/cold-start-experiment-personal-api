import {
  ApiError,
  type Agg,
  type Bucket,
  type FeedCard,
  type Kind,
  type LifeRecord,
  type Series,
} from './types';
import type { Compare, Overview, PairDetail } from '../analytics/types';

const NETWORK_MESSAGE = "Can't reach the API. Check that it is running and that VITE_API_BASE_URL is correct.";
const DAY_MS = 24 * 60 * 60 * 1000;

const UNEXPECTED_MESSAGE = 'The API returned something unexpected. Check that VITE_API_BASE_URL points at the API.';
const TIMEOUT_MESSAGE = 'The API took too long to respond. Check that it is running.';
const TIMEOUT_MS = 15_000;

export type RequestOptions = { signal?: AbortSignal };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createApi(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(
    path: string,
    init?: { method: 'POST'; body?: unknown },
    opts?: RequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const caller = opts?.signal;
    const onCallerAbort = () => controller.abort(caller?.reason);
    if (caller?.aborted) onCallerAbort();
    else caller?.addEventListener('abort', onCallerAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);

    let res: Response;
    let text: string;
    try {
      res = await fetch(`${base}${path}`, {
        method: init?.method ?? 'GET',
        headers,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      text = await res.text();
    } catch (e) {
      if (caller?.aborted) throw e;
      if (timedOut) throw new ApiError(0, TIMEOUT_MESSAGE);
      throw new ApiError(0, NETWORK_MESSAGE);
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    }

    if (res.ok) {
      const parsed = parseJson(text);
      if (parsed === undefined) throw new ApiError(res.status, UNEXPECTED_MESSAGE);
      return parsed as T;
    }

    const errors = readErrors(text);
    if (res.status === 400 || res.status === 409) {
      throw new ApiError(res.status, errors.join(' ') || 'The API rejected the request.', errors);
    }
    throw new ApiError(res.status, `The API returned an error (${res.status}). Try again in a moment.`, errors);
  }

  return {
    feed(limit?: number, opts?: RequestOptions): Promise<FeedCard[]> {
      return request(limit === undefined ? '/feed' : `/feed?limit=${limit}`, undefined, opts);
    },
    async series(
      kind: string,
      opts: { days: number; bucket: Bucket; agg: Agg },
      reqOpts?: RequestOptions,
    ): Promise<Series> {
      const to = new Date();
      const from = new Date(to.getTime() - opts.days * DAY_MS);
      const q = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        bucket: opts.bucket,
        agg: opts.agg,
      });
      return await request(`/series/${encodeURIComponent(kind)}?${q.toString()}`, undefined, reqOpts);
    },
    overview(opts: { days: number; kinds?: string[] }, reqOpts?: RequestOptions): Promise<Overview> {
      const q = new URLSearchParams({ days: String(opts.days) });
      if (opts.kinds?.length) q.set('kinds', opts.kinds.join(','));
      return request(`/analytics/overview?${q.toString()}`, undefined, reqOpts);
    },
    compare(opts: { kinds: string[]; days: number; bucket: Bucket }, reqOpts?: RequestOptions): Promise<Compare> {
      const q = new URLSearchParams({ kinds: opts.kinds.join(','), days: String(opts.days), bucket: opts.bucket });
      return request(`/analytics/compare?${q.toString()}`, undefined, reqOpts);
    },
    pair(
      opts: { a: string; b: string; days: number; bucket: Bucket; lagMin: number; lagMax: number },
      reqOpts?: RequestOptions,
    ): Promise<PairDetail> {
      const q = new URLSearchParams({
        a: opts.a,
        b: opts.b,
        days: String(opts.days),
        bucket: opts.bucket,
        lagMin: String(opts.lagMin),
        lagMax: String(opts.lagMax),
      });
      return request(`/analytics/pair?${q.toString()}`, undefined, reqOpts);
    },
    kinds(opts?: RequestOptions): Promise<Kind[]> {
      return request('/kinds', undefined, opts);
    },
    createRecord(
      input: {
        kind: string;
        occurredAt?: string;
        value?: number;
        title?: string;
        externalId?: string;
        data?: Record<string, unknown>;
      },
      opts?: RequestOptions,
    ): Promise<LifeRecord> {
      return request('/records', { method: 'POST', body: input }, opts);
    },
  };
}

function readErrors(text: string): string[] {
  const body = parseJson(text) as { errors?: unknown } | null | undefined;
  const errors = body?.errors;
  return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === 'string') : [];
}
