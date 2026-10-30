import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeChart, type TimeSeries } from './TimeChart';

const fmt = (_k: string, v: number | null) => (v === null ? 'none' : String(v));

function draw(series: TimeSeries[], mode: 'stack' | 'line' = 'stack', dates = ['2026-10-26', '2026-10-27']) {
  return render(<TimeChart dates={dates} bucket="day" series={series} mode={mode} label="Test chart" yLabel="units" formatValue={fmt} />);
}

describe('Scatter fit line', () => {
  it('keeps the true slope and clips the line to the plot instead of flattening it', async () => {
    const { Scatter } = await import('./Scatter');
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: x, label: `p${x}`, detail: '' }));
    const { container } = render(<Scatter points={points} color="#4A7FFF" xLabel="x" yLabel="y" slope={10} intercept={0} label="Fit" />);
    const line = container.querySelector('line.viz-fit')!;
    const attr = (k: string) => Number(line.getAttribute(k));
    const [x1, y1, x2, y2] = [attr('x1'), attr('y1'), attr('x2'), attr('y2')];
    const xs = [...container.querySelectorAll('circle.viz-dot')].map((c) => Number(c.getAttribute('cx')));
    const ys = [...container.querySelectorAll('circle.viz-dot')].map((c) => Number(c.getAttribute('cy')));
    const pxPerX = (xs[4]! - xs[0]!) / 4;
    const pxPerY = (ys[0]! - ys[4]!) / 4;
    expect((y1 - y2) / (x2 - x1)).toBeCloseTo((10 * pxPerY) / pxPerX, 6);
    expect(line.closest('g[clip-path]')).not.toBeNull();
    expect(container.querySelector('clipPath rect')).not.toBeNull();
  });
});

describe('TimeChart', () => {
  it('stacks positives up from zero and negatives down from zero in the same bucket', () => {
    const { container } = draw([
      { key: 'a', label: 'A', color: '#111111', values: [5, 2] },
      { key: 'b', label: 'B', color: '#222222', values: [-3, 1] },
    ]);
    const zeroY = Number(container.querySelector('line.viz-baseline')!.getAttribute('y1'));
    const rects = [...container.querySelectorAll('svg rect')];
    const a0 = rects.find((r) => r.getAttribute('fill') === '#111111')!;
    const b0 = rects.find((r) => r.getAttribute('fill') === '#222222')!;
    expect(Number(a0.getAttribute('y')) + Number(a0.getAttribute('height'))).toBeCloseTo(zeroY, 1);
    expect(Number(b0.getAttribute('y'))).toBeGreaterThanOrEqual(zeroY);
  });

  it('leaves a 2px surface gap between stacked segments', () => {
    const { container } = draw([
      { key: 'a', label: 'A', color: '#111111', values: [4, 0] },
      { key: 'b', label: 'B', color: '#222222', values: [4, 0] },
    ]);
    const [a, b] = [...container.querySelectorAll('svg rect')];
    const aTop = Number(a!.getAttribute('y'));
    const bBottom = Number(b!.getAttribute('y')) + Number(b!.getAttribute('height'));
    expect(aTop - bBottom).toBeCloseTo(2, 5);
  });

  it('breaks lines at missing values instead of drawing through them', () => {
    const { container } = draw([{ key: 'a', label: 'A', color: '#111111', values: [1, null, 3, 4] }], 'line', ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    const d = container.querySelector('svg path')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toMatch(/NaN/);
  });

  it('reads every series at the focused date and steps with the keyboard', () => {
    draw([
      { key: 'a', label: 'A', color: '#111111', values: [5, 2] },
      { key: 'b', label: 'B', color: '#222222', values: [1, null] },
    ]);
    const plot = screen.getByRole('group', { name: /^Test chart/ });
    fireEvent.focus(plot);
    const live = plot.querySelector('[aria-live="polite"]')!;
    expect(live).toHaveTextContent('Oct 27: A 2, B none');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(live).toHaveTextContent('Oct 26: A 5, B 1');
    fireEvent.blur(plot);
    expect(live).toHaveTextContent('');
  });

  it('renders the data table only when it is opened', async () => {
    const user = userEvent.setup();
    const { container } = draw([{ key: 'a', label: 'A', color: '#111111', values: [5, 2] }]);
    expect(container.querySelector('table')).toBeNull();
    await user.click(screen.getByText('Show data table'));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
