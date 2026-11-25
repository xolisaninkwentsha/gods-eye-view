import { readResponseJsonCapped } from '../../sources/httpBody.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel shows them translated.
const msg = (text) => text;

const MAX_BYTES = 8 * 1024 * 1024;

/** Request the SA news snapshot through the same-origin proxy. */
export function createSaNewsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    /** The raw payload `{fetchedAt, stories, status}`; records.js normalises it. */
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/sa-news', { signal });
      if (!response.ok) throw new Error(`SA news HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, MAX_BYTES, signal);
      signal?.throwIfAborted();
      if (!Array.isArray(payload?.stories))
        throw new Error(msg('Malformed SA news'));
      return payload;
    },
  };
}
