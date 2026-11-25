/** Records for the SA news layer: normaliser, kinds and dot placement. No Cesium. */

import { msg } from '../../i18n/index.js';

export const SA_NEWS_KINDS = Object.freeze([
  { key: 'violence', label: msg('Violence'), color: '#eb5757' },
  { key: 'protest', label: msg('Protest'), color: '#f2994a' },
  { key: 'event', label: msg('Other event'), color: '#8fa6bf' },
  { key: 'headline', label: msg('Headline'), color: '#2bb3a3' },
]);

const KIND_KEYS = new Set(SA_NEWS_KINDS.map((k) => k.key));
const M_PER_DEG_LAT = 111_320;
// A sunflower's nearest neighbours sit about 1.4 radius-units apart, so the
// radius is scaled to keep neighbours near spacingM (0.7x to 1.2x for 54 dots).
const RADIUS_SCALE = 0.7;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function httpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const inRange = (v, limit) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;

function normalizeStory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (!KIND_KEYS.has(raw.kind)) return null;
  if (typeof raw.title !== 'string' || raw.title.trim() === '') return null;
  if (!httpUrl(raw.url)) return null;
  if (!inRange(raw.lat, 90) || !inRange(raw.lon, 180)) return null;
  if (typeof raw.publishedAt !== 'number' || !Number.isFinite(raw.publishedAt))
    return null;
  return {
    id: raw.id,
    kind: raw.kind,
    title: raw.title,
    url: raw.url,
    source: typeof raw.source === 'string' ? raw.source : '',
    publishedAt: raw.publishedAt,
    place: typeof raw.place === 'string' ? raw.place : '',
    lat: raw.lat,
    lon: raw.lon,
    via: Array.isArray(raw.via)
      ? raw.via.filter((v) => typeof v === 'string')
      : [],
  };
}

/** @returns {{stories: object[], status: ?object} | null} */
export function normalizeSaNews(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.stories)) return null;
  const stories = [];
  for (const raw of payload.stories) {
    const story = normalizeStory(raw);
    if (story) stories.push(story);
  }
  const { status } = payload;
  return {
    stories,
    status: status && typeof status === 'object' ? status : null,
  };
}

/** Sunflower spiral in metres from the place; index 0 sits at the centre. */
export function spiralOffsets(n, spacingM = 700) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = spacingM * RADIUS_SCALE * Math.sqrt(i);
    const a = i * GOLDEN_ANGLE;
    out.push({ east: r * Math.sin(a), north: r * Math.cos(a) });
  }
  return out;
}

/**
 * Spread the stories of one place on a spiral, newest at the centre. The
 * place's own position stays in placeLat/placeLon.
 */
export function placeStories(stories) {
  const groups = new Map();
  for (const s of stories) {
    const key = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        b.publishedAt - a.publishedAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const offsets = spiralOffsets(group.length);
    group.forEach((s, i) => {
      const cos = Math.cos((s.lat * Math.PI) / 180);
      out.push({
        ...s,
        placeLat: s.lat,
        placeLon: s.lon,
        lat: s.lat + offsets[i].north / M_PER_DEG_LAT,
        lon: s.lon + offsets[i].east / (M_PER_DEG_LAT * cos),
      });
    });
  }
  return out;
}
