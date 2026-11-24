import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaGovernanceSource } from './source.js';

const ring = [
  [18, -33],
  [19, -33],
  [19, -34],
  [18, -33],
];

test('the snapshot is requested and normalised', async () => {
  let requested;
  const source = createSaGovernanceSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({ audits: null, auditsStatus: 'failed' });
    },
  });
  const gov = await source.getSnapshot();
  assert.equal(requested, '/api/sa-governance');
  assert.equal(gov.audits, null);
  assert.equal(gov.auditsStatus, 'failed');
});

test('the districts are requested and normalised', async () => {
  let requested;
  const source = createSaGovernanceSource({
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({
        fetchedAt: 3,
        areas: [{ id: 'DC1', name: 'D', polygons: [[ring]], members: [] }],
      });
    },
  });
  const d = await source.getDistricts();
  assert.equal(requested, '/api/sa-governance/districts');
  assert.equal(d.areas.length, 1);
});

test('an HTTP 500 rejects', async () => {
  const source = createSaGovernanceSource({
    fetchImpl: async () => new Response('no', { status: 500 }),
  });
  await assert.rejects(source.getSnapshot(), /SA governance HTTP 500/);
  await assert.rejects(source.getDistricts(), /SA governance HTTP 500/);
});

test('malformed bodies reject', async () => {
  const source = createSaGovernanceSource({
    fetchImpl: async () => Response.json([1]),
  });
  await assert.rejects(source.getSnapshot(), /Malformed SA governance data/);
  await assert.rejects(source.getDistricts(), /Malformed SA governance data/);
});

test('an aborted signal rejects before fetching', async () => {
  let called = false;
  const source = createSaGovernanceSource({
    fetchImpl: async () => {
      called = true;
      return Response.json({});
    },
  });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(source.getSnapshot({ signal: ctl.signal }));
  assert.equal(called, false);
});
