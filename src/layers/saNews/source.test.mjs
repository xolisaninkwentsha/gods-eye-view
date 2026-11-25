import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaNewsSource } from './source.js';

const payload = {
  fetchedAt: '2026-11-24T10:00:00.000Z',
  stories: [],
  status: null,
};

test('a good body is returned and the proxy path is requested', async () => {
  let requested;
  const source = createSaNewsSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json(payload);
    },
  });
  assert.deepEqual(await source.getSnapshot({}), payload);
  assert.equal(requested, '/api/sa-news');
});

test('an HTTP 502 rejects with the status', async () => {
  const source = createSaNewsSource({
    fetchImpl: async () => new Response('no', { status: 502 }),
  });
  await assert.rejects(source.getSnapshot({}), /SA news HTTP 502/);
});

test('a body without a stories array is malformed', async () => {
  const source = createSaNewsSource({
    fetchImpl: async () => Response.json({ stories: 'x' }),
  });
  await assert.rejects(source.getSnapshot({}), /Malformed SA news/);
});

test('a body above 8 MiB is refused', async () => {
  const big = JSON.stringify({ stories: [], pad: 'x'.repeat(8 * 1024 * 1024) });
  const source = createSaNewsSource({
    fetchImpl: async () => new Response(big),
  });
  await assert.rejects(source.getSnapshot({}));
});

test('an aborted signal rejects before fetching', async () => {
  let called = false;
  const source = createSaNewsSource({
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
