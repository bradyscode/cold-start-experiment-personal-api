import { contrastRatio } from '../theme/palette';

export const CARD = '#171C25';
export const TEXT = '#F3F1EA';
export const INK_DARK = '#10141A';

// Validated with the dataviz palette checker on #171C25: lightness band, chroma, adjacent CVD dE >= 8, normal dE >= 15, >= 3:1.
export const CATEGORY_ORDER = ['Health', 'Fitness', 'Code', 'Hobbies', 'Reading and media', 'Money', 'Life'] as const;
export const CATEGORY_HUES = ['#14A88A', '#E8541C', '#4A7FFF', '#B98415', '#9A6CF0', '#2296BF', '#D9508C'] as const;
export const OTHER = 'Other';
export const OTHER_COLOR = '#8A93A3';

// Compare series take slots in selection order; the eighth is a light neutral that still reads on the card.
export const SLOT_COLORS = [...CATEGORY_HUES, '#D9D6CC'] as const;

export function categoryOf(category: string | null | undefined): string {
  const c = category?.trim();
  return c && (CATEGORY_ORDER as readonly string[]).includes(c) ? c : OTHER;
}

export function categoryColor(category: string | null | undefined): string {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(categoryOf(category));
  return i >= 0 ? CATEGORY_HUES[i]! : OTHER_COLOR;
}

export function categoryRank(category: string): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return i >= 0 ? i : CATEGORY_ORDER.length;
}

export function slotColor(index: number): string {
  return SLOT_COLORS[((index % SLOT_COLORS.length) + SLOT_COLORS.length) % SLOT_COLORS.length]!;
}

// Empty day, then four steps of one blue hue; every filled step clears 3:1 on the card.
export const HEAT_COLORS = ['#232A36', '#3567D6', '#4A7FFF', '#7FA6FF', '#B9CEFF'] as const;

export function heatLevel(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c ?? 0))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return rgbToHex(x.map((v, i) => v + (y[i]! - v) * k));
}

// Diverging: orange for negative r, gray at zero, blue for positive r. Poles are deep enough that light text reads at 4.5:1 on every step.
export const DIVERGING = { negative: '#C2410C', neutral: '#2E3542', positive: '#2D62D8' } as const;

export function divergingColor(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '#1E242F';
  const t = Math.min(1, Math.abs(r));
  return mix(DIVERGING.neutral, r < 0 ? DIVERGING.negative : DIVERGING.positive, t);
}

export function inkOn(fill: string): string {
  return contrastRatio(fill, TEXT) >= contrastRatio(fill, INK_DARK) ? TEXT : INK_DARK;
}

// Older scatter points shift toward a muted gray that still clears 3:1, rather than fading out with opacity.
export function ageColor(accent: string, age: number): string {
  return mix(accent, OTHER_COLOR, Math.min(1, Math.max(0, age)) * 0.85);
}
