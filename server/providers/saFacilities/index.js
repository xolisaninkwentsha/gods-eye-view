// /api/sa-facilities: HDX health sites (healthsites.io, ODbL) and Giga schools
// (CC BY), fetched on request, parsed, and kept in memory and in
// .gev-cache/sa-facilities/<set>.json. Nothing fetched is committed.
import fs from 'node:fs';
import path from 'node:path';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import {
  readJsonFile,
  removeOrphanTemps,
  writeJsonAtomic,
} from '../saElections/cache.js';
import { FACILITY_SETS, fetchHdxResource } from './hdx.js';
import { parseGigaSchools, parseHealthSites } from './parse.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TTL = DAY;
const STALE_MAX = 30 * DAY;
// A refresh with fewer records than this share of the held set is refused.
const SHRINK_FLOOR = 0.5;
const PARSERS = { health: parseHealthSites, schools: parseGigaSchools };

const CODE = /^[A-Za-z0-9_]{1,40}$/;
/** A log and error label that never carries upstream text: a code, else a fixed name. */
function errorLabel(error) {
  if (error?.name === 'AbortError') return 'ABORTED';
  for (const code of [error?.code, error?.cause?.code])
    if (typeof code === 'string' && CODE.test(code)) return code;
  return 'FETCH_FAILED';
}

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validRecord = (r) =>
  isObject(r) &&
  typeof r.id === 'string' &&
  Number.isFinite(r.lat) &&
  Number.isFinite(r.lon);
const validSaved = (saved, set, at) =>
  saved?.version === 1 &&
  saved.set === set &&
  Number.isFinite(saved.fetchedAt) &&
  saved.fetchedAt <= at &&
  (saved.updated === null || typeof saved.updated === 'string') &&
  Array.isArray(saved.records) &&
  saved.records.length > 0 &&
  saved.records.every(validRecord);

/**
 * Vite plugin for /api/sa-facilities?set=health|schools. `now` drives every
 * refresh decision. In-flight fetches are aborted, and the first-request wait
 * timers cleared, when the dev or preview server closes or on `closeBundle`.
 */
export function saFacilitiesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache', 'sa-facilities'),
  now = () => Date.now(),
  fsImpl = fs.promises,
  log = console,
  firstWaitMs = 60_000,
} = {}) {
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 60,
    globalMax: 600,
    now,
  });
  const sets = Object.keys(FACILITY_SETS);
  const held = Object.fromEntries(sets.map((s) => [s, null]));
  const loads = { ...held };
  const failedAt = Object.fromEntries(sets.map((s) => [s, -Infinity]));
  const lastError = { ...held };
  const abort = new AbortController();
  const timers = new Set();
  let closed = false;

  const warn = (set, code) => log.warn(`[sa-facilities] ${set} ${code}`);
  const file = (set) => `${set}.json`;

  let diskRead = null;
  const readDisk = () =>
    (diskRead ??= (async () => {
      try {
        await removeOrphanTemps(fsImpl, cacheDir);
        for (const set of sets) {
          const saved = await readJsonFile(
            fsImpl,
            path.join(cacheDir, file(set)),
          );
          if (validSaved(saved, set, now())) held[set] ??= saved;
        }
      } catch (error) {
        warn('cache', errorLabel(error));
      }
    })());

  /** One fetch per set at a time, shared by every request that needs it. */
  function refresh(set) {
    loads[set] ??= (async () => {
      try {
        let updated = null;
        const text = await fetchHdxResource(FACILITY_SETS[set], {
          fetchImpl,
          signal: abort.signal,
          onResource: (meta) => {
            updated = meta.updated;
          },
        });
        const records = PARSERS[set](text);
        if (records.length === 0)
          throw Object.assign(new Error('empty'), { code: 'PARSE_FAILED' });
        const prev = held[set];
        const prevUsable = prev && now() - prev.fetchedAt <= STALE_MAX;
        if (prevUsable && records.length < prev.records.length * SHRINK_FLOOR) {
          failedAt[set] = now();
          lastError[set] = 'shrunk';
          warn(set, 'shrunk');
          return;
        }
        const value = { version: 1, set, fetchedAt: now(), updated, records };
        held[set] = value;
        lastError[set] = null;
        const written = await writeJsonAtomic(
          fsImpl,
          cacheDir,
          file(set),
          value,
          { warn() {} },
        );
        if (!written) warn(set, 'cache_write_failed');
      } catch (error) {
        failedAt[set] = now();
        lastError[set] = errorLabel(error);
        if (!closed) warn(set, lastError[set]);
      } finally {
        loads[set] = null;
      }
    })();
    return loads[set];
  }

  /** The held value for `set`, refreshed when due; null when nothing usable is held. */
  async function acquire(set) {
    await readDisk();
    const age = () => (held[set] ? now() - held[set].fetchedAt : Infinity);
    const backedOff = () => now() - failedAt[set] < MINUTE;
    if (age() <= TTL) return { value: held[set], stale: false };
    // `stale` means the last refresh attempt failed and the copy is past its
    // TTL. A copy merely past the TTL, with a refresh in flight or not yet
    // tried, is not stale: the refresh usually fixes it before anyone looks.
    const failed = () => lastError[set] != null || backedOff();
    if (age() <= STALE_MAX) {
      // Serve what is held; the refresh runs on its own and never rejects.
      if (!loads[set] && !backedOff() && !closed) refresh(set);
      return { value: held[set], stale: failed() };
    }
    if (loads[set] || (!backedOff() && !closed)) {
      // The first read waits for the fetch, but not past `firstWaitMs`.
      let cap;
      const capped = new Promise((resolve) => {
        cap = setTimeout(resolve, firstWaitMs);
        cap.unref?.();
        timers.add(cap);
      });
      try {
        await Promise.race([refresh(set), capped]);
      } finally {
        clearTimeout(cap);
        timers.delete(cap);
      }
    }
    if (age() <= TTL) return { value: held[set], stale: false };
    if (age() <= STALE_MAX) return { value: held[set], stale: failed() };
    return null;
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
    const [route, query = ''] = (req.url || '/').split('?');
    if (route !== '/' && route !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const set = new URLSearchParams(query).get('set');
    if (typeof set !== 'string' || !Object.hasOwn(FACILITY_SETS, set))
      return json(400, { error: 'unknown-set' });
    try {
      const got = await acquire(set);
      if (!got) return json(503, { error: lastError[set] || 'UNAVAILABLE' });
      const { fetchedAt, updated, records } = got.value;
      json(
        200,
        {
          set,
          fetchedAt: new Date(fetchedAt).toISOString(),
          updated,
          stale: got.stale,
          records,
        },
        got.stale,
      );
    } catch (error) {
      warn(set, errorLabel(error));
      json(503, { error: errorLabel(error) });
    }
  }

  /** Aborts what is in flight and clears the wait timers; idempotent. */
  function stop() {
    if (closed) return;
    closed = true;
    abort.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function install(server) {
    server.middlewares.use('/api/sa-facilities', handler);
    // Vite restarts the server in-process; the old provider must not live on.
    server.httpServer?.once('close', stop);
  }

  return {
    name: 'sa-facilities',
    configureServer: install,
    configurePreviewServer: install,
    // Middleware mode has no httpServer to hang 'close' on.
    closeBundle: stop,
  };
}
