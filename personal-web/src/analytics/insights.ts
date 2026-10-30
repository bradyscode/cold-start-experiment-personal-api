import { daysSince, formatR, rangeLabel } from './format';
import type { KindOverview, PairResult } from './types';

export type Insight = { id: string; text: string; href: string; linkLabel: string };

export function chartHref(k: Pick<KindOverview, 'kind' | 'agg'>, days: number): string {
  const bucket = days > 90 ? 'week' : 'day';
  return `/chart/${encodeURIComponent(k.kind)}?bucket=${bucket}&agg=${k.agg}&days=${days}`;
}

export function compareHref(kinds: string[], days: number, pair?: [string, string]): string {
  const q = new URLSearchParams({ kinds: kinds.join(','), range: String(days) });
  if (pair) q.set('pair', pair.join(','));
  return `/compare?${q.toString()}`;
}

const MIN_PREVIOUS_ENTRIES = 3;
// Many pairs are checked at once, so only strong correlations over enough days are worth a sentence.
export const MIN_CORRELATION_DAYS = 20;
export const MIN_CORRELATION_R = 0.5;
const MAX_CORRELATION_INSIGHTS = 2;

// Honest wording only: "may be related" / "tended to move together" is association, never cause.
export function buildInsights(allKinds: KindOverview[], pairs: PairResult[] | null, days: number, now: number): Insight[] {
  const kinds = allKinds.filter((k) => !k.error);
  const out: Insight[] = [];
  const names = new Map(kinds.map((k) => [k.kind, k]));
  const period = `the previous ${rangeLabel(days)}`;

  const checked = (pairs ?? []).filter((p) => p.r !== null && names.has(p.a) && names.has(p.b));
  const qualifying =
    days < MIN_CORRELATION_DAYS
      ? []
      : checked.filter((p) => p.n >= MIN_CORRELATION_DAYS && Math.abs(p.r!) >= MIN_CORRELATION_R).sort((x, y) => Math.abs(y.r!) - Math.abs(x.r!));
  qualifying.slice(0, MAX_CORRELATION_INSIGHTS).forEach((p, i) => {
    const a = names.get(p.a)!;
    const b = names.get(p.b)!;
    const how = p.r! > 0 ? 'tended to move together' : 'tended to move in opposite directions';
    const tally = i === 0 ? ` Strongest of ${checked.length} ${checked.length === 1 ? 'pair' : 'pairs'} checked.` : '';
    out.push({
      id: `correlation-${i}`,
      text: `${a.displayName} and ${b.displayName} may be related: they ${how} (r ${formatR(p.r)} over ${p.n} days).${tally}`,
      href: compareHref([a.kind, b.kind], days, [a.kind, b.kind]),
      linkLabel: `Compare ${a.displayName} and ${b.displayName}`,
    });
  });

  const movers = kinds.filter((k) => k.deltaPercent !== null && k.previousEntries >= MIN_PREVIOUS_ENTRIES);
  const up = [...movers].sort((x, y) => y.deltaPercent! - x.deltaPercent!)[0];
  if (up && up.deltaPercent! > 0) {
    out.push({
      id: 'up',
      text: `${up.displayName} rose ${Math.round(up.deltaPercent!)} percent vs ${period}.`,
      href: chartHref(up, days),
      linkLabel: `Open ${up.displayName} chart`,
    });
  }
  const down = [...movers].sort((x, y) => x.deltaPercent! - y.deltaPercent!)[0];
  if (down && down.deltaPercent! < 0) {
    out.push({
      id: 'down',
      text: `${down.displayName} fell ${Math.round(Math.abs(down.deltaPercent!))} percent vs ${period}.`,
      href: chartHref(down, days),
      linkLabel: `Open ${down.displayName} chart`,
    });
  }

  const streak = [...kinds].filter((k) => k.currentStreak >= 2).sort((x, y) => y.currentStreak - x.currentStreak)[0];
  if (streak) {
    out.push({
      id: 'streak',
      text: `${streak.displayName} is on a ${streak.currentStreak}-day streak, the longest running right now.`,
      href: chartHref(streak, days),
      linkLabel: `Open ${streak.displayName} chart`,
    });
  }

  const quiet = kinds
    .map((k) => ({ k, idle: daysSince(k.lastEntryAt, now) }))
    .filter((x): x is { k: KindOverview; idle: number } => x.idle !== null && x.idle >= 3)
    .sort((x, y) => y.idle - x.idle)[0];
  if (quiet && out.length < 5) {
    out.push({
      id: 'quiet',
      text: `${quiet.k.displayName} is the quietest tracker: nothing logged for ${quiet.idle} days.`,
      href: chartHref(quiet.k, days),
      linkLabel: `Open ${quiet.k.displayName} chart`,
    });
  }

  return out.slice(0, 5);
}
