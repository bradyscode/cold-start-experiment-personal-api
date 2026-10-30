const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const base = 10 ** Math.floor(Math.log10(raw));
  const f = raw / base;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * base;
}

export type Ticks = { min: number; max: number; ticks: number[] };

// Clean round ticks that cover the data; zero is included for non-negative data so bars and counts start at a baseline.
export function niceTicks(values: (number | null)[], count = 4, includeZero = true): Ticks {
  const nums = values.filter(finite);
  let lo = nums.length ? Math.min(...nums) : 0;
  let hi = nums.length ? Math.max(...nums) : 1;
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi === lo) {
    hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.5;
    lo = includeZero ? Math.min(0, lo) : lo - Math.abs(lo) * 0.5;
  }
  const step = niceStep(hi - lo, count);
  if (!finite(step) || step <= 0) return { min: 0, max: 1, ticks: [0, 1] };
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2 && ticks.length < 20; t += step) ticks.push(Number(t.toPrecision(12)));
  return { min, max, ticks };
}

export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (v) => (span === 0 || !Number.isFinite(v) ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

// Picks about `count` evenly spaced indexes for x-axis labels, always including the last.
export function labelIndexes(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (count - 1);
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(Math.round(i * step));
  return [...out];
}
