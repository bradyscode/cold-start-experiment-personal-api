import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import { ChartPage, aggForKind } from './ChartPage';

const KINDS = [
  { key: 'range_session', displayName: 'Range session', defaultUnit: 'balls', valueField: 'balls', fields: [], category: 'Hobbies', defaultAgg: 'sum', better: 'none' },
  { key: 'weight', displayName: 'Weight', defaultUnit: 'lb', valueField: 'lb', fields: [], category: 'Health', defaultAgg: 'avg', better: 'none' },
  { key: 'note', displayName: 'Note', defaultUnit: 'pages', valueField: null, fields: [], category: 'Life', defaultAgg: 'count', better: null },
];

function series(values: (number | null)[], over: Record<string, unknown> = {}, counts?: number[]) {
  return {
    kind: 'range_session',
    bucket: 'day',
    agg: 'sum',
    unit: 'balls',
    points: values.map((value, i) => ({
      start: new Date(Date.UTC(2026, 0, 1 + i, 12)).toISOString(),
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      value,
      count: counts?.[i] ?? (value === null || value === 0 ? 0 : 1),
    })),
    ...over,
  };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const MAX_CALLS = 40;
let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([1, 2, 3])));
  // Bounded: a render loop fails the test instead of hanging the suite.
  fetchMock = vi.fn((url: string, init?: RequestInit) =>
    fetchMock.mock.calls.length > MAX_CALLS ? Promise.reject(new Error('too many fetches')) : respond(url, init),
  );
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

function mount(entries: string[] = ['/chart/range_session'], strict = false) {
  const tree = (
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <ApiProvider baseUrl="http://api.test">
        <Routes>
          <Route
            path="/chart/:kind"
            element={
              <>
                <ChartPage />
                <Where />
              </>
            }
          />
          <Route path="/dashboards" element={<p>Dashboards page</p>} />
          <Route path="/" element={<p>Feed page</p>} />
          <Route path="/add" element={<p>Add page</p>} />
        </Routes>
      </ApiProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const seriesCalls = (): URL[] =>
  fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/series/')).map((u) => new URL(u));
const chart = () => screen.findByRole('group', { name: /(Bar|Line) chart of/ });
const stat = (name: RegExp) => screen.getByRole('group', { name });
const bars = () => [...document.querySelectorAll('.viz-plot svg rect')];

describe('ChartPage', () => {
  it('shows a skeleton while loading', () => {
    respond = () => new Promise(() => undefined);
    mount();
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument();
  });

  it('shows the name, what is drawn, an axis chart and honest stats', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([10, 0, 20, 30])));
    mount();
    expect(await screen.findByRole('heading', { name: 'Range session' })).toBeInTheDocument();
    expect(screen.getByText('Total per day, last 30 days')).toBeInTheDocument();
    await chart();
    expect(bars()).toHaveLength(3);
    expect(stat(/^Latest: Jan 4/)).toHaveAccessibleName('Latest: Jan 4: 30 balls');
    expect(stat(/^Average per day with data/)).toHaveAccessibleName('Average per day with data: 20 balls, 3 of 4 days had entries');
    expect(stat(/^Total in range/)).toHaveAccessibleName('Total in range: 60 balls, 15 per day including empty days');
    expect(stat(/^Highest day/)).toHaveAccessibleName('Highest day: 30 balls, Jan 4');
    expect(document.querySelectorAll('.viz-axis').length).toBeGreaterThan(4);
  });

  it('says when the last bucket is empty instead of showing an older value', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([4, 6, 0])));
    mount();
    await chart();
    expect(stat(/^Latest: Jan 3/)).toHaveAccessibleName('Latest: Jan 3: No entries on this day yet');
  });

  it('uses the kind defaultAgg when the URL has none, and lists the aggregations', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([180, null, 182], { agg: 'avg', unit: 'lb', kind: 'weight' })));
    mount(['/chart/weight']);
    await chart();
    expect(seriesCalls()[0]!.searchParams.get('agg')).toBe('avg');
    expect(screen.getByText('Average per day, last 30 days')).toBeInTheDocument();
    expect(stat(/^Average per day with data/)).toHaveAccessibleName('Average per day with data: 181 lb, 2 of 3 days had entries');
    expect(screen.queryByRole('group', { name: /^Total in range/ })).toBeNull();
    expect(within(screen.getByRole('combobox', { name: 'Aggregation' })).getAllByRole('option')).toHaveLength(4);
    // Averages draw as a line on a fitted axis so small changes stay visible; the lone point gets a dot.
    expect(screen.getByRole('group', { name: /^Line chart of average per day/ })).toBeInTheDocument();
    const ticks = [...document.querySelectorAll('.viz-plot text.viz-axis')].map((t) => t.textContent);
    expect(ticks).not.toContain('0');
    expect(document.querySelectorAll('.viz-plot circle.viz-solo')).toHaveLength(2);
    expect(stat(/^Highest day/)).toHaveAccessibleName('Highest day: 182 lb, Jan 3');
  });

  it('labels counts in entries, never the kind unit, and offers only count for kinds without a value', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([2, 1], { agg: 'count', unit: null, kind: 'note' }, [2, 1])));
    mount(['/chart/note']);
    await chart();
    expect(seriesCalls()[0]!.searchParams.get('agg')).toBe('count');
    expect(stat(/^Latest/)).toHaveAccessibleName('Latest: Jan 2: 1 entry');
    expect(screen.getByText('Entries per day, last 30 days')).toBeInTheDocument();
    expect(stat(/^Entries in range/)).toHaveAccessibleName('Entries in range: 3 entries, 1.5 per day including empty days');
    expect(document.body.textContent).not.toContain('pages');
    expect(screen.queryByRole('combobox', { name: 'Aggregation' })).toBeNull();
  });

  it('draws negative values below a zero baseline with negative ticks', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([-7, 3, -2])));
    mount();
    await chart();
    const baseline = document.querySelector('.viz-plot line.viz-baseline')!;
    const zeroY = Number(baseline.getAttribute('y1'));
    const [neg, pos] = bars();
    expect(Number(neg!.getAttribute('y'))).toBeGreaterThanOrEqual(zeroY - 0.01);
    expect(Number(pos!.getAttribute('y')) + Number(pos!.getAttribute('height'))).toBeCloseTo(zeroY, 1);
    const ticks = [...document.querySelectorAll('.viz-plot text.viz-axis')].map((t) => t.textContent);
    expect(ticks.some((t) => t?.startsWith('-'))).toBe(true);
    expect(stat(/^Total in range/)).toHaveAccessibleName(/Total in range: -6 balls/);
  });

  it('abbreviates huge numbers but keeps the full value in the accessible name', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([1e11, 2.5e11])));
    mount();
    await chart();
    const total = stat(/^Total in range/);
    expect(within(total).getByText('350B')).toBeInTheDocument();
    expect(total).toHaveAccessibleName(/350,000,000,000 balls/);
  });

  it('reads values on keyboard focus through a live readout', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([5, 8])));
    mount();
    const plot = await chart();
    plot.focus();
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Jan 2: Range session 8 balls'));
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Jan 1: Range session 5 balls'));
  });

  it('switches range and bucket through the controls and the URL', async () => {
    const user = userEvent.setup();
    mount();
    await chart();
    await user.click(screen.getByRole('radio', { name: '7D' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('days=7'));
    await waitFor(() => expect(seriesCalls().at(-1)!.searchParams.get('bucket')).toBe('day'));
    const span = (u: URL) => (Date.parse(u.searchParams.get('to')!) - Date.parse(u.searchParams.get('from')!)) / 86_400_000;
    expect(Math.round(span(seriesCalls().at(-1)!))).toBe(7);
    await user.click(screen.getByRole('radio', { name: 'Week' }));
    await waitFor(() => expect(seriesCalls().at(-1)!.searchParams.get('bucket')).toBe('week'));
  });

  it('drops the old numbers when a new range fails', async () => {
    const user = userEvent.setup();
    respond = (url) => {
      if (url.includes('/kinds')) return json(KINDS);
      const u = new URL(url);
      const span = (Date.parse(u.searchParams.get('to')!) - Date.parse(u.searchParams.get('from')!)) / 86_400_000;
      return Math.round(span) === 7 ? json({ errors: ['Seven broke'] }, 400) : json(series([4, 5]));
    };
    mount();
    await chart();
    await user.click(screen.getByRole('radio', { name: '7D' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seven broke');
    expect(screen.queryByRole('group', { name: /^Total in range/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /(Bar|Line) chart of/ })).toBeNull();
  });

  it('keeps ceil(days/7) weeks and says the current week is partial', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([500, 1, 2, 3, 4, 5], { bucket: 'week' })));
    mount(['/chart/range_session?bucket=week&days=35']);
    await chart();
    expect(bars()).toHaveLength(5);
    expect(screen.getByText('Total per week, last 5 weeks (current week partial)')).toBeInTheDocument();
    expect(stat(/^Latest: Week of/)).toHaveAccessibleName(/5 balls/);
  });

  it('uses only the last 30 buckets of a 31-point response', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([1000, ...Array.from({ length: 30 }, () => 10)])));
    mount();
    await chart();
    expect(bars()).toHaveLength(30);
    expect(stat(/^Total in range/)).toHaveAccessibleName(/Total in range: 300 balls/);
  });

  it('puts the year on axis labels for a one-year range', async () => {
    const values = Array.from({ length: 366 }, (_, i) => (i % 3) + 1);
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series(values)));
    mount(['/chart/range_session?days=365']);
    await chart();
    const labels = [...document.querySelectorAll('.viz-plot text.viz-axis')].map((t) => t.textContent ?? '');
    expect(labels.some((t) => /\b2026\b/.test(t))).toBe(true);
  });

  it('shows the empty state with a link to add a record', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json(series([0, 0])));
    mount();
    expect(await screen.findByText('Nothing logged for Range session in the last 30 days.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Add a record' }));
    expect(screen.getByText('Add page')).toBeInTheDocument();
  });

  it('says the tracker was not found for a 404, with a link and no useless retry', async () => {
    respond = (url) => (url.includes('/kinds') ? json(KINDS) : json({ errors: ["Unknown kind 'nope'"] }, 404));
    mount(['/chart/nope']);
    expect(await screen.findByRole('alert')).toHaveTextContent('That tracker was not found.');
    expect(screen.getByRole('link', { name: 'Go to dashboards' })).toHaveAttribute('href', '/dashboards');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows other errors with Try again', async () => {
    let n = 0;
    respond = (url) => {
      if (url.includes('/kinds')) return json(KINDS);
      n += 1;
      return n === 1 ? json({ errors: ['Bucket limit exceeded.'] }, 400) : json(series([1, 2]));
    };
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Bucket limit exceeded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await chart();
    expect(seriesCalls()).toHaveLength(2);
  });

  it('fails fast when the API cannot be reached instead of waiting for a second request', async () => {
    respond = (url) => (url.includes('/kinds') ? Promise.reject(new TypeError('Failed to fetch')) : json(series([1])));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the API");
    expect(seriesCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('falls back to the kind key when kinds cannot be loaded', async () => {
    respond = (url) => (url.includes('/kinds') ? json({ errors: ['x'] }, 500) : json(series([1])));
    mount();
    expect(await screen.findByRole('heading', { name: 'range_session' })).toBeInTheDocument();
  });

  it('Back goes to the previous app page, or to the dashboards in a fresh tab', async () => {
    const user = userEvent.setup();
    const first = mount(['/chart/range_session']);
    await chart();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/dashboards');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(screen.getByText('Dashboards page')).toBeInTheDocument();
    first.unmount();

    mount(['/', '/chart/range_session']);
    await chart();
    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(screen.getByText('Feed page')).toBeInTheDocument();
  });

  it.each([
    ['999999999999', 365],
    ['366', 365],
    ['0', 30],
    ['abc', 30],
    ['2.5', 30],
  ])('days=%s requests a %d day span', async (raw, expected) => {
    mount([`/chart/range_session?days=${raw}`]);
    await chart();
    const q = seriesCalls()[0]!.searchParams;
    expect(Math.round((Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000)).toBe(expected);
  });

  it('aborts the in-flight request on unmount', async () => {
    const signals: AbortSignal[] = [];
    respond = (url, init) => {
      if (url.includes('/kinds')) return json(KINDS);
      if (init?.signal) signals.push(init.signal);
      return new Promise(() => undefined);
    };
    const { unmount } = mount();
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0]!.aborted).toBe(true);
  });

  it('ignores a stale response from a previous tracker', async () => {
    const resolvers: Record<string, (r: Response) => void> = {};
    respond = (url) => {
      if (url.includes('/kinds')) return json(KINDS);
      return new Promise<Response>((res) => {
        resolvers[new URL(url).pathname] = res;
      });
    };
    render(
      <MemoryRouter initialEntries={['/chart/a']}>
        <ApiProvider baseUrl="http://api.test">
          <Link to="/chart/b">Go to b</Link>
          <Routes>
            <Route path="/chart/:kind" element={<ChartPage />} />
          </Routes>
        </ApiProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(resolvers['/series/a']).toBeDefined());
    await userEvent.click(screen.getByRole('link', { name: 'Go to b' }));
    await waitFor(() => expect(resolvers['/series/b']).toBeDefined());
    resolvers['/series/b']!(new Response(JSON.stringify(series([7, 9])), { status: 200 }));
    expect(await screen.findByRole('heading', { name: 'b' })).toBeInTheDocument();
    resolvers['/series/a']!(new Response(JSON.stringify(series([100, 200])), { status: 200 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('heading', { name: 'b' })).toBeInTheDocument();
    expect(stat(/^Latest/)).toHaveAccessibleName(/9 balls/);
  });

  it('does not loop under StrictMode', async () => {
    mount(['/chart/range_session'], true);
    await chart();
    await new Promise((r) => setTimeout(r, 50));
    expect(seriesCalls().length).toBeLessThanOrEqual(2);
  });
});

describe('aggForKind', () => {
  it('prefers the URL, then defaultAgg, then sum or count', () => {
    const k = KINDS[1] as Parameters<typeof aggForKind>[0];
    expect(aggForKind(k, 'max')).toBe('max');
    expect(aggForKind(k, null)).toBe('avg');
    expect(aggForKind(k, 'bogus')).toBe('avg');
    expect(aggForKind({ ...k!, defaultAgg: null }, null)).toBe('sum');
    expect(aggForKind({ ...k!, defaultAgg: null, valueField: null }, null)).toBe('count');
    expect(aggForKind(null, null)).toBe('sum');
  });
});
