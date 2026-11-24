import test from 'node:test';
import assert from 'node:assert/strict';
import { saQuakesProxy } from './saQuakes.js';
import { SA_QUAKE_WINDOW_MS } from '../../src/layers/saQuakes/records.js';

// Everything below is synthetic JSON written inline.
const T0 = Date.parse('2026-11-24T09:30:00Z');
const TTL = 600_000;
const DAY = 86_400_000;
const UA = 'GodsEyeView (sa-quakes)';

const feature = (unid, time, mag = 2.2) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [27.4, -26.4, -10] },
  id: unid,
  properties: {
    unid,
    lastupdate: '2026-11-21T15:21:17Z',
    time,
    flynn_region: 'SOUTH AFRICA',
    lat: -26.4,
    lon: 27.4,
    depth: 10,
    auth: 'SASN',
    mag,
    magtype: 'm',
  },
});
const collection = (...f) =>
  JSON.stringify({ type: 'FeatureCollection', features: f });

function setup({ respond, clock = { t: T0 } }) {
  const calls = [];
  const logs = [];
  const plugin = saQuakesProxy({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return respond();
    },
    now: () => clock.t,
    log: { warn: (...a) => logs.push(a) },
  });
  let peers = 0;
  const handlers = {};
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(mount, handler) {
          assert.equal(mount, '/api/sa-earthquakes');
          handlers[hook] = handler;
        },
      },
    });
  }
  const get = async (url = '/', { method = 'GET', headers = {} } = {}) => {
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
    await handlers.configureServer(
      {
        url,
        method,
        headers,
        socket: { remoteAddress: `10.8.${(peers >> 8) & 255}.${peers & 255}` },
      },
      res,
    );
    return res;
  };
  return { plugin, calls, logs, get, clock };
}

test('asks EMSC for the SA box over the last 30 days', async () => {
  const { plugin, calls, get } = setup({
    respond: () =>
      new Response(collection(feature('a', '2026-11-23T10:00:00.0Z'))),
  });
  assert.equal(plugin.name, 'sa-earthquakes');
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.fetchedAt, T0);
  assert.equal(res.body.stale, undefined);
  assert.equal(res.body.rows.length, 1);
  assert.equal(res.body.rows[0].region, 'South Africa');
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(
    `${url.origin}${url.pathname}`,
    'https://www.seismicportal.eu/fdsnws/event/1/query',
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    format: 'json',
    minlat: '-35',
    maxlat: '-22',
    minlon: '16',
    maxlon: '33',
    orderby: 'time',
    limit: '500',
    starttime: new Date(T0 - SA_QUAKE_WINDOW_MS).toISOString().slice(0, 19),
  });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['User-Agent'], UA);
  assert.ok(calls[0].options.signal);
});

test('a 204 is an empty list, not an error', async () => {
  const { get, logs } = setup({
    respond: () => new Response(null, { status: 204 }),
  });
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows, []);
  assert.equal(logs.length, 0);
});

test('serves stale rows on failure and drops those past 30 days', async () => {
  let ok = true;
  const { get, clock } = setup({
    respond: () =>
      ok
        ? new Response(
            collection(
              feature('recent', new Date(T0 - 1 * DAY).toISOString()),
              feature('aging', new Date(T0 - 29.8 * DAY).toISOString()),
            ),
          )
        : new Response('x', { status: 500 }),
  });
  const first = await get();
  assert.equal(first.body.rows.length, 2);
  ok = false;
  clock.t += TTL + 1 + 0.5 * DAY;
  const stale = await get();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.deepEqual(stale.body.rows.map((r) => r.stableId), ['recent']);
});

test('502 without a snapshot', async () => {
  const { get, logs } = setup({
    respond: () => new Response('x', { status: 500 }),
  });
  const res = await get();
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'sa_earthquakes_unavailable' });
  assert.equal(logs.length, 1);
});

test('a malformed body answers 502', async () => {
  const { get } = setup({ respond: () => new Response('{"a":1}') });
  assert.equal((await get()).status, 502);
});

test('404 and 405', async () => {
  const { calls, get } = setup({ respond: () => new Response('') });
  const unknown = await get('/nope');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'unknown_route' });
  const post = await get('/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  assert.equal(calls.length, 0);
});

test('cross-site 403', async () => {
  const { calls, get } = setup({ respond: () => new Response('') });
  const res = await get('/', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('concurrent requests share one refresh', async () => {
  const { calls, get } = setup({
    respond: () => new Response(collection(feature('a', '2026-11-23T10:00:00Z'))),
  });
  await Promise.all([get(), get()]);
  assert.equal(calls.length, 1);
});
