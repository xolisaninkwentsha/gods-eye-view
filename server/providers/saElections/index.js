// /api/sa-elections/{councils,wards}: Municipal Demarcation Board 2026 boundaries joined to the
// IEC's 2026 local election results. IEC files are read only when SA_ELECTIONS_RESULTS=1.
// All work is request-driven: nothing runs at construction and there are no timers.
import fs from 'node:fs';
import path from 'node:path';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { fetchBoundaries } from './boundaries.js';
import {
  IEC_PROVINCES,
  headProvince,
  streamProvince,
  fetchSeatFile,
  isCouncilCode,
} from './iec.js';
import { readSeatFile } from './seats.js';
import {
  isRecord,
  cachedProvince,
  provinceEntry,
  withRetriedSeats,
} from './entries.js';
import { readJsonFile, removeOrphanTemps, writeJsonAtomic } from './cache.js';

const LEVELS = ['councils', 'wards'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const RESULTS_FILE = 'results.json';
const boundaryFile = (level) => `boundaries-${level}.json`;

const reason = (err) =>
  `${err?.message || err}${err?.status ? ` (HTTP ${err.status})` : ''}`;
const warn = (message) => console.warn(`[sa-elections] ${message}`);

/** Runs at most `max` of the given tasks at once. */
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}

// Bumped when the seat-file parser changes what it reads: a cache built by the old one is rebuilt.
const RESULTS_VERSION = 2;
const validArea = (area) =>
  isRecord(area) && typeof area.id === 'string' && Array.isArray(area.polygons);
const validBoundaries = (saved) =>
  saved?.version === 1 &&
  Number.isFinite(saved.fetchedAt) &&
  Array.isArray(saved.areas) &&
  saved.areas.length > 0 &&
  saved.areas.every(validArea);

/**
 * Vite plugin for /api/sa-elections. `now` drives every refresh decision; `fsImpl` does every
 * cache read and write (default `fs.promises`).
 */
export function saElectionsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  cacheDir = path.join(process.cwd(), '.gev-cache', 'sa-elections'),
  env = process.env,
  fsImpl = fs.promises,
} = {}) {
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 60,
    globalMax: 600,
    now,
  });
  const switchOn = () => env.SA_ELECTIONS_RESULTS === '1';
  const cacheFile = (name) => path.join(cacheDir, name);

  // Boundaries per level ({ fetchedAt, areas }), the fetch in flight, and the last failed one.
  const boundaries = { councils: null, wards: null };
  const boundaryLoads = { councils: null, wards: null };
  const boundaryFailedAt = { councils: -Infinity, wards: -Infinity };
  let boundaryCacheRead = null;

  // Results per IEC province code, lookups by area id, the running check and the last finished one.
  const provinces = {};
  let byCouncil = new Map();
  let byWard = new Map();
  let resultsCacheRead = null;
  /** @type {{ fillsGaps: boolean }|null} the run in progress */
  let run = null;
  /** @type {{ at: number, ok: boolean }|null} */
  let lastRun = null;
  const provinceSlots = limiter(2);
  const seatSlots = limiter(4);

  // One chain for every cache write, so results.json renames land in order, newest last.
  let writes = Promise.resolve();
  const persist = (name, value) => {
    writes = writes.then(() =>
      writeJsonAtomic(
        fsImpl,
        cacheDir,
        name,
        typeof value === 'function' ? value() : value,
      ),
    );
    return writes;
  };
  const persistResults = () =>
    persist(RESULTS_FILE, () => ({ version: RESULTS_VERSION, provinces }));

  // Before the first cache read, and so before any write, the temp files a process killed
  // between write and rename left behind are deleted.
  let tempSweep = null;
  const sweepTemps = () =>
    (tempSweep ??= removeOrphanTemps(fsImpl, cacheDir).then((removed) => {
      if (removed) warn(`removed ${removed} leftover cache temp file(s)`);
    }));

  function readBoundaryCache() {
    boundaryCacheRead ??= sweepTemps().then(() =>
      Promise.all(
        LEVELS.map(async (level) => {
          const saved = await readJsonFile(
            fsImpl,
            cacheFile(boundaryFile(level)),
          );
          if (validBoundaries(saved))
            boundaries[level] ??= {
              fetchedAt: saved.fetchedAt,
              areas: saved.areas,
            };
        }),
      ),
    );
    return boundaryCacheRead;
  }

  function readResultsCache() {
    resultsCacheRead ??= sweepTemps()
      .then(() => readJsonFile(fsImpl, cacheFile(RESULTS_FILE)))
      .then((saved) => {
        if (saved?.version !== RESULTS_VERSION || !isRecord(saved.provinces))
          return;
        for (const code of IEC_PROVINCES) {
          const entry = cachedProvince(saved.provinces[code]);
          if (entry) provinces[code] ??= entry;
        }
        reindex();
      });
    return resultsCacheRead;
  }

  function reindex() {
    byCouncil = new Map();
    byWard = new Map();
    for (const code of IEC_PROVINCES) {
      const entry = provinces[code];
      if (!entry) continue;
      for (const [id, result] of Object.entries(entry.councils))
        byCouncil.set(id, result);
      for (const [id, result] of Object.entries(entry.wards))
        byWard.set(id, result);
    }
  }

  function refreshBoundaries(level) {
    boundaryLoads[level] ??= fetchBoundaries(level, { fetchImpl })
      .then((areas) => {
        boundaries[level] = { fetchedAt: now(), areas };
        return persist(boundaryFile(level), {
          version: 1,
          ...boundaries[level],
        });
      })
      .catch((err) => {
        boundaryFailedAt[level] = now();
        warn(`${level} boundaries not fetched: ${reason(err)}`);
        throw err;
      })
      .finally(() => {
        boundaryLoads[level] = null;
      });
    return boundaryLoads[level];
  }

  /** The level's areas. With none held, waits for MDB (retrying at most once a minute). */
  async function currentBoundaries(level) {
    const held = boundaries[level];
    if (!held) {
      if (!boundaryLoads[level] && now() - boundaryFailedAt[level] < MINUTE)
        throw new Error('boundaries_unavailable');
      await refreshBoundaries(level);
      return boundaries[level];
    }
    if (
      now() - held.fetchedAt > WEEK &&
      now() - boundaryFailedAt[level] >= HOUR
    ) {
      refreshBoundaries(level).catch(() => {});
    }
    return held;
  }

  /** Reads the councils' seat files, 4 at a time across all provinces; failures are logged, not thrown. */
  async function readSeats(code, councilCodes) {
    const seats = new Map();
    await Promise.all(
      councilCodes.map((catB) =>
        seatSlots(async () => {
          try {
            seats.set(
              catB,
              readSeatFile(await fetchSeatFile(code, catB, { fetchImpl })),
            );
          } catch (err) {
            warn(`seat file ${code}/${catB} not read: ${reason(err)}`);
          }
        }),
      ),
    );
    return seats;
  }

  /** Fetches only the seat files that failed before, and re-derives the councils that now read. */
  async function retrySeats(code, entry) {
    const seats = await readSeats(code, Object.keys(entry.seatRetry ?? {}));
    if (seats.size === 0) return;
    provinces[code] = withRetriedSeats(code, entry, seats);
    reindex();
    persistResults();
  }

  /**
   * HEAD the province file. A new or changed file is downloaded and re-derived with all its
   * seat files; an unchanged one only retries the seat files that failed before.
   */
  async function refreshProvince(code) {
    const lastModified = await headProvince(code, { fetchImpl });
    const previous = provinces[code];
    if (
      previous &&
      (lastModified === null || lastModified === previous.lastModified)
    ) {
      await retrySeats(code, previous);
      return;
    }
    const tally = await streamProvince(code, { fetchImpl });
    const seats = await readSeats(
      code,
      [...tally.councils.keys()].filter(isCouncilCode),
    );
    provinces[code] = provinceEntry(code, tally, seats, lastModified);
    reindex();
    persistResults();
  }

  /**
   * The run due now, if any. Provinces missing from the results (first run, a partial cache, a
   * failed download) are fetched on their own and read `loading`. With all nine present, the
   * full check comes a day after a good run. Either way a failed run waits an hour.
   */
  function dueRun() {
    const since = lastRun ? now() - lastRun.at : Infinity;
    if (lastRun && !lastRun.ok && since < HOUR) return null;
    const missing = IEC_PROVINCES.filter((code) => !provinces[code]);
    if (missing.length) return { codes: missing, fillsGaps: true };
    if (!lastRun || since >= (lastRun.ok ? DAY : HOUR))
      return { codes: IEC_PROVINCES, fillsGaps: false };
    return null;
  }

  function maybeStartRun() {
    if (run || !switchOn()) return;
    const due = dueRun();
    if (!due) return;
    run = { fillsGaps: due.fillsGaps };
    (async () => {
      let ok = true;
      await Promise.all(
        due.codes.map((code) =>
          provinceSlots(() =>
            refreshProvince(code).catch((err) => {
              ok = false;
              warn(`${code} results not refreshed: ${reason(err)}`);
            }),
          ),
        ),
      );
      await writes;
      return ok;
    })()
      .catch((err) => {
        warn(`results check failed: ${reason(err)}`);
        return false;
      })
      .then((ok) => {
        lastRun = { at: now(), ok };
        run = null;
      });
  }

  // A run filling missing provinces reads `loading` until it ends (provinces it has finished are
  // already served). Otherwise: nothing at all is `failed`, all nine after a good run is `ok`.
  function resultsStatus() {
    if (!switchOn()) return 'off';
    if (run?.fillsGaps) return 'loading';
    const present = IEC_PROVINCES.filter((code) => provinces[code]).length;
    if (present === 0) return lastRun?.ok === false ? 'failed' : 'loading';
    const ok = present === IEC_PROVINCES.length && (lastRun?.ok ?? true);
    return ok ? 'ok' : 'stale';
  }

  function resultsAsOf() {
    let newest = null;
    for (const code of IEC_PROVINCES) {
      const at = provinces[code]?.lastModified;
      if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
    }
    return newest;
  }

  function payload(level, held, status) {
    const index =
      status === 'off' ? null : level === 'councils' ? byCouncil : byWard;
    return {
      level,
      results: status,
      resultsAsOf: status === 'off' ? null : resultsAsOf(),
      boundariesAsOf: held.fetchedAt,
      areas: held.areas.map((area) => ({
        ...area,
        result: index?.get(area.id) ?? null,
      })),
    };
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
    // Refused requests (cross-site, wrong method or path, over quota) do no I/O at all.
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const route = (req.url || '/').split('?')[0];
    const level = LEVELS.find((name) => route === `/${name}`);
    if (!level) return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      await readBoundaryCache();
      if (switchOn()) {
        await readResultsCache();
        maybeStartRun();
      }
      const held = await currentBoundaries(level);
      const status = resultsStatus();
      const stale =
        status === 'stale' || boundaryFailedAt[level] > held.fetchedAt;
      json(200, payload(level, held, status), stale);
    } catch {
      json(502, { error: 'sa_elections_unavailable' });
    }
  }

  return {
    name: 'sa-elections',
    configureServer({ middlewares }) {
      middlewares.use('/api/sa-elections', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/sa-elections', handler);
    },
  };
}
