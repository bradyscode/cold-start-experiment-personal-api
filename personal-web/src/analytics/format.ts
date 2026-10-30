import type { Agg } from '../api/types';
import type { Better, KindOverview } from './types';

const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const twoDp = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  return abs > 0 && abs < 1 ? twoDp.format(value) : full.format(value);
}

// 1,284 / 12.9K / 4.2M / 1.1B: for axes and dense cards.
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  const steps: [number, number, string][] = [
    [1e9, 1e9, 'B'],
    [1e6, 1e6, 'M'],
    [1e4, 1e3, 'K'],
  ];
  for (const [from, size, suffix] of steps) {
    if (abs >= from) return `${full.format(Number((value / size).toFixed(1)))}${suffix}`;
  }
  return formatValue(value);
}

export function unitFor(agg: Agg, unit: string | null, value?: number | null): string | null {
  if (agg === 'count') return value === 1 ? 'entry' : 'entries';
  return unit;
}

export function withUnit(value: number | null, agg: Agg, unit: string | null): string {
  const u = unitFor(agg, unit, value);
  const text = formatValue(value);
  return u && value !== null ? `${text} ${u}` : text;
}

export const AGG_NOUN: Record<Agg, string> = { sum: 'total', avg: 'average', max: 'highest', count: 'entries' };

export function rangeLabel(days: number): string {
  return days === 365 ? 'year' : `${days} days`;
}

const DAY_MS = 86_400_000;

export function relativeAge(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never';
  const diff = Math.max(0, now - t);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
}

export type Delta = {
  direction: 'up' | 'down' | 'flat' | 'new' | 'none';
  tone: 'good' | 'bad' | 'neutral';
  short: string;
  sentence: string;
};

// Tone follows the kind's better direction; "none" kinds (weight, spend) stay neutral.
export function deltaOf(k: Pick<KindOverview, 'value' | 'previousValue' | 'delta' | 'deltaPercent' | 'better'>, days: number): Delta {
  const period = `previous ${rangeLabel(days)}`;
  if (k.value === null || k.previousValue === null || k.delta === null) {
    return { direction: 'none', tone: 'neutral', short: 'No comparison', sentence: `no data to compare with the ${period}` };
  }
  if (k.delta === 0) return { direction: 'flat', tone: 'neutral', short: '0%', sentence: `unchanged vs ${period}` };
  if (k.deltaPercent === null) {
    return { direction: 'new', tone: tone(k.better ?? null, k.delta > 0), short: 'New', sentence: `new this period, nothing in the ${period}` };
  }
  const up = k.delta > 0;
  const pct = Math.abs(k.deltaPercent);
  const pctText = pct >= 10 ? Math.round(pct).toString() : pct.toFixed(1).replace(/\.0$/, '');
  return {
    direction: up ? 'up' : 'down',
    tone: tone(k.better ?? null, up),
    short: `${pctText}%`,
    sentence: `${up ? 'up' : 'down'} ${pctText} percent vs ${period}`,
  };
}

function tone(better: Better | null, up: boolean): Delta['tone'] {
  if (better === 'none') return 'neutral';
  const goodWhenUp = better !== 'lower';
  return up === goodWhenUp ? 'good' : 'bad';
}

export function pluralDays(n: number, noun = 'day'): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function formatR(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '–';
  return r.toFixed(2).replace('-', '−');
}
