const LEGACY_STORAGE_KEY = 'pa.apiKey';

// Older versions stored a secret here; remove it so it does not linger in the browser.
export function removeLegacyStorage(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // storage blocked; nothing to remove
  }
}
