/** Normalize an EMSC FDSN GeoJSON snapshot. Pure — no Cesium types, no i18n. */

export const SA_QUAKE_OVERLAY_SOURCE_ID = 'sa-earthquakes';
/** How far back the layer looks. */
export const SA_QUAKE_WINDOW_MS = 30 * 86_400_000;

const titleCase = (text) =>
  typeof text === 'string' && text.trim()
    ? text
        .trim()
        .toLowerCase()
        .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    : null;

const finite = (value) => (Number.isFinite(value) ? value : null);

/**
 * @returns {Array<{stableId: string, lon: number, lat: number,
 *   depthKm: number|null, mag: number, magType: string|null, timeMs: number,
 *   region: string|null, network: string|null}>|null} newest first, or null
 *   when the body is not a feature collection.
 */
export function normalizeEmscSnapshot(geojson) {
  if (!Array.isArray(geojson?.features)) return null;
  const byId = new Map();
  for (const feature of geojson.features) {
    const p = feature?.properties;
    if (!p || typeof p.unid !== 'string' || !p.unid) continue;
    if (!Number.isFinite(p.mag)) continue;
    const timeMs = typeof p.time === 'string' ? Date.parse(p.time) : NaN;
    if (!Number.isFinite(timeMs)) continue;
    const coords = feature.geometry?.coordinates;
    const lon = finite(p.lon) ?? finite(coords?.[0]);
    const lat = finite(p.lat) ?? finite(coords?.[1]);
    if (lon === null || lat === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const updated = Date.parse(p.lastupdate);
    const row = {
      stableId: p.unid,
      lon,
      lat,
      depthKm: finite(p.depth),
      mag: p.mag,
      magType: typeof p.magtype === 'string' && p.magtype ? p.magtype : null,
      timeMs,
      region: titleCase(p.flynn_region),
      network: typeof p.auth === 'string' && p.auth ? p.auth : null,
    };
    const rank = Number.isFinite(updated) ? updated : -Infinity;
    const seen = byId.get(row.stableId);
    if (!seen || rank > seen.rank) byId.set(row.stableId, { rank, row });
  }
  return [...byId.values()]
    .map((v) => v.row)
    .sort((a, b) => b.timeMs - a.timeMs);
}
