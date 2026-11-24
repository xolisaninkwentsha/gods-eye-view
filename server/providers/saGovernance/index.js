// /api/sa-governance: Treasury audit opinions, the curated section 139 and metro mayor tables,
// and MDB district boundaries with council membership. All work is request-driven.
import fs from 'node:fs';
import path from 'node:path';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import {
  fetchBoundaries,
  fetchCouncilDistricts,
} from '../saElections/boundaries.js';
import {
  readJsonFile,
  removeOrphanTemps,
  writeJsonAtomic,
} from '../saElections/cache.js';
import { fetchAudits } from './audits.js';
import { INTERVENTIONS, METROS } from './tables.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KINDS = {
  audits: { file: 'audits.json', ttl: DAY, staleMax: 30 * DAY },
  districts: { file: 'districts.json', ttl: 7 * DAY, staleMax: 90 * DAY },
};

/** A log label that never carries a body: a string code, else the error name. */
const errorLabel = (error) =>
  typeof error?.code === 'string' ? error.code : error?.name || 'error';

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validAudits = (saved) =>
  saved?.version === 1 &&
  Number.isFinite(saved.fetchedAt) &&
  Number.isFinite(saved.year) &&
  isObject(saved.byCode);
const validDistricts = (saved) =>
  saved?.version === 1 &&
  Number.isFinite(saved.fetchedAt) &&
  Array.isArray(saved.areas) &&
  saved.areas.length > 0 &&
  saved.areas.every(
    (area) => isObject(area) && typeof area.code === 'string',
  ) &&
  Array.isArray(saved.members) &&
  saved.members.every((m) => isObject(m) && typeof m.code === 'string');

/** Vite plugin for /api/sa-governance. `now` drives every refresh decision. */
export function saGovernanceProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  cacheDir = path.join(process.cwd(), '.gev-cache', 'sa-governance'),
  fsImpl = fs.promises,
  log = console,
} = {}) {
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 60,
    globalMax: 600,
    now,
  });
  const held = { audits: null, districts: null };
  const loads = { audits: null, districts: null };
  const failedAt = { audits: -Infinity, districts: -Infinity };
  const loaders = {
    audits: async () => {
      const { year, byCode } = await fetchAudits({ fetchImpl });
      return { version: 1, fetchedAt: now(), year, byCode };
    },
    districts: async () => {
      const [areas, members] = await Promise.all([
        fetchBoundaries('districts', { fetchImpl }),
        fetchCouncilDistricts({ fetchImpl }),
      ]);
      return { version: 1, fetchedAt: now(), areas, members };
    },
  };
  const valid = { audits: validAudits, districts: validDistricts };
  const warn = (what, error) =>
    log.warn(`[sa-governance] ${what} failed`, errorLabel(error));

  let diskRead = null;
  const readDisk = () =>
    (diskRead ??= (async () => {
      try {
        await removeOrphanTemps(fsImpl, cacheDir);
        for (const [kind, { file }] of Object.entries(KINDS)) {
          const saved = await readJsonFile(fsImpl, path.join(cacheDir, file));
          if (valid[kind](saved)) held[kind] ??= saved;
        }
      } catch (error) {
        warn('cache read', error);
      }
    })());

  function refresh(kind) {
    loads[kind] ??= (async () => {
      try {
        const value = await loaders[kind]();
        held[kind] = value;
        try {
          await writeJsonAtomic(fsImpl, cacheDir, KINDS[kind].file, value);
        } catch (error) {
          warn(`${kind} cache write`, error);
        }
      } catch (error) {
        failedAt[kind] = now();
        warn(`${kind} refresh`, error);
      } finally {
        loads[kind] = null;
      }
    })();
    return loads[kind];
  }

  /** The held value for `kind`, refreshed when due; null when nothing usable is held. */
  async function acquire(kind) {
    await readDisk();
    const { ttl, staleMax } = KINDS[kind];
    const age = () => (held[kind] ? now() - held[kind].fetchedAt : Infinity);
    if (age() <= ttl) return { value: held[kind], stale: false };
    if (loads[kind] || now() - failedAt[kind] >= MINUTE) await refresh(kind);
    if (age() <= ttl) return { value: held[kind], stale: false };
    if (age() <= staleMax) return { value: held[kind], stale: true };
    return null;
  }

  const membersOf = (area, rows) =>
    rows
      .filter((row) => row.district === area.code)
      .map(({ code, name }) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

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
    const route = (req.url || '/').split('?')[0];
    if (route !== '/' && route !== '' && route !== '/districts')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      if (route === '/districts') {
        const got = await acquire('districts');
        if (!got) return json(502, { error: 'sa_districts_unavailable' });
        const { fetchedAt, areas, members } = got.value;
        return json(
          200,
          {
            fetchedAt,
            areas: areas.map((area) => ({
              ...area,
              members: membersOf(area, members),
            })),
            ...(got.stale ? { stale: true } : {}),
          },
          got.stale,
        );
      }
      const [audits, districts] = await Promise.all([
        acquire('audits'),
        acquire('districts'),
      ]);
      let districtOf = null;
      if (districts) {
        districtOf = {};
        for (const row of districts.value.members)
          districtOf[row.code] = { code: row.district, name: row.districtName };
      }
      json(
        200,
        {
          audits: audits
            ? {
                year: audits.value.year,
                fetchedAt: audits.value.fetchedAt,
                byCode: audits.value.byCode,
              }
            : null,
          auditsStatus: !audits ? 'failed' : audits.stale ? 'stale' : 'ok',
          interventions: INTERVENTIONS,
          metros: METROS,
          districtOf,
        },
        Boolean(audits?.stale),
      );
    } catch (error) {
      warn('request', error);
      json(502, { error: 'sa_governance_unavailable' });
    }
  }

  return {
    name: 'sa-governance',
    configureServer({ middlewares }) {
      middlewares.use('/api/sa-governance', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/sa-governance', handler);
    },
  };
}
