// Party names and colours for the South African election map. Pure module (no Cesium, no DOM):
// the server (seat sheets, results) and the client layer both import it.

/** Colour for every party without a table entry. Deliberately not the neutral grey of "no fill". */
export const OTHER_COLOR = '#b07aa1';

/**
 * Normalizes an IEC party name: drops a trailing "(PF)" forfeiture mark, folds all whitespace
 * (including newlines) to single spaces, trims and uppercases.
 * @param {string} name
 * @returns {string}
 */
export function normalizePartyName(name) {
  return String(name ?? '')
    .replace(/\(\s*PF\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const FF_PLUS = { short: 'FF Plus', color: '#f28c28' };

/**
 * Style table keyed by normalized IEC name. Keys come from the IEC 2026 files; "RISE MZANSI" is
 * not in the samples we hold and uses the IEC uppercase full-name style.
 * @type {Record<string, { short: string, color: string }>}
 */
export const PARTY_STYLES = {
  'AFRICAN NATIONAL CONGRESS': { short: 'ANC', color: '#1f9d55' },
  'DEMOCRATIC ALLIANCE': { short: 'DA', color: '#1b6ec2' },
  'UMKHONTO WESIZWE PARTY': { short: 'MK', color: '#e0a800' },
  'ECONOMIC FREEDOM FIGHTERS': { short: 'EFF', color: '#d7263d' },
  'INKATHA FREEDOM PARTY': { short: 'IFP', color: '#b3541e' },
  ACTIONSA: { short: 'ActionSA', color: '#0b3d91' },
  'PATRIOTIC ALLIANCE': { short: 'PA', color: '#00897b' },
  // The IEC writes the Afrikaans/English pair with " | " in files and CSVs; keep the plain form too.
  'VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS': FF_PLUS,
  'VRYHEIDSFRONT PLUS FREEDOM FRONT PLUS': FF_PLUS,
  'AFRICAN TRANSFORMATION MOVEMENT': { short: 'ATM', color: '#6a4c93' },
  'UNITED DEMOCRATIC MOVEMENT': { short: 'UDM', color: '#ff7043' },
  GOOD: { short: 'GOOD', color: '#7cb342' },
  'BUILD ONE SOUTH AFRICA': { short: 'BOSA', color: '#8d6e63' },
  'AFRICAN CHRISTIAN DEMOCRATIC PARTY': { short: 'ACDP', color: '#5e35b1' },
  'PAN AFRICANIST CONGRESS OF AZANIA': { short: 'PAC', color: '#455a64' },
  'AL JAMA-AH': { short: 'Al Jama-ah', color: '#00695c' },
  'CONGRESS OF THE PEOPLE': { short: 'COPE', color: '#29b6f6' },
  'RISE MZANSI': { short: 'Rise Mzansi', color: '#ec407a' },
  INDEPENDENT: { short: 'Independent', color: '#a1887f' },
};

/** "DEMOCRATIC PEOPLE'S ALTERNATIVE" -> "Democratic People's Alternative". */
function titleCase(upper) {
  return upper.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * @param {string} name any IEC spelling of a party
 * @returns {{ short: string, color: string }}
 */
export function partyStyle(name) {
  const key = normalizePartyName(name);
  const known = Object.hasOwn(PARTY_STYLES, key) ? PARTY_STYLES[key] : null;
  return known ?? { short: titleCase(key), color: OTHER_COLOR };
}
