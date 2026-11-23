import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSaElectionsPayload,
  saAreaColor,
  SA_ELECTIONS_OVERLAY_SOURCE,
} from './records.js';
import { partyStyle } from './parties.js';

const ring = [
  [28.0, -26.0],
  [28.1, -26.0],
  [28.1, -26.1],
  [28.0, -26.0],
];
const area = (over = {}) => ({
  id: 'JHB',
  name: 'City of Johannesburg',
  code: 'JHB',
  province: 'Gauteng',
  polygons: [[ring]],
  result: null,
  ...over,
});

test('normalizes rows and drops malformed areas', () => {
  const out = normalizeSaElectionsPayload(
    {
      results: 'ok',
      resultsAsOf: 5,
      areas: [
        area(),
        area({ id: '' }),
        area({ id: 'X', polygons: [] }),
        area({ id: 'Y', polygons: [[[[1, 2]]]] }),
        null,
        area({ id: 'Z', name: 7 }),
      ],
    },
    'councils',
  );
  assert.equal(out.status, 'ok');
  assert.equal(out.resultsAsOf, 5);
  assert.deepEqual(out.rows.map((r) => r.stableId), ['JHB']);
  assert.equal(out.rows[0].id, 'JHB');
  assert.equal(
    normalizeSaElectionsPayload({ results: 'weird', areas: [] }, 'wards').status,
    'failed',
  );
  assert.deepEqual(normalizeSaElectionsPayload(null, 'wards').rows, []);
  assert.deepEqual(SA_ELECTIONS_OVERLAY_SOURCE, {
    councils: 'sa-councils-2026',
    wards: 'sa-wards-2026',
  });
});

test('a council with no majority is faint; with no seats it is outline only', () => {
  const anc = 'AFRICAN NATIONAL CONGRESS';
  const base = { parties: [], totalSeats: 100, turnout: 0.5, seatCheck: 'ok' };
  assert.deepEqual(
    saAreaColor(
      { result: { ...base, largest: { party: anc, seats: 60 }, majority: true } },
      'councils',
    ),
    { color: partyStyle(anc).color, strength: 'strong' },
  );
  assert.deepEqual(
    saAreaColor(
      { result: { ...base, largest: { party: anc, seats: 40 }, majority: false } },
      'councils',
    ),
    { color: partyStyle(anc).color, strength: 'faint' },
  );
  const none = { color: null, strength: null };
  assert.deepEqual(
    saAreaColor({ result: { ...base, largest: null, majority: null } }, 'councils'),
    none,
  );
  assert.deepEqual(saAreaColor({ result: null }, 'councils'), none);
});

test('a tied ward has no fill', () => {
  const none = { color: null, strength: null };
  assert.deepEqual(
    saAreaColor({ result: { winner: null, tie: true } }, 'wards'),
    none,
  );
  assert.deepEqual(saAreaColor({ result: null }, 'wards'), none);
  assert.deepEqual(
    saAreaColor(
      { result: { winner: { party: 'DEMOCRATIC ALLIANCE' }, tie: false } },
      'wards',
    ),
    { color: partyStyle('DEMOCRATIC ALLIANCE').color, strength: 'strong' },
  );
});
