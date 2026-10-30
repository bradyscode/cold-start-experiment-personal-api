import { afterEach, describe, expect, it, vi } from 'vitest';
import { newExternalId } from './externalId';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('newExternalId', () => {
  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'from-randomUUID' });
    expect(newExternalId()).toBe('from-randomUUID');
  });

  it('falls back to a v4 UUID built from getRandomValues', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(255) });
    const id = newExternalId();
    expect(id).toMatch(V4);
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('falls back to Math.random without crypto', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = new Set(Array.from({ length: 50 }, newExternalId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
