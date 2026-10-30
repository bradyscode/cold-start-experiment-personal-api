import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import { colorForKind } from '../theme/palette';
import { FeedPage } from './FeedPage';

function card(over: Record<string, unknown> = {}) {
  return {
    id: 'a',
    kind: 'range_session',
    kindName: 'Range session',
    rule: 'personal_best',
    big: '1,250',
    unit: 'balls',
    headline: 'Most balls in a session',
    detail: 'Beat your old best of 900',
    occurredAt: '2026-01-05T10:00:00Z',
    score: 90,
    chart: { kind: 'range_session', bucket: 'day', agg: 'sum', days: 30 },
    ...over,
  };
}

const CARDS = [
  card(),
  card({ id: 'b', kind: 'workout', big: '7', unit: 'days', headline: 'Workout streak', detail: 'Keep it going', chart: { kind: 'workout', bucket: 'week', agg: 'count', days: 90 } }),
  card({ id: 'c', kind: 'note', big: '12', unit: null, headline: 'Notes this week', detail: '', chart: { kind: 'note', bucket: 'day', agg: 'count', days: 14 } }),
];

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  respond = () => json(CARDS);
  fetchMock = vi.fn((url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function mount(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/']}>
      <ApiProvider baseUrl="http://api.test">
        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ApiProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('FeedPage', () => {
  it('shows an accessible loading state as a single dark card', () => {
    respond = () => new Promise(() => undefined);
    mount();
    expect(screen.getByRole('status', { name: 'Loading your feed' })).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('requests the feed with limit 20', async () => {
    mount();
    await screen.findAllByRole('article');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/feed?limit=20');
  });

  it('renders one card per item in order inside a labelled focusable scroller', async () => {
    mount();
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => within(c).getByRole('link', { name: /Workout streak|Most balls|Notes this week/ }).getAttribute('aria-label'))).toEqual([
      '1,250. Most balls in a session. Beat your old best of 900',
      '7 days. Workout streak. Keep it going',
      '12. Notes this week.',
    ]);
    const scroller = screen.getByRole('region', { name: 'Your feed' });
    expect(scroller).toHaveAttribute('tabindex', '0');
  });

  it('includes the big number in each accessible name', async () => {
    respond = () =>
      json([
        card({ id: 's', kind: 'sleep', rule: 'personal_best', big: '8:12', unit: 'hours', headline: 'Best Sleep', detail: 'Longest this year' }),
        card({ id: 't', kind: 'workout', rule: 'streak', big: '14', unit: 'days', headline: 'Workout streak', detail: 'Keep going' }),
      ]);
    mount();
    expect(await screen.findByRole('link', { name: /8:12.*Best Sleep/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /14 days.*Workout streak/ })).toBeInTheDocument();
  });

  it('gives each card its kind colors', async () => {
    mount();
    const cards = await screen.findAllByRole('article');
    const kinds = ['range_session', 'workout', 'note'];
    cards.forEach((c, i) => {
      const { bg, fg } = colorForKind(kinds[i]!);
      expect(c).toHaveStyle({ backgroundColor: bg, color: fg });
    });
  });

  it('keeps the full big value in the DOM and shows the unit only when it adds information', async () => {
    mount();
    const cards = await screen.findAllByRole('article');
    expect(cards[0]!.textContent).toContain('1,250');
    expect(cards[0]!.textContent).toContain('balls');
    expect(cards[2]!.textContent).toContain('12');
    expect(cards[2]!.querySelector('.feed-unit')).toBeNull();
  });

  it('hides the unit when the headline already contains it', async () => {
    respond = () => json([card({ unit: 'balls', headline: 'Most balls in a session' })]);
    mount();
    const [c] = await screen.findAllByRole('article');
    expect(c!.querySelector('.feed-unit')).toBeNull();
  });

  it('navigates to the exact chart URL when a card is activated', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('link', { name: '7 days. Workout streak. Keep it going' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/chart/workout?bucket=week&agg=count&days=90');
  });

  it('activates a card with the keyboard', async () => {
    const user = userEvent.setup();
    mount();
    const link = await screen.findByRole('link', { name: '12. Notes this week.' });
    link.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/chart/note?bucket=day&agg=count&days=14');
  });

  it('puts a Skip to dashboards link on every card, outside the card link', async () => {
    mount();
    const cards = await screen.findAllByRole('article');
    for (const c of cards) {
      const skip = within(c).getByRole('link', { name: 'Skip to dashboards' });
      expect(skip).toHaveAttribute('href', '/dashboards');
      const main = c.querySelector('a.feed-card-link')!;
      expect(main.contains(skip)).toBe(false);
      expect(main.querySelector('a')).toBeNull();
    }
  });

  it('skip navigates to /dashboards', async () => {
    const user = userEvent.setup();
    mount();
    const [first] = await screen.findAllByRole('link', { name: 'Skip to dashboards' });
    await user.click(first!);
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboards');
  });

  it('ends with a caught-up card linking to dashboards and add', async () => {
    mount();
    await screen.findAllByRole('article');
    const end = screen.getByRole('region', { name: "You're caught up" });
    expect(within(end).getByRole('link', { name: 'See dashboards' })).toHaveAttribute('href', '/dashboards');
    expect(within(end).getByRole('link', { name: 'Add a record' })).toHaveAttribute('href', '/add');
  });

  it('shows the empty state with a link to add and no cards', async () => {
    respond = () => json([]);
    mount();
    expect(await screen.findByText('Nothing to celebrate yet. Add your first record.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a record' })).toHaveAttribute('href', '/add');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByText("You're caught up")).toBeNull();
  });

  it('shows the API error and retries with Try again', async () => {
    const user = userEvent.setup();
    respond = () => json({ errors: ['Nope'] }, 400);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');
    respond = () => json(CARDS);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('article')).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the request on unmount', async () => {
    let signal: AbortSignal | null | undefined;
    respond = (_u, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    };
    const { unmount } = mount();
    await waitFor(() => expect(signal).toBeTruthy());
    expect(signal!.aborted).toBe(false);
    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('does not loop under StrictMode', async () => {
    respond = () => (fetchMock.mock.calls.length > 5 ? Promise.reject(new Error('loop')) : json(CARDS));
    mount(true);
    await screen.findAllByRole('article');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('has a visually hidden h1 "Your feed" in every state', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Your feed' })).toHaveClass('visually-hidden');
    await screen.findAllByRole('article');
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Your feed');
  });

  it('keeps the h1 on the empty and error screens', async () => {
    respond = () => json([]);
    const { unmount } = mount();
    await screen.findByText('Nothing to celebrate yet. Add your first record.');
    expect(screen.getByRole('heading', { level: 1, name: 'Your feed' })).toBeInTheDocument();
    unmount();
    respond = () => json({ errors: ['Nope'] }, 400);
    mount();
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { level: 1, name: 'Your feed' })).toBeInTheDocument();
  });

  it('tabs through one skip link, then each card link, then the end card', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByRole('article');
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      stops.push(el.getAttribute('aria-label') ?? el.textContent ?? '');
    }
    expect(stops).toEqual([
      'Your feed', // the focusable scroller region
      'Skip to dashboards',
      '1,250. Most balls in a session. Beat your old best of 900',
      '7 days. Workout streak. Keep it going',
      '12. Notes this week.',
      'See dashboards',
      'Add a record',
    ]);
  });

  it('removes only the later skip links from the tab order, and they stay clickable', async () => {
    const user = userEvent.setup();
    mount();
    const skips = await screen.findAllByRole('link', { name: 'Skip to dashboards' });
    expect(skips).toHaveLength(3);
    expect(skips[0]).not.toHaveAttribute('tabindex');
    expect(skips[1]).toHaveAttribute('tabindex', '-1');
    expect(skips[2]).toHaveAttribute('tabindex', '-1');
    await user.click(skips[2]!);
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboards');
  });

  it('draws focus rings that survive overflow clipping', () => {
    const css = readFileSync(resolve(__dirname, '../theme/app.css'), 'utf8');
    expect(css).toMatch(/\.feed-card-link:focus-visible\s*\{[^}]*outline-offset:\s*-6px/);
    expect(css).toMatch(/\.feed-skip:focus-visible\s*\{[^}]*outline:/);
  });
});
