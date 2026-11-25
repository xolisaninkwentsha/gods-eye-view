import assert from 'node:assert/strict';
import test from 'node:test';

import { SA_FEEDS, createFeeds, parseFeed } from './rss.js';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const HOUR = 3_600_000;
const rfc = (ms) => new Date(ms).toUTCString();

const rssItem = ({ title = 'A headline', link, date, extra = '' } = {}) =>
  `<item><title>${title}</title>${link === undefined ? '' : `<link>${link}</link>`}${
    date === undefined ? '' : `<pubDate>${date}</pubDate>`
  }${extra}</item>`;
const rss = (...items) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;

test('SA_FEEDS lists the eight outlets with their fixed URLs', () => {
  assert.deepEqual(SA_FEEDS, [
    { id: 'iol', name: 'IOL', url: 'https://iol.co.za/rss/' },
    {
      id: 'dailymaverick',
      name: 'Daily Maverick',
      url: 'https://www.dailymaverick.co.za/dmrss/',
    },
    {
      id: 'timeslive',
      name: 'TimesLIVE',
      url: 'https://www.timeslive.co.za/arc/outboundfeeds/rss/',
    },
    { id: 'mg', name: 'Mail & Guardian', url: 'https://mg.co.za/rss/' },
    {
      id: 'groundup',
      name: 'GroundUp',
      url: 'https://groundup.org.za/sitenews/rss/',
    },
    { id: 'enca', name: 'eNCA', url: 'https://www.enca.com/rss.xml' },
    {
      id: 'citizen',
      name: 'The Citizen',
      url: 'https://www.citizen.co.za/feed/',
    },
    { id: 'sanews', name: 'SAnews', url: 'https://www.sanews.gov.za/rss.xml' },
  ]);
});

test('parseFeed reads RSS items', () => {
  const xml = rss(
    rssItem({
      title: 'Taxi strike in Durban',
      link: 'https://example.co.za/a',
      date: rfc(NOW - HOUR),
    }),
  );
  assert.deepEqual(parseFeed(xml, { outlet: 'iol', nowMs: NOW }), [
    {
      title: 'Taxi strike in Durban',
      url: 'https://example.co.za/a',
      publishedAt: NOW - HOUR,
    },
  ]);
});

test('parseFeed reads Atom entries, preferring the alternate link', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>One</title>
      <link rel="self" href="https://example.co.za/self"/>
      <link rel="alternate" type="text/html" href="https://example.co.za/one?a=1&amp;b=2"/>
      <updated>${iso(NOW - 2 * HOUR)}</updated></entry>
    <entry><title type="html">Two</title><link href="https://example.co.za/two"/>
      <published>${iso(NOW - 3 * HOUR)}</published><updated>${iso(NOW)}</updated></entry>
  </feed>`;
  assert.deepEqual(parseFeed(xml, { outlet: 'x', nowMs: NOW }), [
    {
      title: 'One',
      url: 'https://example.co.za/one?a=1&b=2',
      publishedAt: NOW - 2 * HOUR,
    },
    {
      title: 'Two',
      url: 'https://example.co.za/two',
      publishedAt: NOW - 3 * HOUR,
    },
  ]);
});

test('parseFeed decodes CDATA and entities and strips tags', () => {
  const xml = rss(
    rssItem({
      title: '<![CDATA[Cops &amp; robbers &#8211; <b>live</b>]]>',
      link: '<![CDATA[https://example.co.za/cdata]]>',
      date: rfc(NOW),
    }),
    rssItem({
      title:
        ' Tom &amp; Jerry&nbsp;&quot;x&quot; &#x2019;s &lt;3 &apos;y&apos;\n   z ',
      link: 'https://example.co.za/ent',
      date: rfc(NOW),
    }),
  );
  const [a, b] = parseFeed(xml, { outlet: 'x', nowMs: NOW });
  assert.equal(a.title, 'Cops & robbers – live');
  assert.equal(a.url, 'https://example.co.za/cdata');
  assert.equal(b.title, 'Tom & Jerry "x" ’s <3 \'y\' z');
});

test('parseFeed drops hostile, relative, missing links and empty titles', () => {
  const xml = rss(
    rssItem({ link: 'javascript:alert(1)', date: rfc(NOW) }),
    rssItem({ link: 'data:text/html,<b>x</b>', date: rfc(NOW) }),
    rssItem({ link: '/relative/path', date: rfc(NOW) }),
    rssItem({ date: rfc(NOW) }),
    rssItem({
      title: '  <b></b> ',
      link: 'https://example.co.za/e',
      date: rfc(NOW),
    }),
    rssItem({ title: 'Kept', link: 'http://example.co.za/ok', date: rfc(NOW) }),
  );
  assert.deepEqual(
    parseFeed(xml, { outlet: 'x', nowMs: NOW }).map((i) => i.url),
    ['http://example.co.za/ok'],
  );
});

test('parseFeed drops items older than 24 h or over 1 h ahead', () => {
  const xml = rss(
    rssItem({
      title: 'old',
      link: 'https://e.co.za/old',
      date: rfc(NOW - 25 * HOUR),
    }),
    rssItem({
      title: 'future',
      link: 'https://e.co.za/f',
      date: rfc(NOW + 2 * HOUR),
    }),
    rssItem({
      title: 'edge',
      link: 'https://e.co.za/edge',
      date: rfc(NOW - 23 * HOUR),
    }),
    rssItem({
      title: 'soon',
      link: 'https://e.co.za/soon',
      date: rfc(NOW + 30 * 60_000),
    }),
  );
  assert.deepEqual(
    parseFeed(xml, { outlet: 'x', nowMs: NOW }).map((i) => i.title),
    ['edge', 'soon'],
  );
});

test('parseFeed drops a duplicate link, keeping the first as written', () => {
  const xml = rss(
    rssItem({
      title: 'first',
      link: 'https://www.e.co.za/a/?utm=1',
      date: rfc(NOW),
    }),
    rssItem({ title: 'second', link: 'http://e.co.za/a', date: rfc(NOW) }),
  );
  const items = parseFeed(xml, { outlet: 'x', nowMs: NOW });
  assert.deepEqual(
    items.map((i) => [i.title, i.url]),
    [['first', 'https://www.e.co.za/a/?utm=1']],
  );
});

test('parseFeed gives an undated item the time it was first seen', () => {
  const xml = rss(
    rssItem({
      link: 'https://www.e.co.za/u/',
      extra: '<pubDate>not a date</pubDate>',
    }),
  );
  const firstSeen = new Map();
  const [a] = parseFeed(xml, { outlet: 'x', nowMs: NOW, firstSeen });
  assert.equal(a.publishedAt, NOW);
  assert.equal(firstSeen.get('https://e.co.za/u'), NOW);
  const [b] = parseFeed(xml, { outlet: 'x', nowMs: NOW + 5 * HOUR, firstSeen });
  assert.equal(b.publishedAt, NOW);
  const [c] = parseFeed(xml, { outlet: 'x', nowMs: NOW + 5 * HOUR });
  assert.equal(c.publishedAt, NOW + 5 * HOUR);
});

test('parseFeed survives empty and malformed input', () => {
  for (const xml of [
    '',
    '   ',
    '<rss><channel></channel></rss>',
    '<item><title>x',
    null,
    undefined,
  ])
    assert.deepEqual(parseFeed(xml, { outlet: 'x', nowMs: NOW }), []);
});

// Hostile or truncated bodies must parse in linear time (2 MiB is the read cap).
const BODY_BYTES = 2 * 1024 * 1024;
const repeat = (unit) => unit.repeat(Math.ceil(BODY_BYTES / unit.length));
const timed = (xml) => {
  const start = performance.now();
  const items = parseFeed(xml, { nowMs: NOW });
  return { items, ms: performance.now() - start };
};

test('parseFeed stays fast on a body of unclosed <item> or <entry> tags', () => {
  for (const unit of [
    '<item><title>x</title><link>https://e.co.za/a</link>',
    '<entry><title>x</title><link href="https://e.co.za/a"/>',
  ]) {
    const { items, ms } = timed(repeat(unit));
    assert.deepEqual(items, []);
    assert.ok(ms < 1000, `${ms} ms`);
  }
});

test('parseFeed stays fast on huge unclosed fields inside a closed item', () => {
  const shell = (inner) => `<item>${inner}</item>`;
  for (const inner of [
    `<title>${'a'.repeat(BODY_BYTES)}`,
    repeat('<title '),
    repeat('<link '),
    repeat('<link>'),
    repeat('<title><![CDATA['),
    repeat('<'),
  ]) {
    const { ms } = timed(shell(inner));
    assert.ok(ms < 1000, `${ms} ms`);
  }
});

test('parseFeed keeps at most 200 items and cuts a title at 300 characters', () => {
  const many = rss(
    ...Array.from({ length: 250 }, (_, i) =>
      rssItem({ title: `t${i}`, link: `https://e.co.za/${i}`, date: rfc(NOW) }),
    ),
  );
  assert.equal(parseFeed(many, { nowMs: NOW }).length, 200);
  const [long] = parseFeed(
    rss(
      rssItem({
        title: 'b'.repeat(500),
        link: 'https://e.co.za/long',
        date: rfc(NOW),
      }),
    ),
    { nowMs: NOW },
  );
  assert.equal(long.title, `${'b'.repeat(299)}\u2026`);
});

// --- createFeeds -----------------------------------------------------------

const bodyFor = (id, ms) =>
  rss(
    rssItem({
      title: `${id} headline`,
      link: `https://${id}.example.co.za/story`,
      date: rfc(ms),
    }),
  );

function makeStub(handler) {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const feed = SA_FEEDS.find((f) => f.url === url);
      return await handler(feed, options);
    } finally {
      inFlight -= 1;
    }
  };
  return { fetchImpl, calls, peak: () => peak };
}

const okHandler = (clock) => (feed) =>
  new Response(bodyFor(feed.id, clock.t - HOUR), { status: 200 });

function setup(handler, clock = { t: NOW }) {
  const warnings = [];
  const stub = makeStub(handler ?? okHandler(clock));
  const feeds = createFeeds({
    fetchImpl: stub.fetchImpl,
    now: () => clock.t,
    log: { warn: (...args) => warnings.push(args) },
  });
  return { clock, feeds, warnings, ...stub };
}

test('status is loading before the first attempt', () => {
  const { feeds } = setup();
  assert.deepEqual(
    feeds.status(),
    Object.fromEntries(SA_FEEDS.map((f) => [f.id, 'loading'])),
  );
  assert.deepEqual(feeds.items(), []);
});

test('every request carries the exact URL, redirect error, agent and a signal, 4 at a time', async () => {
  const { feeds, calls, peak } = setup();
  await feeds.refresh({});
  assert.deepEqual(
    calls.map((c) => c.url).sort(),
    SA_FEEDS.map((f) => f.url).sort(),
  );
  for (const { options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['User-Agent'], 'GodsEyeView (sa-news)');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.ok(peak() <= 4 && peak() >= 2);
  assert.ok(Object.values(feeds.status()).every((s) => s === 'ok'));
});

test('a caller signal reaches the request', async () => {
  const { feeds, calls } = setup();
  const controller = new AbortController();
  await feeds.refresh({ signal: controller.signal });
  controller.abort();
  assert.ok(calls.every((c) => c.options.signal.aborted));
});

test('one feed failing keeps the others, and is logged by label only', async () => {
  const clock = { t: NOW };
  const { feeds, warnings } = setup((feed) => {
    if (feed.id === 'mg')
      throw Object.assign(new Error('secret body text'), {
        code: 'ECONNRESET',
      });
    return okHandler(clock)(feed);
  }, clock);
  await feeds.refresh({});
  assert.equal(feeds.status().mg, 'failed');
  assert.equal(feeds.status().iol, 'ok');
  assert.equal(feeds.items().length, 7);
  assert.deepEqual(warnings, [['[sa-news] feed failed', 'mg', 'ECONNRESET']]);
});

test('HTTP statuses and oversized bodies are labelled, never described', async () => {
  const clock = { t: NOW };
  const big = new Uint8Array(2 * 1024 * 1024 + 1).fill(97);
  const { feeds, warnings } = setup((feed) => {
    if (feed.id === 'iol') return new Response('nope', { status: 503 });
    if (feed.id === 'enca') return new Response(big, { status: 200 });
    return okHandler(clock)(feed);
  }, clock);
  await feeds.refresh({});
  assert.equal(feeds.status().iol, 'failed');
  assert.equal(feeds.status().enca, 'failed');
  assert.deepEqual(
    warnings.sort((a, b) => a[1].localeCompare(b[1])),
    [
      ['[sa-news] feed failed', 'enca', 'RESPONSE_TOO_LARGE'],
      ['[sa-news] feed failed', 'iol', 'HTTP_503'],
    ],
  );
});

test('a failed feed keeps its previous items', async () => {
  const clock = { t: NOW };
  let broken = false;
  const { feeds } = setup((feed) => {
    if (broken && feed.id === 'iol') return new Response('', { status: 500 });
    return okHandler(clock)(feed);
  }, clock);
  await feeds.refresh({});
  broken = true;
  clock.t += 15 * 60_000;
  await feeds.refresh({});
  assert.equal(feeds.status().iol, 'failed');
  assert.ok(feeds.items().some((i) => i.source === 'IOL'));
});

test('feeds are refetched only when 15 minutes old, failures on the same cadence', async () => {
  const clock = { t: NOW };
  let failIol = true;
  const { feeds, calls } = setup((feed) => {
    if (failIol && feed.id === 'iol') return new Response('', { status: 500 });
    return okHandler(clock)(feed);
  }, clock);
  await feeds.refresh({});
  assert.equal(calls.length, 8);
  clock.t += 14 * 60_000;
  await feeds.refresh({});
  assert.equal(calls.length, 8);
  failIol = false;
  clock.t += 60_000;
  await feeds.refresh({});
  assert.equal(calls.length, 16);
  assert.equal(feeds.status().iol, 'ok');
});

test('concurrent refreshes share one run', async () => {
  const { feeds, calls } = setup();
  await Promise.all([feeds.refresh({}), feeds.refresh({})]);
  assert.equal(calls.length, 8);
});

test('a caller abort changes no status and is no attempt', async () => {
  const { feeds, calls, warnings } = setup();
  const controller = new AbortController();
  const run = feeds.refresh({ signal: controller.signal });
  controller.abort();
  await run;
  assert.deepEqual(
    Object.values(feeds.status()),
    SA_FEEDS.map(() => 'loading'),
  );
  assert.deepEqual(warnings, []);
  const before = calls.length;
  await feeds.refresh({});
  assert.equal(calls.length - before, 8);
  assert.ok(Object.values(feeds.status()).every((s) => s === 'ok'));
});

test('items names the outlet, ages out by now() and dedups across outlets', async () => {
  const clock = { t: NOW };
  const { feeds } = setup((feed) => {
    const link = ['iol', 'timeslive'].includes(feed.id)
      ? 'https://www.shared.co.za/story/?ref=' + feed.id
      : `https://${feed.id}.example.co.za/story`;
    return new Response(
      rss(
        rssItem({ title: `${feed.id} story`, link, date: rfc(NOW - 2 * HOUR) }),
      ),
      { status: 200 },
    );
  }, clock);
  await feeds.refresh({});
  const items = feeds.items();
  assert.equal(items.length, 7);
  const shared = items.find((i) => i.url.includes('shared.co.za'));
  assert.equal(shared.source, 'IOL');
  assert.equal(shared.title, 'iol story');
  assert.equal(
    items.find((i) => i.title === 'mg story').source,
    'Mail & Guardian',
  );
  clock.t += 23 * HOUR;
  assert.deepEqual(feeds.items(), []);
});
