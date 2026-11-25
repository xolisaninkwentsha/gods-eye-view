import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saFacilitiesProxy } from './index.js';

// Everything below is synthetic: a stubbed HDX with made-up facilities.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 25, 6, 0, 0);

const IDS = {
  'south-africa-healthsites': [
    '11111111-aaaa-bbbb-cccc-000000000001',
    'south-africa-healthsites-geojson',
    'health',
  ],
  'south-africa-school-geolocation-and-connectivity-status': [
    '22222222-aaaa-bbbb-cccc-000000000002',
    'south-africa-school-geolocation-connectivity-data.csv',
    'schools',
  ],
};
const geo = (n) =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => ({
      type: 'Feature',
      properties: {
        osm_id: i + 1,
        osm_type: 'node',
        amenity: 'clinic',
        name: `Clinic ${i}`,
      },
      geometry: { type: 'Point', coordinates: [28 + i / 100, -26] },
    })),
  });
const csv = (n) =>
  [
    'school_name,longitude,latitude,education_level,connectivity',
    ...Array.from(
      { length: n },
      (_, i) => `School ${i},${28 + i / 100},-26,Primary,Yes`,
    ),
  ].join('\n');

function upstream({ health = geo(10), schools = csv(10) } = {}) {
  const state = {
    clock: { now: T0 },
    bodies: { health, schools },
    calls: [],
    fetched: { health: 0, schools: 0 },
    fail: null, // a status to answer the package step with
    gate: null, // a promise the data step waits for
    signals: [],
  };
  state.fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    state.calls.push(String(url));
    state.signals.push(init.signal);
    if (u.pathname === '/api/3/action/package_show') {
      if (state.fail)
        return new Response('upstream text', { status: state.fail });
      const [id, name] = IDS[u.searchParams.get('id')];
      return new Response(
        JSON.stringify({
          result: {
            resources: [
              {
                id,
                name,
                last_modified: '2026-09-29T00:00:00',
                url: `https://data.humdata.org/dataset/d/resource/${id}/download/f`,
              },
            ],
          },
        }),
      );
    }
    if (u.hostname === 'data.humdata.org') {
      const id = u.pathname.split('/')[4];
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/${id}/f?X-Amz-Signature=secret`,
        },
      });
    }
    const set = Object.values(IDS).find(([id]) => u.pathname.includes(id))[2];
    state.fetched[set] += 1;
    if (state.gate)
      await Promise.race([
        state.gate,
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
      ]);
    if (state.s3Status) return new Response('x', { status: state.s3Status });
    return new Response(state.bodies[set]);
  };
  return state;
}

async function harness({
  up = upstream(),
  cacheDir,
  httpServer,
  firstWaitMs,
} = {}) {
  const dir = cacheDir ?? (await mkdtemp(path.join(tmpdir(), 'gev-sa-fac-')));
  const logs = [];
  const plugin = saFacilitiesProxy({
    fetchImpl: up.fetchImpl,
    cacheDir: dir,
    now: () => up.clock.now,
    log: { warn: (...args) => logs.push(args) },
    ...(firstWaitMs ? { firstWaitMs } : {}),
  });
  assert.equal(plugin.name, 'sa-facilities');
  const handlers = {};
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(mount, handler) {
          assert.equal(mount, '/api/sa-facilities');
          handlers[hook] = handler;
        },
      },
      ...(httpServer ? { httpServer } : {}),
    });
  }
  let peers = 0;
  const request = async (
    url = '/?set=health',
    { method = 'GET', peer, headers = {} } = {},
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
    await handlers.configureServer(
      { url, method, headers, socket: { remoteAddress } },
      res,
    );
    return res;
  };
  return { request, up, logs, plugin, dir, close: () => plugin.closeBundle() };
}

const settle = async (until) => {
  const end = Date.now() + 5000;
  while (Date.now() < end && !until())
    await new Promise((r) => setImmediate(r));
  assert.ok(until(), 'settled');
};
const cleanup = (t, h) =>
  t.after(async () => {
    h.close();
    await rm(h.dir, { recursive: true, force: true });
  });

test('the first request fetches; a second within the ttl does not', async (t) => {
  const h = await harness();
  cleanup(t, h);
  const first = await h.request();
  assert.equal(first.status, 200);
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.equal(first.body.set, 'health');
  assert.equal(first.body.stale, false);
  assert.equal(first.body.updated, '2026-09-29');
  assert.equal(first.body.fetchedAt, new Date(T0).toISOString());
  assert.equal(first.body.records.length, 10);
  assert.deepEqual(first.body.records[0], {
    id: 'node/1',
    name: 'Clinic 0',
    kind: 'clinic',
    lat: -26,
    lon: 28,
  });
  h.up.clock.now += 23 * HOUR;
  const second = await h.request();
  assert.equal(second.body.records.length, 10);
  assert.equal(second.body.stale, false);
  assert.equal(h.up.fetched.health, 1);
  // Each set has its own cache.
  const schools = await h.request('/?set=schools');
  assert.equal(schools.body.set, 'schools');
  assert.equal(schools.body.records[0].level, 'Primary');
  assert.equal(h.up.fetched.schools, 1);
  assert.deepEqual((await readdir(h.dir)).sort(), [
    'health.json',
    'schools.json',
  ]);
  assert.deepEqual(h.logs, []);
});

test('concurrent first requests share one fetch', async (t) => {
  const up = upstream();
  let open;
  up.gate = new Promise((resolve) => (open = resolve));
  const h = await harness({ up });
  cleanup(t, h);
  const runs = [h.request(), h.request(), h.request()];
  await settle(() => up.fetched.health === 1);
  open();
  const done = await Promise.all(runs);
  assert.deepEqual(
    done.map((r) => r.status),
    [200, 200, 200],
  );
  assert.equal(up.fetched.health, 1);
});

test('after a restart the cache serves without fetching', async (t) => {
  const up = upstream();
  const a = await harness({ up });
  cleanup(t, a);
  await a.request();
  a.close();
  const b = await harness({ up, cacheDir: a.dir });
  cleanup(t, b);
  const res = await b.request();
  assert.equal(res.status, 200);
  assert.equal(res.body.records.length, 10);
  assert.equal(res.body.stale, false);
  assert.equal(up.fetched.health, 1);
  assert.equal(up.calls.length, 3);
});

test('a corrupt or malformed cache file is ignored, never fatal', async (t) => {
  for (const content of [
    '{not json',
    '',
    '[]',
    JSON.stringify({
      version: 1,
      set: 'health',
      fetchedAt: T0,
      updated: null,
      records: [{ id: 1 }],
    }),
    JSON.stringify({
      version: 1,
      set: 'schools',
      fetchedAt: T0,
      updated: null,
      records: [{ id: 'a', lat: 1, lon: 1 }],
    }),
    JSON.stringify({
      version: 1,
      set: 'health',
      fetchedAt: T0 + DAY,
      updated: null,
      records: [{ id: 'a', lat: 1, lon: 1 }],
    }),
  ]) {
    const h = await harness();
    cleanup(t, h);
    await writeFile(path.join(h.dir, 'health.json'), content);
    const res = await h.request();
    assert.equal(res.status, 200, content.slice(0, 30));
    assert.equal(res.body.records.length, 10);
    assert.equal(h.up.fetched.health, 1);
    // The bad file is replaced by a whole one.
    const saved = JSON.parse(
      await readFile(path.join(h.dir, 'health.json'), 'utf8'),
    );
    assert.equal(saved.records.length, 10);
  }
});

test('orphan temp files are removed on the first read', async (t) => {
  const h = await harness();
  cleanup(t, h);
  const orphan = '.health.json.123.0123456789ab.tmp';
  await writeFile(path.join(h.dir, orphan), 'x');
  await h.request();
  assert.ok(!(await readdir(h.dir)).includes(orphan));
});

test('stale data is served at once and refreshed in the background', async (t) => {
  const h = await harness();
  cleanup(t, h);
  await h.request();
  h.up.bodies.health = geo(12);
  h.up.clock.now += 25 * HOUR;
  const stale = await h.request();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.equal(stale.body.records.length, 10);
  await settle(() => h.up.fetched.health === 2);
  let fresh;
  for (let i = 0; i < 100 && !fresh; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    const res = await h.request();
    if (!res.body.stale) fresh = res;
  }
  assert.equal(fresh.body.records.length, 12);
  assert.equal(fresh.body.fetchedAt, new Date(h.up.clock.now).toISOString());
});

test('a refresh that shrinks is refused and the old records are kept', async (t) => {
  const h = await harness();
  cleanup(t, h);
  await h.request();
  h.up.bodies.health = geo(4); // 40 percent of 10
  h.up.clock.now += 25 * HOUR;
  const stale = await h.request();
  assert.equal(stale.body.stale, true);
  await settle(() => h.logs.length > 0);
  assert.deepEqual(h.logs, [['[sa-facilities] health shrunk']]);
  const after = await h.request();
  assert.equal(after.status, 200);
  assert.equal(after.body.records.length, 10);
  assert.equal(after.body.stale, true);
  assert.equal(after.body.fetchedAt, new Date(T0).toISOString());
  const saved = JSON.parse(
    await readFile(path.join(h.dir, 'health.json'), 'utf8'),
  );
  assert.equal(saved.records.length, 10);
  // Exactly half is accepted.
  h.up.clock.now += 2 * MINUTE;
  h.up.bodies.health = geo(5);
  await h.request();
  await settle(() => h.up.fetched.health === 3);
  let res;
  for (let i = 0; i < 100 && res?.body.records.length !== 5; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    res = await h.request();
  }
  assert.equal(res.body.records.length, 5);
});

test('a refresh that fails keeps serving the held set, retrying no sooner than a minute', async (t) => {
  const h = await harness();
  cleanup(t, h);
  await h.request();
  h.up.fail = 500;
  h.up.clock.now += 25 * HOUR;
  await h.request();
  await settle(() => h.logs.length === 1);
  assert.deepEqual(h.logs, [['[sa-facilities] health HDX_PACKAGE_HTTP_500']]);
  const calls = h.up.calls.length;
  const res = await h.request();
  assert.equal(res.body.stale, true);
  assert.equal(h.up.calls.length, calls, 'backed off');
});

test('data older than 30 days is not served', async (t) => {
  const h = await harness();
  cleanup(t, h);
  await h.request();
  h.up.fail = 500;
  h.up.clock.now += 31 * DAY;
  const res = await h.request();
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'HDX_PACKAGE_HTTP_500' });
});

test('an unknown or missing set answers 400 and fetches nothing', async (t) => {
  const h = await harness();
  cleanup(t, h);
  for (const url of [
    '/?set=bogus',
    '/',
    '/?set=',
    '/?set=__proto__',
    '/?set=toString',
    '/?other=health',
  ]) {
    const res = await h.request(url);
    assert.equal(res.status, 400, url);
    assert.deepEqual(res.body, { error: 'unknown-set' });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(h.up.calls.length, 0);
});

test('other routes and methods are refused before any fetch', async (t) => {
  const h = await harness();
  cleanup(t, h);
  assert.equal((await h.request('/unknown?set=health')).status, 404);
  const post = await h.request('/?set=health', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  assert.equal(h.up.calls.length, 0);
});

test('cross-site requests are refused', async (t) => {
  const h = await harness();
  cleanup(t, h);
  const res = await h.request('/?set=health', {
    headers: { origin: 'https://evil.example', host: 'localhost:5173' },
  });
  assert.equal(res.status, 403);
  assert.equal(h.up.calls.length, 0);
});

test('60 requests a minute per client, then 429', async (t) => {
  const h = await harness();
  cleanup(t, h);
  const peer = '10.0.0.5';
  let last;
  for (let i = 0; i < 61; i += 1)
    last = await h.request('/?set=bogus', { peer });
  assert.equal(last.status, 429);
  assert.equal(last.headers['Retry-After'], '60');
});

test('an upstream failure with nothing held answers 503 by code; no log carries a URL', async (t) => {
  for (const setup of [
    (up) => (up.fail = 500),
    (up) => (up.s3Status = 403),
    (up) => (up.bodies.health = '<html>outage</html>'),
    (up) => (up.bodies.health = geo(0)),
  ]) {
    const up = upstream();
    setup(up);
    const h = await harness({ up });
    cleanup(t, h);
    const res = await h.request();
    assert.equal(res.status, 503);
    assert.match(res.body.error, /^[A-Z0-9_]+$/);
    assert.deepEqual(Object.keys(res.body), ['error']);
    const seen = JSON.stringify([h.logs, res.body]);
    assert.doesNotMatch(
      seen,
      /https?:|amazonaws|humdata|X-Amz|secret|upstream text|outage/i,
    );
    for (const line of h.logs)
      assert.match(line[0], /^\[sa-facilities\] health [A-Z0-9_]+$/);
    assert.equal(line0(h.logs), `[sa-facilities] health ${res.body.error}`);
  }
});
const line0 = (logs) => logs[0][0];

test('a thrown error with a message or odd code never reaches the answer or the log', async (t) => {
  const up = upstream();
  up.fetchImpl = async () => {
    throw Object.assign(
      new Error('https://s3.us-east-1.amazonaws.com/x?sig=secret'),
      {
        code: 'https://leak.example/?sig=secret',
      },
    );
  };
  const h = await harness({ up });
  cleanup(t, h);
  const res = await h.request();
  assert.deepEqual(res.body, { error: 'FETCH_FAILED' });
  assert.doesNotMatch(JSON.stringify(h.logs), /secret|leak|amazonaws/);
});

test('the first request waits no longer than firstWaitMs, and the fetch still lands', async (t) => {
  const up = upstream();
  let open;
  up.gate = new Promise((resolve) => (open = resolve));
  const h = await harness({ up, firstWaitMs: 30 });
  cleanup(t, h);
  const res = await h.request();
  assert.equal(res.status, 503);
  open();
  await settle(() => up.fetched.health === 1);
  let later;
  for (let i = 0; i < 100 && later?.status !== 200; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    later = await h.request();
  }
  assert.equal(later.body.records.length, 10);
  assert.equal(up.fetched.health, 1);
});

test('closing the server aborts what is in flight, once and quietly', async (t) => {
  const up = upstream();
  up.gate = new Promise(() => {});
  const httpServer = new EventEmitter();
  const h = await harness({ up, httpServer });
  cleanup(t, h);
  const run = h.request();
  await settle(() => up.fetched.health === 1);
  assert.equal(
    up.signals.some((s) => s.aborted),
    false,
  );
  httpServer.emit('close');
  h.close();
  await run;
  assert.ok(up.signals.at(-1).aborted);
  // The abort is not a fault worth a log line.
  assert.deepEqual(h.logs, []);
});
