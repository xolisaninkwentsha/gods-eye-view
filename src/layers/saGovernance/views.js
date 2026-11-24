/** Council views (audit, section 139) and card lines. Pure — no Cesium types. */

import { t, msg, formatDate } from '../../i18n/index.js';

export const SA_COUNCIL_VIEWS = Object.freeze([
  'party',
  'audit',
  'intervention',
]);

// Overlay cards do not wrap lines, so each text line stays short.
const LINE_CAP = 90;

export const AUDIT_BANDS = Object.freeze([
  { key: 'unqualified', label: msg('Clean audit'), color: '#2e9e5b' },
  {
    key: 'unqualified_emphasis_of_matter',
    label: msg('Unqualified with findings'),
    color: '#9ccc65',
  },
  { key: 'qualified', label: msg('Qualified'), color: '#f2c94c' },
  { key: 'adverse', label: msg('Adverse'), color: '#f2994a' },
  { key: 'disclaimer', label: msg('Disclaimer'), color: '#eb5757' },
  { key: 'outstanding', label: msg('Outstanding'), color: '#9b6dd6' },
  { key: 'none', label: msg('No audit data'), color: '#9aa4ad' },
]);

const NO_DATA_BAND = AUDIT_BANDS[AUDIT_BANDS.length - 1];
const BAND_BY_KEY = new Map(AUDIT_BANDS.map((b) => [b.key, b]));

const INTERVENTION_COLOR = '#eb5757';
const NOT_LISTED_COLOR = '#9aa4ad';

/** 2024 -> "2023/24" (the financial year that ended in 2024). */
export function auditYearLabel(year) {
  return `${year - 1}/${String(year % 100).padStart(2, '0')}`;
}

/** The band for an opinion code; unknown codes use the no-data band. */
export function auditBand(opinion) {
  if (opinion === 'none') return NO_DATA_BAND;
  return BAND_BY_KEY.get(opinion) ?? NO_DATA_BAND;
}

/**
 * Fill for a council in a view. Null in the party view: the caller keeps
 * using saAreaColor.
 * @returns {{color: string, strength: 'strong'|'faint'}|null}
 */
export function saGovernanceColor(row, view, gov) {
  if (view === 'audit') {
    const band = auditBand(gov?.audits?.byCode.get(row.code)?.opinion);
    return { color: band.color, strength: 'strong' };
  }
  if (view === 'intervention') {
    return gov?.interventions.has(row.code)
      ? { color: INTERVENTION_COLOR, strength: 'strong' }
      : { color: NOT_LISTED_COLOR, strength: 'faint' };
  }
  return null;
}

const DAY = Object.freeze({ day: 'numeric', timeZone: 'UTC' });
const MONTH = Object.freeze({ month: 'short', timeZone: 'UTC' });
const YEAR = Object.freeze({ year: 'numeric', timeZone: 'UTC' });
const SAST_DAY = Object.freeze({
  day: 'numeric',
  timeZone: 'Africa/Johannesburg',
});
const SAST_MONTH = Object.freeze({
  month: 'short',
  timeZone: 'Africa/Johannesburg',
});
const SAST_YEAR = Object.freeze({
  year: 'numeric',
  timeZone: 'Africa/Johannesburg',
});

/**
 * "19 Nov 2026" from a date-only ISO string (read as written, whatever the
 * machine's zone) or a timestamp (shown in South African time). Anything
 * else comes back unchanged.
 */
export function formatSaDate(value) {
  const dateOnly =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = dateOnly
    ? Date.parse(`${value}T00:00:00Z`)
    : new Date(value).getTime();
  if (!Number.isFinite(ms)) return String(value ?? '');
  const [d, m, y] = dateOnly
    ? [DAY, MONTH, YEAR]
    : [SAST_DAY, SAST_MONTH, SAST_YEAR];
  return `${formatDate(ms, d)} ${formatDate(ms, m)} ${formatDate(ms, y)}`;
}

/** "2026-08" -> "Aug 2026"; anything else comes back unchanged. */
function formatSaMonth(value) {
  const ms =
    typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
      ? Date.parse(`${value}-01T00:00:00Z`)
      : NaN;
  if (!Number.isFinite(ms)) return String(value ?? '');
  return `${formatDate(ms, MONTH)} ${formatDate(ms, YEAR)}`;
}

function cut(line) {
  return line.length > LINE_CAP ? `${line.slice(0, LINE_CAP - 1)}…` : line;
}

function auditLine(code, gov) {
  if (!gov.audits) return t('Audit: unavailable');
  const year = auditYearLabel(gov.audits.year);
  const entry = gov.audits.byCode.get(code);
  return entry
    ? t('Audit {year}: {opinion}', { year, opinion: entry.label })
    : t('Audit {year}: no data', { year });
}

function mayorLines(row) {
  const lines = [];
  if (row.status === 'elected') {
    lines.push(
      t('Mayor: {mayor} ({party}), elected {date}', {
        mayor: row.mayor ?? '',
        party: row.party ?? '',
        date: formatSaDate(row.electedOn),
      }),
    );
  } else {
    lines.push(
      t('Mayor: not yet elected (as of {date})', {
        date: formatSaDate(row.asOf),
      }),
    );
  }
  if (typeof row.note === 'string' && row.note.trim()) lines.push(row.note);
  return lines;
}

/**
 * The governance lines of a council card, each cut to 90 characters.
 * @param {string} code council code
 * @param {object|null} gov normalizeGovernance result
 * @returns {string[]}
 */
export function governanceLines(code, gov) {
  if (!gov) return [];
  const lines = [];
  const district = gov.districtOf.get(code);
  if (district && district.code !== code) {
    lines.push(
      t('District: {name} ({code})', {
        name: district.name,
        code: district.code,
      }),
    );
  }
  lines.push(auditLine(code, gov));
  const listed = gov.interventions.get(code);
  if (listed) {
    lines.push(
      t('Section 139 since {since} (CoGTA list, {asOf})', {
        since: listed.since,
        asOf: formatSaMonth(gov.interventionsAsOf),
      }),
    );
    lines.push(t('Type: {type}', { type: listed.type }));
  }
  const metro = gov.metros.get(code);
  if (metro) lines.push(...mayorLines(metro));
  return lines.map(cut);
}
