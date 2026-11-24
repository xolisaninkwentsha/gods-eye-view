import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { normalizeDistricts, normalizeGovernance } from './records.js';

// A portable export (package.json): no i18n here. Failures stay English data;
// the Layers panel shows them translated.
const msg = (text) => text;

const SNAPSHOT_CAP = 8 * 1024 * 1024;
const DISTRICTS_CAP = 40 * 1024 * 1024;

/** Request SA governance data through the same-origin proxy. */
export function createSaGovernanceSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function load(path, cap, normalize, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(path, { signal });
    if (!response.ok) throw new Error(`SA governance HTTP ${response.status}`);
    const payload = await readResponseJsonCapped(response, cap, signal);
    signal?.throwIfAborted();
    const result = normalize(payload);
    if (!result) throw new Error(msg('Malformed SA governance data'));
    return result;
  }

  return {
    /** Audits, section 139 list, metro mayors and the district map. */
    getSnapshot({ signal } = {}) {
      return load(
        '/api/sa-governance',
        SNAPSHOT_CAP,
        normalizeGovernance,
        signal,
      );
    },
    /** District boundaries with their member councils. */
    getDistricts({ signal } = {}) {
      return load(
        '/api/sa-governance/districts',
        DISTRICTS_CAP,
        normalizeDistricts,
        signal,
      );
    },
  };
}
