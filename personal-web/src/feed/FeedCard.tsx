import { Link } from 'react-router-dom';
import type { FeedCard as Card } from '../api/types';
import { colorForKind } from '../theme/palette';

export function chartPath({ chart }: Card): string {
  const q = new URLSearchParams({ bucket: chart.bucket, agg: chart.agg, days: String(chart.days) });
  return `/chart/${encodeURIComponent(chart.kind)}?${q.toString()}`;
}

const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function shouldShowUnit(unit: string | null, headline: string): unit is string {
  if (!unit) return false;
  if (unit.length <= 2) return true;
  return !new RegExp('\\b' + escapeRegExp(unit) + 's?\\b', 'i').test(headline);
}

// Only the first card's skip link is a tab stop; the rest stay clickable but out of the tab order.
export function FeedCard({ card, skipTabbable = true }: { card: Card; skipTabbable?: boolean }) {
  const { bg, fg } = colorForKind(card.kind);
  const showUnit = shouldShowUnit(card.unit, card.headline);
  const label = `${card.big}${showUnit ? ` ${card.unit}` : ''}. ${card.headline}.${card.detail ? ` ${card.detail}` : ''}`;

  return (
    <article className="feed-card" style={{ backgroundColor: bg, color: fg }}>
      <Link to="/dashboards" className="feed-skip" tabIndex={skipTabbable ? undefined : -1}>
        Skip to dashboards
      </Link>
      <Link to={chartPath(card)} className="feed-card-link" aria-label={label}>
        <span className="feed-big display">{card.big}</span>
        {showUnit && <span className="feed-unit">{card.unit}</span>}
        <span className="feed-headline">{card.headline}</span>
        {card.detail && <span className="feed-detail">{card.detail}</span>}
      </Link>
    </article>
  );
}
