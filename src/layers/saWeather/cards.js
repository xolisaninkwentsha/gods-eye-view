/** Card models for selected SA weather warning areas. Pure — no Cesium types. */

import { t, formatDate } from '../../i18n/index.js';
import { saWeatherBandAccent, saWeatherBandRank } from './records.js';

const SAST = 'Africa/Johannesburg';
const SAST_OFFSET_MS = 2 * 3600 * 1000; // SAST has no daylight saving.
const DAY_MS = 24 * 3600 * 1000;
const DESCRIPTION_CAP = 200;
const INSTRUCTION_CAP = 160;

const DAY_PART = Object.freeze({ weekday: 'short', timeZone: SAST });
const DATE_NUMBER = Object.freeze({ day: 'numeric', timeZone: SAST });
const DATE_MONTH = Object.freeze({ month: 'short', timeZone: SAST });
const CLOCK = Object.freeze({
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: SAST,
});

const clock = (ms) => formatDate(ms, CLOCK);
const sastDay = (ms) => Math.floor((ms + SAST_OFFSET_MS) / DAY_MS);

function sastDate(ms) {
  return `${formatDate(ms, DAY_PART)} ${formatDate(ms, DATE_NUMBER)} ${formatDate(ms, DATE_MONTH)}`;
}

/** "Tue 24 Nov 13:00" in South African time, whatever the machine's zone. */
export function formatSastTime(ms) {
  return `${sastDate(ms)} ${clock(ms)}`;
}

/** One day: "Tue 24 Nov 13:00–22:59 SAST"; otherwise both days are named. */
export function formatSastRange(startMs, endMs) {
  if (sastDay(startMs) === sastDay(endMs))
    return `${sastDate(startMs)} ${clock(startMs)}–${clock(endMs)} SAST`;
  return `${formatSastTime(startMs)} – ${formatSastTime(endMs)} SAST`;
}

function cut(text, cap) {
  const s = typeof text === 'string' ? text.trim() : '';
  return s.length > cap ? `${s.slice(0, cap - 1)}…` : s;
}

function bandWord(band) {
  if (band === 'red') return t('Red');
  if (band === 'orange') return t('Orange');
  return t('Yellow');
}

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

/** The card for one warning area: each warning worst first (as the route sorts them), then the source. */
export function buildSaWeatherCard(area) {
  const warnings = Array.isArray(area.warnings) ? area.warnings : [];
  const worst = warnings.reduce(
    (best, w) =>
      saWeatherBandRank(w.band) > saWeatherBandRank(best) ? w.band : best,
    null,
  );
  const details = [];
  for (const w of warnings) {
    details.push(
      Number.isFinite(w.level)
        ? t('{band} · Level {level} · {event}', {
            band: bandWord(w.band),
            level: w.level,
            event: w.event,
          })
        : `${w.levelText} · ${w.event}`,
    );
    details.push(formatSastRange(w.onsetMs ?? w.sentMs, w.expiresMs));
    details.push(t('Issued {time}', { time: formatSastTime(w.sentMs) }));
    const description = cut(w.description, DESCRIPTION_CAP);
    if (description) details.push(description);
    const instruction = cut(w.instruction, INSTRUCTION_CAP);
    if (instruction) details.push(instruction);
  }
  details.push(t('Source: South African Weather Service'));
  return entry(
    `sa-weather-card:${area.stableId}`,
    area.name,
    details,
    saWeatherBandAccent(worst),
  );
}
