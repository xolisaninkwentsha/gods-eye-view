import test from 'node:test';
import assert from 'node:assert/strict';
import { saWeatherWarningsProxy } from './index.js';

// Everything below is synthetic XML written inline.
const BASE = 'https://www.weathersa.co.za/Documents/Warnings/';
const RSS_URL = 'https://caps.weathersa.co.za/Home/RssFeed';
const UA = 'GodsEyeView (sa-weather)';
const RSS_TTL_MS = 600_000;
const T0 = Date.parse('2026-11-24T09:30:00+02:00');
const EXPIRES = Date.parse('2026-11-24T22:59:59+02:00');
const NAME_A = 'GP_CAP_DamagingWinds_20261124_085823.xml';
const NAME_B = 'WC_CAP_HeavyRain_20261124_090000.xml';

const rss = (...guids) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${guids
    .map((g) => `<item><guid>${g}</guid><link>${g}</link></item>`)
    .join('')}</channel></rss>`;

const POLY = (d) =>
  `-28.0${d},32.0 -28.1${d},32.1 -28.2${d},32.0 -28.0${d},32.0`;

const cap = (zone, level, sent = '2026-11-24T08:56:52+02:00') =>
  `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>i</identifier><sender>s</sender><sent>${sent}</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope><info><event>Damaging Winds</event><severity>Minor</severity><onset>2026-11-24T09:00:00+02:00</onset><expires>2026-11-24T22:59:59+02:00</expires><headline>h</headline><description>d</description><instruction>i</instruction><parameter><valueName>alertType</valueName><value>Warning Level ${level}</value></parameter><area><areaDesc>${zone}</areaDesc><polygon>${POLY(level)}</polygon></area></info></alert>`;

const reply =
  (body, status = 200) =>
  () =>
    new Response(body, { status });

function setup({ routes, clock = { t: T0 } } = {}) {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const route = routes[url];
    return route();
  };
  const plugin = saWeatherWarningsProxy({
    fetchImpl,
    now: () => clock.t,
    log: { warn: (...args) => logs.push(args) },
  });
  let peers = 0;
  const handlers = {};
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(mount, handler) {
          assert.equal(mount, '/api/sa-weather-warnings');
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
        socket: { remoteAddress: `10.9.${(peers >> 8) & 255}.${peers & 255}` },
      },
      res,
    );
    return res;
  };
  return { plugin, calls, logs, get, clock };
}

test('serves the warnings in force from the feed', async () => {
  const { plugin, calls, get } = setup({
    routes: {
      [RSS_URL]: reply(
        rss(
          `http://www.weathersa.co.za/Documents/Warnings/${NAME_A}`,
          BASE + NAME_B,
        ),
      ),
      [BASE + NAME_A]: reply(cap('Zone A', 4)),
      [BASE + NAME_B]: reply(cap('Zone B', 6)),
    },
  });
  assert.equal(plugin.name, 'sa-weather-warnings');
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['X-Data-Stale'], undefined);
  assert.equal(res.body.fetchedAt, T0);
  assert.equal(res.body.stale, undefined);
  const byName = Object.fromEntries(
    res.body.areas.map((a) => [a.name, a.band]),
  );
  assert.deepEqual(byName, { 'Zone A': 'yellow', 'Zone B': 'orange' });
  assert.deepEqual(
    calls.map((c) => c.url).sort(),
    [RSS_URL, BASE + NAME_A, BASE + NAME_B].sort(),
  );
  for (const { options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['User-Agent'], UA);
    assert.ok(options.signal);
  }
});

test('a CAP file that fails is skipped and fetched again next time', async () => {
  const { calls, logs, get, clock } = setup({
    routes: {
      [RSS_URL]: reply(rss(BASE + NAME_A, BASE + NAME_B)),
      [BASE + NAME_A]: reply('not found', 404),
      [BASE + NAME_B]: reply(cap('Zone B', 6)),
    },
  });
  const first = await get();
  assert.equal(first.status, 200);
  assert.deepEqual(
    first.body.areas.map((a) => a.name),
    ['Zone B'],
  );
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(NAME_A));
  clock.t += RSS_TTL_MS + 1;
  calls.length = 0;
  await get();
  const urls = calls.map((c) => c.url);
  assert.ok(urls.includes(RSS_URL));
  assert.ok(urls.includes(BASE + NAME_A));
  assert.ok(!urls.includes(BASE + NAME_B));
});

test('stale data is re-filtered for expiry', async () => {
  let feedOk = true;
  const { get, clock } = setup({
    routes: {
      [RSS_URL]: () => (feedOk ? reply(rss(BASE + NAME_A)) : reply('x', 500))(),
      [BASE + NAME_A]: reply(cap('Zone A', 4)),
    },
  });
  const first = await get();
  assert.equal(first.body.areas.length, 1);
  feedOk = false;
  clock.t += RSS_TTL_MS + 1;
  const stale = await get();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.deepEqual(stale.body.areas, first.body.areas);
  clock.t = EXPIRES + 1;
  const expired = await get();
  assert.equal(expired.body.stale, true);
  assert.deepEqual(expired.body.areas, []);
});

test('no snapshot and no feed answers 502', async () => {
  const { get, logs } = setup({ routes: { [RSS_URL]: reply('x', 500) } });
  const res = await get();
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'sa_weather_unavailable' });
  assert.equal(logs.length, 1);
});

test('a feed whose files all fail answers 502', async () => {
  const { get } = setup({
    routes: {
      [RSS_URL]: reply(rss(BASE + NAME_A)),
      [BASE + NAME_A]: reply('x', 500),
    },
  });
  assert.equal((await get()).status, 502);
});

test('a feed with only old files is a quiet layer, not an error', async () => {
  const old = 'GP_CAP_DamagingWinds_20260101_085823.xml';
  const { get } = setup({ routes: { [RSS_URL]: reply(rss(BASE + old)) } });
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.areas, []);
  assert.equal(res.body.stale, undefined);
});

const NO_POLYGON = `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>i</identifier><sent>2026-11-24T08:56:52+02:00</sent><status>Actual</status><msgType>Alert</msgType><info><event>Damaging Winds</event><expires>2026-11-24T22:59:59+02:00</expires><area><areaDesc>Zone A</areaDesc><geocode><valueName>x</valueName><value>1</value></geocode></area></info></alert>`;

// After a good snapshot, a feed that no longer reads must serve it as stale.
async function staleAfterBreak(breakRoutes) {
  const routes = {
    [RSS_URL]: reply(rss(BASE + NAME_A)),
    [BASE + NAME_A]: reply(cap('Zone A', 4)),
  };
  const ctx = setup({ routes });
  const first = await ctx.get();
  assert.equal(first.body.areas.length, 1);
  Object.assign(routes, breakRoutes);
  ctx.clock.t += RSS_TTL_MS + 1;
  const second = await ctx.get();
  assert.equal(second.status, 200);
  assert.equal(second.body.stale, true);
  assert.deepEqual(second.body.areas, first.body.areas);
  return ctx;
}

test('an RSS with no items serves the last snapshot as stale', async () => {
  await staleAfterBreak({ [RSS_URL]: reply(rss()) });
});

test('an RSS whose items no longer parse serves the last snapshot as stale', async () => {
  await staleAfterBreak({
    [RSS_URL]: reply(rss(BASE + 'renamed_format.xml')),
  });
});

test('CAP files with no usable polygon serve the last snapshot as stale', async () => {
  await staleAfterBreak({
    [RSS_URL]: reply(rss(BASE + NAME_B)),
    [BASE + NAME_B]: reply(NO_POLYGON),
  });
});

test('each feed failure has its own log code', async () => {
  const cases = [
    ['saws_feed_empty', { [RSS_URL]: reply(rss()) }],
    [
      'saws_feed_unrecognised',
      { [RSS_URL]: reply(rss(BASE + 'renamed_format.xml')) },
    ],
    [
      'saws_cap_unusable',
      {
        [RSS_URL]: reply(rss(BASE + NAME_B)),
        [BASE + NAME_B]: reply(NO_POLYGON),
      },
    ],
  ];
  for (const [code, routes] of cases) {
    const { get, logs } = setup({ routes });
    assert.equal((await get()).status, 502, code);
    assert.equal(logs.at(-1)[1], code);
  }
});

test('an unrecognised feed with no snapshot answers 502', async () => {
  const { get } = setup({
    routes: { [RSS_URL]: reply(rss(BASE + 'renamed_format.xml')) },
  });
  const res = await get();
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'sa_weather_unavailable' });
});

test('a Cancel file with no area is a usable file', async () => {
  const cancel = `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>i</identifier><sent>2026-11-24T08:56:52+02:00</sent><status>Actual</status><msgType>Cancel</msgType></alert>`;
  const { get } = setup({
    routes: {
      [RSS_URL]: reply(rss(BASE + NAME_A)),
      [BASE + NAME_A]: reply(cancel),
    },
  });
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.areas, []);
});

test('logs carry the code or name, never a message body', async () => {
  const { logs, get } = setup({
    routes: {
      [RSS_URL]: reply(rss(BASE + NAME_A)),
      [BASE + NAME_A]: () => {
        throw new SyntaxError('Unexpected token <secret body>');
      },
    },
  });
  await get();
  const text = JSON.stringify(logs);
  assert.ok(!text.includes('secret body'), text);
  assert.ok(logs[0].includes('SyntaxError'));
});

test('unknown routes answer 404 and other methods 405', async () => {
  const { calls, get } = setup({ routes: {} });
  const unknown = await get('/nope');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'unknown_route' });
  const post = await get('/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  assert.equal(calls.length, 0);
});

test('cross-site browsers are refused', async () => {
  const { calls, get } = setup({ routes: {} });
  const res = await get('/', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test('concurrent requests share one refresh', async () => {
  const { calls, get } = setup({
    routes: {
      [RSS_URL]: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return reply(rss(BASE + NAME_A))();
      },
      [BASE + NAME_A]: reply(cap('Zone A', 4)),
    },
  });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(calls.filter((c) => c.url === RSS_URL).length, 1);
});
