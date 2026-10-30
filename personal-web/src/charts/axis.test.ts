import { describe, expect, it } from 'vitest';
import { labelIndexes, niceTicks, scaleLinear } from './axis';

describe('niceTicks', () => {
  it('covers the data with round steps starting at zero', () => {
    expect(niceTicks([3, 17])).toEqual({ min: 0, max: 20, ticks: [0, 5, 10, 15, 20] });
    expect(niceTicks([0, 1234]).ticks).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks([0.2, 0.7]).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it('spans negative values such as z-scores', () => {
    const t = niceTicks([-2.3, 1.1]);
    expect(t.min).toBeLessThanOrEqual(-2.3);
    expect(t.max).toBeGreaterThanOrEqual(1.1);
    expect(t.ticks).toContain(0);
  });

  it('can leave zero out for values far from it', () => {
    const t = niceTicks([181, 186], 4, false);
    expect(t.min).toBeGreaterThan(100);
    expect(t.ticks[0]).toBe(t.min);
  });

  it('never returns NaN or an empty axis for empty, flat or odd input', () => {
    for (const input of [[], [null], [0, 0], [5, 5], [Number.NaN, Number.POSITIVE_INFINITY]]) {
      const t = niceTicks(input as (number | null)[]);
      expect(t.ticks.length).toBeGreaterThanOrEqual(2);
      expect(t.ticks.every(Number.isFinite)).toBe(true);
      expect(t.max).toBeGreaterThan(t.min);
    }
  });
});

describe('scaleLinear and labelIndexes', () => {
  it('maps the domain onto the range and guards a zero span', () => {
    const y = scaleLinear([0, 10], [100, 0]);
    expect(y(0)).toBe(100);
    expect(y(5)).toBe(50);
    expect(scaleLinear([3, 3], [0, 10])(3)).toBe(0);
  });

  it('spreads labels evenly and always ends on the last index', () => {
    expect(labelIndexes(30, 5)).toEqual([0, 7, 15, 22, 29]);
    expect(labelIndexes(3, 5)).toEqual([0, 1, 2]);
    expect(labelIndexes(0, 5)).toEqual([]);
  });
});
