import { afterEach, describe, expect, it, vi } from 'vitest';
import { axisDate, formatBucketDate, spanDays, tooltipDate } from './dates';

afterEach(() => vi.restoreAllMocks());

describe('formatBucketDate', () => {
  it('shows the given calendar date unchanged', () => {
    expect(formatBucketDate('2026-10-14')).toBe('Oct 14');
    expect(formatBucketDate('2026-01-01')).toBe('Jan 1');
    expect(formatBucketDate('2026-12-31')).toBe('Dec 31');
  });

  it('labels weeks as week of', () => {
    expect(formatBucketDate('2026-10-12', 'week')).toBe('Week of Oct 12');
  });

  it('falls back to an em dash for malformed input', () => {
    for (const bad of ['', 'nope', '2026-13-01', '2026-02-30', '2026-1-1', undefined as unknown as string]) {
      expect(formatBucketDate(bad)).toBe('—');
    }
  });

  it('does not depend on the browser time zone', () => {
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset');
    const local = vi.spyOn(Date.prototype, 'getDate');
    const localHours = vi.spyOn(Date.prototype, 'getHours');
    expect(formatBucketDate('2026-10-14')).toBe('Oct 14');
    expect(spy).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    expect(localHours).not.toHaveBeenCalled();
  });

  it('gives the same label under different TZ values', () => {
    const original = process.env.TZ;
    try {
      const out = ['Pacific/Honolulu', 'Pacific/Kiritimati', 'UTC'].map((tz) => {
        process.env.TZ = tz;
        return formatBucketDate('2026-10-14');
      });
      expect(out).toEqual(['Oct 14', 'Oct 14', 'Oct 14']);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('long-range labels', () => {
  it('adds the year once a range spans more than about six months', () => {
    expect(spanDays(['2025-10-29', '2026-10-28'])).toBe(364);
    expect(spanDays([])).toBe(0);
    expect(axisDate('2025-10-29', 364)).toBe('Oct 2025');
    expect(axisDate('2026-10-14', 30)).toBe('Oct 14');
    expect(tooltipDate('2025-10-29', 'day', 364)).toBe('Oct 29, 2025');
    expect(tooltipDate('2025-10-27', 'week', 364)).toBe('Week of Oct 27, 2025');
    expect(tooltipDate('2026-10-14', 'day', 30)).toBe('Oct 14');
    expect(axisDate('bad', 400)).toBe('—');
  });
});
