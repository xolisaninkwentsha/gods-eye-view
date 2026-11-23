import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaElectionsSource } from './source.js';

test('source asks the level route and refuses a failed answer', async () => {
  let requested;
  const payload = { level: 'wards', results: 'ok', areas: [] };
  const source = createSaElectionsSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json(payload);
    },
  });
  assert.deepEqual(await source.getSnapshot({ level: 'wards' }), payload);
  assert.equal(requested, '/api/sa-elections/wards');
  const failing = createSaElectionsSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(failing.getSnapshot({ level: 'councils' }), /503/);
});
