import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import type { Kind } from '../api/types';
import { KindForm } from './KindForm';

const RANGE: Kind = {
  key: 'range_session',
  displayName: 'Range Session',
  defaultUnit: 'balls',
  valueField: 'balls',
  fields: [
    { name: 'balls', type: 'Number', required: true, label: 'Balls hit' },
    { name: 'avg_speed', type: 'Number', required: false },
    { name: 'club', type: 'Choice', required: false, options: ['Driver', '7 iron'] },
    { name: 'surface', type: 'Choice', required: true, options: ['Mat', 'Grass'] },
    { name: 'indoors', type: 'Boolean', required: false },
    { name: 'played_on', type: 'Date', required: false },
    { name: 'location', type: 'Text', required: false },
  ],
};

const OTHER: Kind = {
  key: 'workout',
  displayName: 'Workout',
  defaultUnit: null,
  valueField: null,
  fields: [{ name: 'minutes', type: 'Number', required: false }],
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  respond = () => json({ id: '1' }, 201);
  fetchMock = vi.fn((url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function mount(kind: Kind = RANGE, strict = false) {
  const tree = (
    <MemoryRouter>
      <ApiProvider baseUrl="http://api.test">
        <KindForm kind={kind} />
      </ApiProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function body(call = 0) {
  return JSON.parse(String(fetchMock.mock.calls[call]![1].body));
}

describe('KindForm controls', () => {
  it('renders the right control type per field type with real labels', () => {
    mount();
    const balls = screen.getByLabelText('Balls hit (required)');
    expect(balls).toHaveAttribute('type', 'text');
    expect(balls).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Avg speed')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Location')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Indoors')).toHaveAttribute('type', 'checkbox');
    expect(screen.getByLabelText('Played on')).toHaveAttribute('type', 'date');
    const club = screen.getByLabelText('Club');
    expect(club.tagName).toBe('SELECT');
    expect(Array.from((club as HTMLSelectElement).options).map((o) => o.value)).toEqual(['', 'Driver', '7 iron']);
    expect(screen.getByLabelText('When')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText('Title')).toHaveAttribute('type', 'text');
  });

  it('marks required fields in the label text and sets required semantics', () => {
    mount();
    const balls = screen.getByLabelText('Balls hit (required)');
    expect(balls).toBeRequired();
    expect(balls).toHaveAttribute('aria-required', 'true');
    const surface = screen.getByLabelText('Surface (required)') as HTMLSelectElement;
    expect(Array.from(surface.options).map((o) => o.value)).toEqual(['', 'Mat', 'Grass']);
    expect(surface.value).toBe('');
    expect(Array.from(surface.options).map((o) => o.text)).toEqual(['Choose...', 'Mat', 'Grass']);
    expect(Array.from((screen.getByLabelText('Club') as HTMLSelectElement).options).map((o) => o.text)).toEqual(['None', 'Driver', '7 iron']);
    expect(screen.getByLabelText('Club')).not.toBeRequired();
  });

  it('names the submit button after the kind in lowercase', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Save range session' })).toBeInTheDocument();
  });
});

describe('KindForm validation', () => {
  it('rejects a non-numeric Number before any request', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(screen.getByText('Balls hit must be a number')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Balls hit (required)')).toHaveFocus();
  });

  it('shows required messages, sends nothing and focuses the first invalid control', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(screen.getByText('Balls hit is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const balls = screen.getByLabelText('Balls hit (required)');
    expect(balls).toHaveFocus();
    expect(balls).toHaveAttribute('aria-invalid', 'true');
    expect(balls).toHaveAccessibleDescription('Balls hit is required');
  });

  it('focuses the first invalid control even when a later one is also invalid', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Avg speed'), 'fast');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(screen.getByLabelText('Balls hit (required)')).toHaveFocus();
    expect(screen.getByText('Avg speed must be a number')).toBeInTheDocument();
  });
});

describe('KindForm submit', () => {
  it('sends Number fields as JS numbers, trims text and omits empty optional fields', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '150');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.type(screen.getByLabelText('Avg speed'), '12.5');
    await user.type(screen.getByLabelText('Location'), '  Pebble  ');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('status');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/records');
    expect(body()).toEqual({
      kind: 'range_session',
      externalId: expect.any(String),
      data: { balls: 150, avg_speed: 12.5, surface: 'Mat', indoors: false, location: 'Pebble' },
    });
  });

  it('accepts negative numbers and sends Date, Choice, Boolean and Title', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '-3');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.selectOptions(screen.getByLabelText('Club'), '7 iron');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Grass');
    await user.click(screen.getByLabelText('Indoors'));
    fireEvent.change(screen.getByLabelText('Played on'), { target: { value: '2026-02-03' } });
    await user.type(screen.getByLabelText('Title'), ' Morning ');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('status');
    expect(body()).toEqual({
      kind: 'range_session',
      externalId: expect.any(String),
      title: 'Morning',
      data: { balls: -3, club: '7 iron', surface: 'Grass', indoors: true, played_on: '2026-02-03' },
    });
  });

  it('omits occurredAt when When is untouched so the server clock is used', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('status');
    expect(body()).not.toHaveProperty('occurredAt');
  });

  it('sends occurredAt as an ISO string once When is changed', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-03-01T08:30' } });
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('status');
    expect(body().occurredAt).toBe(new Date('2026-03-01T08:30').toISOString());
  });

  it('defaults When to now in local time', () => {
    mount();
    const v = (screen.getByLabelText('When') as HTMLInputElement).value;
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Math.abs(new Date(v).getTime() - Date.now())).toBeLessThan(2 * 60_000);
  });

  it('on success shows the message, resets the form and returns focus to the first control', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '150');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.type(screen.getByLabelText('Title'), 'x');
    await user.click(screen.getByLabelText('Indoors'));
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. It will show up in your feed.');
    const balls = screen.getByLabelText('Balls hit (required)');
    expect(balls).toHaveValue('');
    expect(balls).toHaveFocus();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Surface (required)')).toHaveValue('');
    expect(screen.getByLabelText('Indoors')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save range session' })).toBeEnabled();
  });

  it('disables the button and says Saving... while in flight, and a double click sends one request', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    respond = () => new Promise((res) => (release = res));
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '5');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    const btn = screen.getByRole('button', { name: 'Save range session' });
    await user.dblClick(btn);
    const saving = screen.getByRole('button', { name: 'Saving...' });
    expect(saving).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response('{"id":"1"}', { status: 201 }));
    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: 'Save range session' })).toBeEnabled();
  });

  it('shows server errors in an alert, keeps values and focuses the alert', async () => {
    const user = userEvent.setup();
    respond = () => json({ errors: ['balls must be positive', 'club is unknown'] }, 400);
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '150');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.type(screen.getByLabelText('Title'), 'keep me');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('balls must be positive');
    expect(alert).toHaveTextContent('club is unknown');
    expect(alert.querySelectorAll('li')).toHaveLength(2);
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Balls hit (required)')).toHaveValue('150');
    expect(screen.getByLabelText('Title')).toHaveValue('keep me');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears an old alert when the next attempt starts', async () => {
    const user = userEvent.setup();
    respond = () => json({ errors: ['bad'] }, 400);
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('alert');
    respond = () => json({ id: '1' }, 201);
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('status');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows other API errors with their message', async () => {
    const user = userEvent.setup();
    respond = () => json({}, 500);
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The API returned an error (500). Try again in a moment.');
    expect(screen.getByLabelText('Balls hit (required)')).toHaveValue('1');
  });

  it('on a network failure says it could not confirm and does not clear the form', async () => {
    const user = userEvent.setup();
    respond = () => Promise.reject(new TypeError('network'));
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '150');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't confirm that it saved. Check your feed before trying again.");
    expect(screen.getByLabelText('Balls hit (required)')).toHaveValue('150');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('aborts an in-flight save on unmount', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | null | undefined;
    respond = (_u, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    };
    const { unmount } = mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await waitFor(() => expect(signal).toBeTruthy());
    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('sends exactly one request under StrictMode', async () => {
    const user = userEvent.setup();
    respond = () => (fetchMock.mock.calls.length > 3 ? Promise.reject(new Error('loop')) : json({ id: '1' }, 201));
    mount(RANGE, true);
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
    await screen.findByRole('status');
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('works for a kind with no value field', async () => {
    const user = userEvent.setup();
    mount(OTHER);
    await user.type(screen.getByLabelText('Minutes'), '30');
    await user.click(screen.getByRole('button', { name: 'Save workout' }));
    await screen.findByRole('status');
    expect(body()).toEqual({ kind: 'workout', externalId: expect.any(String), data: { minutes: 30 } });
  });
});

describe('KindForm choice, numbers and stale state', () => {
  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Save range session' }));
  }

  it('starts every Choice blank and requires a choice before sending', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByLabelText('Surface (required)')).toHaveValue('');
    expect(screen.getByLabelText('Club')).toHaveValue('');
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await submit(user);
    expect(screen.getByText('Surface is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Surface (required)')).toHaveFocus();
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Grass');
    expect(screen.queryByText('Surface is required')).toBeNull();
    await submit(user);
    await screen.findByRole('status');
    expect(body().data.surface).toBe('Grass');
    expect(body().data).not.toHaveProperty('club');
  });

  it.each([
    ['1,5', 1.5],
    ['-2,25', -2.25],
    ['.5', 0.5],
    ['12.', 12],
    ['2,25', 2.25],
    ['3,1415', 3.1415],
    ['1,2345', 1.2345],
    ['1.234', 1.234],
    [',5', 0.5],
  ])('accepts %s as %s', async (typed, expected) => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), typed);
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await submit(user);
    await screen.findByRole('status');
    expect(body().data.balls).toBe(expected);
  });

  it.each(['1e3', '0x10', '+5', 'Infinity', 'NaN', '-', '.', '1,2,3', '1.234,5', '1,234.5'])(
    'rejects %s with no request',
    async (typed) => {
      const user = userEvent.setup();
      mount();
      await user.type(screen.getByLabelText('Balls hit (required)'), typed);
      await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
      await submit(user);
      expect(screen.getByText('Balls hit must be a number')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['1,234', '1,500', '-2,000'])('rejects ambiguous %s with guidance and no request', async (typed) => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), typed);
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await submit(user);
    expect(screen.getByText('Balls hit: type 1234 or 1.234 (no thousands separators).')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a number too large to send', async () => {
    const user = userEvent.setup();
    mount();
    fireEvent.change(screen.getByLabelText('Balls hit (required)'), { target: { value: '9'.repeat(400) } });
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await submit(user);
    expect(screen.getByText('Balls hit is too large')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears a field error as soon as that field is edited', async () => {
    const user = userEvent.setup();
    mount();
    await submit(user);
    expect(screen.getByText('Balls hit is required')).toBeInTheDocument();
    expect(screen.getByText('Surface is required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    expect(screen.queryByText('Balls hit is required')).toBeNull();
    expect(screen.getByText('Surface is required')).toBeInTheDocument();
  });

  it('clears the saved message as soon as the user edits again', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await submit(user);
    await screen.findByRole('status');
    await user.type(screen.getByLabelText('Balls hit (required)'), '2');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ignores a late response for a form that was replaced and aborts its request', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    let signal: AbortSignal | null | undefined;
    respond = (_u, init) => {
      signal = init?.signal;
      return new Promise((res) => (release = res));
    };
    const tree = (k: Kind) => (
      <MemoryRouter>
        <ApiProvider baseUrl="http://api.test">
          <KindForm key={k.key} kind={k} />
        </ApiProvider>
      </MemoryRouter>
    );
    const { rerender } = render(tree(RANGE));
    await user.type(screen.getByLabelText('Balls hit (required)'), '1');
    await user.selectOptions(screen.getByLabelText('Surface (required)'), 'Mat');
    await submit(user);
    await waitFor(() => expect(signal).toBeTruthy());
    rerender(tree(OTHER));
    expect(signal!.aborted).toBe(true);
    await user.type(screen.getByLabelText('Minutes'), '30');
    release(new Response('{"id":"1"}', { status: 201 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Minutes')).toHaveValue('30');
  });
});
