import type { FieldDef } from '../api/types';

export const MAX_NUMBER = 1e12;
export const OUT_OF_RANGE = 'between -1,000,000,000,000 and 1,000,000,000,000';

const fmt = (n: number) => String(n);

// Short hint shown under a Number input, or null when the field has no bounds.
export function numberHint(f: FieldDef): string | null {
  if (f.type !== 'Number') return null;
  const min = f.min ?? null;
  const max = f.max ?? null;
  const whole = f.integer === true;
  let range: string | null = null;
  if (min !== null && max !== null) range = `${fmt(min)} to ${fmt(max)}`;
  else if (min !== null) range = `${whole ? 'at' : 'At'} least ${fmt(min)}`;
  else if (max !== null) range = `${whole ? 'at' : 'At'} most ${fmt(max)}`;
  if (whole) return range ? `Whole number, ${range}` : 'Whole number';
  return range;
}

// Mirrors the server checks for a parsed number; returns the message or null.
export function numberError(f: FieldDef, label: string, n: number): string | null {
  if (Math.abs(n) > MAX_NUMBER) return `${label} must be ${OUT_OF_RANGE}`;
  if (f.integer === true && !Number.isInteger(n)) return `${label} must be a whole number`;
  if (f.min != null && n < f.min) return `${label} must be at least ${fmt(f.min)}`;
  if (f.max != null && n > f.max) return `${label} must be at most ${fmt(f.max)}`;
  return null;
}
