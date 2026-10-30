import type { Bucket } from '../api/types';
import { formatR } from '../analytics/format';
import type { Normalization } from '../analytics/normalize';

export const COMPARE_RANGES = [30, 90, 365] as const;
export type CompareRange = (typeof COMPARE_RANGES)[number];
export const MAX_COMPARE = 8;
export const MAX_LAG = 7;

export type CompareState = {
  kinds: string[];
  range: CompareRange;
  bucket: Bucket;
  norm: Normalization;
  lag: number;
  pair: [string, string] | null;
};

const DEFAULTS = { range: 90 as CompareRange, bucket: 'day' as Bucket, norm: 'index' as Normalization, lag: 0 };

function list(raw: string | null): string[] {
  return [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
}

export function parseCompare(q: URLSearchParams): CompareState {
  const kinds = list(q.get('kinds')).slice(0, MAX_COMPARE);
  const rangeNum = Number(q.get('range'));
  const range = (COMPARE_RANGES as readonly number[]).includes(rangeNum) ? (rangeNum as CompareRange) : DEFAULTS.range;
  const bucket: Bucket = q.get('bucket') === 'week' ? 'week' : 'day';
  const normRaw = q.get('norm');
  const norm: Normalization = normRaw === 'raw' || normRaw === 'z' || normRaw === 'index' ? normRaw : DEFAULTS.norm;
  const lagRaw = q.get('lag') ?? '';
  const lagNum = /^-?\d+$/.test(lagRaw) ? Number(lagRaw) : 0;
  const lag = Math.abs(lagNum) <= MAX_LAG ? lagNum : 0;
  const p = list(q.get('pair'));
  const pairOk = p.length === 2 && kinds.includes(p[0]!) && kinds.includes(p[1]!);
  const pair: [string, string] | null = pairOk ? [p[0]!, p[1]!] : kinds.length >= 2 ? [kinds[0]!, kinds[1]!] : null;
  return { kinds, range, bucket, norm, lag, pair };
}

export function serializeCompare(s: CompareState): string {
  const q = new URLSearchParams();
  if (s.kinds.length) q.set('kinds', s.kinds.join(','));
  if (s.range !== DEFAULTS.range) q.set('range', String(s.range));
  if (s.bucket !== DEFAULTS.bucket) q.set('bucket', s.bucket);
  if (s.norm !== DEFAULTS.norm) q.set('norm', s.norm);
  if (s.lag !== DEFAULTS.lag) q.set('lag', String(s.lag));
  const defaultPair = s.kinds.length >= 2 ? `${s.kinds[0]},${s.kinds[1]}` : '';
  if (s.pair && s.pair.join(',') !== defaultPair) q.set('pair', s.pair.join(','));
  return q.toString();
}

export const MIN_LAG_R = 0.3;
export const MIN_LAG_N = 20;

const units = (n: number, bucket: Bucket) => `${n} ${bucket}${Math.abs(n) === 1 ? '' : 's'}`;

// Lag L pairs a on one bucket with b L buckets later, so a positive L means b follows a.
// With many lags tried the best one always looks good, so a weak or small result is reported as nothing standing out.
export function lagSentence(a: string, b: string, best: { lag: number; r: number | null; n: number } | null, bucket: Bucket, tried: number): string {
  if (!best || best.r === null) return 'No lag gives enough overlapping data to compare.';
  const { lag, r, n } = best;
  if (Math.abs(r) < MIN_LAG_R || n < MIN_LAG_N) {
    const at = lag === 0 ? units(0, bucket) : `${lag > 0 ? '+' : '−'}${units(Math.abs(lag), bucket)}`;
    return `No lag stands out (strongest: r ${formatR(r)} at ${at}).`;
  }
  const rText = `(r ${formatR(r)} over ${units(n, bucket)}, strongest of ${tried} lags tried)`;
  if (lag === 0) return `${a} and ${b} line up best on the same ${bucket} ${rText}.`;
  const [lead, follow] = lag > 0 ? [a, b] : [b, a];
  return `${follow} tends to ${r > 0 ? 'rise' : 'fall'} ${units(Math.abs(lag), bucket)} after ${lead} rises ${rText}.`;
}
