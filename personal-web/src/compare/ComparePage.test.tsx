import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import type { Compare, CompareSeries, PairDetail } from '../analytics/types';
import { ComparePage, trendText } from './ComparePage';

const KINDS = [
  { key: 'sleep', displayName: 'Sleep', defaultUnit: 'hours', valueField: 'hours', fields: [], category: 'Health', defaultAgg: 'sum', better: 'higher' },
  { key: 'commits', displayName: 'Commits', defaultUnit: null, valueField: null, fields: [], category: 'Code', defaultAgg: 'count', better: null },
  { key: 'mood', displayName: 'Mood', defaultUnit: 'of 5', valueField: 'score', fields: [], category: 'Health', defaultAgg: 'avg', better: 'higher' },
  { key: 'steps', displayName: 'Steps', defaultUnit: 'steps', valueField: 'steps', fields: [], category: 'Health', defaultAgg: 'sum', better: 'higher' },
];

const DATES = ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'];

function s(kind: string, name: string, values: (number | null)[], over: Partial<CompareSeries> = {}): CompareSeries {
  const nums = values.filter((v): v is number => v !== null);
  return {
    kind,
    displayName: name,
    category: 'Health',
    agg: 'sum',
    unit: 'hours',
    values,
    stats: { n: nums.length, total: nums.reduce((a, b) => a + b, 0), mean: 5, min: Math.min(...nums), max: Math.max(...nums), stdDev: 1.2, slope: 0.25 },
    ...over,
  };
}

const SERIES = {
  sleep: s('sleep', 'Sleep', [7, 6, 8, 5, 7, 9, 6]),
  commits: s('commits', 'Commits', [3, 1, 4, 0, 2, 5, 1], { agg: 'count', unit: null, category: 'Code' }),
  mood: s('mood', 'Mood', [3, null, 4, 2, null, 5, 3], { agg: 'avg', unit: 'of 5' }),
};

function compare(keys: string[]): Compare {
  const list = keys.map((k) => SERIES[k as keyof typeof SERIES]).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const mood = list[i]!.kind === 'mood' || list[j]!.kind === 'mood';
      pairs.push({ a: list[i]!.kind, b: list[j]!.kind, lag: 0, r: mood ? null : 0.42, r2: mood ? null : 0.18, n: mood ? 4 : 63, slope: mood ? null : 1.5, intercept: mood ? null : 0.2, reason: mood ? 'fewer than 5 overlapping days' : null });
    }
  return { days: 90, bucket: 'day', dates: DATES, series: list, pairs };
}

function pair(a: string, b: string): PairDetail {
  return {
    days: 90,
    bucket: 'day',
    dates: DATES,
    a: SERIES[a as keyof typeof SERIES],
    b: SERIES[b as keyof typeof SERIES],
    lags: Array.from({ length: 15 }, (_, i) => i - 7).map((lag) => ({ a, b, lag, r: lag === 1 ? 0.31 : lag === 0 ? 0.2 : 0.05, r2: 0.04, n: 7 - Math.abs(lag), slope: 1, intercept: 0, reason: null })),
    bestLag: 1,
  };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const MAX_CALLS = 30;
let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string) => Promise<Response>;

function defaultRespond(url: string) {
  const u = new URL(url);
  if (u.pathname === '/kinds') return json(KINDS);
  if (u.pathname === '/analytics/compare') return json(compare(u.searchParams.get('kinds')!.split(',')));
  if (u.pathname === '/analytics/pair') return json(pair(u.searchParams.get('a')!, u.searchParams.get('b')!));
  return json({ errors: ['unexpected'] }, 500);
}

beforeEach(() => {
  respond = defaultRespond;
  fetchMock = vi.fn((url: string) => (fetchMock.mock.calls.length > MAX_CALLS ? Promise.reject(new Error('too many fetches')) : respond(url)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.search}</p>;
}

function mount(search = '?kinds=sleep,commits,mood', strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[`/compare${search}`]}>
      <ApiProvider baseUrl="http://api.test">
        <Routes>
          <Route
            path="/compare"
            element={
              <>
                <ComparePage />
                <Where />
              </>
            }
          />
        </Routes>
      </ApiProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const calls = (path: string) => fetchMock.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname === path);
const where = () => new URLSearchParams(screen.getByTestId('where').textContent!);
const matrix = () => screen.findByRole('grid', { name: 'Correlation matrix (Pearson r)' });

describe('ComparePage', () => {
  it('drops unknown trackers from the link, says which, and keeps the rest of the state', async () => {
    const user = userEvent.setup();
    mount('?kinds=sleep,nope,commits,ghost&range=30&norm=z');
    expect(await screen.findByText('Ignored unknown trackers: nope, ghost')).toBeInTheDocument();
    await waitFor(() => expect(where().get('kinds')).toBe('sleep,commits'));
    expect(where().get('range')).toBe('30');
    expect(where().get('norm')).toBe('z');
    await matrix();
    expect(calls('/analytics/compare').every((u) => !u.searchParams.get('kinds')!.includes('nope'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Ignored unknown trackers/)).toBeNull();
    // A notice raised for one link does not follow the user to the next selection.
    mount('?kinds=sleep,ghost,commits');
    expect(await screen.findByText('Ignored unknown trackers: ghost')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Remove Commits' }).at(-1)!);
    expect(screen.queryByText('Ignored unknown trackers: ghost')).toBeNull();
  });

  it('asks for two trackers and makes no analytics calls without them', async () => {
    mount('');
    expect(await screen.findByText('Pick at least two trackers.')).toBeInTheDocument();
    expect(screen.getAllByText('Pick at least two trackers to compare.').length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole('checkbox', { name: 'Sleep' })).toBeInTheDocument();
    expect(calls('/analytics/compare')).toHaveLength(0);
    expect(calls('/analytics/pair')).toHaveLength(0);
  });

  it('loads the comparison and the first pair from the URL', async () => {
    mount('?kinds=sleep,commits,mood&range=365&bucket=week');
    await matrix();
    const c = calls('/analytics/compare')[0]!.searchParams;
    expect(Object.fromEntries(c)).toEqual({ kinds: 'sleep,commits,mood', days: '365', bucket: 'week' });
    const p = calls('/analytics/pair')[0]!.searchParams;
    expect(Object.fromEntries(p)).toEqual({ a: 'sleep', b: 'commits', days: '365', bucket: 'week', lagMin: '-7', lagMax: '7' });
    expect(screen.getByRole('radio', { name: '1Y' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Week' })).toBeChecked();
  });

  it('names matrix cells with the numbers and shows a dash with a reason when r is missing', async () => {
    mount();
    const grid = await matrix();
    expect(within(grid).getAllByRole('button', { name: 'Sleep vs Commits: r 0.42 over 63 days' })[0]).toHaveTextContent('0.42');
    const missing = within(grid).getAllByRole('button', { name: 'Sleep vs Mood: no r, fewer than 5 overlapping days' })[0]!;
    expect(missing).toHaveTextContent('–');
  });

  it('moves through the matrix with arrow keys and selects a pair', async () => {
    const user = userEvent.setup();
    mount();
    const grid = await matrix();
    const start = within(grid).getAllByRole('button').find((b) => b.tabIndex === 0)!;
    start.focus();
    expect(start).toHaveAccessibleName('Commits vs Sleep: r 0.42 over 63 days');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName('Mood vs Sleep: no r, fewer than 5 overlapping days');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('Mood with itself');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toHaveAccessibleName('Commits vs Mood: no r, fewer than 5 overlapping days');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where().get('pair')).toBe('mood,commits'));
    await waitFor(() => expect(calls('/analytics/pair').at(-1)!.searchParams.get('a')).toBe('mood'));
  });

  it('shows pair stats, the best lag in words and the caution line', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Sleep vs Commits' })).toBeInTheDocument();
    // The fixture's best lag has only 6 overlapping days, so nothing is claimed.
    expect(screen.getByText('No lag stands out (strongest: r 0.31 at +1 day).')).toBeInTheDocument();
    expect(screen.getByText('Correlation is not causation. Small samples mislead. 15 lags were tried, so the strongest looks better than chance.')).toBeInTheDocument();
    expect(screen.getByText(/Only days after both trackers started/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^Scatter plot of Sleep against Commits, 7 points, r 0.20/ })).toBeInTheDocument();
  });

  it('changes the lag without refetching and keeps it in the URL', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('heading', { name: 'Sleep vs Commits' });
    const before = calls('/analytics/pair').length;
    await user.click(screen.getByRole('button', { name: 'Show strongest lag' }));
    expect(where().get('lag')).toBe('1');
    const slider = screen.getByRole('slider', { name: /Lag/ });
    expect(slider).toHaveValue('1');
    expect(slider).toHaveAttribute('aria-valuetext', '1 day, r 0.31');
    fireEvent.change(slider, { target: { value: '-3' } });
    expect(where().get('lag')).toBe('-3');
    expect(screen.getByRole('group', { name: /Scatter plot .* 4 points/ })).toBeInTheDocument();
    expect(calls('/analytics/pair')).toHaveLength(before);
  });

  it('normalizes client side and reads raw values at the crosshair', async () => {
    const user = userEvent.setup();
    mount();
    await matrix();
    const plot = screen.getByRole('group', { name: /^Line chart of Sleep, Commits, Mood, index 100 values per day/ });
    plot.focus();
    await waitFor(() => expect(plot.querySelector('[aria-live="polite"]')).toHaveTextContent('Oct 28: Sleep 6 hours (index 86), Commits 1 entry (index 33), Mood 3 of 5 (index 100)'));
    const before = calls('/analytics/compare').length;
    await user.click(screen.getByRole('radio', { name: 'Z-score' }));
    expect(where().get('norm')).toBe('z');
    expect(calls('/analytics/compare')).toHaveLength(before);
  });

  it('toggles series in the legend', async () => {
    const user = userEvent.setup();
    mount();
    await matrix();
    const legend = screen.getByRole('list', { name: 'Series' });
    const mood = within(legend).getByRole('button', { name: 'Mood' });
    await user.click(mood);
    expect(mood).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: /^Line chart/ }).querySelectorAll('path')).toHaveLength(2);
  });

  it('removes and adds trackers through the picker, capped at 8', async () => {
    const user = userEvent.setup();
    mount();
    await matrix();
    await user.click(screen.getByRole('button', { name: 'Remove Mood' }));
    expect(where().get('kinds')).toBe('sleep,commits');
    await user.click(screen.getByRole('button', { name: 'Add trackers' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search trackers' }), 'ste');
    expect(screen.queryByRole('checkbox', { name: 'Sleep' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Steps' }));
    expect(where().get('kinds')).toBe('sleep,commits,steps');
  });

  it('summarizes every selected tracker', async () => {
    mount();
    await matrix();
    const table = within(screen.getByRole('region', { name: 'Summary' })).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Sleep48 hours5 hours5 hours9 hours1.2 hours+0.25 hours per day');
    expect(rows[2]).toHaveTextContent('Mood–5 of 52 of 55 of 5');
  });

  it('shows per-panel errors and keeps the other panels', async () => {
    respond = (url) => (url.includes('/analytics/pair') ? json({ errors: ['Pair broke'] }, 400) : defaultRespond(url));
    mount();
    await matrix();
    expect(await screen.findByRole('alert')).toHaveTextContent('Pair broke');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not loop under StrictMode', async () => {
    mount('?kinds=sleep,commits,mood', true);
    await matrix();
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe('trendText', () => {
  it('reads tiny slopes as flat and keeps units', () => {
    const base = SERIES.sleep;
    expect(trendText({ ...base, stats: { ...base.stats, slope: 0.25 } }, 'day')).toBe('+0.25 hours per day');
    expect(trendText({ ...base, stats: { ...base.stats, slope: -1234 } }, 'week')).toBe('−1,234 hours per week');
    expect(trendText({ ...base, stats: { ...base.stats, slope: 0.000001 } }, 'day')).toBe('Flat');
    expect(trendText({ ...base, stats: { ...base.stats, slope: null } }, 'day')).toBe('–');
  });
});
