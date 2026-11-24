import { readResponseJsonCapped, coalesceProxyRequest } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { admitSameSiteKeyless } from './common/same-site.js';
import {
  normalizeEmscSnapshot,
  SA_QUAKE_WINDOW_MS,
} from '../../src/layers/saQuakes/records.js';

const EMSC_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query?';
const TTL_MS = 600_000;
/** Longest a failed refresh keeps serving the last snapshot, marked stale. */
const STALE_MAX_MS = 86_400_000;
const BODY_CAP = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const HEADERS = {
  'User-Agent': 'GodsEyeView (sa-quakes)',
  Accept: 'application/json',
};

/** Fixed-host, bounded EMSC earthquake route for the South African box. */
export function saQuakesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  log = console,
} = {}) {
  let snapshot = null;
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });

  async function refresh() {
    const starttime = new Date(now() - SA_QUAKE_WINDOW_MS)
      .toISOString()
      .slice(0, 19);
    const url =
      EMSC_URL +
      new URLSearchParams({
        format: 'json',
        minlat: '-35',
        maxlat: '-22',
        minlon: '16',
        maxlon: '33',
        orderby: 'time',
        limit: '500',
        starttime,
      });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(url, {
      headers: HEADERS,
      redirect: 'error',
      signal,
    });
    let rows;
    if (response.status === 204) {
      // No event in the window: an empty layer, not a failure.
      await response.body?.cancel();
      rows = [];
    } else {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`upstream_${response.status}`);
      }
      rows = normalizeEmscSnapshot(
        await readResponseJsonCapped(response, BODY_CAP, signal),
      );
      if (!rows) throw new Error('malformed_snapshot');
    }
    return { fetchedAt: now(), rows, savedAt: now() };
  }

  async function acquire() {
    const previous = snapshot;
    if (previous && now() - previous.savedAt < TTL_MS)
      return { value: previous, stale: false };
    if (!inFlight.has('quakes') && inFlight.size >= 256)
      throw Object.assign(new Error('busy'), { status: 429 });
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'quakes', async () => {
        snapshot = await refresh();
        return snapshot;
      });
      return { value: await promise, stale: false };
    } catch (error) {
      if (previous && now() - previous.savedAt <= STALE_MAX_MS)
        return { value: previous, stale: true };
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value, stale = false) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...(stale ? { 'X-Data-Stale': 'true' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      const { value, stale } = await acquire();
      const cutoff = now() - SA_QUAKE_WINDOW_MS;
      json(
        200,
        {
          fetchedAt: value.fetchedAt,
          // The window is applied at serve time, so stale serving stays honest.
          rows: value.rows.filter((row) => row.timeMs >= cutoff),
          ...(stale ? { stale: true } : {}),
        },
        stale,
      );
    } catch (error) {
      if (error.status !== 429)
        log.warn('[sa-quakes] refresh failed', error?.code || error?.message);
      json(error.status === 429 ? 429 : 502, {
        error: 'sa_earthquakes_unavailable',
      });
    }
  }

  return {
    name: 'sa-earthquakes',
    configureServer({ middlewares }) {
      middlewares.use('/api/sa-earthquakes', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/sa-earthquakes', handler);
    },
  };
}
