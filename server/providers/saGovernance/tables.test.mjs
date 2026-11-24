import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERVENTIONS,
  METROS,
  validateInterventions,
  validateMetros,
} from './tables.js';

const EXPECTED_CODES = [
  'EC139',
  'DC12',
  'EC104',
  'DC15',
  'EC145',
  'MAN',
  'FS205',
  'FS182',
  'FS162',
  'FS184',
  'FS185',
  'FS181',
  'FS203',
  'KZN224',
  'GT421',
  'GT484',
  'DC36',
  'MP312',
  'MP307',
  'MP302',
  'MP321',
  'MP305',
  'NC094',
  'NC075',
  'NC091',
  'NW372',
  'NW382',
  'DC39',
  'NW374',
  'NW385',
  'NW392',
  'NW384',
  'NW403',
  'WC053',
  'WC041',
  'DC4',
  'WC031',
];

const clone = (v) => JSON.parse(JSON.stringify(v));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

test('the intervention list holds the 37 annexure rows', () => {
  assert.equal(INTERVENTIONS.asOf, '2026-08');
  assert.equal(INTERVENTIONS.rows.length, 37);
  assert.deepEqual(
    INTERVENTIONS.rows.map((r) => r.code),
    EXPECTED_CODES,
  );
  for (const r of INTERVENTIONS.rows) {
    for (const k of ['name', 'province', 'type', 'since']) {
      assert.equal(typeof r[k], 'string');
      assert.ok(r[k].trim().length > 0, `${r.code} ${k}`);
    }
  }
});

test('five listed councils are districts', () => {
  const dcs = INTERVENTIONS.rows
    .map((r) => r.code)
    .filter((c) => /^DC\d+$/.test(c));
  assert.deepEqual([...dcs].sort(), ['DC12', 'DC15', 'DC36', 'DC39', 'DC4']);
});

test('the metro table covers the 8 metros', () => {
  assert.deepEqual(METROS.rows.map((r) => r.code).sort(), [
    'BUF',
    'CPT',
    'EKU',
    'ETH',
    'JHB',
    'MAN',
    'NMA',
    'TSH',
  ]);
});

test('an elected metro row names its mayor and date', () => {
  const elected = METROS.rows.filter((r) => r.status === 'elected');
  assert.ok(elected.length > 0);
  for (const r of elected) {
    assert.ok(r.mayor && r.party, r.code);
    assert.match(r.electedOn, ISO);
    assert.ok(Array.isArray(r.coalition) && r.coalition.length > 0);
  }
  for (const r of METROS.rows.filter((x) => x.status === 'unresolved')) {
    assert.equal(r.mayor, undefined);
  }
});

test('every metro row has a valid ISO asOf and an https sourceUrl', () => {
  for (const r of METROS.rows) {
    assert.match(r.asOf, ISO);
    assert.equal(
      new Date(`${r.asOf}T00:00:00Z`).toISOString().slice(0, 10),
      r.asOf,
    );
    assert.equal(new URL(r.sourceUrl).protocol, 'https:');
  }
});

test('the tables are frozen', () => {
  assert.ok(Object.isFrozen(INTERVENTIONS));
  assert.ok(Object.isFrozen(INTERVENTIONS.rows[0]));
  assert.ok(Object.isFrozen(METROS.rows));
  // Any elected row, wherever it sits: only those carry a coalition.
  const elected = METROS.rows.find((row) => row.status === 'elected');
  assert.ok(Object.isFrozen(elected.coalition));
});

// Literal rows for the bad-row checks, so no edit of the committed tables
// (a metro elected, a row moved) can make a bad fixture valid.
const INTERVENTION_ROW = Object.freeze({
  code: 'EC139',
  name: 'Enoch Mgijima',
  province: 'Eastern Cape',
  type: 'S139(1)(b)',
  since: '2019',
});
const interventions = (...rows) => ({
  asOf: '2026-08',
  source: 'CoGTA reply to NW4545',
  sourceUrl: 'https://pmg.org.za/committee-question/40568/',
  rows: rows.map((row) => ({ ...INTERVENTION_ROW, ...row })),
});
const ELECTED_ROW = Object.freeze({
  code: 'CPT',
  status: 'elected',
  mayor: 'A Mayor',
  party: 'DA',
  coalition: ['DA'],
  electedOn: '2026-11-19',
  note: 'Elected',
  asOf: '2026-11-24',
  sourceUrl: 'https://example.com/elected',
});
const UNRESOLVED_ROW = Object.freeze({
  code: 'JHB',
  status: 'unresolved',
  note: 'Vote expected',
  asOf: '2026-11-24',
  sourceUrl: 'https://example.com/unresolved',
});
const metros = (...rows) => ({ rows: rows.map((row) => clone(row)) });

test('the literal fixtures are valid, so each bad one fails for its own field', () => {
  assert.doesNotThrow(() =>
    validateInterventions(interventions({}, { code: 'DC12' })),
  );
  assert.doesNotThrow(() =>
    validateMetros(metros(ELECTED_ROW, UNRESOLVED_ROW)),
  );
});

test('validation rejects bad rows', () => {
  const bad = /invalid_governance_table/;
  assert.throws(
    () => validateInterventions(interventions({}, { name: 'Again' })),
    bad,
    'a repeated code',
  );
  assert.throws(
    () => validateInterventions(interventions({ type: '' })),
    bad,
    'an empty type',
  );
  assert.throws(
    () => validateInterventions(interventions({ code: 'x1' })),
    bad,
    'a code that is not an MDB code',
  );

  const elected = (over) => metros({ ...ELECTED_ROW, ...over }, UNRESOLVED_ROW);
  const unresolved = (over) =>
    metros(ELECTED_ROW, { ...UNRESOLVED_ROW, ...over });
  assert.throws(() => validateMetros(elected({ status: 'maybe' })), bad);
  assert.throws(() => validateMetros(elected({ asOf: '24 Nov' })), bad);
  assert.throws(() => validateMetros(elected({ asOf: '2026-02-30' })), bad);
  assert.throws(
    () => validateMetros(elected({ sourceUrl: 'http://example.com/x' })),
    bad,
  );
  assert.throws(() => validateMetros(unresolved({ code: 'CPT' })), bad);
  assert.throws(() => validateMetros(elected({ mayor: undefined })), bad);
  assert.throws(() => validateMetros(elected({ coalition: [] })), bad);
  assert.throws(() => validateMetros(unresolved({ mayor: 'Someone' })), bad);
});

test('recording a result (JHB elected) is a valid edit of the committed table', () => {
  const edited = clone(METROS);
  const jhb = edited.rows.find((row) => row.code === 'JHB');
  Object.assign(jhb, {
    status: 'elected',
    mayor: 'A Mayor',
    party: 'ANC',
    coalition: ['ANC', 'EFF'],
    electedOn: '2026-11-27',
    note: 'Elected in a council vote',
    asOf: '2026-11-27',
    sourceUrl: 'https://example.com/jhb',
  });
  assert.doesNotThrow(() => validateMetros(edited));
});
