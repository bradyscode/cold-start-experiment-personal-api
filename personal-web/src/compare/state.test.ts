import { describe, expect, it } from 'vitest';
import { lagSentence, parseCompare, serializeCompare } from './state';

const q = (s: string) => new URLSearchParams(s);

describe('parseCompare', () => {
  it('reads every control from the query string', () => {
    expect(parseCompare(q('kinds=sleep,steps,mood&range=90&bucket=week&norm=z&lag=-3&pair=steps,sleep'))).toEqual({
      kinds: ['sleep', 'steps', 'mood'],
      range: 90,
      bucket: 'week',
      norm: 'z',
      lag: -3,
      pair: ['steps', 'sleep'],
    });
  });

  it('falls back to safe defaults for missing or bad values', () => {
    expect(parseCompare(q('range=12&bucket=month&norm=log&lag=99&pair=a'))).toEqual({
      kinds: [],
      range: 90,
      bucket: 'day',
      norm: 'index',
      lag: 0,
      pair: null,
    });
    expect(parseCompare(q('lag=1.5')).lag).toBe(0);
    expect(parseCompare(q('lag=-7')).lag).toBe(-7);
  });

  it('dedupes kinds, keeps at most 8 and replaces a pair that is not selected with the first two', () => {
    const s = parseCompare(q('kinds=a,b,a,,c,d,e,f,g,h,i&pair=a,z'));
    expect(s.kinds).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(s.pair).toEqual(['a', 'b']);
    expect(parseCompare(q('kinds=a,b&pair=b,b')).pair).toEqual(['a', 'b']);
    expect(parseCompare(q('kinds=a&pair=a,b')).pair).toBeNull();
  });

  it('defaults the pair to the first two kinds', () => {
    expect(parseCompare(q('kinds=x,y,z')).pair).toEqual(['x', 'y']);
  });
});

describe('serializeCompare', () => {
  it('round-trips and omits defaults so links stay short', () => {
    const state = { kinds: ['sleep', 'mood'], range: 90 as const, bucket: 'day' as const, norm: 'index' as const, lag: 0, pair: ['sleep', 'mood'] as [string, string] };
    expect(serializeCompare(state)).toBe('kinds=sleep%2Cmood');
    const full = { ...state, range: 365 as const, bucket: 'week' as const, norm: 'raw' as const, lag: 2, pair: ['mood', 'sleep'] as [string, string] };
    expect(parseCompare(q(serializeCompare(full)))).toEqual(full);
  });
});

describe('lagSentence', () => {
  const best = (lag: number, r: number, n: number) => ({ lag, r, n });

  it('describes a clear best lag, its sample and how many lags were tried, without claiming cause', () => {
    expect(lagSentence('Sleep', 'Commits', best(1, 0.31, 25), 'day', 15)).toBe('Commits tends to rise 1 day after Sleep rises (r 0.31 over 25 days, strongest of 15 lags tried).');
    expect(lagSentence('Sleep', 'Commits', best(3, -0.4, 40), 'day', 15)).toBe('Commits tends to fall 3 days after Sleep rises (r −0.40 over 40 days, strongest of 15 lags tried).');
    expect(lagSentence('Sleep', 'Commits', best(-2, 0.5, 20), 'week', 15)).toBe('Sleep tends to rise 2 weeks after Commits rises (r 0.50 over 20 weeks, strongest of 15 lags tried).');
    expect(lagSentence('Sleep', 'Commits', best(0, 0.5, 30), 'day', 15)).toBe('Sleep and Commits line up best on the same day (r 0.50 over 30 days, strongest of 15 lags tried).');
  });

  it('says no lag stands out when r is under 0.3 or n is under 20', () => {
    expect(lagSentence('Sleep', 'Commits', best(3, 0.21, 60), 'day', 15)).toBe('No lag stands out (strongest: r 0.21 at +3 days).');
    expect(lagSentence('Sleep', 'Commits', best(-1, -0.299, 60), 'day', 15)).toBe('No lag stands out (strongest: r −0.30 at −1 day).');
    expect(lagSentence('Sleep', 'Commits', best(2, 0.9, 19), 'week', 15)).toBe('No lag stands out (strongest: r 0.90 at +2 weeks).');
    expect(lagSentence('Sleep', 'Commits', best(0, 0.1, 50), 'day', 15)).toBe('No lag stands out (strongest: r 0.10 at 0 days).');
    expect(lagSentence('Sleep', 'Commits', best(1, 0.3, 20), 'day', 15)).toMatch(/^Commits tends to rise/);
    expect(lagSentence('Sleep', 'Commits', best(1, -0.3, 20), 'day', 15)).toMatch(/^Commits tends to fall/);
  });

  it('handles no usable lag at all', () => {
    expect(lagSentence('Sleep', 'Commits', null, 'day', 15)).toBe('No lag gives enough overlapping data to compare.');
  });
});
