/** Card models for selected SA earthquakes. Pure — no Cesium types. */

import { t } from '../../i18n/index.js';
import {
  earthquakeMagnitudeTitle,
  earthquakeSeverityName,
} from '../earthquakes/model.js';
import { formatSastTime } from '../saWeather/cards.js';

export { SA_QUAKE_OVERLAY_SOURCE_ID as SA_QUAKES_OVERLAY_SOURCE_ID } from './records.js';

const DAY_MS = 24 * 3600 * 1000;

/** Dot and card colour by how recent the event is. */
export const SA_QUAKE_AGE_ACCENTS = Object.freeze({
  day: '#eb5757',
  week: '#f2994a',
  month: '#f2c94c',
});

/** @returns {'day' | 'week' | 'month'} under 24 h, under 7 days, otherwise older. */
export function saQuakeAgeBand(timeMs, nowMs) {
  const age = nowMs - timeMs;
  if (age < DAY_MS) return 'day';
  if (age < 7 * DAY_MS) return 'week';
  return 'month';
}

/** Dot diameter: 6 px up to M2, growing 3 px per magnitude, capped at 16 px. */
export const saQuakeDotPx = (mag) =>
  Math.min(16, Math.max(6, 6 + 3 * (mag - 2)));

function entry(id, title, details, accent) {
  return {
    id,
    selected: true,
    interactive: false,
    title,
    details,
    accent,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** The card for one event: magnitude and class, place, SAST time, network, source. */
export function buildSaQuakeCard(row, nowMs) {
  const details = [];
  if (row.region) details.push(row.region);
  details.push(`${formatSastTime(row.timeMs)} SAST`);
  if (row.network)
    details.push(t('Network: {network}', { network: row.network }));
  details.push(t('Source: EMSC-CSEM SeismicPortal'));
  return entry(
    `sa-quake-card:${row.stableId}`,
    `${earthquakeMagnitudeTitle(row.mag)} · ${earthquakeSeverityName(row.mag, t)}`,
    details,
    SA_QUAKE_AGE_ACCENTS[saQuakeAgeBand(row.timeMs, nowMs)],
  );
}
