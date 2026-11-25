import test from 'node:test';
import assert from 'node:assert/strict';
import { FACILITY_CLASSES, normaliseFacilities } from './records.js';

const base = {
  fetchedAt: '2026-11-25T08:00:00.000Z',
  updated: '2026-11-20',
  stale: false,
};
const clinic = (id, extra = {}) => ({
  id,
  name: `Sample Clinic ${id}`,
  kind: 'clinic',
  lat: -29.5,
  lon: 25.5,
  ...extra,
});
const school = (id, extra = {}) => ({
  id,
  name: `Example School ${id}`,
  lat: -28.5,
  lon: 24.5,
  level: 'Primary',
  connectivity: 'yes',
  ...extra,
});

test('the classes are fixed, in order, with their colours', () => {
  assert.deepEqual(
    FACILITY_CLASSES.health.map((c) => [c.key, c.label, c.color]),
    [
      ['hospital', 'Hospital', '#eb5757'],
      ['clinic', 'Clinic', '#f2994a'],
      ['doctors', 'Doctor', '#bb6bd9'],
      ['pharmacy', 'Pharmacy', '#27ae60'],
      ['dentist', 'Dentist', '#56ccf2'],
      ['other', 'Other', '#bdbdbd'],
    ],
  );
  assert.deepEqual(
    FACILITY_CLASSES.schools.map((c) => [c.key, c.label, c.color]),
    [
      ['yes', 'Connected', '#27ae60'],
      ['no', 'Not connected', '#eb5757'],
      ['unknown', 'Unknown', '#9e9e9e'],
    ],
  );
});

test('a good health payload is normalised', () => {
  const out = normaliseFacilities(
    { ...base, set: 'health', records: [clinic('node/1')] },
    'health',
  );
  assert.equal(out.records.length, 1);
  assert.equal(out.stale, false);
  assert.equal(out.fetchedAt, base.fetchedAt);
  assert.equal(out.updated, '2026-11-20');
});

test('records with non-finite coordinates are dropped', () => {
  const out = normaliseFacilities(
    {
      ...base,
      records: [
        clinic('node/1'),
        clinic('node/2', { lat: NaN }),
        clinic('node/3', { lon: null }),
        clinic('node/4', { lat: '-29.5' }),
        clinic('node/5', { lat: Infinity }),
      ],
    },
    'health',
  );
  assert.deepEqual(
    out.records.map((r) => r.id),
    ['node/1'],
  );
});

test('records of an unknown class are dropped, per set', () => {
  const health = normaliseFacilities(
    {
      ...base,
      records: [
        clinic('a'),
        clinic('b', { kind: 'morgue' }),
        clinic('c', { kind: undefined }),
      ],
    },
    'health',
  );
  assert.deepEqual(
    health.records.map((r) => r.id),
    ['a'],
  );
  const schools = normaliseFacilities(
    {
      ...base,
      records: [
        school('school:1'),
        school('school:2', { connectivity: 'maybe' }),
        school('school:3', { connectivity: 'no' }),
      ],
    },
    'schools',
  );
  assert.deepEqual(
    schools.records.map((r) => r.id),
    ['school:1', 'school:3'],
  );
});

test('records without a string id, and non-objects, are dropped', () => {
  const out = normaliseFacilities(
    { ...base, records: [clinic('a'), clinic(7), null, 'x', clinic('')] },
    'health',
  );
  assert.deepEqual(
    out.records.map((r) => r.id),
    ['a'],
  );
});

test('a payload that is not an object with records, or an unknown set, is null', () => {
  assert.equal(normaliseFacilities(null, 'health'), null);
  assert.equal(normaliseFacilities({ records: 'x' }, 'health'), null);
  assert.equal(normaliseFacilities({ ...base, records: [] }, 'roads'), null);
});

test('stale is true only when the payload says so; a bad fetchedAt is null', () => {
  assert.equal(
    normaliseFacilities({ ...base, stale: 'yes', records: [] }, 'health').stale,
    false,
  );
  assert.equal(
    normaliseFacilities({ ...base, stale: true, records: [] }, 'health').stale,
    true,
  );
  assert.equal(
    normaliseFacilities({ ...base, fetchedAt: 'nope', records: [] }, 'health')
      .fetchedAt,
    null,
  );
});
