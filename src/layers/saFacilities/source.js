import { readResponseJsonCapped } from '../../sources/httpBody.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel shows them translated.
const msg = (text) => text;

const MAX_BYTES = 16 * 1024 * 1024;
const SETS = new Set(['health', 'schools']);

/** Request one SA facility set through the same-origin proxy. */
export function createSaFacilitiesSource({
  set,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  if (!SETS.has(set)) throw new TypeError('Unknown SA facilities set');
  return {
    /** The raw payload `{set, fetchedAt, updated, stale, records}`; records.js normalises it. */
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(`/api/sa-facilities?set=${set}`, {
        signal,
      });
      if (!response.ok)
        throw new Error(`SA facilities HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
      signal?.throwIfAborted();
      if (!Array.isArray(payload?.records))
        throw new Error(msg('Malformed SA facilities'));
      return payload;
    },
  };
}
