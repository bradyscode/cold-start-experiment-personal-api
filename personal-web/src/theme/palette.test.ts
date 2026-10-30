import { describe, expect, it } from 'vitest';
import { colorForKind, contrastRatio, PALETTE } from './palette';

describe('colorForKind', () => {
  it('returns the seeded colors', () => {
    expect(colorForKind('note').bg).toBe('#D9D6CC');
    expect(colorForKind('range_session').bg).toBe('#FF5A1F');
    expect(colorForKind('workout').bg).toBe('#E3A72F');
    expect(colorForKind('book_finished').bg).toBe('#D9D6CC');
  });

  it('is stable for the same key and picks a palette color for unknown kinds', () => {
    const a = colorForKind('sleep_hours');
    expect(colorForKind('sleep_hours')).toEqual(a);
    expect(PALETTE).toContain(a.bg);
  });

  it('picks the higher-contrast text color, >= 4.5 for every palette color', () => {
    for (const bg of PALETTE) {
      const dark = contrastRatio(bg, '#10141A');
      const light = contrastRatio(bg, '#F3F1EA');
      const { fg } = colorForKindByBg(bg);
      expect(contrastRatio(bg, fg)).toBe(Math.max(dark, light));
      expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function colorForKindByBg(bg: string) {
  const seeded = { '#D9D6CC': 'note', '#FF5A1F': 'range_session', '#E3A72F': 'workout' } as Record<string, string>;
  const direct = seeded[bg];
  if (direct) return colorForKind(direct);
  for (let i = 0; i < 1000; i++) {
    const c = colorForKind(`probe-${i}`);
    if (c.bg === bg) return c;
  }
  throw new Error(`no key hashes to ${bg}`);
}
