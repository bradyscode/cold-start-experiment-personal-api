import type { Bucket } from '../api/types';

const FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Labels come from the API's local date string; no time zone math, so the date shows unchanged anywhere.
export function formatBucketDate(date: string, bucket: Bucket = 'day'): string {
  const m = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return '—';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return '—';
  const text = FORMAT.format(utc);
  return bucket === 'week' ? `Week of ${text}` : text;
}

const WITH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const LONG_SPAN_DAYS = 180;

function utcOf(date: string): Date | null {
  const m = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() === Number(m[3]) ? d : null;
}

// Days from the first to the last date string; long spans get the year in their labels.
export function spanDays(dates: string[]): number {
  const a = utcOf(dates[0] ?? '');
  const b = utcOf(dates[dates.length - 1] ?? '');
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : 0;
}

export function axisDate(date: string, span: number): string {
  if (span <= LONG_SPAN_DAYS) return formatBucketDate(date);
  const d = utcOf(date);
  return d ? MONTH_YEAR.format(d) : '—';
}

export function tooltipDate(date: string, bucket: Bucket, span: number): string {
  if (span <= LONG_SPAN_DAYS) return formatBucketDate(date, bucket);
  const d = utcOf(date);
  if (!d) return '—';
  return bucket === 'week' ? `Week of ${WITH_YEAR.format(d)}` : WITH_YEAR.format(d);
}
