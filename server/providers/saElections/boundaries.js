import { readResponseJsonCapped } from '../common/http.js';

// Municipal Demarcation Board 2026 boundaries (public, keyless ArcGIS
// FeatureServers). Simplified server-side so a full ward page stays small.
export const MDB_LAYERS = Object.freeze({
  councils:
    'https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_L_ocal_Municipalities_2026/FeatureServer/0',
  wards:
    'https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_Wards_2026/FeatureServer/0',
  districts:
    'https://services7.arcgis.com/oeoyTUJC8HEeYsRB/arcgis/rest/services/MDB_District_Municipalities_2026/FeatureServer/0',
});

const OUT_FIELDS = {
  councils: 'CAT_B,MUNICNAME,PROVINCE,CATEGORY',
  wards: 'WardID,CAT_B,WardNo,MUNICNAME,Province',
  districts: 'DISTRICT,DISTRICT_N,CATEGORY,PROVINCE',
};

const MAX_PAGES = 5;
const PAGE_SIZE = 2000;
const PAGE_CAP_BYTES = 16 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 90_000;
const USER_AGENT = 'GodsEyeView (sa-elections)';

const exceededTransferLimit = (payload) =>
  payload?.exceededTransferLimit === true ||
  payload?.properties?.exceededTransferLimit === true;

const textOrNull = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
};

// Same ring rule as src/layers/droneAirspace/records.js.
function validRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  for (const position of ring) {
    if (!Array.isArray(position) || position.length < 2) return false;
    const [lon, lat] = position;
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) return false;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return false;
  }
  return true;
}

/** Polygon/MultiPolygon to polygons (arrays of rings); null when malformed or empty. */
function normalizePolygons(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  let polygons;
  if (geometry.type === 'Polygon') polygons = [geometry.coordinates];
  else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates;
  else return null;
  if (!Array.isArray(polygons)) return null;
  const result = [];
  for (const rings of polygons) {
    if (!Array.isArray(rings)) return null;
    if (!rings.length) continue;
    if (!rings.every(validRing)) return null;
    result.push(rings);
  }
  return result.length ? result : null;
}

function toArea(level, feature) {
  const p = feature?.properties;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const polygons = normalizePolygons(feature.geometry);
  if (!polygons) return null;
  if (level === 'districts') {
    const district = textOrNull(p.DISTRICT);
    if (!district) return null;
    return {
      id: district,
      name: textOrNull(p.DISTRICT_N) ?? district,
      code: district,
      province: textOrNull(p.PROVINCE),
      category: textOrNull(p.CATEGORY),
      polygons,
    };
  }
  const code = textOrNull(p.CAT_B);
  if (level === 'councils') {
    if (!code) return null;
    return {
      id: code,
      name: textOrNull(p.MUNICNAME) ?? code,
      code,
      province: textOrNull(p.PROVINCE),
      category: textOrNull(p.CATEGORY),
      polygons,
    };
  }
  if (p.WardID == null || p.WardID === '') return null;
  const id = String(p.WardID);
  const wardNo =
    Number.isFinite(Number(p.WardNo)) && p.WardNo !== '' && p.WardNo != null
      ? Number(p.WardNo)
      : null;
  return {
    id,
    name: wardNo != null ? `Ward ${wardNo}` : `Ward ${id}`,
    code,
    province: textOrNull(p.Province),
    wardNo,
    municipality: textOrNull(p.MUNICNAME),
    polygons,
  };
}

/**
 * Fetch every ward or council boundary as simplified WGS84 polygons. Throws
 * `incomplete_boundaries` unless the service reports the set complete and at
 * least one area is valid.
 */
export async function fetchBoundaries(
  level,
  { fetchImpl = (...args) => globalThis.fetch(...args), signal } = {},
) {
  const layer = MDB_LAYERS[level];
  if (!layer) throw new Error('unknown_level');
  const base = new URLSearchParams({
    where: '1=1',
    outFields: OUT_FIELDS[level],
    f: 'geojson',
    outSR: '4326',
    maxAllowableOffset: '0.001',
    geometryPrecision: '5',
    resultRecordCount: String(PAGE_SIZE),
  });
  const features = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams(base);
    query.set('resultOffset', String(features.length));
    const timeout = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    const pageSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(`${layer}/query?${query}`, {
      signal: pageSignal,
      redirect: 'error',
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('upstream_unavailable');
    }
    const payload = await readResponseJsonCapped(
      response,
      PAGE_CAP_BYTES,
      pageSignal,
    );
    if (!Array.isArray(payload?.features))
      throw new Error('invalid_boundaries');
    features.push(...payload.features);
    if (!exceededTransferLimit(payload)) {
      complete = true;
      break;
    }
    if (!payload.features.length) break;
  }
  if (!complete) throw new Error('incomplete_boundaries');
  const seen = new Set();
  const areas = [];
  for (const feature of features) {
    const area = toArea(level, feature);
    if (!area || seen.has(area.id)) continue;
    seen.add(area.id);
    areas.push(area);
  }
  if (!areas.length) throw new Error('incomplete_boundaries');
  return areas;
}

const coded = (code) => Object.assign(new Error(code), { code });

/**
 * Attribute-only fetch mapping every council (CAT_B) to its district. Throws
 * `incomplete_membership` unless the service reports the set complete and at
 * least one council is valid.
 */
export async function fetchCouncilDistricts({
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
} = {}) {
  const base = new URLSearchParams({
    where: '1=1',
    outFields: 'CAT_B,MUNICNAME,DISTRICT,DISTRICT_N',
    returnGeometry: 'false',
    f: 'json',
    resultRecordCount: String(PAGE_SIZE),
  });
  const rows = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams(base);
    query.set('resultOffset', String(rows.length));
    const timeout = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    const pageSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(`${MDB_LAYERS.councils}/query?${query}`, {
      signal: pageSignal,
      redirect: 'error',
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw coded('upstream_unavailable');
    }
    const payload = await readResponseJsonCapped(
      response,
      PAGE_CAP_BYTES,
      pageSignal,
    );
    if (!Array.isArray(payload?.features)) throw coded('invalid_membership');
    rows.push(...payload.features);
    if (!exceededTransferLimit(payload)) {
      complete = true;
      break;
    }
    if (!payload.features.length) break;
  }
  if (!complete) throw coded('incomplete_membership');
  const seen = new Set();
  const councils = [];
  for (const row of rows) {
    const a = row?.attributes;
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    const code = textOrNull(a.CAT_B);
    const district = textOrNull(a.DISTRICT);
    if (!code || !district || seen.has(code)) continue;
    seen.add(code);
    councils.push({
      code,
      name: textOrNull(a.MUNICNAME) ?? code,
      district,
      districtName: textOrNull(a.DISTRICT_N) ?? district,
    });
  }
  if (!councils.length) throw coded('incomplete_membership');
  return councils;
}
