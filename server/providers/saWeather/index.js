import { readResponseTextCapped, coalesceProxyRequest } from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { parseSawsFeed, parseCapAlert, sawsCapUrl } from './cap.js';
import { recentWarningFiles, currentWarningAreas } from './select.js';

const SAWS_RSS_URL = 'https://caps.weathersa.co.za/Home/RssFeed';
const RSS_TTL_MS = 600_000;
/** Longest a failed refresh keeps serving the last snapshot, marked stale. */
const STALE_MAX_MS = 86_400_000;
const CAP_CACHE_MAX = 128;
const CAP_CONCURRENCY = 4;
const MIB = 1024 * 1024;
const RSS_CAP = 4 * MIB;
const CAP_CAP = 2 * MIB;
const TIMEOUT_MS = 20_000;
const HEADERS = { 'User-Agent': 'GodsEyeView (sa-weather)' };

/** Fixed-host, bounded South African Weather Service warning route. */
export function saWeatherWarningsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  log = console,
} = {}) {
  /** name -> parsed CAP alert; only files that were read and parsed. */
  const capCache = new Map();
  let snapshot = null;
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 1200 });

  async function upstreamText(url, cap) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: HEADERS,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`upstream_${response.status}`);
    }
    return readResponseTextCapped(response, cap, signal);
  }

  async function loadCap(entry) {
    try {
      const xml = await upstreamText(sawsCapUrl(entry.name), CAP_CAP);
      const alert = parseCapAlert(xml);
      if (!capCache.has(entry.name) && capCache.size >= CAP_CACHE_MAX) {
        capCache.delete(capCache.keys().next().value);
      }
      capCache.set(entry.name, alert);
    } catch (error) {
      log.warn('[sa-weather] cap skipped', entry.name, error?.code || error?.message);
    }
  }

  async function refresh() {
    const feed = parseSawsFeed(await upstreamText(SAWS_RSS_URL, RSS_CAP));
    const candidates = recentWarningFiles(feed, now()).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const missing = candidates.filter((e) => !capCache.has(e.name));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CAP_CONCURRENCY, missing.length) }, async () => {
        while (next < missing.length) await loadCap(missing[next++]);
      }),
    );
    const files = candidates
      .filter((e) => capCache.has(e.name))
      .map((e) => ({
        name: e.name,
        office: e.office,
        hazard: e.hazard,
        alert: capCache.get(e.name),
      }));
    if (candidates.length && !files.length) throw new Error('no_cap_readable');
    return { fetchedAt: now(), files, savedAt: now() };
  }

  async function acquire() {
    const previous = snapshot;
    if (previous && now() - previous.savedAt < RSS_TTL_MS)
      return { value: previous, stale: false };
    if (!inFlight.has('warnings') && inFlight.size >= 256)
      throw Object.assign(new Error('busy'), { status: 429 });
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'warnings', async () => {
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
      const body = {
        fetchedAt: value.fetchedAt,
        // Expiry is applied at serve time, so a stale snapshot drops lapsed warnings.
        areas: currentWarningAreas(value.files, now()),
        ...(stale ? { stale: true } : {}),
      };
      json(200, body, stale);
    } catch (error) {
      if (error.status !== 429)
        log.warn('[sa-weather] refresh failed', error?.code || error?.message);
      json(error.status === 429 ? 429 : 502, {
        error: 'sa_weather_unavailable',
      });
    }
  }

  return {
    name: 'sa-weather-warnings',
    configureServer({ middlewares }) {
      middlewares.use('/api/sa-weather-warnings', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/sa-weather-warnings', handler);
    },
  };
}
