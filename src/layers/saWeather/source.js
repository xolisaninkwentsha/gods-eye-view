import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeSaWeatherAreas } from './records.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel shows them translated.
const msg = (text) => text;

/** Request the current SAWS warnings through the same-origin proxy. */
export function createSaWeatherSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  /**
   * The rows with how fresh they are: the proxy answers from its last
   * snapshot, marked stale, while SAWS is unreachable.
   * @returns {Promise<{rows: object[], stale: boolean, fetchedAt: number|null}>}
   */
  async function getSnapshotDetail({ signal } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl('/api/sa-weather-warnings', { signal });
    if (!response.ok) throw new Error(`SAWS HTTP ${response.status}`);
    const payload = await readResponseJsonCapped(
      response,
      16 * 1024 * 1024,
      signal,
    );
    signal?.throwIfAborted();
    const rows = normalizeSaWeatherAreas(payload?.areas);
    if (!rows) throw new Error(msg('Malformed SA weather warnings'));
    return {
      rows,
      stale: payload.stale === true,
      fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : null,
    };
  }

  return {
    /** The area rows (see getSnapshotDetail for staleness). */
    async getSnapshot(options = {}) {
      return (await getSnapshotDetail(options)).rows;
    },
    getSnapshotDetail,
  };
}
