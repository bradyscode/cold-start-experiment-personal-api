import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import type { Kind } from '../api/types';
import { colorForKind } from '../theme/palette';
import { EntryPage, groupKinds } from './EntryPage';

const KINDS: Kind[] = [
  {
    key: 'range_session',
    displayName: 'Range session',
    defaultUnit: 'balls',
    valueField: 'balls',
    fields: [{ name: 'balls', type: 'Number', required: true }],
  },
  {
    key: 'workout',
    displayName: 'Workout',
    defaultUnit: null,
    valueField: null,
    fields: [{ name: 'minutes', type: 'Number', required: false }],
  },
  { key: 'note', displayName: 'Note', defaultUnit: null, valueField: null, fields: [] },
];

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  respond = () => json(KINDS);
  fetchMock = vi.fn((url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function mount(entry = '/add', strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      <ApiProvider baseUrl="http://api.test">
        <EntryPage />
      </ApiProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('EntryPage', () => {
  it('shows the heading and an accessible loading state', () => {
    respond = () => new Promise(() => undefined);
    mount();
    expect(screen.getByRole('heading', { name: 'Log something' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading trackers' })).toBeInTheDocument();
  });

  it('shows a radiogroup of kinds with the first selected and its form shown', async () => {
    mount();
    const group = await screen.findByRole('radiogroup', { name: 'What are you logging?' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['range_session', 'workout', 'note']);
    expect(screen.getByRole('radio', { name: 'Range session' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save range session' })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/kinds');
  });

  it('preselects the kind from ?kind= when it matches and falls back otherwise', async () => {
    const { unmount } = mount('/add?kind=workout');
    expect(await screen.findByRole('radio', { name: 'Workout' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save workout' })).toBeInTheDocument();
    unmount();
    mount('/add?kind=nope');
    expect(await screen.findByRole('radio', { name: 'Range session' })).toBeChecked();
  });

  it('colors the selected pill with its kind colors and leaves the others neutral', async () => {
    const user = userEvent.setup();
    mount();
    const pill = (name: string) => screen.getByRole('radio', { name }).closest('label')!;
    await screen.findByRole('radiogroup');
    const r = colorForKind('range_session');
    expect(pill('Range session')).toHaveStyle({ backgroundColor: r.bg, color: r.fg });
    expect(pill('Workout').getAttribute('style') ?? '').not.toContain('background');
    await user.click(screen.getByRole('radio', { name: 'Workout' }));
    const w = colorForKind('workout');
    expect(pill('Workout')).toHaveStyle({ backgroundColor: w.bg, color: w.fg });
    expect(pill('Range session').getAttribute('style') ?? '').not.toContain('background');
  });

  it('switching kind swaps the fields and clears values and errors', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText('Balls (required)'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(screen.getByText('Balls must be a number')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Workout' }));
    expect(screen.queryByLabelText('Balls (required)')).toBeNull();
    expect(screen.getByLabelText('Minutes')).toHaveValue('');
    expect(screen.queryByText('Balls must be a number')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Range session' }));
    expect(screen.getByLabelText('Balls (required)')).toHaveValue('');
    expect(screen.queryByText('Balls must be a number')).toBeNull();
  });

  it('locks the kind pills while a save is in flight', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    respond = (url) => (url.endsWith('/records') ? new Promise((res) => (release = res)) : json(KINDS));
    mount();
    await user.type(await screen.findByLabelText('Balls (required)'), '5');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(screen.getByRole('radio', { name: 'Workout' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Workout' }));
    expect(screen.getByRole('radio', { name: 'Range session' })).toBeChecked();
    release(new Response('{"id":"1"}', { status: 201 }));
    await screen.findByRole('status');
    expect(screen.getByRole('radio', { name: 'Workout' })).toBeEnabled();
  });

  it('moves the selection with arrow keys', async () => {
    const user = userEvent.setup();
    mount();
    const first = await screen.findByRole('radio', { name: 'Range session' });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Workout' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save workout' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no kinds', async () => {
    respond = () => json([]);
    mount();
    expect(await screen.findByText('No trackers to log yet.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows the error with Try again, which refetches', async () => {
    const user = userEvent.setup();
    respond = () => json({ errors: ['Nope'] }, 400);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');
    respond = () => json(KINDS);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the kinds request on unmount', async () => {
    let signal: AbortSignal | null | undefined;
    respond = (_u, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    };
    const { unmount } = mount();
    await waitFor(() => expect(signal).toBeTruthy());
    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('does not loop under StrictMode', async () => {
    respond = () => (fetchMock.mock.calls.length > 5 ? Promise.reject(new Error('loop')) : json(KINDS));
    mount('/add', true);
    await screen.findByRole('radiogroup');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('draws focus rings on pills and controls', () => {
    const css = readFileSync(resolve(__dirname, '../theme/app.css'), 'utf8');
    expect(css).toMatch(/\.pill:has\(input:focus-visible\)\s*\{[^}]*outline:/);
  });
});

function mk(key: string, displayName: string, category: string | null): Kind {
  return { key, displayName, defaultUnit: null, valueField: null, fields: [{ name: 'v', type: 'Number', required: false }], category };
}

function manyKinds(): Kind[] {
  return [
    mk('sleep', 'Sleep', 'Health'),
    mk('weight', 'Weight', 'Health'),
    mk('mood', 'Mood', 'Health'),
    mk('run', 'Run', 'Fitness'),
    mk('workout', 'Workout', 'Fitness'),
    mk('github_commit', 'Commit', 'Code'),
    mk('claude_usage', 'Claude usage', 'Code'),
    mk('range_session', 'Range session', 'Hobbies'),
    mk('purchase', 'Purchase', 'Money'),
    mk('note', 'Note', null),
  ];
}

const radioValues = () => screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);

describe('EntryPage with many trackers', () => {
  beforeEach(() => {
    respond = () => json(manyKinds());
  });

  it('groups trackers under category headings in a fixed order, sorted by name inside each group', async () => {
    mount();
    await screen.findByRole('radiogroup', { name: 'What are you logging?' });

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Health', 'Fitness', 'Code', 'Hobbies', 'Money', 'Other']);
    expect(radioValues()).toEqual(['mood', 'sleep', 'weight', 'run', 'workout', 'claude_usage', 'github_commit', 'range_session', 'purchase', 'note']);
    expect(screen.getByRole('group', { name: 'Health' })).toBeInTheDocument();
  });

  it('preselects nothing and shows no form until a tracker is chosen', async () => {
    mount();
    await screen.findByRole('radiogroup');

    expect(screen.getByText('Pick a tracker to start logging.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('collapses the picker after a choice, shows the form, and focuses the change button', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('radio', { name: 'Sleep' }));

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByText('Sleep', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/in Health/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save sleep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change tracker' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Change tracker' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('reopens the picker with the search box focused and keeps the current form until another is chosen', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('radio', { name: 'Sleep' }));
    await user.click(screen.getByRole('button', { name: 'Change tracker' }));

    expect(screen.getByRole('searchbox', { name: 'Find a tracker' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Sleep' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save sleep' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide trackers' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('radio', { name: 'Run' }));
    expect(screen.getByRole('button', { name: 'Save run' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save sleep' })).not.toBeInTheDocument();
  });

  it('filters by name, key and category, announces the count, and clears with Escape', async () => {
    const user = userEvent.setup();
    mount();
    const search = await screen.findByRole('searchbox', { name: 'Find a tracker' });

    await user.type(search, 'claude');
    expect(radioValues()).toEqual(['claude_usage']);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('1 tracker');

    await user.clear(search);
    await user.type(search, 'health');
    expect(radioValues()).toEqual(['mood', 'sleep', 'weight']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Health']);

    await user.clear(search);
    await user.type(search, 'github_com');
    expect(radioValues()).toEqual(['github_commit']);

    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(radioValues()).toHaveLength(10);
  });

  it('says so when nothing matches and offers the way back', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find a tracker' }), 'zzz');

    expect(screen.getByText(/No trackers match “zzz”/)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('starts collapsed on a tracker named in ?kind= and falls back to the open picker for an unknown one', async () => {
    mount('/add?kind=workout');
    expect(await screen.findByRole('button', { name: 'Save workout' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('opens the picker with no form for an unknown ?kind=', async () => {
    mount('/add?kind=nope');
    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
  });

  it('locks the change button while a save is in flight', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    respond = (_url, init) =>
      init?.method === 'POST' ? new Promise<Response>((res) => (release = res)) : json(manyKinds());
    mount('/add?kind=sleep');
    await user.type(await screen.findByLabelText('V'), '7');
    await user.click(screen.getByRole('button', { name: 'Save sleep' }));

    expect(screen.getByRole('button', { name: 'Change tracker' })).toBeDisabled();
    release(new Response(JSON.stringify({ id: '1' }), { status: 201 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change tracker' })).toBeEnabled());
  });

  it('keeps the plain row of pills with no search for a short list', async () => {
    respond = () => json(KINDS);
    mount();
    await screen.findByRole('radiogroup');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change tracker' })).not.toBeInTheDocument();
  });
});

describe('groupKinds', () => {
  it('keeps the original order in a single group when no tracker has a category', () => {
    const plain = [mk('b', 'Beta', null), mk('a', 'Alpha', null)];
    expect(groupKinds(plain, '').map((g) => g.kinds.map((k) => k.key))).toEqual([['b', 'a']]);
  });

  it('puts unknown categories after the known ones alphabetically and uncategorized last', () => {
    const kinds = [mk('x', 'X', null), mk('z', 'Z', 'Zoo'), mk('a', 'A', 'Aviary'), mk('h', 'H', 'Health')];
    expect(groupKinds(kinds, '').map((g) => g.name)).toEqual(['Health', 'Aviary', 'Zoo', 'Other']);
  });

  it('returns nothing when the search matches nothing', () => {
    expect(groupKinds(manyKinds(), 'qqq')).toEqual([]);
  });

  it('trims the query and ignores case', () => {
    expect(groupKinds(manyKinds(), '  SLEEP ').flatMap((g) => g.kinds.map((k) => k.key))).toEqual(['sleep']);
  });
});
