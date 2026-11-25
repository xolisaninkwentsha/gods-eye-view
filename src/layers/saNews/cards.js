/** Card model for a selected SA news story. Pure — no Cesium types, no link opening. */

import { t } from '../../i18n/index.js';
import { formatSastTime } from '../saWeather/cards.js';
import { SA_NEWS_KINDS } from './records.js';

export { SA_NEWS_KINDS } from './records.js';

const LINE_CAP = 90;
const cut = (line) =>
  line.length > LINE_CAP ? `${line.slice(0, LINE_CAP - 1)}…` : line;

function relativeAgo(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return t('just now');
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return t('<1m ago');
  if (minutes < 90) return t('{count}m ago', { count: minutes });
  return t('{count}h ago', { count: Math.round(minutes / 60) });
}

/** The card for one story; the layer attaches the `activate` callback. */
export function buildSaNewsCard(story, nowMs) {
  const kind = SA_NEWS_KINDS.find((k) => k.key === story.kind);
  const ago = relativeAgo(nowMs - story.publishedAt);
  const details = [];
  if (story.place) details.push(story.place);
  details.push(
    `${story.source} · ${ago} (${formatSastTime(story.publishedAt)} SAST)`,
  );
  if (kind) details.push(t(kind.label));
  details.push(t('Click to open the story ↗'));
  return {
    id: `sa-news-card:${story.id}`,
    selected: true,
    interactive: true,
    accessibilityLabel: t('Open the story: {title}', { title: story.title }),
    title: cut(story.title),
    details: details.map(cut),
    accent: kind?.color,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
