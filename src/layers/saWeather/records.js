/** Normalize the SA weather warnings route body. Pure — no Cesium types, no i18n. */

export const SA_WEATHER_OVERLAY_SOURCE_ID = 'sa-weather-warnings';
export const SA_WEATHER_BANDS = Object.freeze(['yellow', 'orange', 'red']);

const RANKS = { yellow: 1, orange: 2, red: 3 };
const ACCENTS = {
  yellow: '#f2c94c',
  orange: '#f2994a',
  red: '#eb5757',
};
const NO_BAND_ACCENT = '#9aa4ad';

/** null 0, yellow 1, orange 2, red 3. */
export function saWeatherBandRank(band) {
  return RANKS[band] ?? 0;
}

export function saWeatherBandAccent(band) {
  return ACCENTS[band] ?? NO_BAND_ACCENT;
}

function validRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  return ring.every(
    (p) =>
      Array.isArray(p) &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      Math.abs(p[0]) <= 180 &&
      Math.abs(p[1]) <= 90,
  );
}

function validPolygons(polygons) {
  return (
    Array.isArray(polygons) &&
    polygons.length > 0 &&
    polygons.every(
      (rings) =>
        Array.isArray(rings) && rings.length > 0 && rings.every(validRing),
    )
  );
}

/**
 * Keep the areas the map and cards can use: a string stableId, a valid
 * polygon and at least one warning with a finite expiry.
 * @returns {object[]|null} null when the input is not an array
 */
export function normalizeSaWeatherAreas(areas) {
  if (!Array.isArray(areas)) return null;
  const rows = [];
  for (const area of areas) {
    if (!area || typeof area !== 'object') continue;
    if (typeof area.stableId !== 'string' || area.stableId === '') continue;
    if (!validPolygons(area.polygons)) continue;
    if (
      !Array.isArray(area.warnings) ||
      !area.warnings.some((w) => w && Number.isFinite(w.expiresMs))
    )
      continue;
    rows.push(area);
  }
  return rows;
}
