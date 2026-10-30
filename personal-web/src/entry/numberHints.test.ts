import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../api/types';
import { numberError, numberHint } from './numberHints';

const num = (extra: Partial<FieldDef> = {}): FieldDef => ({ name: 'n', type: 'Number', required: false, ...extra });

describe('numberHint', () => {
  it.each([
    [{ min: 1, max: 5, integer: true }, 'Whole number, 1 to 5'],
    [{ min: 0, max: 24 }, '0 to 24'],
    [{ min: 0 }, 'At least 0'],
    [{ max: 10 }, 'At most 10'],
    [{ min: 0, integer: true }, 'Whole number, at least 0'],
    [{ integer: true }, 'Whole number'],
    [{ min: 0.5, max: 2.5 }, '0.5 to 2.5'],
    [{}, null],
  ] as [Partial<FieldDef>, string | null][])('%o -> %s', (extra, hint) => {
    expect(numberHint(num(extra))).toBe(hint);
  });

  it('is null for non-number fields even with bounds', () => {
    expect(numberHint({ name: 't', type: 'Text', required: false, min: 1 })).toBeNull();
  });
});

describe('numberError', () => {
  const rating = num({ min: 1, max: 5, integer: true });

  it('accepts values on the bounds and rejects one step outside', () => {
    expect(numberError(rating, 'R', 1)).toBeNull();
    expect(numberError(rating, 'R', 5)).toBeNull();
    expect(numberError(rating, 'R', 0)).toBe('R must be at least 1');
    expect(numberError(rating, 'R', 6)).toBe('R must be at most 5');
    expect(numberError(rating, 'R', 2.5)).toBe('R must be a whole number');
  });

  it('applies the trillion bound at exactly the limit and just above, both signs', () => {
    expect(numberError(num(), 'N', 1e12)).toBeNull();
    expect(numberError(num(), 'N', -1e12)).toBeNull();
    const msg = 'N must be between -1,000,000,000,000 and 1,000,000,000,000';
    expect(numberError(num(), 'N', 1e12 + 1)).toBe(msg);
    expect(numberError(num(), 'N', -1e12 - 1)).toBe(msg);
    expect(numberError(num({ max: 1e15 }), 'N', 1e13)).toBe(msg);
  });
});
