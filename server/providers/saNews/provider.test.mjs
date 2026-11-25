import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { mock } from 'node:test';

import { exportUrl } from '../news/gdeltEvents.js';
import { zipTable } from '../news/gdeltFixtures.mjs';
import {
  SA_COL,
  hash,
  normalizeUrl,
  parseSaEvents,
  saStories,
} from './gdelt.js';
import { saNewsProxy, mergeStories } from './index.js';
import { matchPlace } from './places.js';
import { SA_FEEDS } from './rss.js';

// Everything below is synthetic: made-up articles in a stubbed GDELT and
// stubbed feeds.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STEP = 15 * MINUTE;
// 12:07 UTC: the newest quarter hour is 12:00.
const T0 = Date.UTC(2026, 10, 24, 12, 7, 0);
const newestAt = (ms) => Math.floor(ms / STEP) * STEP;
const stamp = (ms) =>
  new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);

const SHARED = 'protest-blocks-road-in-johannesburg-cbd';
const GDELT_ONLY = 'police-clash-with-miners-near-rustenburg';

// `slug` is a path under example.co.za/news, or a whole address.
function row(addedMs, slug, place, lat, lon) {
  const f = new Array(61).fill('');
  const set = {
    id: String(addedMs % 1_000_000),
    rootCode: '14',
    quadClass: '3',
    mentions: '2',
    geoType: '4',
    place,
    country: 'SF',
    lat,
    lon,
    added: stamp(addedMs),
    url: /^https?:/.test(slug)
      ? slug
      : `https://www.example.co.za/news/${slug}`,
  };
  for (const [name, value] of Object.entries(set)) f[SA_COL[name]] = value;
  return f.join('\t');
}

const rssItem = (title, link, date) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${new Date(date).toUTCString()}</pubDate></item>`;
const rss = (...items) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;

const IOL = rss(
  // The same article as GDELT's, under another spelling of its address.
  rssItem(
    'Protesters block road in Johannesburg CBD',
    `http://example.co.za/news/${SHARED}/`,
    T0 - 3 * MINUTE,
  ),
  rssItem(
    'Taxi strike grips Durban',
    'https://iol.co.za/news/taxi-strike-durban',
    T0 - HOUR,
  ),
  rssItem(
    'Minister speaks on policy',
    'https://iol.co.za/news/minister-policy',
    T0 - HOUR,
  ),
);

// The rows of the newest export (at `at`, its time) unless a test gives its own.
const NEWEST_ROWS = (at) => [
  row(
    at + MINUTE,
    SHARED,
    'Johannesburg, Gauteng, South Africa',
    '-26.2',
    '28.0',
  ),
  row(
    at + 2 * MINUTE,
    GDELT_ONLY,
    'Rustenburg, North West, South Africa',
    '-25.67',
    '27.24',
  ),
];

/** A stub GDELT and stub feeds behind one fetch. */
function upstream({ feeds = {}, rows: newestRows = NEWEST_ROWS } = {}) {
  const clock = { now: T0 };
  const state = { calls: [], mode: 'normal', gdelt: 'rows' };
  state.clock = clock;
  state.fetchImpl = async (url, options = {}) => {
    const href = String(url);
    state.calls.push(href);
    if (state.mode === 'hang') {
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }
    if (href.endsWith('lastupdate.txt')) {
      const at = exportUrl(newestAt(clock.now));
      return new Response(`1 2 ${at.replace('https:', 'http:')}\n`);
    }
    const feed = SA_FEEDS.find((f) => f.url === href);
    if (feed) {
      const made = feeds[feed.id] ?? (feed.id === 'iol' ? IOL : rss());
      return made === 'fail'
        ? new Response('no', { status: 500 })
        : new Response(made);
    }
    if (state.gdelt === 'none') return new Response('', { status: 404 });
    const at = Date.parse(
      href.replace(
        /.*\/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\..*/,
        '$1-$2-$3T$4:$5:$6Z',
      ),
    );
    const rows = at === newestAt(T0) ? newestRows(at) : [];
    return new Response(zipTable(rows.join('\n')));
  };
  const count = (url) => state.calls.filter((c) => c === url).length;
  state.exportCalls = () => state.calls.filter((c) => /export\.CSV/.test(c));
  state.count = count;
  return state;
}

function harness({
  up = upstream(),
  firstWaitMs = 10_000,
  extra = {},
  httpServer,
} = {}) {
  const logs = [];
  const infos = [];
  const plugin = saNewsProxy({
    fetchImpl: up.fetchImpl,
    now: () => {
      if (extra.breakNow?.on)
        throw (
          extra.breakNow.make?.() ??
          Object.assign(new Error('secret'), { code: 'BOOM' })
        );
      return up.clock.now;
    },
    log: {
      warn: (...args) => logs.push(args),
      info: (...args) => infos.push(args),
    },
    firstWaitMs,
  });
  assert.equal(plugin.name, 'sa-news');
  const handlers = {};
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(mount, handler) {
          assert.equal(mount, '/api/sa-news');
          handlers[hook] = handler;
        },
      },
      ...(httpServer ? { httpServer } : {}),
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
  return {
    request,
    up,
    logs,
    infos,
    plugin,
    close: () => plugin.closeBundle(),
  };
}

// Waits in real time (setTimeout may be mocked) for `until`, up to 5 s.
// Lets in-flight work finish (real time) so the next timer is set before a tick.
const quiet = async (ms = 80) => {
  const end = Date.now() + ms;
  while (Date.now() < end)
    await new Promise((resolve) => setImmediate(resolve));
};
const settle = async (until) => {
  const end = Date.now() + 5000;
  while (Date.now() < end && !until())
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(until(), 'settled');
};

test('the payload joins both sources, merged by article address', async (t) => {
  const { request, close } = harness();
  t.after(close);
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.equal(res.body.fetchedAt, new Date(T0).toISOString());
  const byTitle = Object.fromEntries(res.body.stories.map((s) => [s.title, s]));
  // One story for the article both sources carry: the outlet's words, GDELT's
  // place, kind and id, the earlier time, the outlet's link.
  const both = byTitle['Protesters block road in Johannesburg CBD'];
  assert.deepEqual(both.via, ['gdelt', 'rss']);
  assert.equal(both.kind, 'protest');
  assert.match(both.id, /^gd:/);
  assert.equal(both.place, 'Johannesburg');
  assert.equal(both.source, 'IOL');
  assert.equal(both.url, `http://example.co.za/news/${SHARED}/`);
  assert.equal(both.publishedAt, newestAt(T0) + MINUTE);
  // GDELT's point, 4 km from the listed town, snaps to it.
  const joburg = matchPlace('Johannesburg');
  assert.deepEqual([both.lat, both.lon], [joburg.lat, joburg.lon]);
  const ids = res.body.stories.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(
    res.body.stories.filter(
      (s) => normalizeUrl(s.url) === normalizeUrl(both.url),
    ).length,
    1,
  );
  // A headline that names a town.
  const headline = byTitle['Taxi strike grips Durban'];
  assert.deepEqual(headline.via, ['rss']);
  assert.equal(headline.kind, 'headline');
  assert.equal(headline.place, 'Durban');
  assert.equal(
    headline.id,
    `rss:${hash(normalizeUrl('https://iol.co.za/news/taxi-strike-durban'))}`,
  );
  // GDELT alone.
  const gd = res.body.stories.find((s) => s.via.join() === 'gdelt');
  assert.equal(gd.place, 'Rustenburg');
  // The kinds of both sources are present; an unplaced headline is dropped.
  assert.ok(res.body.stories.some((s) => s.kind === 'headline'));
  assert.ok(res.body.stories.some((s) => s.kind === 'protest'));
  assert.ok(!('Minister speaks on policy' in byTitle));
  // Newest first.
  const times = res.body.stories.map((s) => s.publishedAt);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
});

test('the status shows partial GDELT coverage and a failed feed', async (t) => {
  const { request, close } = harness({
    up: upstream({ feeds: { mg: 'fail' } }),
  });
  t.after(close);
  const { status } = (await request('/')).body;
  assert.equal(status.gdelt.state, 'partial');
  assert.equal(status.gdelt.hoursCovered, 3);
  assert.equal(status.gdelt.complete, false);
  assert.ok(status.gdelt.missing > 0);
  assert.deepEqual(Object.keys(status.gdelt).sort(), [
    'complete',
    'hoursCovered',
    'missing',
    'state',
  ]);
  assert.equal(status.rss.mg, 'failed');
  assert.equal(status.rss.iol, 'ok');
  assert.deepEqual(
    Object.keys(status.rss).sort(),
    SA_FEEDS.map((f) => f.id).sort(),
  );
});

test('a slow upstream still gets a 200 within the cap, from what is held', async (t) => {
  const up = upstream();
  up.mode = 'hang';
  const { request, close } = harness({ up, firstWaitMs: 30 });
  t.after(close);
  const started = Date.now();
  const res = await request('/');
  assert.ok(Date.now() - started < 2000);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stories, []);
  assert.equal(res.body.status.gdelt.state, 'loading');
  assert.equal(res.body.status.rss.iol, 'loading');
});

test('both sources failing is still a 200 the legend can read', async (t) => {
  const up = upstream({
    feeds: Object.fromEntries(SA_FEEDS.map((f) => [f.id, 'fail'])),
  });
  up.gdelt = 'none';
  const { request, close } = harness({ up });
  t.after(close);
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stories, []);
  assert.equal(res.body.status.rss.iol, 'failed');
});

test('later requests never wait on a refresh', async (t) => {
  const up = upstream();
  const { request, close } = harness({ up });
  t.after(close);
  const first = await request('/');
  assert.ok(first.body.stories.length > 0);
  up.mode = 'hang';
  const again = await request('/');
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.stories, first.body.stories);
});

test('two simultaneous first requests share one fetch per URL', async (t) => {
  const up = upstream();
  const { request, close } = harness({ up });
  t.after(close);
  const [a, b] = await Promise.all([request('/'), request('/')]);
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.stories, b.body.stories);
  const exportsAsked = up.exportCalls();
  assert.equal(exportsAsked.length, 12);
  assert.equal(new Set(exportsAsked).size, 12);
  assert.equal(
    up.count('https://data.gdeltproject.org/gdeltv2/lastupdate.txt'),
    1,
  );
  for (const feed of SA_FEEDS) assert.equal(up.count(feed.url), 1, feed.id);
});

test('unknown paths are 404, other methods 405, cross-site 403, floods 429', async (t) => {
  const up = upstream();
  const { request, close } = harness({ up });
  t.after(close);
  for (const url of ['/nope', '/unknown', '/a/b'])
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
  assert.equal(up.calls.length, 0, 'refusals start no refresh');
  let last;
  for (let i = 0; i < 61; i++) last = await request('/', { peer: '10.0.0.9' });
  assert.equal(last.status, 429);
  assert.equal(last.headers['Retry-After'], '60');
});

test('the loop refreshes GDELT every 2 s while it reads and is incomplete, else every 5 minutes; feeds every 15', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const up = upstream();
  const { request, close } = harness({ up });
  t.after(close);
  await request('/');
  assert.equal(up.exportCalls().length, 12);
  mock.timers.tick(1999);
  await settle(() => true);
  assert.equal(up.exportCalls().length, 12, 'not yet');
  mock.timers.tick(1);
  await settle(() => up.exportCalls().length === 24);
  await quiet();
  // Nothing more to read: the next refresh is in 5 minutes.
  up.gdelt = 'none';
  mock.timers.tick(2000);
  await settle(() => up.exportCalls().length === 36);
  await quiet();
  const before = up.calls.length;
  mock.timers.tick(2000);
  await settle(() => true);
  assert.equal(up.calls.length, before, 'no 2 s refresh after a read of none');
  up.clock.now += 5 * MINUTE;
  mock.timers.tick(5 * MINUTE);
  await settle(() => up.calls.length > before);
  await quiet();
  // Feeds were read once so far; they come due after 15 minutes.
  assert.equal(up.count(SA_FEEDS[0].url), 1);
  up.clock.now += 15 * MINUTE;
  mock.timers.tick(15 * MINUTE);
  await settle(() => up.count(SA_FEEDS[0].url) === 2);
});

test('a rejected refresh is logged by code only and the loop keeps going', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const breakNow = { on: false };
  const up = upstream();
  const { request, logs, close } = harness({ up, extra: { breakNow } });
  t.after(close);
  await request('/');
  await quiet();
  breakNow.on = true;
  mock.timers.tick(2000);
  await settle(() => logs.length >= 1);
  await quiet();
  assert.ok(logs.every((l) => l.at(-1) === 'BOOM'));
  assert.ok(!JSON.stringify(logs).includes('secret'));
  breakNow.on = false;
  const before = up.calls.length;
  mock.timers.tick(5 * MINUTE);
  await settle(() => up.calls.length > before);
});

test('a refresh error with only a cause code is logged by that code', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const breakNow = {
    on: false,
    make: () => new TypeError('secret', { cause: { code: 'ECAUSE' } }),
  };
  const up = upstream();
  const { request, logs, close } = harness({ up, extra: { breakNow } });
  t.after(close);
  await request('/');
  await quiet();
  breakNow.on = true;
  mock.timers.tick(2000);
  await settle(() => logs.length >= 1);
  await quiet();
  assert.deepEqual(logs, [['[sa-news] gdelt refresh failed', 'ECAUSE']]);
});

test('closeBundle stops the loop, leaves no timers and logs one stop line', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const up = upstream();
    const { request, plugin, infos } = harness({ up });
    await request('/');
    plugin.closeBundle();
    plugin.closeBundle();
    const before = up.calls.length;
    up.clock.now += 30 * MINUTE;
    mock.timers.tick(30 * MINUTE);
    await quiet();
    assert.equal(up.calls.length, before);
    assert.deepEqual(infos, [['[sa-news] stopped']]);
  } finally {
    mock.timers.reset();
  }
});

test("the dev server's 'close' stops the loop, once with closeBundle", async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const httpServer = new EventEmitter();
  const up = upstream();
  const { request, plugin, infos } = harness({ up, httpServer });
  try {
    await request('/');
    httpServer.emit('close');
    const before = up.calls.length;
    up.clock.now += 30 * MINUTE;
    mock.timers.tick(30 * MINUTE);
    await quiet();
    assert.equal(up.calls.length, before);
    // Vite also calls closeBundle on the way down: still one line.
    plugin.closeBundle();
    assert.deepEqual(infos, [['[sa-news] stopped']]);
  } finally {
    plugin.closeBundle();
    mock.timers.reset();
  }
});

test('a provider that never ran stops without a log line', () => {
  const { plugin, infos } = harness();
  plugin.closeBundle();
  assert.deepEqual(infos, []);
});

test('a request after the first wait answers at once while upstream hangs', async (t) => {
  const up = upstream();
  up.mode = 'hang';
  const { request, close } = harness({ up, firstWaitMs: 200 });
  t.after(close);
  await request('/');
  const started = performance.now();
  const res = await request('/');
  const took = performance.now() - started;
  assert.equal(res.status, 200);
  assert.ok(took < 100, `${took} ms`);
});

test('two requests start one loop: one more lastupdate read per tick', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const LAST = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
  const up = upstream();
  const { request, close } = harness({ up });
  t.after(close);
  await request('/');
  await quiet();
  await request('/');
  await quiet();
  assert.equal(up.count(LAST), 1, 'the second request starts no refresh');
  up.clock.now += 5 * MINUTE;
  mock.timers.tick(5 * MINUTE);
  await settle(() => up.count(LAST) >= 2);
  await quiet();
  assert.equal(up.count(LAST), 2, 'one loop, not two');
});

test('mergeStories drops anything past 24 hours at response time', () => {
  const now = T0;
  const old = {
    id: 'gd:1',
    kind: 'event',
    title: 't',
    source: 's',
    url: 'https://a.co.za/x',
    place: 'p',
    lat: 1,
    lon: 2,
    publishedAt: now - 25 * HOUR,
  };
  const fresh = {
    ...old,
    id: 'gd:2',
    url: 'https://a.co.za/y',
    publishedAt: now - HOUR,
  };
  const out = mergeStories([old, fresh], [], now);
  assert.deepEqual(
    out.map((s) => s.id),
    ['gd:2'],
  );
});

test('a GDELT story snaps to its listed town within 25 km, else keeps its point', () => {
  const base = { kind: 'event', title: 't', source: 's' };
  const story = (id, place, lat, lon) => ({
    ...base,
    id,
    url: `https://a.co.za/${id}`,
    place,
    lat,
    lon,
    publishedAt: T0 - HOUR,
  });
  const out = mergeStories(
    [
      // GDELT's Johannesburg point, as seen live: 4 km from the town.
      story('near', 'Johannesburg', -26.2, 28.0833),
      // The listed Richmond is the KwaZulu-Natal one; this is the Northern Cape's.
      story('far', 'Richmond', -31.4167, 23.9333),
      // Not a listed town.
      story('none', 'Mamelodi', -25.72, 28.39),
    ],
    [],
    T0,
  );
  const at = Object.fromEntries(out.map((s) => [s.id, [s.lat, s.lon]]));
  const joburg = matchPlace('Johannesburg');
  assert.deepEqual(at.near, [joburg.lat, joburg.lon]);
  assert.deepEqual(at.far, [-31.4167, 23.9333]);
  assert.deepEqual(at.none, [-25.72, 28.39]);
});

test('two GDELT articles that differ only in the query keep one id, the earlier', () => {
  const A = 'https://www.example.co.za/article.php?id=101';
  const B = 'https://www.example.co.za/article.php?id=202';
  const at = newestAt(T0);
  const gd = saStories(
    parseSaEvents(
      [
        row(
          at - 2 * HOUR,
          A,
          'Durban, KwaZulu-Natal, South Africa',
          '-29.86',
          '31.03',
        ),
        row(at - HOUR, B, 'Pretoria, Gauteng, South Africa', '-25.74', '28.19'),
      ].join('\n'),
    ),
    { nowMs: T0 },
  );
  assert.equal(gd.length, 2);
  assert.equal(gd[0].id, gd[1].id, 'the two articles share an id');
  // Either order in, the earlier one out.
  for (const list of [gd, [...gd].reverse()]) {
    const out = mergeStories(list, [], T0);
    assert.equal(out.length, 1);
    assert.equal(out[0].url, A);
    assert.equal(out[0].place, 'Durban');
  }
  // An outlet item of that address joins the story that is kept.
  const joined = mergeStories(
    [...gd].reverse(),
    [{ title: 'Outlet words', url: B, source: 'IOL', publishedAt: T0 - HOUR }],
    T0,
  );
  assert.equal(joined.length, 1);
  assert.equal(joined[0].title, 'Outlet words');
  assert.equal(joined[0].place, 'Durban');
  assert.deepEqual(joined[0].via, ['gdelt', 'rss']);
});

test('GDELT rows at Kwazulu make no story; Newcastle, a headline-only name, does', async (t) => {
  const up = upstream({
    rows: (at) => [
      row(
        at + MINUTE,
        'floods-sweep-homes-across-the-province',
        'Kwazulu, KwaZulu-Natal, South Africa',
        '-28.5',
        '30.9',
      ),
      row(
        at + 2 * MINUTE,
        'steel-plant-strike-shuts-newcastle-works',
        'Newcastle, KwaZulu-Natal, South Africa',
        '-27.7576',
        '29.9318',
      ),
    ],
  });
  const { request, close } = harness({ up });
  t.after(close);
  const { stories } = (await request('/')).body;
  assert.deepEqual(
    stories.filter((s) => s.via.includes('gdelt')).map((s) => s.place),
    ['Newcastle'],
  );
});
