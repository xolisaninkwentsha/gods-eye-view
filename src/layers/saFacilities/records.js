/** Records for the SA health and schools layers: classes and normaliser. No Cesium. */

import { t } from '../../i18n/index.js';

export const FACILITY_SETS = Object.freeze(['health', 'schools']);

// Each `label()` is a literal t() call with its own context, so "Other",
// "Unknown" and "Primary" here never take another feature's translation
// (the draw tool's "Primary" colour, say). The catalogs key them
// `context|text`; English shows the text.

export const FACILITY_CLASSES = Object.freeze({
  health: Object.freeze([
    {
      key: 'hospital',
      label: () => t('Hospital', { context: 'health facility' }),
      color: '#eb5757',
    },
    {
      key: 'clinic',
      label: () => t('Clinic', { context: 'health facility' }),
      color: '#f2994a',
    },
    {
      key: 'doctors',
      label: () => t('Doctor', { context: 'health facility' }),
      color: '#bb6bd9',
    },
    {
      key: 'pharmacy',
      label: () => t('Pharmacy', { context: 'health facility' }),
      color: '#27ae60',
    },
    {
      key: 'dentist',
      label: () => t('Dentist', { context: 'health facility' }),
      color: '#56ccf2',
    },
    {
      key: 'other',
      label: () => t('Other', { context: 'health facility' }),
      color: '#bdbdbd',
    },
  ]),
  schools: Object.freeze([
    {
      key: 'yes',
      label: () => t('Connected', { context: 'internet access' }),
      color: '#27ae60',
    },
    {
      key: 'no',
      label: () => t('Not connected', { context: 'internet access' }),
      color: '#eb5757',
    },
    {
      key: 'unknown',
      label: () => t('Unknown', { context: 'internet access' }),
      color: '#9e9e9e',
    },
  ]),
});

/** The closed set of school levels the provider sends, each with its label. */
export const SCHOOL_LEVEL_LABELS = Object.freeze({
  Primary: () => t('Primary', { context: 'school level' }),
  Secondary: () => t('Secondary', { context: 'school level' }),
  'Primary and Secondary': () =>
    t('Primary and Secondary', { context: 'school level' }),
  'Pre-Primary': () => t('Pre-Primary', { context: 'school level' }),
  Other: () => t('Other', { context: 'school level' }),
  Unknown: () => t('Unknown', { context: 'school level' }),
});

/** The field of a record that holds its class, per set. */
export const CLASS_FIELD = Object.freeze({
  health: 'kind',
  schools: 'connectivity',
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * `{records, fetchedAt, updated, stale}` from a `/api/sa-facilities` payload;
 * null when the payload or the set is unusable. Records without a string id,
 * finite coordinates or a known class are dropped.
 */
export function normaliseFacilities(payload, set) {
  const classes = FACILITY_CLASSES[set];
  if (!classes || !payload || !Array.isArray(payload.records)) return null;
  const known = new Set(classes.map((c) => c.key));
  const field = CLASS_FIELD[set];
  const records = payload.records.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      r.id !== '' &&
      finite(r.lat) &&
      finite(r.lon) &&
      known.has(r[field]),
  );
  const fetchedAt =
    typeof payload.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(payload.fetchedAt))
      ? payload.fetchedAt
      : null;
  return {
    records,
    fetchedAt,
    updated: typeof payload.updated === 'string' ? payload.updated : null,
    stale: payload.stale === true,
  };
}
