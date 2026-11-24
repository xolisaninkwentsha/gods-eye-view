import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_OPINIONS,
  latestAuditYear,
  normalizeAuditFacts,
  fetchAudits,
} from './audits.js';

// Everything below is synthetic JSON written inline.
const cell = (year, code, count) => ({
  'financial_year_end.year': year,
  'opinion.code': code,
  _count: count,
});
const aggregate = (...cells) => ({ cells });

const row = (code, opinion, label = 'Label') => ({
  'demarcation.code': code,
  'demarcation.label': `Muni ${code}`,
  'financial_year_end.year': 2024,
  'opinion.code': opinion,
  'opinion.label': label,
  'opinion.report_url': 'https://example.test/report.pdf',
});
const manyRows = (n) =>
  Array.from({ length: n }, (_, i) => row(`M${i}`, 'qualified'));

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

test('the opinion list is fixed', () => {
  assert.deepEqual(AUDIT_OPINIONS, [
    'unqualified',
    'unqualified_emphasis_of_matter',
    'qualified',
    'adverse',
    'disclaimer',
    'outstanding',
  ]);
});

test('the latest year skips a year that is mostly outstanding', () => {
  const body = aggregate(
    cell(2024, 'unqualified', 100),
    cell(2024, 'qualified', 147),
    cell(2024, 'outstanding', 10),
    cell(2025, 'qualified', 50),
    cell(2025, 'outstanding', 207),
  );
  assert.equal(latestAuditYear(body), 2024);
});

test('null when no year qualifies', () => {
  assert.equal(latestAuditYear(aggregate(cell(2025, 'qualified', 50))), null);
  assert.equal(latestAuditYear({}), null);
  assert.equal(latestAuditYear(null), null);
});

test('facts normalise by code', () => {
  const data = [
    {
      ...row('CPT', 'unqualified', ' Unqualified - No findings '),
      'demarcation.label': 'City of Cape Town',
    },
    row('ODD', 'mystery', 'Odd'),
    { 'demarcation.label': 'No code', 'opinion.code': 'qualified' },
    ...manyRows(200),
  ];
  const out = normalizeAuditFacts({ data }, 2024);
  assert.equal(out.year, 2024);
  assert.deepEqual(out.byCode.CPT, {
    opinion: 'unqualified',
    label: 'Unqualified - No findings',
  });
  assert.equal(out.byCode.ODD.opinion, 'other');
  assert.equal(Object.keys(out.byCode).includes('undefined'), false);
  assert.equal(Object.keys(out.byCode).length, 202);
  assert.equal(JSON.stringify(out).includes('report'), false);
});

test('fewer than 200 rows is invalid', () => {
  assert.throws(() => normalizeAuditFacts({ data: manyRows(199) }, 2024), {
    message: 'invalid_audits',
    code: 'invalid_audits',
  });
  assert.throws(() => normalizeAuditFacts({ data: 'x' }, 2024), {
    code: 'invalid_audits',
  });
});

test('fetchAudits asks the fixed URLs with the right options', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/aggregate?'))
      return jsonResponse(aggregate(cell(2024, 'qualified', 257)));
    return jsonResponse({ data: manyRows(257) });
  };
  const out = await fetchAudits({ fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    'https://municipaldata.treasury.gov.za/api/cubes/audit_opinions/aggregate?drilldown=financial_year_end.year%7Copinion.code&pagesize=500',
  );
  assert.equal(
    calls[1].url,
    'https://municipaldata.treasury.gov.za/api/cubes/audit_opinions/facts?cut=financial_year_end.year:2024&pagesize=500',
  );
  for (const { options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, {
      'User-Agent': 'GodsEyeView (sa-governance)',
      Accept: 'application/json',
    });
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(out.year, 2024);
  assert.equal(Object.keys(out.byCode).length, 257);
});

test('fetchAudits errors carry a string code', async () => {
  await assert.rejects(
    fetchAudits({
      fetchImpl: async () => new Response('no', { status: 503 }),
    }),
    { code: 'upstream_503' },
  );
  await assert.rejects(
    fetchAudits({
      fetchImpl: async () =>
        jsonResponse(aggregate(cell(2025, 'qualified', 5))),
    }),
    { code: 'no_audit_year' },
  );
});
