export type Normalization = 'raw' | 'index' | 'z';

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

// index: 100 at the base value, moving by percent of |base| (so a negative series also starts at 100 and rises
// when it rises); the base is the first value of at least 1% of the largest magnitude, so a tiny first value
// cannot blow the line up. z: (v - mean) / sample std dev. Null when the series cannot be scaled.
export function normalize(values: (number | null)[], mode: Normalization): (number | null)[] {
  if (mode === 'raw') return values.map((v) => (finite(v) ? v : null));
  if (mode === 'index') {
    const peak = Math.max(0, ...values.filter(finite).map(Math.abs));
    const base = values.find((v) => finite(v) && v !== 0 && Math.abs(v) >= peak * 0.01);
    if (!finite(base) || peak === 0) return values.map(() => null);
    return values.map((v) => (finite(v) ? 100 + (100 * (v - base)) / Math.abs(base) : null));
  }
  const nums = values.filter(finite);
  if (nums.length < 2) return values.map(() => null);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1));
  if (!(sd > 0) || !Number.isFinite(sd)) return values.map((v) => (finite(v) ? 0 : null));
  return values.map((v) => (finite(v) ? (v - mean) / sd : null));
}

export const NORMALIZATION_LABEL: Record<Normalization, string> = { raw: 'Raw', index: 'Index 100', z: 'Z-score' };

export function shiftForLag<T>(values: T[], lag: number): (T | null)[] {
  return values.map((_, i) => (i + lag >= 0 && i + lag < values.length ? values[i + lag]! : null));
}
