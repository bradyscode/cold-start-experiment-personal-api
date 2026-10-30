export const PALETTE = ['#3F7BFF', '#1FBF9F', '#FF5A1F', '#E3A72F', '#B4471F', '#D9D6CC'] as const;

const DARK = '#10141A';
const LIGHT = '#F3F1EA';

const SEEDED: Record<string, string> = {
  note: '#D9D6CC',
  range_session: '#FF5A1F',
  workout: '#E3A72F',
  book_finished: '#D9D6CC',
};

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return h;
}

export function colorForKind(key: string): { bg: string; fg: string } {
  const bg = SEEDED[key] ?? PALETTE[hashKey(key) % PALETTE.length] ?? PALETTE[0];
  const fg = contrastRatio(bg, DARK) >= contrastRatio(bg, LIGHT) ? DARK : LIGHT;
  return { bg, fg };
}
