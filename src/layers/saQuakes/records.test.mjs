import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmscSnapshot, SA_QUAKE_WINDOW_MS } from './records.js';

// Synthetic EMSC-shaped data written inline.
const feature = (over = {}, geometry) => ({
  type: 'Feature',
  geometry: geometry ?? { type: 'Point', coordinates: [27.484, -26.429, -10] },
  id: 'x',
  properties: {
    unid: '20261121_0000203',
    lastupdate: '2026-11-21T15:21:17.200818Z',
    time: '2026-11-21T15:11:16.0Z',
    flynn_region: 'SOUTH AFRICA',
    lat: -26.429,
    lon: 27.484,
    depth: 10,
    auth: 'SASN',
    mag: 2.2,
    magtype: 'm',
    ...over,
  },
});
const coll = (...features) => ({ type: 'FeatureCollection', features });

test('the window is thirty days', () => {
  assert.equal(SA_QUAKE_WINDOW_MS, 30 * 86_400_000);
});

test("reads EMSC's ISO time, positive depth and region", () => {
  const [row] = normalizeEmscSnapshot(coll(feature()));
  assert.deepEqual(row, {
    stableId: '20261121_0000203',
    lon: 27.484,
    lat: -26.429,
    depthKm: 10,
    mag: 2.2,
    magType: 'm',
    timeMs: Date.parse('2026-11-21T15:11:16.0Z'),
    region: 'South Africa',
    network: 'SASN',
  });
});

test('falls back to geometry and nulls missing optional fields', () => {
  const f = feature({ lat: undefined, lon: undefined, depth: undefined, auth: undefined, magtype: undefined, flynn_region: undefined });
  const [row] = normalizeEmscSnapshot(coll(f));
  assert.equal(row.lon, 27.484);
  assert.equal(row.lat, -26.429);
  assert.equal(row.depthKm, null);
  assert.equal(row.magType, null);
  assert.equal(row.region, null);
  assert.equal(row.network, null);
});

test('title-cases multi-word regions', () => {
  const [row] = normalizeEmscSnapshot(coll(feature({ flynn_region: 'NORTHERN BOTSWANA' })));
  assert.equal(row.region, 'Northern Botswana');
});

test('skips events without a magnitude or time, or out of range', () => {
  const rows = normalizeEmscSnapshot(
    coll(
      feature({ unid: 'a', mag: null }),
      feature({ unid: 'b', time: 'nope' }),
      feature({ unid: 'c', time: undefined }),
      feature({ unid: 'd', unid2: 1, lat: -95 }),
      feature({ unid: 'e', lon: 200 }),
      feature({ unid: undefined }),
      feature({ unid: 'ok' }),
    ),
  );
  assert.deepEqual(rows.map((r) => r.stableId), ['ok']);
});

test('keeps the latest update of a repeated event, newest first', () => {
  const rows = normalizeEmscSnapshot(
    coll(
      feature({ lastupdate: '2026-11-21T16:00:00Z', mag: 3 }),
      feature({ lastupdate: '2026-11-21T15:00:00Z', mag: 2 }),
      feature({ unid: 'newer', time: '2026-11-22T00:00:00Z' }),
    ),
  );
  assert.deepEqual(rows.map((r) => [r.stableId, r.mag]), [
    ['newer', 2.2],
    ['20261121_0000203', 3],
  ]);
});

test('returns null for a non-collection', () => {
  assert.equal(normalizeEmscSnapshot(null), null);
  assert.equal(normalizeEmscSnapshot({}), null);
  assert.equal(normalizeEmscSnapshot({ features: 'x' }), null);
});
