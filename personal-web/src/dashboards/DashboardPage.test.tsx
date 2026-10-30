import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import type { KindOverview, Overview } from '../analytics/types';
import { DashboardPage, RANGE_KEY } from './DashboardPage';

const NOW = Date.parse('2026-10-28T12:00:00Z');

function dates(n: number, end = '2026-10-28'): string[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(last - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

function kind(key: string, name: string, over: Partial<KindOverview> = {}, days = 30, activityDays = 182): KindOverview {
  const counts = over.counts ?? Array.from({ length: days }, (_, i) => (i % 2 === 0 ? 1 : 0));
  return {
    kind: key,
    displayName: name,
    category: 'Health',
    agg: 'sum',
    unit: 'h',
    better: 'higher',
    value: 120,
    previousValue: 100,
    delta: 20,
    deltaPercent: 20,
    avgPerDay: 4,
    entries: counts.reduce((a, b) => a + b, 0),
    previousEntries: 10,
    activeDays: 15,
    best: { date: '2026-10-20', value: 9 },
    latest: { date: '2026-10-27', value: 7 },
    lastEntryAt: '2026-10-27T08:00:00Z',
    currentStreak: 3,
    longestStreak: 9,
    values: counts.map((c) => c * 8),
    previousValues: counts.map(() => 3),
    counts,
    activity: Array.from({ length: activityDays }, (_, i) => (i % 3 === 0 ? 2 : 0)),
    ...over,
  };
}

function overview(kinds: KindOverview[], days = 30): Overview {
  const activityDays = days <= 30 ? 182 : 371;
  return {
    days,
    activityDays,
    generatedAt: '2026-10-28T12:00:00Z',
    dates: dates(days),
    previousDates: dates(days, new Date(Date.parse('2026-10-28T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10)),
    activityDates: dates(activityDays),
    activityTotal: Array.from({ length: activityDays }, () => 1),
    kinds,
  };
}

const KINDS = [
  kind('sleep', 'Sleep', { lastEntryAt: '2026-10-28T06:00:00Z', currentStreak: 12 }),
  kind('commits', 'Commits', { category: 'Code', agg: 'count', unit: null, value: 40, previousValue: 50, delta: -10, deltaPercent: -20, lastEntryAt: '2026-10-26T06:00:00Z' }),
  kind('resting_hr', 'Resting heart rate', { agg: 'avg', unit: 'bpm', better: 'lower', value: 58, previousValue: 55, delta: 3, deltaPercent: 5.45, avgPerDay: null, lastEntryAt: '2026-10-25T06:00:00Z' }),
  kind('weight', 'Weight', { agg: 'avg', unit: 'lb', better: 'none', value: 181.2, previousValue: 182, delta: -0.8, deltaPercent: -0.44, avgPerDay: null, lastEntryAt: '2026-10-24T06:00:00Z' }),
];

const COMPARE = {
  days: 30,
  bucket: 'day',
  dates: dates(30),
  series: [],
  pairs: [{ a: 'sleep', b: 'commits', lag: 0, r: 0.61, r2: 0.37, n: 30, slope: 1, intercept: 0, reason: null }],
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const MAX_CALLS = 30;
let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

function defaultRespond(url: string): Promise<Response> {
  if (url.includes('/analytics/overview')) {
    const days = Number(new URL(url).searchParams.get('days'));
    return json(overview(KINDS.map((k) => ({ ...k, counts: k.counts.slice(0, days).concat(Array(Math.max(0, days - k.counts.length)).fill(0)) })), days));
  }
  if (url.includes('/analytics/compare')) return json(COMPARE);
  return json({ errors: ['unexpected'] }, 500);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  respond = defaultRespond;
  // Bounded: a refetch loop fails the test instead of hanging the suite.
  fetchMock = vi.fn((url: string, init?: RequestInit) =>
    fetchMock.mock.calls.length > MAX_CALLS ? Promise.reject(new Error('too many fetches')) : respond(url, init),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function mount(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/dashboards']}>
      <ApiProvider baseUrl="http://api.test">
        <Routes>
          <Route path="/dashboards" element={<DashboardPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ApiProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const urls = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])));
const overviewCalls = () => urls().filter((u) => u.pathname === '/analytics/overview');
const kpis = () => within(screen.getByRole('list', { name: 'Key numbers per tracker' })).getAllByRole('link');
const ready = () => screen.findByRole('list', { name: 'Key numbers per tracker' });

describe('DashboardPage data loading', () => {
  it('loads everything with one overview request for 30 days and no per-kind calls', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Dashboards' })).toBeInTheDocument();
    await ready();
    expect(overviewCalls()).toHaveLength(1);
    expect(overviewCalls()[0]!.searchParams.get('days')).toBe('30');
    expect(urls().some((u) => u.pathname.startsWith('/series/'))).toBe(false);
    await waitFor(() => expect(urls().filter((u) => u.pathname === '/analytics/compare')).toHaveLength(1));
    expect(urls().find((u) => u.pathname === '/analytics/compare')!.searchParams.get('kinds')).toBe('sleep,commits,resting_hr,weight');
  });

  it('shows skeletons while loading', () => {
    respond = () => new Promise(() => undefined);
    mount();
    expect(screen.getAllByRole('status', { name: /^Loading/ }).length).toBeGreaterThanOrEqual(5);
  });

  it('changes range, refetches and remembers the choice', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const { unmount } = mount();
    await ready();
    await user.click(screen.getByRole('radio', { name: '90D' }));
    await waitFor(() => expect(overviewCalls().at(-1)!.searchParams.get('days')).toBe('90'));
    expect(localStorage.getItem(RANGE_KEY)).toBe('90');
    unmount();
    fetchMock.mockClear();
    mount();
    expect(screen.getByRole('radio', { name: '90D' })).toBeChecked();
    await waitFor(() => expect(overviewCalls()[0]!.searchParams.get('days')).toBe('90'));
  });

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === RANGE_KEY) throw new Error('blocked');
      return null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount();
    await ready();
    expect(screen.getByRole('radio', { name: '30D' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '7D' }));
    await waitFor(() => expect(overviewCalls().at(-1)!.searchParams.get('days')).toBe('7'));
  });

  it('never lets a slow older response overwrite a newer range', async () => {
    const pending: Record<string, (r: Response) => void> = {};
    respond = (url) => {
      const u = new URL(url);
      if (u.pathname === '/analytics/compare') return json(COMPARE);
      const days = u.searchParams.get('days')!;
      return new Promise((res) => {
        pending[days] = res;
      });
    };
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount();
    await waitFor(() => expect(pending['30']).toBeDefined());
    await user.click(screen.getByRole('radio', { name: '7D' }));
    await waitFor(() => expect(pending['7']).toBeDefined());
    pending['7']!(new Response(JSON.stringify(overview([kind('seven', 'Seven day kind', {}, 7)], 7))));
    await waitFor(() => expect(kpis().map((c) => c.getAttribute('aria-label')!.split(':')[0])).toEqual(['Seven day kind']));
    pending['30']!(new Response(JSON.stringify(overview(KINDS, 30))));
    await new Promise((r) => setTimeout(r, 20));
    expect(kpis().map((c) => c.getAttribute('aria-label')!.split(':')[0])).toEqual(['Seven day kind']);
  });

  it('aborts in-flight requests on unmount', async () => {
    const signals: AbortSignal[] = [];
    respond = (_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise(() => undefined);
    };
    const { unmount } = mount();
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(1));
    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('does not loop under StrictMode', async () => {
    mount(true);
    await ready();
    await new Promise((r) => setTimeout(r, 50));
    expect(overviewCalls().length).toBeLessThanOrEqual(2);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

describe('DashboardPage KPI strip', () => {
  it('names each card with value, unit, delta in words and last-entry age, newest first', async () => {
    mount();
    await ready();
    const cards = kpis();
    expect(cards.map((c) => c.getAttribute('aria-label')!.split(':')[0])).toEqual(['Sleep', 'Commits', 'Resting heart rate', 'Weight']);
    expect(cards[0]).toHaveAccessibleName('Sleep: 120 h total in the last 30 days, up 20 percent vs previous 30 days, last entry 6h ago');
    expect(cards[1]).toHaveAccessibleName('Commits: 40 entries in the last 30 days, down 20 percent vs previous 30 days, last entry 2d ago');
    expect(cards[2]).toHaveAccessibleName(/^Resting heart rate: 58 bpm average .* up 5\.5 percent/);
    expect(cards[0]).toHaveAttribute('href', '/chart/sleep?bucket=day&agg=sum&days=30');
  });

  it('colors deltas by whether up is good, and never by color alone', async () => {
    mount();
    await ready();
    const tone = (name: RegExp) => kpis().find((c) => name.test(c.getAttribute('aria-label')!))!.querySelector('.kpi-delta')!;
    expect(tone(/^Sleep/)).toHaveClass('tone-good');
    expect(tone(/^Commits/)).toHaveClass('tone-bad');
    expect(tone(/^Resting/)).toHaveClass('tone-bad');
    expect(tone(/^Weight/)).toHaveClass('tone-neutral');
    expect(tone(/^Sleep/)).toHaveTextContent('▲20%');
  });

  it('abbreviates big values on the card but keeps the full value in its name', async () => {
    respond = (url) => (url.includes('/overview') ? json(overview([kind('steps', 'Steps', { unit: 'steps', value: 240256 }), kind('huge', 'Huge', { value: 3.4e12 })])) : json(COMPARE));
    mount();
    await ready();
    const steps = kpis().find((c) => c.getAttribute('aria-label')!.startsWith('Steps'));
    const huge = kpis().find((c) => c.getAttribute('aria-label')!.startsWith('Huge'));
    expect(steps!.querySelector('.kpi-value')).toHaveTextContent('240.3K');
    expect(steps).toHaveAccessibleName(/^Steps: 240,256 steps total/);
    expect(huge!.querySelector('.kpi-value')).toHaveTextContent('3,400B');
    expect(huge).toHaveAccessibleName(/^Huge: 3,400,000,000,000 h total/);
  });

  it('shows the top 8 and expands to all', async () => {
    const many = Array.from({ length: 11 }, (_, i) => kind(`k${i}`, `Kind ${i}`, { lastEntryAt: `2026-10-${String(27 - i).padStart(2, '0')}T00:00:00Z` }));
    respond = (url) => (url.includes('/overview') ? json(overview(many)) : json(COMPARE));
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount();
    await ready();
    expect(kpis()).toHaveLength(8);
    const more = screen.getByRole('button', { name: 'Show all 11 trackers' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(kpis()).toHaveLength(11);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('solos a category from the full set, toggles within a subset, and restores with All (keyboard too)', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount();
    await ready();
    const names = () => kpis().map((c) => c.getAttribute('aria-label')!.split(':')[0]);
    const code = screen.getByRole('button', { name: 'Code, 1 of 1 shown' });
    expect(code).toHaveAttribute('aria-pressed', 'true');
    code.focus();
    await user.keyboard('{Enter}');
    expect(names()).toEqual(['Commits']);
    expect(screen.getByRole('button', { name: 'Code, 1 of 1 shown' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Health, 0 of 3 shown' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^All trackers/ })).toHaveAttribute('aria-pressed', 'false');
    // Adding Health back means every category is on again.
    await user.click(screen.getByRole('button', { name: 'Health, 0 of 3 shown' }));
    expect(names()).toEqual(['Sleep', 'Commits', 'Resting heart rate', 'Weight']);
    // Clicking the only category shown restores everything instead of emptying the page.
    await user.click(screen.getByRole('button', { name: 'Code, 1 of 1 shown' }));
    expect(names()).toEqual(['Commits']);
    await user.click(screen.getByRole('button', { name: 'Code, 1 of 1 shown' }));
    expect(kpis()).toHaveLength(4);
    // With a subset active (Weight unchecked), a chip toggles its own category.
    await user.click(screen.getByRole('button', { name: /Choose trackers/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Weight' }));
    expect(screen.getByRole('button', { name: 'Health, 2 of 3 shown' })).toHaveAttribute('aria-pressed', 'mixed');
    await user.click(screen.getByRole('button', { name: 'Code, 1 of 1 shown' }));
    expect(names()).toEqual(['Sleep', 'Resting heart rate']);
    await user.click(screen.getByRole('button', { name: /^All trackers/ }));
    expect(kpis()).toHaveLength(4);
    expect(overviewCalls()).toHaveLength(1);
  });

  it('puts the aggregation word on its own line under the value', async () => {
    mount();
    await ready();
    const hr = kpis().find((c) => c.getAttribute('aria-label')!.startsWith('Resting'))!;
    expect(hr.querySelector('.kpi-unit')).toHaveTextContent(/^bpm$/);
    expect(hr.querySelector('.kpi-agg')).toHaveTextContent('average');
    const sleep = kpis().find((c) => c.getAttribute('aria-label')!.startsWith('Sleep'))!;
    expect(sleep.querySelector('.kpi-agg')).toHaveTextContent('total');
  });
});

describe('DashboardPage panels', () => {
  it('renders every panel with an accessible text equivalent', async () => {
    mount();
    await ready();
    for (const title of ['Activity over time', 'Share of entries', 'Activity calendar', 'Insights', 'This period vs previous', 'Records and streaks', 'All trackers']) {
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('group', { name: /^Stacked bar chart of entries per day by category, last 30 days, \d+ entries in total/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^Calendar heatmap for all trackers: \d+ entries on \d+ of 182 days/ })).toBeInTheDocument();
    const share = within(screen.getByRole('region', { name: 'Share of entries' }));
    expect(share.getByText('Health')).toBeInTheDocument();
    expect(share.getAllByText(/%$/).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the calendar at one rect per day and lets you focus one tracker', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    respond = (url) => (url.includes('/overview') ? json(overview(KINDS.map((k) => kind(k.kind, k.displayName, {}, 365, 371)), 365)) : json(COMPARE));
    localStorage.setItem(RANGE_KEY, '365');
    mount();
    await ready();
    const cal = screen.getByRole('region', { name: 'Activity calendar' });
    expect(cal.querySelectorAll('.viz-plot svg rect:not(.viz-cell-focus)').length).toBeLessThanOrEqual(371);
    await user.selectOptions(within(cal).getByRole('combobox', { name: 'Calendar tracker' }), 'sleep');
    expect(within(cal).getByRole('group', { name: /^Calendar heatmap for Sleep/ })).toBeInTheDocument();
  });

  it('writes honest insights with links', async () => {
    mount();
    await ready();
    const insights = within(screen.getByRole('region', { name: 'Insights' }));
    expect(await insights.findByText('Sleep and Commits may be related: they tended to move together (r 0.61 over 30 days). Strongest of 1 pair checked.')).toBeInTheDocument();
    expect(insights.getByRole('link', { name: 'Compare Sleep and Commits' })).toHaveAttribute('href', '/compare?kinds=sleep%2Ccommits&range=30&pair=sleep%2Ccommits');
    expect(insights.getByText('Sleep is on a 12-day streak, the longest running right now.')).toBeInTheDocument();
  });

  it('sorts the table by any column and announces the sort', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount();
    await ready();
    const table = within(screen.getByRole('region', { name: 'All trackers' })).getByRole('table');
    const names = () => within(table).getAllByRole('rowheader').map((r) => r.textContent);
    expect(within(table).getByRole('columnheader', { name: /Last entry/ })).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(table).getByRole('button', { name: /^Tracker/ }));
    expect(within(table).getByRole('columnheader', { name: /Tracker/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['Commits', 'Resting heart rate', 'Sleep', 'Weight']);
    await user.click(within(table).getByRole('button', { name: /^Tracker/ }));
    expect(names()).toEqual(['Weight', 'Sleep', 'Resting heart rate', 'Commits']);
    expect(within(table).getByRole('columnheader', { name: /Last entry/ })).not.toHaveAttribute('aria-sort');
  });

  it('shows records from the data: best, lowest for lower-is-better, highest for neutral kinds', async () => {
    mount();
    await ready();
    const rec = within(screen.getByRole('region', { name: 'Records and streaks' }));
    expect(rec.getByRole('link', { name: /^Sleep\s*12 days$/ })).toBeInTheDocument();
    expect(rec.getAllByText('lowest on Oct 20')).toHaveLength(1);
    expect(rec.getAllByText('highest on Oct 20')).toHaveLength(1);
    expect(rec.getAllByText('best on Oct 20')).toHaveLength(2);
    expect(rec.getByText('Longest streaks, last 182 days')).toBeInTheDocument();
  });

  it('shows a per-panel error with Try again and keeps the page', async () => {
    let fail = true;
    respond = (url) => (url.includes('/overview') && fail ? json({ errors: ['Overview broke'] }, 400) : defaultRespond(url));
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(7);
    expect(alerts[0]).toHaveTextContent('Overview broke');
    expect(screen.getByRole('heading', { name: 'Dashboards' })).toBeInTheDocument();
    expect(screen.getByText('Not loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    await ready();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('clears old numbers when a new range fails instead of showing them under the new label', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    respond = (url) => (url.includes('days=90') ? json({ errors: ['Range broke'] }, 400) : defaultRespond(url));
    mount();
    await ready();
    await user.click(screen.getByRole('radio', { name: '90D' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Range broke');
    expect(screen.queryByRole('list', { name: 'Key numbers per tracker' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps a tracker that failed out of combined panels, says so, and shows its message', async () => {
    const failed = { ...kind('big', 'Big tracker'), value: null, previousValue: null, delta: null, deltaPercent: null, avgPerDay: null, best: null, latest: null, lastEntryAt: null, values: [], previousValues: [], counts: [], activity: [], entries: 0, previousEntries: 0, error: 'Too many records to chart (more than 20,000). Try a shorter range.' };
    respond = (url) => (url.includes('/overview') ? json(overview([...KINDS, failed])) : defaultRespond(url));
    mount();
    await ready();
    const card = kpis().find((c) => c.getAttribute('aria-label')!.startsWith('Big tracker'))!;
    expect(card).toHaveAccessibleName('Big tracker: Too many records to chart (more than 20,000). Try a shorter range.');
    for (const title of ['Activity over time', 'Share of entries', 'Activity calendar', 'Insights']) {
      expect(within(screen.getByRole('region', { name: title })).getByText('1 tracker skipped: too much data')).toBeInTheDocument();
    }
    const table = within(screen.getByRole('region', { name: 'All trackers' }));
    expect(table.getByText('Too many records to chart (more than 20,000). Try a shorter range.')).toBeInTheDocument();
    const compareUrl = urls().find((u) => u.pathname === '/analytics/compare')!;
    expect(compareUrl.searchParams.get('kinds')).not.toContain('big');
  });

  it('a failing correlation request only affects the insight that needs it', async () => {
    respond = (url) => (url.includes('/compare') ? json({ errors: ['nope'] }, 500) : defaultRespond(url));
    mount();
    await ready();
    expect(await screen.findByText(/Correlations are unavailable right now/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'All trackers' })).toBeInTheDocument();
    expect(screen.getByText('Sleep is on a 12-day streak, the longest running right now.')).toBeInTheDocument();
  });

  it('shows empty states with an Add a record link when nothing is logged', async () => {
    const empty = KINDS.map((k) =>
      kind(k.kind, k.displayName, {
        counts: Array(30).fill(0),
        activity: Array(182).fill(0),
        entries: 0,
        previousEntries: 0,
        value: 0,
        previousValue: 0,
        delta: 0,
        deltaPercent: null,
        best: null,
        latest: null,
        lastEntryAt: null,
        currentStreak: 0,
        longestStreak: 0,
      }),
    );
    respond = (url) => (url.includes('/overview') ? json(overview(empty)) : json(COMPARE));
    mount();
    await ready();
    expect(screen.getAllByRole('link', { name: 'Add a record' }).length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText('Nothing logged in the last 30 days.', { selector: 'p' }).length).toBeGreaterThanOrEqual(2);
    expect(urls().some((u) => u.pathname === '/analytics/compare')).toBe(false);
  });
});
