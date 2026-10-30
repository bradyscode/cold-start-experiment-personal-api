import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FeedCard, shouldShowUnit } from './FeedCard';
import type { FeedCard as Card } from '../api/types';

const base: Card = {
  id: 'a',
  kind: 'workout',
  kindName: 'Workout',
  rule: 'streak',
  big: '1,234,567,890',
  unit: 'days',
  headline: 'Streak',
  detail: '',
  occurredAt: '2026-01-05T10:00:00Z',
  score: 1,
  chart: { kind: 'workout', bucket: 'day', agg: 'count', days: 30 },
};

function mount(card: Card) {
  return render(
    <MemoryRouter>
      <FeedCard card={card} />
    </MemoryRouter>,
  );
}

describe('FeedCard', () => {
  it('names the link by number, unit and headline when detail is empty', () => {
    mount(base);
    expect(screen.getByRole('link', { name: '1,234,567,890 days. Streak.' })).toHaveAttribute('href', '/chart/workout?bucket=day&agg=count&days=30');
  });

  it('keeps the whole big value as one unwrapped text node', () => {
    mount(base);
    const big = screen.getByText('1,234,567,890');
    expect(big).toHaveClass('feed-big');
    expect(big.textContent).toBe('1,234,567,890');
  });

  it('makes the skip link tabbable by default and not when skipTabbable is false', () => {
    const { rerender } = mount(base);
    expect(screen.getByRole('link', { name: 'Skip to dashboards' })).not.toHaveAttribute('tabindex');
    rerender(
      <MemoryRouter>
        <FeedCard card={base} skipTabbable={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Skip to dashboards' })).toHaveAttribute('tabindex', '-1');
  });

  it('omits the detail paragraph when empty and shows it otherwise', () => {
    const { container, rerender } = mount(base);
    expect(container.querySelector('.feed-detail')).toBeNull();
    rerender(
      <MemoryRouter>
        <FeedCard card={{ ...base, detail: 'More' }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.feed-detail')).toHaveTextContent('More');
  });

  it('hides the unit only when the headline has it as a whole word', () => {
    expect(shouldShowUnit('min', 'Please administer it')).toBe(true);
    expect(shouldShowUnit('min', 'Run for 12 min')).toBe(false);
    expect(shouldShowUnit('min', 'Run for 12 mins')).toBe(false);
    expect(shouldShowUnit('days', '12 days in a row')).toBe(false);
    expect(shouldShowUnit('h', 'The longest sleep')).toBe(true);
    expect(shouldShowUnit(null, 'x')).toBe(false);
  });

  it('does not throw on units with regex characters', () => {
    expect(() => shouldShowUnit('m²', 'Run')).not.toThrow();
    expect(() => shouldShowUnit('$/h', 'Pay (net) $/h')).not.toThrow();
  });
});
