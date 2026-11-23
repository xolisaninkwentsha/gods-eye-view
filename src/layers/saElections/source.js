import { readResponseJsonCapped } from '../../sources/httpBody.js';

/** Request one level of South African election areas from the same-origin route. */
export function createSaElectionsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    /** @returns {Promise<object>} The raw route payload (see records.js to normalize it). */
    async getSnapshot({ signal, level } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(`/api/sa-elections/${level}`, { signal });
      if (!response.ok) throw new Error(`SA elections HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(response, 40 * 1024 * 1024, signal);
      signal?.throwIfAborted();
      return payload;
    },
  };
}
