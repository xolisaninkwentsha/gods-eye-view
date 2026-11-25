// Parsers for the two HDX files behind /api/sa-facilities. Every string is
// capped at 120 characters; records without a finite position inside the
// South African box are dropped.

// The same values as SA_GRID_BOX in src/layers/saPopulation/grid.js, kept here
// so the server does not import from src/layers.
const SA_BOX = Object.freeze({
  west: 16,
  south: -35.5,
  east: 33.5,
  north: -22,
});
const MAX_TEXT = 120;
const HEALTH_KINDS = new Set([
  'hospital',
  'clinic',
  'doctors',
  'pharmacy',
  'dentist',
]);

const coded = (code) => Object.assign(new Error(code), { code });

function cap(value) {
  if (typeof value !== 'string') return '';
  let out = value.trim().slice(0, MAX_TEXT);
  // Never end on half of a surrogate pair.
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  return out;
}

const inBox = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lon >= SA_BOX.west &&
  lon <= SA_BOX.east &&
  lat >= SA_BOX.south &&
  lat <= SA_BOX.north;

const isPosition = (p) =>
  Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number';

/** Mean of a ring's vertices, not counting a closing vertex repeated. */
function ringMean(ring) {
  if (!Array.isArray(ring) || !ring.every(isPosition) || ring.length === 0)
    return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const vertices = closed ? ring.slice(0, -1) : ring;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of vertices) {
    lon += x;
    lat += y;
  }
  return { lon: lon / vertices.length, lat: lat / vertices.length };
}

function position(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  const c = geometry.coordinates;
  if (geometry.type === 'Point')
    return isPosition(c) ? { lon: c[0], lat: c[1] } : null;
  if (geometry.type === 'Polygon') return ringMean(c?.[0]);
  if (geometry.type === 'MultiPolygon') return ringMean(c?.[0]?.[0]);
  return null;
}

/**
 * healthsites.io GeoJSON to `{id, name, kind, lat, lon, operator?, city?}`.
 * Throws PARSE_FAILED when the text is not a feature collection.
 */
export function parseHealthSites(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw coded('PARSE_FAILED');
  }
  if (!Array.isArray(json?.features)) throw coded('PARSE_FAILED');
  const records = [];
  for (const feature of json.features) {
    const props = feature?.properties;
    if (!props || typeof props !== 'object') continue;
    const at = position(feature.geometry);
    if (!at || !inBox(at.lat, at.lon)) continue;
    const osmId = props.osm_id;
    const osmType = cap(String(props.osm_type ?? ''));
    if ((typeof osmId !== 'number' && typeof osmId !== 'string') || !osmType)
      continue;
    const amenity = typeof props.amenity === 'string' ? props.amenity : '';
    const record = {
      id: cap(`${osmType}/${osmId}`),
      name: cap(props.name) || null,
      kind: HEALTH_KINDS.has(amenity) ? amenity : 'other',
      lat: at.lat,
      lon: at.lon,
    };
    const operator = cap(props.operator);
    if (operator) record.operator = operator;
    const city = cap(props.addr_city);
    if (city) record.city = city;
    records.push(record);
  }
  return records;
}

/** RFC 4180 rows of fields; quotes may hold commas, doubled quotes and newlines. */
function csvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(field);
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && field === '' && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length > 0 || wasQuoted) endRow();
  return rows;
}

const LEVELS = new Map([
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['primary and secondary', 'Primary and Secondary'],
  ['pre-primary', 'Pre-Primary'],
  ['other', 'Other'],
]);

const number = (value) => {
  const s = String(value ?? '').trim();
  return s === '' ? NaN : Number(s);
};

/**
 * Giga schools CSV to `{id, name, lat, lon, level, connectivity}`. `id` is
 * `school:<n>`, n counting the data rows from 1 (blank lines excluded), so it
 * holds still when a row is dropped. Throws PARSE_FAILED without the
 * longitude and latitude columns.
 */
export function parseGigaSchools(text) {
  const rows = csvRows(String(text).replace(/^﻿/, ''));
  if (rows.length === 0) throw coded('PARSE_FAILED');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(
    [
      'school_name',
      'longitude',
      'latitude',
      'education_level',
      'connectivity',
    ].map((name) => [name, header.indexOf(name)]),
  );
  if (col.longitude < 0 || col.latitude < 0) throw coded('PARSE_FAILED');
  const records = [];
  let n = 0;
  for (const fields of rows.slice(1)) {
    if (fields.length === 1 && fields[0].trim() === '') continue;
    n += 1;
    const lat = number(fields[col.latitude]);
    const lon = number(fields[col.longitude]);
    if (!inBox(lat, lon)) continue;
    const level = String(fields[col.education_level] ?? '')
      .trim()
      .toLowerCase();
    const link = String(fields[col.connectivity] ?? '')
      .trim()
      .toLowerCase();
    records.push({
      id: `school:${n}`,
      name: cap(fields[col.school_name]) || null,
      lat,
      lon,
      level: LEVELS.get(level) ?? 'Unknown',
      connectivity: link === 'yes' || link === 'no' ? link : 'unknown',
    });
  }
  return records;
}
