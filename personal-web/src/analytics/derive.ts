import type { Bucket } from '../api/types';
import { categoryColor, categoryOf, categoryRank } from './colors';
import type { KindOverview } from './types';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Calendar math on the API's local date strings only; UTC here is a neutral calendar, not a time zone conversion.
export function parseDate(date: string): Date | null {
  const m = DATE.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() === Number(m[3]) ? d : null;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 0 = Monday ... 6 = Sunday.
export function weekday(date: string): number {
  const d = parseDate(date);
  return d ? (d.getUTCDay() + 6) % 7 : 0;
}

export function mondayOf(date: string): string {
  const d = parseDate(date);
  if (!d) return date;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return toDateString(d);
}

export type Layer = { key: string; label: string; color: string; values: number[] };
export type Stack = { dates: string[]; bucket: Bucket; layers: Layer[] };

// Long ranges roll days up into Monday weeks so the chart keeps about 50 columns.
export function bucketFor(days: number): Bucket {
  return days > 90 ? 'week' : 'day';
}

export function rollup(dates: string[], values: number[], bucket: Bucket): { dates: string[]; values: number[] } {
  if (bucket === 'day') return { dates, values };
  const out: { dates: string[]; values: number[] } = { dates: [], values: [] };
  dates.forEach((d, i) => {
    const w = mondayOf(d);
    if (out.dates[out.dates.length - 1] !== w) {
      out.dates.push(w);
      out.values.push(0);
    }
    out.values[out.values.length - 1]! += values[i] ?? 0;
  });
  return out;
}

export function groupByCategory<T extends { category: string | null }>(items: T[]): { category: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const c = categoryOf(item.category);
    map.set(c, [...(map.get(c) ?? []), item]);
  }
  return [...map.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0])).map(([category, list]) => ({ category, items: list }));
}

export function activityStack(kinds: KindOverview[], dates: string[], days: number): Stack {
  const bucket = bucketFor(days);
  const layers = groupByCategory(kinds).map(({ category, items }) => {
    const daily = dates.map((_, i) => items.reduce((sum, k) => sum + (k.counts[i] ?? 0), 0));
    const rolled = rollup(dates, daily, bucket);
    return { key: category, label: category, color: categoryColor(category), values: rolled.values };
  }).filter((l) => l.values.some((v) => v !== 0));
  return { dates: rollup(dates, dates.map(() => 0), bucket).dates, bucket, layers };
}

export type Share = { key: string; label: string; color: string; value: number; percent: number; top: string | null };

export function categoryShares(kinds: KindOverview[]): Share[] {
  const groups = groupByCategory(kinds).map(({ category, items }) => {
    const sorted = [...items].sort((a, b) => b.entries - a.entries);
    return {
      key: category,
      label: category,
      color: categoryColor(category),
      value: items.reduce((s, k) => s + k.entries, 0),
      top: sorted[0] && sorted[0].entries > 0 ? sorted[0].displayName : null,
    };
  });
  const total = groups.reduce((s, g) => s + g.value, 0);
  return groups
    .filter((g) => g.value > 0)
    .map((g) => ({ ...g, percent: total > 0 ? (g.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

// Most recently active first; kinds never logged sink to the end in name order.
export function byRecentActivity(kinds: KindOverview[]): KindOverview[] {
  return [...kinds].sort((a, b) => {
    const ta = a.lastEntryAt ? Date.parse(a.lastEntryAt) : -Infinity;
    const tb = b.lastEntryAt ? Date.parse(b.lastEntryAt) : -Infinity;
    if (tb !== ta) return tb - ta;
    if (b.entries !== a.entries) return b.entries - a.entries;
    return a.displayName.localeCompare(b.displayName);
  });
}

export type HeatDay = { date: string; value: number; top: string | null; column: number; row: number };

export function heatmapDays(dates: string[], kinds: KindOverview[], focus: string | null): { days: HeatDay[]; max: number; columns: number } {
  const offset = dates.length ? weekday(dates[0]!) : 0;
  const pool = focus ? kinds.filter((k) => k.kind === focus) : kinds;
  let max = 0;
  const days = dates.map((date, i) => {
    let value = 0;
    let top: string | null = null;
    let topValue = 0;
    for (const k of pool) {
      const c = k.activity[i] ?? 0;
      value += c;
      if (c > topValue) {
        topValue = c;
        top = k.displayName;
      }
    }
    max = Math.max(max, value);
    const slot = offset + i;
    return { date, value, top, column: Math.floor(slot / 7), row: slot % 7 };
  });
  return { days, max, columns: Math.ceil((offset + dates.length) / 7) };
}
