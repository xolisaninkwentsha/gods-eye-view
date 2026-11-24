/** Normalize the SA governance route payloads. Pure — no Cesium types. */

const STATUSES = new Set(['ok', 'stale', 'failed']);

const text = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

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

function normalizeAudits(audits) {
  if (!isObject(audits) || !Number.isFinite(audits.year)) return null;
  if (!isObject(audits.byCode)) return null;
  const byCode = new Map();
  for (const [code, entry] of Object.entries(audits.byCode)) {
    if (!isObject(entry) || !text(entry.opinion) || !text(entry.label))
      continue;
    byCode.set(code, { opinion: entry.opinion, label: entry.label });
  }
  return { year: audits.year, byCode };
}

function rowMap(rows, accept) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isObject(row) && text(row.code) && accept(row)) map.set(row.code, row);
  }
  return map;
}

function normalizeDistrictOf(districtOf) {
  const map = new Map();
  if (!isObject(districtOf)) return map;
  for (const [code, d] of Object.entries(districtOf)) {
    if (isObject(d) && text(d.code) && text(d.name)) {
      map.set(code, { code: d.code, name: d.name });
    }
  }
  return map;
}

/**
 * @param {object} payload GET /api/sa-governance answer
 * @returns {object|null} null when the payload is not an object
 */
export function normalizeGovernance(payload) {
  if (!isObject(payload)) return null;
  const interventions = isObject(payload.interventions)
    ? payload.interventions
    : {};
  return {
    audits: normalizeAudits(payload.audits),
    auditsStatus: STATUSES.has(payload.auditsStatus)
      ? payload.auditsStatus
      : 'failed',
    interventions: rowMap(interventions.rows, () => true),
    interventionsAsOf: text(interventions.asOf) ? interventions.asOf : null,
    interventionsSource: text(interventions.source)
      ? interventions.source
      : null,
    metros: rowMap(payload.metros?.rows, () => true),
    districtOf: normalizeDistrictOf(payload.districtOf),
  };
}

/**
 * @param {object} payload GET /api/sa-governance/districts answer
 * @returns {{areas: object[], stale: boolean, fetchedAt: number|null}|null}
 */
export function normalizeDistricts(payload) {
  if (!isObject(payload) || !Array.isArray(payload.areas)) return null;
  const areas = [];
  for (const area of payload.areas) {
    if (!isObject(area)) continue;
    if (!text(area.id) || !text(area.name) || !validPolygons(area.polygons))
      continue;
    const members = (Array.isArray(area.members) ? area.members : []).filter(
      (m) => isObject(m) && text(m.code) && text(m.name),
    );
    areas.push({
      ...area,
      stableId: area.id,
      members: members.map((m) => ({ code: m.code, name: m.name })),
    });
  }
  return {
    areas,
    stale: payload.stale === true,
    fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : null,
  };
}
