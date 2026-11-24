import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { saGovernanceProxy } from './index.js';
import { INTERVENTIONS, METROS } from './tables.js';

// Everything below is synthetic: made-up councils, districts and audit rows.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 24, 6, 0, 0);
const DIR = '/cache/sa-governance';

const ring = [
  [28, -26],
  [28.1, -26],
  [28.1, -26.1],
  [28, -26],
];
const district = (code, name, category = 'C') => ({
  type: 'Feature',
  properties: {
    DISTRICT: code,
    DISTRICT_N: name,
    CATEGORY: category,
    PROVINCE: 'Gauteng',
  },
  geometry: { type: 'Polygon', coordinates: [ring] },
});
const member = (code, name, dist, distName) => ({
  attributes: {
    CAT_B: code,
    MUNICNAME: name,
    DISTRICT: dist,
    DISTRICT_N: distName,
  },
});
const MDB_DISTRICTS = {
  type: 'FeatureCollection',
  features: [
    district('DC1', 'Alpha District'),
    district('JHB', 'City of Johannesburg', 'A'),
  ],
};
const MDB_MEMBERS = {
  features: [
    member('GP001', 'Zulu Local', 'DC1', 'Alpha District'),
    member('GP002', 'Bravo Local', 'DC1', 'Alpha District'),
    member('JHB', 'City of Johannesburg', 'JHB', 'City of Johannesburg'),
  ],
};
const AUDIT_AGGREGATE = {
  cells: [
    {
      'financial_year_end.year': 2024,
      'opinion.code': 'qualified',
      _count: 250,
    },
  ],
};
const AUDIT_FACTS = {
  data: Array.from({ length: 220 }, (_, i) => ({
    'demarcation.code': i === 0 ? 'JHB' : `M${i}`,
    'opinion.code': 'qualified',
    'opinion.label': 'Qualified',
  })),
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A router over the three upstreams; `down` names the ones that answer 503. */
function upstream() {
  const state = { down: new Set(), calls: [], gate: null };
  state.fetchImpl = async (url) => {
    const href = String(url);
    state.calls.push(href);
    if (state.gate) await state.gate;
    if (state.hangMdb && !href.includes('municipaldata'))
      await new Promise(() => {});
    const kind = href.includes('municipaldata')
      ? 'audits'
      : href.includes('District_Municipalities')
        ? 'districts'
        : 'members';
    if (state.down.has(kind) || (kind !== 'audits' && state.down.has('mdb')))
      return new Response('secret upstream body', { status: 503 });
    if (kind === 'audits')
      return json(href.includes('/aggregate') ? AUDIT_AGGREGATE : AUDIT_FACTS);
    return json(kind === 'districts' ? MDB_DISTRICTS : MDB_MEMBERS);
  };
  state.count = (needle) =>
    state.calls.filter((call) => call.includes(needle)).length;
  return state;
}

function memoryFs() {
  const files = new Map();
  const fsImpl = {
    files,
    async mkdir() {},
    async writeFile(file, text) {
      files.set(file, text);
    },
    async rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    },
    async readFile(file) {
      if (!files.has(file))
        throw Object.assign(new Error('x'), { code: 'ENOENT' });
      return files.get(file);
    },
    async readdir() {
      return [...files.keys()].map((file) => file.split('/').pop());
    },
    async rm(file) {
      files.delete(file);
    },
  };
  return fsImpl;
}

function harness({ up = upstream(), fsImpl = memoryFs(), clock } = {}) {
  const time = clock ?? { at: T0 };
  const logs = [];
  const plugin = saGovernanceProxy({
    fetchImpl: up.fetchImpl,
    now: () => time.at,
    cacheDir: DIR,
    fsImpl,
    log: { warn: (...args) => logs.push(args) },
  });
  assert.equal(plugin.name, 'sa-governance');
  const handlers = {};
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(mount, handler) {
          assert.equal(mount, '/api/sa-governance');
          handlers[hook] = handler;
        },
      },
    });
  }
  let peers = 0;
  const request = async (
    url = '/',
    { method = 'GET', peer, headers = {}, hook = 'configureServer' } = {},
  ) => {
    peers += 1;
    const res = {
      headers: {},
      writeHead(status, h) {
        this.status = status;
        this.headers = h;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(body) {
        this.status ??= this.statusCode;
        this.body = JSON.parse(body);
      },
    };
    const remoteAddress = peer ?? `10.9.${(peers >> 8) & 255}.${peers & 255}`;
    await handlers[hook](
      { url, method, headers, socket: { remoteAddress } },
      res,
    );
    return res;
  };
  return { request, up, fsImpl, time, logs };
}

test('the main route serves audits, the tables and the district lookup', async () => {
  const { request, time } = harness();
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.auditsStatus, 'ok');
  assert.equal(res.body.audits.year, 2024);
  assert.equal(res.body.audits.fetchedAt, time.at);
  assert.equal(res.body.audits.byCode.JHB.opinion, 'qualified');
  assert.deepEqual(res.body.interventions, INTERVENTIONS);
  assert.deepEqual(res.body.metros, METROS);
  assert.deepEqual(res.body.districtOf.GP001, {
    code: 'DC1',
    name: 'Alpha District',
  });
  assert.equal(res.headers['X-Data-Stale'], undefined);
  // Both mounts answer.
  assert.equal(
    (await request('/', { hook: 'configurePreviewServer' })).status,
    200,
  );
});

test('an audits failure with nothing held still serves the tables', async () => {
  const up = upstream();
  up.down.add('audits');
  const { request, logs } = harness({ up });
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.equal(res.body.auditsStatus, 'failed');
  assert.equal(res.body.audits, null);
  assert.deepEqual(res.body.interventions, INTERVENTIONS);
  assert.deepEqual(res.body.metros, METROS);
  assert.ok(res.body.districtOf);
  assert.ok(logs.length > 0);
  for (const args of logs) {
    assert.match(args[0], /^\[sa-governance\] .* failed$/);
    assert.equal(typeof args[1], 'string');
    assert.ok(!JSON.stringify(args).includes('secret'));
  }
});

test('a failure after success serves the old audits as stale, then failed past 30 days', async () => {
  const up = upstream();
  const { request, time } = harness({ up });
  await request('/');
  up.down.add('audits');
  time.at = T0 + 25 * HOUR;
  const stale = await request('/');
  assert.equal(stale.body.auditsStatus, 'stale');
  assert.equal(stale.body.audits.year, 2024);
  assert.equal(stale.body.audits.fetchedAt, T0);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  time.at = T0 + 31 * DAY;
  const failed = await request('/');
  assert.equal(failed.body.auditsStatus, 'failed');
  assert.equal(failed.body.audits, null);
});

test('after a failure a refetch waits a minute', async () => {
  const up = upstream();
  const { request, time } = harness({ up });
  await request('/');
  up.down.add('audits');
  time.at = T0 + 25 * HOUR;
  await request('/');
  const before = up.count('municipaldata');
  time.at += 30_000;
  await request('/');
  assert.equal(up.count('municipaldata'), before, 'no retry within a minute');
  time.at += 31_000;
  await request('/');
  assert.ok(up.count('municipaldata') > before, 'retried after a minute');
});

test('a fresh process reads the disk cache without fetching', async () => {
  const fsImpl = memoryFs();
  const first = harness({ fsImpl });
  await first.request('/');
  assert.ok(fsImpl.files.has(`${DIR}/audits.json`));
  assert.ok(fsImpl.files.has(`${DIR}/districts.json`));
  const saved = JSON.parse(fsImpl.files.get(`${DIR}/audits.json`));
  assert.equal(saved.version, 1);
  const up = upstream();
  const second = harness({ up, fsImpl, clock: { at: T0 + HOUR } });
  const res = await second.request('/');
  assert.equal(res.body.auditsStatus, 'ok');
  assert.equal(res.body.audits.year, 2024);
  assert.equal((await second.request('/districts')).status, 200);
  assert.equal(up.calls.length, 0);
});

test('a disk cache of another version is ignored', async () => {
  const fsImpl = memoryFs();
  fsImpl.files.set(
    `${DIR}/audits.json`,
    JSON.stringify({ version: 2, fetchedAt: T0, year: 1999, byCode: {} }),
  );
  const up = upstream();
  const { request } = harness({ up, fsImpl });
  const res = await request('/');
  assert.equal(res.body.audits.year, 2024);
  assert.ok(up.count('municipaldata') > 0);
});

test('districts carry their member councils, sorted by name', async () => {
  const { request, time } = harness();
  const res = await request('/districts');
  assert.equal(res.status, 200);
  assert.equal(res.body.fetchedAt, time.at);
  assert.equal(res.body.stale, undefined);
  const dc1 = res.body.areas.find((a) => a.code === 'DC1');
  assert.equal(dc1.name, 'Alpha District');
  assert.ok(Array.isArray(dc1.polygons));
  assert.deepEqual(dc1.members, [
    { code: 'GP002', name: 'Bravo Local' },
    { code: 'GP001', name: 'Zulu Local' },
  ]);
  const jhb = res.body.areas.find((a) => a.code === 'JHB');
  assert.deepEqual(jhb.members, [
    { code: 'JHB', name: 'City of Johannesburg' },
  ]);
});

test('districts give 502 when nothing is held and the load fails', async () => {
  const up = upstream();
  up.down.add('mdb');
  const { request } = harness({ up });
  const res = await request('/districts');
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'sa_districts_unavailable' });
  const main = await request('/');
  assert.equal(main.status, 200);
  assert.equal(main.body.districtOf, null);
});

test('districts go stale after a failed refresh, and 502 past 90 days', async () => {
  const up = upstream();
  const { request, time } = harness({ up });
  await request('/districts');
  up.down.add('mdb');
  time.at = T0 + 8 * DAY;
  const stale = await request('/districts');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  time.at = T0 + 91 * DAY;
  assert.equal((await request('/districts')).status, 502);
});

test('unknown paths are 404, other methods 405, cross-site 403, floods 429', async () => {
  const { request, up, fsImpl } = harness();
  for (const url of ['/nope', '/districts/extra', '/districts/unknown'])
    assert.equal((await request(url)).status, 404, url);
  const post = await request('/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  const cross = await request('/', {
    headers: {
      host: 'localhost:5173',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
  });
  assert.equal(cross.status, 403);
  assert.equal(up.calls.length, 0, 'refusals reach no upstream');
  assert.equal(fsImpl.files.size, 0, 'refusals touch no file');
  let last;
  for (let i = 0; i < 61; i++) last = await request('/', { peer: '10.0.0.9' });
  assert.equal(last.status, 429);
  assert.equal(last.headers['Retry-After'], '60');
});

test('concurrent requests share one refresh', async () => {
  const up = upstream();
  let release;
  up.gate = new Promise((resolve) => {
    release = resolve;
  });
  const { request } = harness({ up });
  const pending = [request('/'), request('/'), request('/districts')];
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const results = await Promise.all(pending);
  for (const res of results) assert.equal(res.status, 200);
  assert.equal(up.count('aggregate'), 1);
  assert.equal(up.count('District_Municipalities'), 1);
  assert.equal(up.count('MDB_L_ocal'), 1);
});

const goodAudits = (over = {}) => ({
  version: 1,
  fetchedAt: T0,
  year: 2023,
  byCode: { JHB: { opinion: 'qualified', label: 'Q' } },
  ...over,
});
const goodDistricts = (over = {}) => ({
  version: 1,
  fetchedAt: T0,
  areas: [
    {
      id: 'DC1',
      name: 'D',
      code: 'DC1',
      province: null,
      category: 'C',
      polygons: [[ring]],
    },
  ],
  members: [{ code: 'GP001', name: 'A', district: 'DC1', districtName: 'D' }],
  ...over,
});
const seed = (name, value) => {
  const fsImpl = memoryFs();
  fsImpl.files.set(`${DIR}/${name}`, JSON.stringify(value));
  return fsImpl;
};

test('a malformed v1 audits cache is ignored and refetched', async () => {
  for (const bad of [
    goodAudits({ year: 2024.5 }),
    goodAudits({ byCode: { JHB: 'garbage', CPT: null } }),
    goodAudits({ fetchedAt: T0 + DAY }),
  ]) {
    const up = upstream();
    const { request } = harness({ up, fsImpl: seed('audits.json', bad) });
    const res = await request('/');
    assert.equal(res.body.audits.year, 2024);
    assert.ok(up.count('municipaldata') > 0);
    const down = upstream();
    down.down.add('audits');
    const h = harness({ up: down, fsImpl: seed('audits.json', bad) });
    const failed = await h.request('/');
    assert.equal(failed.body.auditsStatus, 'failed');
    assert.equal(failed.body.audits, null);
  }
});

test('a malformed v1 districts cache is ignored and refetched', async () => {
  const bads = [
    goodDistricts({
      members: [{ code: 'GP001', name: 7, district: 'DC1', districtName: 'D' }],
    }),
    goodDistricts({ areas: [{ id: 'DC1', code: 'DC1', name: 'D' }] }),
    goodDistricts({
      members: [{ code: 'A', district: 'DC1', districtName: 'D' }],
    }),
    goodDistricts({ fetchedAt: T0 + DAY }),
  ];
  for (const bad of bads) {
    const up = upstream();
    const { request } = harness({ up, fsImpl: seed('districts.json', bad) });
    const res = await request('/districts');
    assert.equal(res.status, 200);
    assert.equal(res.body.areas.length, 2);
    assert.ok(up.count('District_Municipalities') > 0);
    const down = upstream();
    down.down.add('mdb');
    const h = harness({ up: down, fsImpl: seed('districts.json', bad) });
    const failed = await h.request('/districts');
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.body, { error: 'sa_districts_unavailable' });
  }
});

test('a failing cache write logs under its own name and not on the console', async () => {
  const spy = mock.method(console, 'warn', () => {});
  try {
    const fsImpl = memoryFs();
    fsImpl.writeFile = async () => {
      throw new Error('EACCES /secret/path');
    };
    const { request, logs } = harness({ fsImpl });
    assert.equal((await request('/')).status, 200);
    const mine = logs.filter(
      (l) => l[0] === '[sa-governance] audits cache write failed',
    );
    assert.equal(mine.length, 1);
    assert.equal(mine[0][1], 'cache_write_failed');
    assert.equal(spy.mock.callCount(), 0);
    assert.ok(!JSON.stringify(logs).includes('secret'));
  } finally {
    spy.mock.restore();
  }
});

test('a thrown error is logged by its name, never its message', async () => {
  const fetchImpl = async () => {
    throw new TypeError('secret socket detail');
  };
  const { request, logs } = harness({ up: { fetchImpl, calls: [] } });
  const res = await request('/');
  assert.equal(res.body.auditsStatus, 'failed');
  assert.ok(logs.some((l) => l[1] === 'TypeError'));
  assert.ok(!JSON.stringify(logs).includes('secret'));
});

test('the main route does not wait on a districts refresh once districts are held', async () => {
  const up = upstream();
  const { request, time } = harness({ up });
  await request('/');
  time.at = T0 + 8 * DAY;
  up.hangMdb = true;
  const res = await Promise.race([
    request('/'),
    new Promise((resolve) => setTimeout(() => resolve('slow'), 500)),
  ]);
  assert.notEqual(res, 'slow');
  assert.equal(res.status, 200);
  assert.ok(res.body.districtOf.GP001);
});
