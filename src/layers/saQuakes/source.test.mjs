import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaQuakesSource } from './source.js';

const rows = [
  { stableId: 'q1', lon: 27, lat: -26, depthKm: 10, mag: 2.2, magType: 'm', timeMs: 1, region: 'South Africa', network: 'SASN' },
];

test('a good body yields rows, fetchedAt and the requested path', async () => {
  let requested;
  const source = createSaQuakesSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({ fetchedAt: 5, rows });
    },
  });
  const detail = await source.getSnapshotDetail();
  assert.equal(requested, '/api/sa-earthquakes');
  assert.equal(detail.rows.length, 1);
  assert.equal(detail.stale, false);
  assert.equal(detail.fetchedAt, 5);
  assert.equal((await source.getSnapshot()).length, 1);
});

test('an HTTP 500 rejects', async () => {
  const source = createSaQuakesSource({
    fetchImpl: async () => new Response('no', { status: 500 }),
  });
  await assert.rejects(source.getSnapshot(), /EMSC HTTP 500/);
});

test('a body without rows is malformed', async () => {
  const source = createSaQuakesSource({
    fetchImpl: async () => Response.json({ fetchedAt: 1 }),
  });
  await assert.rejects(source.getSnapshot(), /Malformed SA earthquake snapshot/);
});

test('an empty list is valid', async () => {
  const source = createSaQuakesSource({
    fetchImpl: async () => Response.json({ fetchedAt: 1, rows: [] }),
  });
  assert.deepEqual(await source.getSnapshot(), []);
});

test('a stale body comes through as stale', async () => {
  const source = createSaQuakesSource({
    fetchImpl: async () => Response.json({ fetchedAt: 1, rows, stale: true }),
  });
  assert.equal((await source.getSnapshotDetail()).stale, true);
});
