import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaWeatherSource } from './source.js';

const ring = [
  [18, -33],
  [19, -33],
  [19, -34],
  [18, -33],
];
const areas = [
  {
    stableId: 'za-wx:ab',
    name: 'Cape',
    polygons: [[ring]],
    band: 'red',
    warnings: [{ event: 'Rain', level: 9, expiresMs: 2, sentMs: 1 }],
  },
];

test('a good body yields rows, fetchedAt and the requested path', async () => {
  let requested;
  const source = createSaWeatherSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({ fetchedAt: 5, areas });
    },
  });
  const detail = await source.getSnapshotDetail();
  assert.equal(requested, '/api/sa-weather-warnings');
  assert.equal(detail.rows.length, 1);
  assert.equal(detail.stale, false);
  assert.equal(detail.fetchedAt, 5);
  assert.equal((await source.getSnapshot()).length, 1);
});

test('an HTTP 500 rejects', async () => {
  const source = createSaWeatherSource({
    fetchImpl: async () => new Response('no', { status: 500 }),
  });
  await assert.rejects(source.getSnapshot(), /SAWS HTTP 500/);
});

test('a body without areas is malformed', async () => {
  const source = createSaWeatherSource({
    fetchImpl: async () => Response.json({ fetchedAt: 1 }),
  });
  await assert.rejects(source.getSnapshot(), /Malformed/);
});

test('a stale body comes through as stale', async () => {
  const source = createSaWeatherSource({
    fetchImpl: async () => Response.json({ fetchedAt: 1, areas, stale: true }),
  });
  assert.equal((await source.getSnapshotDetail()).stale, true);
});
