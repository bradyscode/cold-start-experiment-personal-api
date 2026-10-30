import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeLegacyStorage } from './legacyCleanup';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('removeLegacyStorage', () => {
  it('removes the old stored value and leaves other entries alone', () => {
    localStorage.setItem('pa.apiKey', 'old');
    localStorage.setItem('other', 'keep');
    removeLegacyStorage();
    expect(localStorage.getItem('pa.apiKey')).toBeNull();
    expect(localStorage.getItem('other')).toBe('keep');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => removeLegacyStorage()).not.toThrow();
  });
});
