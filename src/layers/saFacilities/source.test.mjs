import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaFacilitiesSource } from './source.js';

const payload = {
  set: 'health',
  fetchedAt: '2026-11-25T08:00:00.000Z',
  updated: null,
  stale: false,
  records: [],
};

test('a good body is returned and the set is requested through the proxy', async () => {
  const requested = [];
  for (const set of ['health', 'schools']) {
    const source = createSaFacilitiesSource({
      set,
      fetchImpl: async (url) => {
        requested.push(String(url));
        return Response.json({ ...payload, set });
      },
    });
    assert.equal((await source.getSnapshot({})).set, set);
  }
  assert.deepEqual(requested, [
    '/api/sa-facilities?set=health',
    '/api/sa-facilities?set=schools',
  ]);
});

test('an HTTP 503 rejects with the status', async () => {
  const source = createSaFacilitiesSource({
    set: 'health',
    fetchImpl: async () => Response.json({ error: 'x' }, { status: 503 }),
  });
  await assert.rejects(source.getSnapshot({}), /SA facilities HTTP 503/);
});

test('a body without a records array is malformed', async () => {
  const source = createSaFacilitiesSource({
    set: 'health',
    fetchImpl: async () => Response.json({ records: 'x' }),
  });
  await assert.rejects(source.getSnapshot({}), /Malformed SA facilities/);
});

test('an unknown set is refused at construction', () => {
  assert.throws(() => createSaFacilitiesSource({ set: 'hospitals' }));
});

test('an aborted signal rejects before fetching', async () => {
  let called = false;
  const source = createSaFacilitiesSource({
    set: 'schools',
    fetchImpl: async () => {
      called = true;
      return Response.json(payload);
    },
  });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(source.getSnapshot({ signal: ctl.signal }));
  assert.equal(called, false);
});
