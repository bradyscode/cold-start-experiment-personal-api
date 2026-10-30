import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../theme/palette';
import {
  CARD,
  CATEGORY_HUES,
  DIVERGING,
  HEAT_COLORS,
  OTHER_COLOR,
  SLOT_COLORS,
  ageColor,
  categoryColor,
  categoryOf,
  divergingColor,
  heatLevel,
  inkOn,
  slotColor,
} from './colors';
import { activityStack, byRecentActivity, categoryShares, heatmapDays, mondayOf, rollup, weekday } from './derive';
import { compact, deltaOf, formatR, formatValue, relativeAge, unitFor, withUnit } from './format';
import { buildInsights, compareHref } from './insights';
import { normalize, shiftForLag } from './normalize';
import type { KindOverview } from './types';

export function kindOverview(over: Partial<KindOverview> = {}): KindOverview {
  return {
    kind: 'k',
    displayName: 'K',
    category: 'Health',
    agg: 'sum',
    unit: 'h',
    better: 'higher',
    value: 10,
    previousValue: 8,
    delta: 2,
    deltaPercent: 25,
    avgPerDay: 1,
    entries: 5,
    previousEntries: 4,
    activeDays: 5,
    best: { date: '2026-01-01', value: 3 },
    latest: { date: '2026-01-01', value: 3 },
    lastEntryAt: '2026-01-01T12:00:00Z',
    currentStreak: 0,
    longestStreak: 0,
    values: [],
    previousValues: [],
    counts: [],
    activity: [],
    ...over,
  };
}

describe('number formatting', () => {
  it('formats values, compacts big numbers and never shows NaN', () => {
    expect(formatValue(1234.56)).toBe('1,234.6');
    expect(formatValue(0.456)).toBe('0.46');
    expect(formatValue(null)).toBe('–');
    expect(formatValue(Number.NaN)).toBe('–');
    expect(compact(950)).toBe('950');
    expect(compact(9999)).toBe('9,999');
    expect(compact(12_900)).toBe('12.9K');
    expect(compact(4_200_000)).toBe('4.2M');
    expect(compact(-15_000)).toBe('-15K');
    expect(compact(Number.POSITIVE_INFINITY)).toBe('–');
  });

  it('labels counts in entries and never uses the kind unit for them', () => {
    expect(unitFor('count', 'pages', 1)).toBe('entry');
    expect(unitFor('count', 'pages', 3)).toBe('entries');
    expect(unitFor('avg', 'lb', 3)).toBe('lb');
    expect(withUnit(12, 'count', 'pages')).toBe('12 entries');
    expect(withUnit(null, 'sum', 'h')).toBe('–');
  });

  it('formats r with a true minus sign and two decimals', () => {
    expect(formatR(-0.4219)).toBe('−0.42');
    expect(formatR(0.5)).toBe('0.50');
    expect(formatR(null)).toBe('–');
  });

  it('describes last-entry age compactly', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    expect(relativeAge(null, now)).toBe('never');
    expect(relativeAge('2026-01-10T11:59:40Z', now)).toBe('just now');
    expect(relativeAge('2026-01-10T11:15:00Z', now)).toBe('45m ago');
    expect(relativeAge('2026-01-10T02:00:00Z', now)).toBe('10h ago');
    expect(relativeAge('2026-01-08T10:00:00Z', now)).toBe('2d ago');
    expect(relativeAge('2025-12-10T12:00:00Z', now)).toBe('4w ago');
    expect(relativeAge('2025-06-01T12:00:00Z', now)).toBe('7mo ago');
    expect(relativeAge('garbage', now)).toBe('never');
  });
});

describe('deltaOf', () => {
  const k = (over: Partial<KindOverview>) => kindOverview(over);

  it('words the delta as text, not just color', () => {
    expect(deltaOf(k({}), 30)).toEqual({ direction: 'up', tone: 'good', short: '25%', sentence: 'up 25 percent vs previous 30 days' });
    expect(deltaOf(k({ delta: -1, deltaPercent: -4.25 }), 7).sentence).toBe('down 4.3 percent vs previous 7 days');
    expect(deltaOf(k({}), 365).sentence).toBe('up 25 percent vs previous year');
  });

  it('uses the better direction for tone and stays neutral for none', () => {
    expect(deltaOf(k({ better: 'lower' }), 30).tone).toBe('bad');
    expect(deltaOf(k({ better: 'lower', delta: -2, deltaPercent: -20 }), 30).tone).toBe('good');
    expect(deltaOf(k({ better: 'none' }), 30).tone).toBe('neutral');
    expect(deltaOf(k({ better: null, delta: -2, deltaPercent: -20 }), 30).tone).toBe('bad');
  });

  it('handles new, flat and missing comparisons', () => {
    expect(deltaOf(k({ previousValue: 0, delta: 10, deltaPercent: null }), 30).direction).toBe('new');
    expect(deltaOf(k({ delta: 0, deltaPercent: 0 }), 30)).toMatchObject({ direction: 'flat', tone: 'neutral', short: '0%' });
    expect(deltaOf(k({ value: null, delta: null, deltaPercent: null }), 30)).toMatchObject({ direction: 'none', short: 'No comparison' });
  });
});

describe('colors', () => {
  it('every category, slot, heat and diverging pole color clears 3:1 on the card', () => {
    for (const c of [...CATEGORY_HUES, ...SLOT_COLORS, OTHER_COLOR, ...HEAT_COLORS.slice(1), DIVERGING.negative, DIVERGING.positive]) {
      expect(contrastRatio(c, CARD), c).toBeGreaterThanOrEqual(3);
    }
  });

  it('maps categories in a fixed order and unknown ones to Other', () => {
    expect(categoryColor('Health')).toBe(CATEGORY_HUES[0]);
    expect(categoryColor('Life')).toBe(CATEGORY_HUES[6]);
    expect(categoryColor('Garden')).toBe(OTHER_COLOR);
    expect(categoryColor(null)).toBe(OTHER_COLOR);
    expect(categoryOf(' Code ')).toBe('Code');
    expect(slotColor(9)).toBe(SLOT_COLORS[1]);
  });

  it('steps heat levels 1 to 4 and keeps zero empty', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
  });

  it('diverging cells are gray at zero, colored at the poles, and their numbers stay readable', () => {
    expect(divergingColor(0)).toBe(DIVERGING.neutral);
    expect(divergingColor(1)).toBe(DIVERGING.positive);
    expect(divergingColor(-1)).toBe(DIVERGING.negative);
    for (let r = -1; r <= 1.0001; r += 0.05) {
      const fill = divergingColor(r);
      expect(contrastRatio(inkOn(fill), fill), `r ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('aged scatter points stay at 3:1 or better', () => {
    for (const accent of SLOT_COLORS) {
      for (const age of [0, 0.25, 0.5, 0.75, 1]) expect(contrastRatio(ageColor(accent, age), CARD)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('normalize', () => {
  it('passes raw values through and drops non-finite ones', () => {
    expect(normalize([1, null, Number.NaN, 3], 'raw')).toEqual([1, null, null, 3]);
  });

  it('indexes to 100 at the first value that is at least 1% of the largest', () => {
    expect(normalize([0, 4, 2, null, 8], 'index')).toEqual([0, 100, 50, null, 200]);
    expect(normalize([0, 0], 'index')).toEqual([null, null]);
    expect(normalize([null, null], 'index')).toEqual([null, null]);
  });

  it('starts a negative series at 100 and moves up as it rises', () => {
    expect(normalize([-4, -2, 0, -8], 'index')).toEqual([100, 150, 200, 0]);
  });

  it('skips a tiny first value so the line does not explode', () => {
    const out = normalize([0.001, 10, 20], 'index');
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(200);
    expect(out[0]).toBeCloseTo(0.01, 10);
  });

  it('computes z-scores with the sample standard deviation', () => {
    const z = normalize([2, 4, 4, 4, 5, 5, 7, 9], 'z');
    const sd = Math.sqrt(32 / 7);
    expect(z[0]).toBeCloseTo((2 - 5) / sd, 10);
    expect(z[7]).toBeCloseTo((9 - 5) / sd, 10);
    expect(normalize([3, 3, null], 'z')).toEqual([0, 0, null]);
    expect(normalize([3], 'z')).toEqual([null]);
  });

  it('shifts b by the lag so a[i] pairs with b[i + lag]', () => {
    expect(shiftForLag([1, 2, 3, 4], 1)).toEqual([2, 3, 4, null]);
    expect(shiftForLag([1, 2, 3, 4], -2)).toEqual([null, null, 1, 2]);
  });
});

describe('derive', () => {
  it('finds weekdays and Mondays from date strings', () => {
    expect(weekday('2026-10-26')).toBe(0);
    expect(weekday('2026-11-01')).toBe(6);
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
  });

  it('rolls days into Monday weeks', () => {
    const r = rollup(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'], [1, 2, 3, 4], 'week');
    expect(r).toEqual({ dates: ['2026-10-19', '2026-10-26'], values: [3, 7] });
  });

  it('stacks entry counts by category in the fixed category order', () => {
    const kinds = [
      kindOverview({ kind: 'a', category: 'Code', counts: [1, 2] }),
      kindOverview({ kind: 'b', category: 'Health', counts: [0, 1] }),
      kindOverview({ kind: 'c', category: 'Code', counts: [3, 0] }),
    ];
    const s = activityStack(kinds, ['2026-10-26', '2026-10-27'], 30);
    expect(s.layers.map((l) => [l.key, l.values])).toEqual([
      ['Health', [0, 1]],
      ['Code', [4, 2]],
    ]);
    expect(s.dates).toEqual(['2026-10-26', '2026-10-27']);
    expect(activityStack(kinds, ['2026-10-26', '2026-10-27'], 365).bucket).toBe('week');
    const quiet = [...kinds, kindOverview({ kind: 'd', category: 'Life', counts: [0, 0] })];
    expect(activityStack(quiet, ['2026-10-26', '2026-10-27'], 30).layers.map((l) => l.key)).toEqual(['Health', 'Code']);
  });

  it('ranks category shares with percentages and the top kind', () => {
    const shares = categoryShares([
      kindOverview({ kind: 'a', displayName: 'A', category: 'Code', entries: 6 }),
      kindOverview({ kind: 'b', displayName: 'B', category: 'Health', entries: 2 }),
      kindOverview({ kind: 'c', displayName: 'C', category: 'Code', entries: 0 }),
      kindOverview({ kind: 'd', displayName: 'D', category: 'Life', entries: 0 }),
    ]);
    expect(shares.map((s) => [s.key, s.value, s.percent, s.top])).toEqual([
      ['Code', 6, 75, 'A'],
      ['Health', 2, 25, 'B'],
    ]);
  });

  it('sorts by most recent entry, never-logged last', () => {
    const sorted = byRecentActivity([
      kindOverview({ kind: 'old', lastEntryAt: '2026-01-01T00:00:00Z' }),
      kindOverview({ kind: 'never', lastEntryAt: null }),
      kindOverview({ kind: 'new', lastEntryAt: '2026-02-01T00:00:00Z' }),
    ]);
    expect(sorted.map((k) => k.kind)).toEqual(['new', 'old', 'never']);
  });

  it('places heatmap days on a Monday-first grid and reports the top kind', () => {
    const dates = ['2026-10-25', '2026-10-26', '2026-10-27'];
    const { days, max, columns } = heatmapDays(
      dates,
      [kindOverview({ kind: 'a', displayName: 'A', activity: [1, 0, 2] }), kindOverview({ kind: 'b', displayName: 'B', activity: [0, 3, 1] })],
      null,
    );
    expect(days.map((d) => [d.row, d.column, d.value, d.top])).toEqual([
      [6, 0, 1, 'A'],
      [0, 1, 3, 'B'],
      [1, 1, 3, 'A'],
    ]);
    expect(max).toBe(3);
    expect(columns).toBe(2);
    expect(heatmapDays(dates, [kindOverview({ kind: 'a', activity: [1, 0, 2] }), kindOverview({ kind: 'b', activity: [5, 5, 5] })], 'a').max).toBe(2);
  });
});

describe('buildInsights', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const kinds = [
    kindOverview({ kind: 'sleep', displayName: 'Sleep', deltaPercent: 12, previousEntries: 20, currentStreak: 9, lastEntryAt: '2026-01-10T06:00:00Z' }),
    kindOverview({ kind: 'commits', displayName: 'Commits', agg: 'count', deltaPercent: -30, previousEntries: 10, currentStreak: 2, lastEntryAt: '2026-01-09T06:00:00Z' }),
    kindOverview({ kind: 'golf', displayName: 'Golf', deltaPercent: 400, previousEntries: 1, lastEntryAt: '2025-12-20T06:00:00Z' }),
  ];

  const pair = (a: string, b: string, r: number | null, n: number) => ({ a, b, lag: 0, r, r2: r === null ? null : r * r, n, slope: 1, intercept: 0, reason: r === null ? 'no variation' : null });

  it('builds honest sentences with links', () => {
    const pairs = [pair('sleep', 'commits', 0.52, 30), pair('sleep', 'golf', null, 30), pair('commits', 'golf', 0.1, 30)];
    const list = buildInsights(kinds, pairs, 30, now);
    expect(list.map((i) => i.text)).toEqual([
      'Sleep and Commits may be related: they tended to move together (r 0.52 over 30 days). Strongest of 2 pairs checked.',
      'Sleep rose 12 percent vs the previous 30 days.',
      'Commits fell 30 percent vs the previous 30 days.',
      'Sleep is on a 9-day streak, the longest running right now.',
      'Golf is the quietest tracker: nothing logged for 21 days.',
    ]);
    expect(list[0]!.href).toBe(compareHref(['sleep', 'commits'], 30, ['sleep', 'commits']));
    expect(list[2]!.href).toBe('/chart/commits?bucket=day&agg=count&days=30');
    expect(list.every((i) => !/caus/i.test(i.text))).toBe(true);
  });

  it('says opposite directions for negative r', () => {
    const neg = buildInsights(kinds, [pair('sleep', 'commits', -0.61, 40)], 90, now);
    expect(neg[0]!.text).toBe('Sleep and Commits may be related: they tended to move in opposite directions (r −0.61 over 40 days). Strongest of 1 pair checked.');
  });

  it('needs at least 20 overlapping days and |r| of at least 0.5', () => {
    const has = (p: ReturnType<typeof pair>[], days = 30) => buildInsights(kinds, p, days, now).filter((i) => i.id.startsWith('correlation')).length;
    expect(has([pair('sleep', 'commits', 0.5, 20)])).toBe(1);
    expect(has([pair('sleep', 'commits', -0.5, 20)])).toBe(1);
    expect(has([pair('sleep', 'commits', 0.99, 19)])).toBe(0);
    expect(has([pair('sleep', 'commits', 0.4999, 60)])).toBe(0);
    expect(has([pair('sleep', 'commits', null, 60)])).toBe(0);
    expect(buildInsights(kinds, null, 30, now).some((i) => i.id.startsWith('correlation'))).toBe(false);
  });

  it('gives no correlation insight for ranges shorter than 20 days', () => {
    expect(buildInsights(kinds, [pair('sleep', 'commits', 0.9, 20)], 7, now).some((i) => i.id.startsWith('correlation'))).toBe(false);
  });

  it('shows at most the two strongest qualifying pairs and how many were checked', () => {
    const list = buildInsights(kinds, [pair('sleep', 'commits', 0.6, 30), pair('sleep', 'golf', -0.8, 30), pair('commits', 'golf', 0.55, 30), pair('golf', 'sleep', 0.2, 30)], 30, now);
    const corr = list.filter((i) => i.id.startsWith('correlation'));
    expect(corr.map((i) => i.text)).toEqual([
      'Sleep and Golf may be related: they tended to move in opposite directions (r −0.80 over 30 days). Strongest of 4 pairs checked.',
      'Sleep and Commits may be related: they tended to move together (r 0.60 over 30 days).',
    ]);
  });

  it('leaves failed trackers out of every insight', () => {
    const withFailed = [...kinds, kindOverview({ kind: 'big', displayName: 'Big', error: 'Too many records', deltaPercent: 900, previousEntries: 50, currentStreak: 99, lastEntryAt: '2025-01-01T00:00:00Z' })];
    expect(buildInsights(withFailed, [], 30, now).some((i) => i.text.includes('Big'))).toBe(false);
  });

  it('returns nothing for kinds without data', () => {
    const empty = [kindOverview({ deltaPercent: null, previousEntries: 0, lastEntryAt: null, currentStreak: 0 })];
    expect(buildInsights(empty, [], 30, now)).toEqual([]);
  });
});
