// /api/sa-elections/{councils,wards}: Municipal Demarcation Board 2026 boundaries joined to the
// IEC's 2026 local election results. IEC files are read only when SA_ELECTIONS_RESULTS=1.
// All work is request-driven: nothing runs at construction and there are no timers.
import fs from 'node:fs';
import path from 'node:path';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { fetchBoundaries } from './boundaries.js';
import { IEC_PROVINCES, headProvince, streamProvince, fetchSeatFile, isCouncilCode } from './iec.js';
import { readSeatFile } from './seats.js';
import { councilOutcome, wardOutcome, seatCheck } from './results.js';
import { readJsonFile, writeJsonAtomic } from './cache.js';

const LEVELS = ['councils', 'wards'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const RESULTS_FILE = 'results.json';
const boundaryFile = (level) => `boundaries-${level}.json`;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const reason = (err) => `${err?.message || err}${err?.status ? ` (HTTP ${err.status})` : ''}`;
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

const validArea = (area) => isRecord(area) && typeof area.id === 'string' && Array.isArray(area.polygons);
const validBoundaries = (saved) =>
  saved?.version === 1 &&
  Number.isFinite(saved.fetchedAt) &&
  Array.isArray(saved.areas) &&
  saved.areas.length > 0 &&
  saved.areas.every(validArea);
const validProvince = (entry) =>
  isRecord(entry) &&
  (entry.lastModified === null || Number.isFinite(entry.lastModified)) &&
  isRecord(entry.councils) &&
  isRecord(entry.wards);

/**
 * Plain-object outcomes for one province. A council whose seat file was read gets its seat
 * check; a mismatch marks every ward of that council unconfirmed.
 * @param {string} code
 * @param {import('./results.js').ProvinceTally} tally
 * @param {Map<string, import('./seats.js').SeatSheet>} seatsByCouncil
 * @param {number|null} lastModified
 */
function provinceEntry(code, tally, seatsByCouncil, lastModified) {
  const wards = {};
  const wardsOf = new Map();
  for (const [id, ward] of tally.wards) {
    const result = wardOutcome(ward);
    wards[id] = result;
    if (!wardsOf.has(ward.catB)) wardsOf.set(ward.catB, []);
    wardsOf.get(ward.catB).push(result);
  }
  const councils = {};
  for (const [catB, council] of tally.councils) {
    if (!isCouncilCode(catB)) {
      warn(`${code}: skipped unexpected council code ${JSON.stringify(catB.slice(0, 40))}`);
      continue;
    }
    const seats = seatsByCouncil.get(catB) ?? null;
    const result = councilOutcome(council, seats);
    if (seats) {
      const wardResults = wardsOf.get(catB) ?? [];
      result.seatCheck = seatCheck(wardResults, seats);
      if (result.seatCheck === 'mismatch') for (const ward of wardResults) ward.confirmed = false;
      const unmatched = seats.parties.filter((p) => !council.prVotes.has(p.party)).map((p) => p.party);
      if (unmatched.length) warn(`${code}/${catB}: seat-file parties with no PR votes: ${unmatched.join('; ')}`);
    }
    councils[catB] = result;
  }
  return { lastModified, councils, wards };
}

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
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600, now });
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
  let resultsFromCache = false;
  let run = null;
  /** @type {{ at: number, ok: boolean }|null} */
  let lastRun = null;
  const provinceSlots = limiter(2);
  const seatSlots = limiter(4);

  // One chain for every cache write, so results.json renames land in order, newest last.
  let writes = Promise.resolve();
  const persist = (name, value) => {
    writes = writes.then(() => writeJsonAtomic(fsImpl, cacheDir, name, typeof value === 'function' ? value() : value));
    return writes;
  };
  const persistResults = () => persist(RESULTS_FILE, () => ({ version: 1, provinces }));

  function readBoundaryCache() {
    boundaryCacheRead ??= Promise.all(
      LEVELS.map(async (level) => {
        const saved = await readJsonFile(fsImpl, cacheFile(boundaryFile(level)));
        if (validBoundaries(saved)) boundaries[level] ??= { fetchedAt: saved.fetchedAt, areas: saved.areas };
      }),
    );
    return boundaryCacheRead;
  }

  function readResultsCache() {
    resultsCacheRead ??= readJsonFile(fsImpl, cacheFile(RESULTS_FILE)).then((saved) => {
      if (saved?.version !== 1 || !isRecord(saved.provinces)) return;
      for (const code of IEC_PROVINCES) {
        if (!validProvince(saved.provinces[code])) continue;
        provinces[code] ??= saved.provinces[code];
        resultsFromCache = true;
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
      for (const [id, result] of Object.entries(entry.councils)) byCouncil.set(id, result);
      for (const [id, result] of Object.entries(entry.wards)) byWard.set(id, result);
    }
  }

  function refreshBoundaries(level) {
    boundaryLoads[level] ??= fetchBoundaries(level, { fetchImpl })
      .then((areas) => {
        boundaries[level] = { fetchedAt: now(), areas };
        return persist(boundaryFile(level), { version: 1, ...boundaries[level] });
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
      if (!boundaryLoads[level] && now() - boundaryFailedAt[level] < MINUTE) throw new Error('boundaries_unavailable');
      await refreshBoundaries(level);
      return boundaries[level];
    }
    if (now() - held.fetchedAt > WEEK && now() - boundaryFailedAt[level] >= HOUR) {
      refreshBoundaries(level).catch(() => {});
    }
    return held;
  }

  /** HEAD the province file; download and re-derive it only when it is new or changed. */
  async function refreshProvince(code) {
    const lastModified = await headProvince(code, { fetchImpl });
    const previous = provinces[code];
    if (previous && (lastModified === null || lastModified === previous.lastModified)) return;
    const tally = await streamProvince(code, { fetchImpl });
    const seats = new Map();
    const councilCodes = [...tally.councils.keys()].filter(isCouncilCode);
    await Promise.all(
      councilCodes.map((catB) =>
        seatSlots(async () => {
          try {
            seats.set(catB, readSeatFile(await fetchSeatFile(code, catB, { fetchImpl })));
          } catch (err) {
            warn(`seat file ${code}/${catB} not read: ${reason(err)}`);
          }
        }),
      ),
    );
    provinces[code] = provinceEntry(code, tally, seats, lastModified);
    reindex();
    persistResults();
  }

  /** Starts a results check when one is due: never run, a day after a good one, an hour after a failed one. */
  function maybeStartRun() {
    if (run || !switchOn()) return;
    if (lastRun && now() - lastRun.at < (lastRun.ok ? DAY : HOUR)) return;
    run = (async () => {
      let ok = true;
      await Promise.all(
        IEC_PROVINCES.map((code) =>
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

  // `loading` until a completed set exists: one read from the cache, or a finished check. The
  // first check's provinces are served as they land, but it stays `loading` until it ends.
  function resultsStatus() {
    if (!switchOn()) return 'off';
    if (!lastRun && !resultsFromCache) return 'loading';
    const present = IEC_PROVINCES.filter((code) => provinces[code]).length;
    if (present === 0) return run ? 'loading' : 'failed';
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
    const index = status === 'off' ? null : level === 'councils' ? byCouncil : byWard;
    return {
      level,
      results: status,
      resultsAsOf: status === 'off' ? null : resultsAsOf(),
      boundariesAsOf: held.fetchedAt,
      areas: held.areas.map((area) => ({ ...area, result: index?.get(area.id) ?? null })),
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
      const stale = status === 'stale' || boundaryFailedAt[level] > held.fetchedAt;
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
