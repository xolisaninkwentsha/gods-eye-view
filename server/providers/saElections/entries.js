// Province entries as kept in results.json: plain-object ward and council outcomes per area id,
// plus, for councils whose seat file could not be read, what a later retry needs.
import { isCouncilCode } from './iec.js';
import { councilOutcome, wardOutcome, seatCheck } from './results.js';

/**
 * @typedef {{ prVotes: Array<[string, number]>, registered: number, wardCast: number, prCast: number, wards: string[] }} SeatRetry
 * @typedef {{ lastModified: number|null, councils: Record<string, object>, wards: Record<string, object>, seatRetry?: Record<string, SeatRetry> }} ProvinceEntry
 */

export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const warn = (message) => console.warn(`[sa-elections] ${message}`);
const count = (n) => Number.isFinite(n) && n >= 0;

const validRetry = (item) =>
  isRecord(item) &&
  Array.isArray(item.prVotes) &&
  item.prVotes.every((p) => Array.isArray(p) && typeof p[0] === 'string' && count(p[1])) &&
  count(item.registered) &&
  count(item.wardCast) &&
  count(item.prCast) &&
  Array.isArray(item.wards) &&
  item.wards.every((id) => typeof id === 'string');

/** `seatRetry` is kept only while some council still lacks its seat file. */
const withRetry = (entry, seatRetry) => (Object.keys(seatRetry).length ? { ...entry, seatRetry } : entry);

/**
 * A province entry read back from the cache, or null. Malformed seat-retry items are dropped.
 * @returns {ProvinceEntry|null}
 */
export function cachedProvince(entry) {
  if (!isRecord(entry) || !isRecord(entry.councils) || !isRecord(entry.wards)) return null;
  if (entry.lastModified !== null && !Number.isFinite(entry.lastModified)) return null;
  const retry = isRecord(entry.seatRetry)
    ? Object.entries(entry.seatRetry).filter(([catB, item]) => isCouncilCode(catB) && validRetry(item))
    : [];
  const { lastModified, councils, wards } = entry;
  return withRetry({ lastModified, councils, wards }, Object.fromEntries(retry));
}

/**
 * The council's outcome; with seats, its seat check, and on a mismatch its wards unconfirmed.
 * @param {string} where `CODE/CAT_B`, for the log
 * @param {import('./results.js').CouncilTally} council
 * @param {import('./seats.js').SeatSheet|null} seats
 * @param {import('./results.js').WardResult[]} wardResults the council's wards, changed in place
 */
function councilResult(where, council, seats, wardResults) {
  const result = councilOutcome(council, seats);
  if (!seats) return result;
  result.seatCheck = seatCheck(wardResults, seats);
  if (result.seatCheck === 'mismatch') for (const ward of wardResults) ward.confirmed = false;
  const unmatched = seats.parties.filter((p) => !council.prVotes.has(p.party)).map((p) => p.party);
  if (unmatched.length) warn(`${where}: seat-file parties with no PR votes: ${unmatched.join('; ')}`);
  return result;
}

/**
 * Outcomes for one freshly read province.
 * @param {string} code
 * @param {import('./results.js').ProvinceTally} tally
 * @param {Map<string, import('./seats.js').SeatSheet>} seatsByCouncil
 * @param {number|null} lastModified
 * @returns {ProvinceEntry}
 */
export function provinceEntry(code, tally, seatsByCouncil, lastModified) {
  const wards = {};
  const wardsOf = new Map();
  for (const [id, ward] of tally.wards) {
    const result = wardOutcome(ward);
    wards[id] = result;
    if (!wardsOf.has(ward.catB)) wardsOf.set(ward.catB, { ids: [], results: [] });
    wardsOf.get(ward.catB).ids.push(id);
    wardsOf.get(ward.catB).results.push(result);
  }
  const councils = {};
  const seatRetry = {};
  for (const [catB, council] of tally.councils) {
    if (!isCouncilCode(catB)) {
      warn(`${code}: skipped unexpected council code ${JSON.stringify(catB.slice(0, 40))}`);
      continue;
    }
    const seats = seatsByCouncil.get(catB) ?? null;
    const own = wardsOf.get(catB) ?? { ids: [], results: [] };
    councils[catB] = councilResult(`${code}/${catB}`, council, seats, own.results);
    if (!seats) {
      const { registered, wardCast, prCast } = council;
      seatRetry[catB] = { prVotes: [...council.prVotes], registered, wardCast, prCast, wards: own.ids };
    }
  }
  return withRetry({ lastModified, councils, wards }, seatRetry);
}

/**
 * The entry with seat files that have now been read: each such council's outcome and seat check
 * are redone, its wards' `confirmed` recomputed, and it leaves `seatRetry`. The input is not changed.
 * @param {string} code
 * @param {ProvinceEntry} entry
 * @param {Map<string, import('./seats.js').SeatSheet>} seatsByCouncil
 * @returns {ProvinceEntry}
 */
export function withRetriedSeats(code, entry, seatsByCouncil) {
  const councils = { ...entry.councils };
  const wards = { ...entry.wards };
  const seatRetry = { ...entry.seatRetry };
  for (const [catB, seats] of seatsByCouncil) {
    const saved = seatRetry[catB];
    if (!saved) continue;
    const { registered, wardCast, prCast } = saved;
    const council = { prVotes: new Map(saved.prVotes), registered, wardCast, prCast };
    // An unchecked council's wards were never marked down, so `confirmed` restarts from "has a winner".
    const own = saved.wards.filter((id) => isRecord(wards[id]));
    for (const id of own) wards[id] = { ...wards[id], confirmed: wards[id].winner != null };
    councils[catB] = councilResult(`${code}/${catB}`, council, seats, own.map((id) => wards[id]));
    delete seatRetry[catB];
  }
  return withRetry({ lastModified: entry.lastModified, councils, wards }, seatRetry);
}
