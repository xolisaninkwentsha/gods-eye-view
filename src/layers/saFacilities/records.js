/** Records for the SA health and schools layers: classes and normaliser. No Cesium. */

import { msg } from '../../i18n/index.js';

export const FACILITY_SETS = Object.freeze(['health', 'schools']);

export const FACILITY_CLASSES = Object.freeze({
  health: Object.freeze([
    { key: 'hospital', label: msg('Hospital'), color: '#eb5757' },
    { key: 'clinic', label: msg('Clinic'), color: '#f2994a' },
    { key: 'doctors', label: msg('Doctor'), color: '#bb6bd9' },
    { key: 'pharmacy', label: msg('Pharmacy'), color: '#27ae60' },
    { key: 'dentist', label: msg('Dentist'), color: '#56ccf2' },
    { key: 'other', label: msg('Other'), color: '#bdbdbd' },
  ]),
  schools: Object.freeze([
    { key: 'yes', label: msg('Connected'), color: '#27ae60' },
    { key: 'no', label: msg('Not connected'), color: '#eb5757' },
    { key: 'unknown', label: msg('Unknown'), color: '#9e9e9e' },
  ]),
});

/** The closed set of school levels the provider sends; each name goes through t(). */
export const SCHOOL_LEVEL_LABELS = Object.freeze({
  Primary: msg('Primary'),
  Secondary: msg('Secondary'),
  'Primary and Secondary': msg('Primary and Secondary'),
  'Pre-Primary': msg('Pre-Primary'),
  Other: msg('Other'),
  Unknown: msg('Unknown'),
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
