/** Normalize the SA elections route payload and colour its areas. Pure — no Cesium types. */

import { partyStyle } from './parties.js';

export const SA_ELECTIONS_OVERLAY_SOURCE = Object.freeze({
  councils: 'sa-councils-2026',
  wards: 'sa-wards-2026',
});

const STATUSES = new Set(['off', 'loading', 'ok', 'stale', 'failed']);

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

const text = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {object} payload route answer
 * @param {'councils'|'wards'} _level
 * @returns {{status: string, resultsAsOf: number|null, rows: object[]}}
 */
export function normalizeSaElectionsPayload(payload, _level) {
  const status = STATUSES.has(payload?.results) ? payload.results : 'failed';
  const resultsAsOf = Number.isFinite(payload?.resultsAsOf)
    ? payload.resultsAsOf
    : null;
  const rows = [];
  for (const area of Array.isArray(payload?.areas) ? payload.areas : []) {
    if (!area || typeof area !== 'object') continue;
    if (!text(area.id) || !text(area.name) || !validPolygons(area.polygons))
      continue;
    rows.push({ ...area, stableId: area.id, result: area.result ?? null });
  }
  return { status, resultsAsOf, rows };
}

const NONE = Object.freeze({ color: null, strength: null });

/**
 * Fill colour for an area. Null colour means outline only.
 * @returns {{color: string|null, strength: 'strong'|'faint'|null}}
 */
export function saAreaColor(row, level) {
  const result = row?.result;
  if (!result) return NONE;
  if (level === 'wards') {
    if (result.tie || !result.winner) return NONE;
    return { color: partyStyle(result.winner.party).color, strength: 'strong' };
  }
  if (!result.largest) return NONE;
  return {
    color: partyStyle(result.largest.party).color,
    strength: result.majority ? 'strong' : 'faint',
  };
}
