import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './client';
import { ApiError } from './types';

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup() {
  return { api: createApi('http://api.test/') };
}

function headerOf(call: number, name: string): string | null {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return new Headers(init.headers).get(name);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createApi', () => {
  it('strips the trailing slash from the base url and sends no auth header', async () => {
    fetchMock.mockResolvedValue(json(200, []));
    const { api } = setup();
    await api.kinds();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/kinds');
    expect(headerOf(0, 'Authorization')).toBeNull();
  });

  it('rejects a 500 with a generic ApiError', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const { api } = setup();
    const err = (await api.feed().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  it('rejects 400 with the errors list', async () => {
    fetchMock.mockResolvedValue(json(400, { errors: ['Value must be a number', 'Title is required'] }));
    const { api } = setup();
    const err = (await api.createRecord({ kind: 'note' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.errors).toEqual(['Value must be a number', 'Title is required']);
  });

  it('keeps the API message for a 409 conflict and sends externalId', async () => {
    fetchMock.mockResolvedValue(json(409, { errors: ["externalId 'x' from source 'manual' is already used by a record of kind 'note'."] }));
    const { api } = setup();
    const err = (await api.createRecord({ kind: 'workout', externalId: 'x' }).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(409);
    expect(err.message).toBe("externalId 'x' from source 'manual' is already used by a record of kind 'note'.");
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ kind: 'workout', externalId: 'x' });
  });

  it('gives a readable message for other non-2xx responses', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const { api } = setup();
    const err = (await api.kinds().catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/500/);
  });

  it('turns a network failure into ApiError status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { api } = setup();
    const err = (await api.kinds().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe(
      "Can't reach the API. Check that it is running and that VITE_API_BASE_URL is correct.",
    );
  });

  it('builds the series query with from = now - days and to = now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
    fetchMock.mockResolvedValue(json(200, { kind: 'workout', bucket: 'day', agg: 'sum', unit: null, points: [] }));
    const { api } = setup();
    await api.series('workout', { days: 14, bucket: 'day', agg: 'sum' });
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/series/workout');
    expect(url.searchParams.get('to')).toBe('2026-10-27T12:00:00.000Z');
    expect(url.searchParams.get('from')).toBe('2026-10-13T12:00:00.000Z');
    expect(url.searchParams.get('bucket')).toBe('day');
    expect(url.searchParams.get('agg')).toBe('sum');
  });

  it('builds analytics queries and encodes kind keys', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, {})));
    const { api } = setup();
    await api.overview({ days: 90 });
    await api.overview({ days: 7, kinds: ['a b', 'c'] });
    await api.compare({ kinds: ['sleep', 'github_commit'], days: 30, bucket: 'week' });
    await api.pair({ a: 'sleep', b: 'mood', days: 365, bucket: 'day', lagMin: -7, lagMax: 7 });
    const urls = fetchMock.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls[0]!.pathname).toBe('/analytics/overview');
    expect(urls[0]!.search).toBe('?days=90');
    expect(urls[1]!.searchParams.get('kinds')).toBe('a b,c');
    expect(urls[2]!.pathname).toBe('/analytics/compare');
    expect(Object.fromEntries(urls[2]!.searchParams)).toEqual({ kinds: 'sleep,github_commit', days: '30', bucket: 'week' });
    expect(urls[3]!.pathname).toBe('/analytics/pair');
    expect(Object.fromEntries(urls[3]!.searchParams)).toEqual({ a: 'sleep', b: 'mood', days: '365', bucket: 'day', lagMin: '-7', lagMax: '7' });
  });

  it('passes the abort signal through for analytics calls', async () => {
    fetchMock.mockImplementation(abortableHang);
    const { api } = setup();
    const ctrl = new AbortController();
    const result = api.overview({ days: 30 }, { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort();
    expect(((await result) as DOMException).name).toBe('AbortError');
  });

  it('adds limit to the feed only when given', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, [])));
    const { api } = setup();
    await api.feed();
    await api.feed(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/feed');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://api.test/feed?limit=5');
  });

  it('posts JSON for createRecord', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, {})));
    const { api } = setup();
    await api.createRecord({ kind: 'workout', value: 3 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(headerOf(0, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'workout', value: 3 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/records');
  });

  it('turns an empty 200 body into ApiError', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const { api } = setup();
    const err = (await api.kinds().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(204);
    expect(err.message).toMatch(/something unexpected/);
  });

  it('turns an HTML 200 body into ApiError', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>proxy</html>', { status: 200 })));
    const { api } = setup();
    const err = (await api.feed().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/VITE_API_BASE_URL/);
  });

  it('turns a non-JSON 502 into ApiError, not SyntaxError', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })));
    const { api } = setup();
    const err = (await api.kinds().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/502/);
  });

  it('times out after 15 seconds with ApiError status 0', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(abortableHang);
    const { api } = setup();
    const result = api.kinds().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    const err = (await result) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe('The API took too long to respond. Check that it is running.');
  });

  it('rejects with the original AbortError on caller abort', async () => {
    fetchMock.mockImplementation(abortableHang);
    const { api } = setup();
    const ctrl = new AbortController();
    const result = api.feed(undefined, { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort();
    const err = await result;
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    fetchMock.mockImplementation(abortableHang);
    const { api } = setup();
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await api.kinds({ signal: ctrl.signal }).catch((e: unknown) => e);
    expect((err as DOMException).name).toBe('AbortError');
  });
});

function abortableHang(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal as AbortSignal;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason));
  });
}
