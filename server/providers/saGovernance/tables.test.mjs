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
  assert.ok(Object.isFrozen(METROS.rows[0].coalition ?? []));
});

test('validation rejects bad rows', () => {
  const bad = /invalid_governance_table/;
  const dup = clone(INTERVENTIONS);
  dup.rows[1].code = dup.rows[0].code;
  assert.throws(() => validateInterventions(dup), bad);

  const emptyType = clone(INTERVENTIONS);
  emptyType.rows[0].type = '';
  assert.throws(() => validateInterventions(emptyType), bad);

  const badCode = clone(INTERVENTIONS);
  badCode.rows[0].code = 'x1';
  assert.throws(() => validateInterventions(badCode), bad);

  const maybe = clone(METROS);
  maybe.rows[0].status = 'maybe';
  assert.throws(() => validateMetros(maybe), bad);

  const badDate = clone(METROS);
  badDate.rows[0].asOf = '24 Nov';
  assert.throws(() => validateMetros(badDate), bad);

  const feb30 = clone(METROS);
  feb30.rows[0].asOf = '2026-02-30';
  assert.throws(() => validateMetros(feb30), bad);

  const http = clone(METROS);
  http.rows[0].sourceUrl = 'http://example.com/x';
  assert.throws(() => validateMetros(http), bad);

  const dupMetro = clone(METROS);
  dupMetro.rows[1].code = dupMetro.rows[0].code;
  assert.throws(() => validateMetros(dupMetro), bad);

  const noMayor = clone(METROS);
  delete noMayor.rows[0].mayor;
  assert.throws(() => validateMetros(noMayor), bad);

  const emptyCoalition = clone(METROS);
  emptyCoalition.rows[0].coalition = [];
  assert.throws(() => validateMetros(emptyCoalition), bad);

  const unresolvedMayor = clone(METROS);
  unresolvedMayor.rows[1].mayor = 'Someone';
  assert.throws(() => validateMetros(unresolvedMayor), bad);
});
