import { readResponseJsonCapped } from '../common/http.js';

export const AUDIT_OPINIONS = [
  'unqualified',
  'unqualified_emphasis_of_matter',
  'qualified',
  'adverse',
  'disclaimer',
  'outstanding',
];

const BASE = 'https://municipaldata.treasury.gov.za/api/cubes/audit_opinions';
const AGGREGATE_URL = `${BASE}/aggregate?drilldown=financial_year_end.year%7Copinion.code&pagesize=500`;
const factsUrl = (year) =>
  `${BASE}/facts?cut=financial_year_end.year:${year}&pagesize=500`;
const USER_AGENT = 'GodsEyeView (sa-governance)';
const CAP_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MIN_ROWS = 200;

const failure = (code) => Object.assign(new Error(code), { code });

/** Latest year with at least 200 rows that are not "outstanding", or null. */
export function latestAuditYear(aggregate) {
  const cells = Array.isArray(aggregate?.cells) ? aggregate.cells : [];
  const real = new Map();
  for (const cell of cells) {
    const year = cell?.['financial_year_end.year'];
    if (!Number.isInteger(year)) continue;
    if (cell['opinion.code'] === 'outstanding') continue;
    const count = Number(cell._count);
    if (!Number.isFinite(count)) continue;
    real.set(year, (real.get(year) ?? 0) + count);
  }
  let latest = null;
  for (const [year, count] of real)
    if (count >= MIN_ROWS && (latest === null || year > latest)) latest = year;
  return latest;
}

export function normalizeAuditFacts(facts, year) {
  const data = facts?.data;
  if (!Array.isArray(data) || data.length < MIN_ROWS)
    throw failure('invalid_audits');
  const byCode = {};
  for (const row of data) {
    const code = row?.['demarcation.code'];
    if (typeof code !== 'string' || !code) continue;
    const opinionCode = row['opinion.code'];
    const label = row['opinion.label'];
    byCode[code] = {
      opinion: AUDIT_OPINIONS.includes(opinionCode) ? opinionCode : 'other',
      label: typeof label === 'string' ? label.trim() : '',
    };
  }
  return { year, byCode };
}

async function getJson(fetchImpl, url, signal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'error',
    signal: combined,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(`upstream_${response.status}`);
  }
  return readResponseJsonCapped(response, CAP_BYTES, combined);
}

export async function fetchAudits({ fetchImpl = fetch, signal } = {}) {
  const aggregate = await getJson(fetchImpl, AGGREGATE_URL, signal);
  const year = latestAuditYear(aggregate);
  if (year === null) throw failure('no_audit_year');
  const facts = await getJson(fetchImpl, factsUrl(year), signal);
  return normalizeAuditFacts(facts, year);
}
