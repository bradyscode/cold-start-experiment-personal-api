import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../api/ApiProvider';
import type { Kind } from '../api/types';
import { KindForm } from './KindForm';

const RATING: Kind = {
  key: 'mood',
  displayName: 'Mood',
  defaultUnit: null,
  valueField: 'rating',
  fields: [
    { name: 'rating', type: 'Number', required: true, label: 'Mood (1-5)', min: 1, max: 5, integer: true },
    { name: 'hours', type: 'Number', required: false, min: 0, max: 24 },
    { name: 'cost', type: 'Number', required: false, min: 0 },
    { name: 'free', type: 'Number', required: false },
  ],
};

const OPTIONAL: Kind = {
  key: 'journal',
  displayName: 'Journal',
  defaultUnit: null,
  valueField: null,
  fields: [
    { name: 'text', type: 'Text', required: false },
    { name: 'done', type: 'Boolean', required: false },
  ],
};

const OTHER: Kind = { key: 'workout', displayName: 'Workout', defaultUnit: null, valueField: null, fields: [{ name: 'minutes', type: 'Number', required: true }] };

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  respond = () => json({ id: '1' }, 201);
  fetchMock = vi.fn((url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

function tree(kind: Kind) {
  return (
    <MemoryRouter>
      <ApiProvider baseUrl="http://api.test">
        <KindForm key={kind.key} kind={kind} />
      </ApiProvider>
    </MemoryRouter>
  );
}

const body = (call = 0) => JSON.parse(String(fetchMock.mock.calls[call]![1].body));
const save = (name: RegExp | string) => screen.getByRole('button', { name });

describe('number hints', () => {
  it('shows a hint under each bounded label and links it with aria-describedby', () => {
    render(tree(RATING));
    const rating = screen.getByLabelText('Mood (1-5) (required)');
    expect(screen.getByText('Whole number, 1 to 5')).toBeInTheDocument();
    expect(rating.getAttribute('aria-describedby')).toBe(screen.getByText('Whole number, 1 to 5').id);
    expect(screen.getByText('0 to 24')).toBeInTheDocument();
    expect(screen.getByText('At least 0')).toBeInTheDocument();
    expect(screen.getByLabelText('Free')).not.toHaveAttribute('aria-describedby');
  });

  it('uses a numeric keypad for whole numbers and decimal otherwise', () => {
    render(tree(RATING));
    expect(screen.getByLabelText('Mood (1-5) (required)')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('Hours')).toHaveAttribute('inputmode', 'decimal');
  });

  it('keeps hint and error both in aria-describedby', async () => {
    const user = userEvent.setup();
    render(tree(RATING));
    await user.type(screen.getByLabelText('Mood (1-5) (required)'), '6');
    await user.click(save('Save mood'));
    const ids = screen.getByLabelText('Mood (1-5) (required)').getAttribute('aria-describedby')!.split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[1]!)).toHaveTextContent('Mood (1-5) must be at most 5');
  });

  it.each([
    ['0', 'Mood (1-5) must be at least 1'],
    ['6', 'Mood (1-5) must be at most 5'],
    ['2.5', 'Mood (1-5) must be a whole number'],
    ['1000000000001', 'Mood (1-5) must be between -1,000,000,000,000 and 1,000,000,000,000'],
  ])('rejects %s before any request', async (typed, message) => {
    const user = userEvent.setup();
    render(tree(RATING));
    await user.type(screen.getByLabelText('Mood (1-5) (required)'), typed);
    await user.click(save('Save mood'));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mood (1-5) (required)')).toHaveFocus();
  });

  it.each(['1', '5', '3'])('sends %s on and inside the bounds', async (typed) => {
    const user = userEvent.setup();
    render(tree(RATING));
    await user.type(screen.getByLabelText('Mood (1-5) (required)'), typed);
    await user.click(save('Save mood'));
    await screen.findByRole('status');
    expect(body().data.rating).toBe(Number(typed));
  });

  it('applies the trillion bound to a field without declared bounds at the limit and one above, both signs', async () => {
    const user = userEvent.setup();
    render(tree(RATING));
    const free = screen.getByLabelText('Free');
    await user.type(screen.getByLabelText('Mood (1-5) (required)'), '3');
    await user.type(free, '-1000000000000');
    await user.click(save('Save mood'));
    await screen.findByRole('status');
    expect(body().data.free).toBe(-1e12);

    await user.type(screen.getByLabelText('Mood (1-5) (required)'), '3');
    await user.type(screen.getByLabelText('Free'), '-1000000000001');
    await user.click(save('Save mood'));
    expect(screen.getByText('Free must be between -1,000,000,000,000 and 1,000,000,000,000')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the comma-decimal rules', async () => {
    const user = userEvent.setup();
    render(tree(RATING));
    await user.type(screen.getByLabelText('Mood (1-5) (required)'), '3');
    await user.type(screen.getByLabelText('Hours'), '1,234');
    await user.click(save('Save mood'));
    expect(screen.getByText(/type 1234 or 1.234/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Hours'));
    await user.type(screen.getByLabelText('Hours'), '1,5');
    await user.click(save('Save mood'));
    await screen.findByRole('status');
    expect(body().data.hours).toBe(1.5);
  });
});

describe('future-dated saves', () => {
  async function saveWhen(offsetMs: number) {
    const user = userEvent.setup();
    render(tree(OTHER));
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    const at = new Date(Date.now() + offsetMs);
    const p = (n: number) => String(n).padStart(2, '0');
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}` },
    });
    await user.click(save('Save workout'));
    return await screen.findByRole('status');
  }

  it('says the record is dated in the future when When is days ahead', async () => {
    expect(await saveWhen(3 * 24 * 3600 * 1000)).toHaveTextContent('Saved. It is dated in the future, so it will show up in your feed on that day.');
  });

  it('keeps the normal message for a past time', async () => {
    expect(await saveWhen(-3600 * 1000)).toHaveTextContent('Saved. It will show up in your feed.');
  });

  it('uses the 60 second threshold exactly', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 30));
    const user = userEvent.setup();
    render(tree(OTHER));
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    // 12:01 is 30 s ahead (plus the seconds that elapsed): not future; 12:02 is ahead by more than 60 s.
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-06-01T12:01' } });
    await user.click(save('Save workout'));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. It will show up in your feed.');
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-06-01T12:02' } });
    await user.click(save('Save workout'));
    expect(await screen.findByText(/dated in the future/)).toBeInTheDocument();
  });
});

describe('empty submit', () => {
  it('shows "Fill in at least one field." and sends nothing when everything is blank', async () => {
    const user = userEvent.setup();
    render(tree(OPTIONAL));
    await user.click(save('Save journal'));
    expect(screen.getByText('Fill in at least one field.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Text')).toHaveFocus();
  });

  it('treats whitespace-only text as blank', async () => {
    const user = userEvent.setup();
    render(tree(OPTIONAL));
    await user.type(screen.getByLabelText('Text'), '   ');
    await user.click(save('Save journal'));
    expect(screen.getByText('Fill in at least one field.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['text', async (u: ReturnType<typeof userEvent.setup>) => u.type(screen.getByLabelText('Text'), 'x')],
    ['a ticked box', async (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByLabelText('Done'))],
    ['a title', async (u: ReturnType<typeof userEvent.setup>) => u.type(screen.getByLabelText('Title'), 'T')],
  ])('sends when there is %s', async (_n, act) => {
    const user = userEvent.setup();
    render(tree(OPTIONAL));
    await act(user);
    await user.click(save('Save journal'));
    await screen.findByRole('status');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the message when the user types', async () => {
    const user = userEvent.setup();
    render(tree(OPTIONAL));
    await user.click(save('Save journal'));
    await user.type(screen.getByLabelText('Text'), 'x');
    expect(screen.queryByText('Fill in at least one field.')).toBeNull();
  });

  it('does not apply when the kind has a required field (the required message wins)', async () => {
    const user = userEvent.setup();
    render(tree(OTHER));
    await user.click(save('Save workout'));
    expect(screen.getByText('Minutes is required')).toBeInTheDocument();
    expect(screen.queryByText('Fill in at least one field.')).toBeNull();
  });
});

describe('idempotency key', () => {
  it('keeps the same externalId across a retry after a network failure, then changes it after success', async () => {
    const user = userEvent.setup();
    respond = () => Promise.reject(new TypeError('offline'));
    render(tree(OTHER));
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    await user.click(save('Save workout'));
    await screen.findByRole('alert');
    respond = () => Promise.reject(new TypeError('offline'));
    await user.click(save('Save workout'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(body(1).externalId).toBe(body(0).externalId);
    expect(body(0).externalId).toMatch(/^[0-9a-f-]{36}$/);

    respond = () => json({ id: '1' }, 201);
    await screen.findByRole('alert');
    await user.click(save('Save workout'));
    await screen.findByRole('status');
    expect(body(2).externalId).toBe(body(0).externalId);

    await user.type(screen.getByLabelText('Minutes (required)'), '6');
    await user.click(save('Save workout'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(body(3).externalId).not.toBe(body(2).externalId);
  });

  it('keeps the id after a 5xx and drops it after a 409', async () => {
    const user = userEvent.setup();
    respond = () => json({}, 503);
    render(tree(OTHER));
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    await user.click(save('Save workout'));
    await screen.findByRole('alert');
    respond = () => json({ errors: ["externalId 'x' from source 'manual' is already used by a record of kind 'note'."] }, 409);
    await user.click(save('Save workout'));
    expect(await screen.findByText(/is already used by a record of kind 'note'/)).toBeInTheDocument();
    expect(body(1).externalId).toBe(body(0).externalId);
    respond = () => json({ id: '1' }, 201);
    await user.click(save('Save workout'));
    await screen.findByRole('status');
    expect(body(2).externalId).not.toBe(body(1).externalId);
  });

  it('uses a different id for a form of another tracker', async () => {
    const user = userEvent.setup();
    respond = () => json({}, 503);
    const { rerender } = render(tree(OTHER));
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    await user.click(save('Save workout'));
    await screen.findByRole('alert');
    rerender(tree(RATING));
    await user.type(screen.getByLabelText('Mood (1-5) (required)'), '3');
    await user.click(save('Save mood'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(body(1).externalId).not.toBe(body(0).externalId);
  });

  it('works without crypto.randomUUID (plain http)', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(1) });
    render(tree(OTHER));
    await user.type(screen.getByLabelText('Minutes (required)'), '5');
    await user.click(save('Save workout'));
    await screen.findByRole('status');
    expect(body().externalId).toBe('01010101-0101-4101-8101-010101010101');
  });
});
