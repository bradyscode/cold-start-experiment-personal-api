import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

function parts(values: (number | null)[]) {
  const { container } = render(<Sparkline values={values} color="#fff" />);
  const path = container.querySelector('path')?.getAttribute('d') ?? '';
  return { container, path, dots: container.querySelectorAll('circle') };
}

describe('Sparkline', () => {
  it('is decorative', () => {
    const { container } = parts([1, 2]);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a line for several points', () => {
    const { path } = parts([1, 3, 2]);
    expect(path.match(/M/g)).toHaveLength(1);
    expect(path.match(/L/g)).toHaveLength(2);
  });

  it('renders a single point as a dot', () => {
    const { path, dots, container } = parts([5]);
    expect(dots).toHaveLength(1);
    expect(path).toBe('');
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('renders all-equal values as a flat line without NaN', () => {
    const { path } = parts([4, 4, 4]);
    expect(path).not.toMatch(/NaN|Infinity/);
    const ys = [...path.matchAll(/[ML]\s*[\d.]+[ ,]([\d.]+)/g)].map((m) => m[1]);
    expect(new Set(ys).size).toBe(1);
    expect(ys).toHaveLength(3);
  });

  it('breaks the line at a middle null', () => {
    const { path } = parts([1, 2, null, 3, 4]);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toMatch(/NaN/);
  });

  it('handles leading and trailing nulls and isolated points', () => {
    const lead = parts([null, null, 1, 2]);
    expect(lead.path.match(/M/g)).toHaveLength(1);
    const trail = parts([1, 2, null]);
    expect(trail.path.match(/M/g)).toHaveLength(1);
    const iso = parts([1, null, 2, null, 3, 4]);
    expect(iso.dots).toHaveLength(2);
    expect(iso.path).not.toMatch(/NaN/);
  });

  it('renders nothing harmful for empty, all-null and huge values', () => {
    for (const v of [[], [null, null], [1e300, 2e300], [Number.NaN, 1]] as (number | null)[][]) {
      const { container } = render(<Sparkline values={v} color="#fff" />);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    }
  });
});
