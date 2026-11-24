import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGovernance, normalizeDistricts } from './records.js';

const good = () => ({
  audits: {
    year: 2024,
    fetchedAt: 1,
    byCode: {
      CPT: { opinion: 'unqualified', label: 'Unqualified - No findings' },
    },
  },
  auditsStatus: 'ok',
  interventions: {
    asOf: '2026-08',
    source: 'CoGTA',
    sourceUrl: 'https://example.org',
    rows: [
      {
        code: 'KZN212',
        name: 'Umdoni',
        province: 'KZN',
        type: 'x',
        since: '2024',
      },
    ],
  },
  metros: { rows: [{ code: 'CPT', status: 'elected', mayor: 'A', note: 'n' }] },
  districtOf: { KZN212: { code: 'DC21', name: 'Ugu' } },
});

test('a good payload becomes Maps', () => {
  const g = normalizeGovernance(good());
  assert.equal(g.audits.year, 2024);
  assert.ok(g.audits.byCode instanceof Map);
  assert.equal(g.audits.byCode.get('CPT').opinion, 'unqualified');
  assert.equal(g.auditsStatus, 'ok');
  assert.equal(g.interventions.get('KZN212').name, 'Umdoni');
  assert.equal(g.interventionsAsOf, '2026-08');
  assert.equal(g.interventionsSource, 'CoGTA');
  assert.equal(g.metros.get('CPT').mayor, 'A');
  assert.deepEqual(g.districtOf.get('KZN212'), { code: 'DC21', name: 'Ugu' });
});

test('a non-object payload is null', () => {
  for (const bad of [null, undefined, 'x', 5, []]) {
    assert.equal(normalizeGovernance(bad), null);
  }
});

test('null audits and districtOf are tolerated', () => {
  const p = {
    ...good(),
    audits: null,
    districtOf: null,
    auditsStatus: 'failed',
  };
  const g = normalizeGovernance(p);
  assert.equal(g.audits, null);
  assert.equal(g.districtOf.size, 0);
  assert.equal(g.auditsStatus, 'failed');
});

test('an unknown auditsStatus becomes failed', () => {
  assert.equal(
    normalizeGovernance({ ...good(), auditsStatus: 'weird' }).auditsStatus,
    'failed',
  );
  assert.equal(
    normalizeGovernance({ ...good(), auditsStatus: 'stale' }).auditsStatus,
    'stale',
  );
});

test('malformed rows are skipped, not fatal', () => {
  const p = good();
  p.interventions.rows.push(null, { name: 'no code' }, { code: 5 });
  p.metros.rows.push('x', { status: 'elected' });
  p.audits.byCode.BAD = { opinion: 5 };
  p.audits.byCode.WORSE = null;
  p.districtOf.BAD = { code: 'DC1' };
  const g = normalizeGovernance(p);
  assert.deepEqual([...g.interventions.keys()], ['KZN212']);
  assert.deepEqual([...g.metros.keys()], ['CPT']);
  assert.deepEqual([...g.audits.byCode.keys()], ['CPT']);
  assert.deepEqual([...g.districtOf.keys()], ['KZN212']);
});

test('a known opinion needs no label; another opinion without one is dropped', () => {
  const p = good();
  p.audits.byCode.NOLABEL = { opinion: 'qualified' };
  p.audits.byCode.BLANK = { opinion: 'disclaimer', label: '  ' };
  p.audits.byCode.ODD = { opinion: 'other', label: 'Withdrawn' };
  p.audits.byCode.ODDBLANK = { opinion: 'other', label: '' };
  const { byCode } = normalizeGovernance(p).audits;
  assert.equal(byCode.get('NOLABEL').opinion, 'qualified');
  assert.equal(byCode.get('BLANK').opinion, 'disclaimer');
  assert.equal(byCode.get('ODD').label, 'Withdrawn');
  assert.equal(byCode.has('ODDBLANK'), false);
});

test('audits without a numeric year are dropped', () => {
  const p = good();
  p.audits.year = 'x';
  assert.equal(normalizeGovernance(p).audits, null);
});

test('missing interventions and metros give empty Maps', () => {
  const g = normalizeGovernance({ auditsStatus: 'ok' });
  assert.equal(g.interventions.size, 0);
  assert.equal(g.metros.size, 0);
  assert.equal(g.interventionsAsOf, null);
});

const ring = [
  [18, -33],
  [19, -33],
  [19, -34],
  [18, -33],
];

test('districts keep valid areas and their members', () => {
  const d = normalizeDistricts({
    fetchedAt: 7,
    stale: true,
    areas: [
      {
        id: 'DC21',
        name: 'Ugu',
        code: 'DC21',
        province: 'KZN',
        category: 'C',
        polygons: [[ring]],
        members: [{ code: 'KZN212', name: 'Umdoni' }, { code: 3 }, null],
      },
      { id: 'bad', name: 'Bad', polygons: [[[[200, 0]]]] },
      { id: '', name: 'x', polygons: [[ring]] },
      null,
    ],
  });
  assert.equal(d.areas.length, 1);
  assert.equal(d.areas[0].stableId, 'DC21');
  assert.deepEqual(d.areas[0].members, [{ code: 'KZN212', name: 'Umdoni' }]);
  assert.equal(d.stale, true);
  assert.equal(d.fetchedAt, 7);
});

test('districts reject a non-object or an areas-less payload', () => {
  assert.equal(normalizeDistricts(null), null);
  assert.equal(normalizeDistricts({ fetchedAt: 1 }), null);
  assert.equal(normalizeDistricts([]), null);
});
