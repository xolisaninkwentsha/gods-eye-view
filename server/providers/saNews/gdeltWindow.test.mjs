import assert from 'node:assert/strict';
import test from 'node:test';

import { exportUrl } from '../news/gdeltEvents.js';
import { zipTable } from '../news/gdeltFixtures.mjs';
import { SA_COL, createGdeltWindow } from './gdelt.js';

const STEP = 15 * 60_000;
// 12:07 UTC: the newest quarter hour is 12:00.
const T0 = Date.UTC(2026, 10, 24, 12, 7, 0);
const newestAt = (ms) => Math.floor(ms / STEP) * STEP;
const stamp = (ms) =>
  new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);

function row(addedMs, slug = 'protest-blocks-road-in-johannesburg-cbd') {
  const f = new Array(61).fill('');
  const set = {
    id: String(addedMs % 1_000_000),
    rootCode: '14',
    quadClass: '3',
    mentions: '2',
    geoType: '4',
    place: 'Johannesburg, Gauteng, South Africa',
    country: 'SF',
    lat: '-26.2',
    lon: '28.0',
    added: stamp(addedMs),
    url: `https://www.example.co.za/news/${slug}`,
  };
  for (const [name, value] of Object.entries(set)) f[SA_COL[name]] = value;
  return f.join('\t');
}

const lastupdate = (ms) =>
  new Response(
    `1 2 ${exportUrl(ms).replace('https:', 'http:')}\n3 4 ${exportUrl(ms).replace('export', 'mentions')}\n`,
  );

/**
 * A stub GDELT: `clock.now` moves, `latest()` is what lastupdate.txt lists,
 * `serve(url, at)` answers an export (a Response, or null for 404; throw to
 * fail).
 */
function stub({ serve, latest } = {}) {
  const clock = { now: T0 };
  const listedAt = latest ?? (() => newestAt(clock.now));
  const calls = [];
  let inflight = 0;
  let peak = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('lastupdate.txt')) {
      const at = listedAt();
      return at === null ? new Response('no', { status: 500 }) : lastupdate(at);
    }
    inflight += 1;
    peak = Math.max(peak, inflight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const at = Date.parse(
        url.replace(
          /.*\/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\..*/,
          '$1-$2-$3T$4:$5:$6Z',
        ),
      );
      const made = serve ? serve(url, at) : zipped(at);
      return made === null ? new Response('', { status: 404 }) : made;
    } finally {
      inflight -= 1;
    }
  };
  return {
    clock,
    calls,
    fetchImpl,
    peak: () => peak,
    exportCalls: () => calls.filter((c) => !c.url.endsWith('lastupdate.txt')),
  };
  function zipped(at) {
    return new Response(zipTable(row(at + 60_000)), { status: 200 });
  }
}

function build(s, extra = {}) {
  const warnings = [];
  const window = createGdeltWindow({
    fetchImpl: s.fetchImpl,
    now: () => s.clock.now,
    log: { warn: (...args) => warnings.push(args) },
    denied: () => false,
    ...extra,
  });
  return { window, warnings };
}

const urlAt = (ms) => exportUrl(ms);

test('before any read the window is loading and empty', () => {
  const { window } = build(stub());
  assert.deepEqual(window.coverage(), {
    hoursCovered: 0,
    missing: 0,
    complete: false,
    state: 'loading',
  });
  assert.deepEqual(window.stories(), []);
});

test('it never asks for an export past lastupdate', async () => {
  const s = stub({ latest: () => newestAt(T0) - 2 * STEP });
  const { window } = build(s);
  await window.refresh({});
  const asked = s.exportCalls().map((c) => c.url);
  assert.ok(asked.length > 0);
  assert.ok(!asked.includes(urlAt(newestAt(T0))));
  assert.ok(!asked.includes(urlAt(newestAt(T0) - STEP)));
  assert.equal(asked[0], urlAt(newestAt(T0) - 2 * STEP));
});

test('it fetches at most 12 per call and at most 4 at once', async () => {
  const s = stub();
  const { window } = build(s);
  await window.refresh({});
  assert.equal(s.exportCalls().length, 12);
  assert.ok(s.peak() <= 4 && s.peak() > 1, `peak ${s.peak()}`);
  await window.refresh({});
  assert.equal(s.exportCalls().length, 24);
  // Newest first, none twice.
  assert.equal(new Set(s.exportCalls().map((c) => c.url)).size, 24);
});

test('every request carries redirect error, the User-Agent and a signal', async () => {
  const s = stub();
  const { window } = build(s);
  await window.refresh({ signal: new AbortController().signal });
  assert.ok(s.calls.some((c) => c.url.endsWith('lastupdate.txt')));
  for (const { options } of s.calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['User-Agent'], 'GodsEyeView (sa-news)');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('an abort mid-flight aborts the request in flight and stops further ones', async () => {
  const seen = [];
  const s = stub({
    serve: (url, at) => {
      seen.push(url);
      return new Response(zipTable(row(at + 60_000)));
    },
  });
  const { window } = build(s);
  const abort = new AbortController();
  const pending = window.refresh({ signal: abort.signal });
  await new Promise((resolve) => setTimeout(resolve, 1));
  abort.abort();
  await pending;
  const flying = s.exportCalls();
  assert.ok(flying.length >= 1 && flying.length <= 4);
  assert.ok(flying.every((c) => c.options.signal.aborted));
  const after = s.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(s.calls.length, after);
  assert.notEqual(window.coverage().state, 'failed');
});

test('two refreshes at once share one read', async () => {
  const s = stub();
  const { window } = build(s);
  await Promise.all([window.refresh({}), window.refresh({})]);
  const asked = s.exportCalls().map((c) => c.url);
  assert.equal(asked.length, 12);
  assert.equal(new Set(asked).size, 12);
  assert.equal(window.coverage().hoursCovered, 3);
  await window.refresh({});
  assert.equal(s.exportCalls().length, 24);
});

test('a 404 is retried and is gone only 90 minutes after the export time', async () => {
  const newest = urlAt(newestAt(T0));
  const s = stub({
    serve: (url, at) =>
      url === newest ? null : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  const count = () => s.exportCalls().filter((c) => c.url === newest).length;
  for (let i = 0; i < 6; i++) await window.refresh({});
  // Never given up on by count: asked on every refresh.
  assert.equal(count(), 6);
  // 13:29: the 12:00 export is 89 minutes old.
  s.clock.now = T0 + 82 * 60_000;
  await window.refresh({});
  assert.equal(count(), 7);
  // 13:31: 91 minutes old, asked once more, then gone.
  s.clock.now = T0 + 84 * 60_000;
  await window.refresh({});
  assert.equal(count(), 8);
  await window.refresh({});
  assert.equal(count(), 8);
});

test('the window prunes exports that fall out of it', async () => {
  const newest = newestAt(T0);
  // One export alone has a row, stamped to stay fresh well into tomorrow.
  const s = stub({
    serve: (url) =>
      url === urlAt(newest)
        ? new Response(zipTable(row(newest + 26 * 3_600_000)))
        : null,
  });
  const { window } = build(s);
  await window.refresh({});
  assert.equal(window.stories().length, 1);
  // An hour on the export is still inside the window.
  s.clock.now = T0 + 3_600_000;
  await window.refresh({});
  assert.equal(window.stories().length, 1);
  // A day and a bit on it has fallen out, and its events with it.
  s.clock.now = T0 + 25 * 3_600_000;
  await window.refresh({});
  assert.equal(window.stories().length, 0);
});

test('hoursCovered grows across calls until 24', async () => {
  const s = stub();
  const { window } = build(s);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await window.refresh({});
    seen.push(window.coverage().hoursCovered);
  }
  assert.deepEqual(seen, [3, 6, 9, 12, 15, 18, 21, 24]);
  assert.deepEqual(window.coverage(), {
    hoursCovered: 24,
    missing: 0,
    complete: true,
    state: 'ok',
  });
  const before = s.exportCalls().length;
  await window.refresh({});
  assert.equal(s.exportCalls().length, before);
});

test('a partial window says partial and counts what is missing', async () => {
  const s = stub();
  const { window } = build(s);
  await window.refresh({});
  assert.deepEqual(window.coverage(), {
    hoursCovered: 3,
    missing: 84,
    complete: false,
    state: 'partial',
  });
});

test('stories come back newest first', async () => {
  const newest = newestAt(T0);
  const s = stub({
    serve: (url, at) =>
      at >= newest - STEP
        ? new Response(
            zipTable(
              row(
                at + 60_000,
                at === newest
                  ? 'late-news-from-johannesburg-today'
                  : 'early-news-from-johannesburg-today',
              ),
            ),
          )
        : null,
  });
  const { window } = build(s);
  await window.refresh({});
  const stories = window.stories();
  assert.equal(stories.length, 2);
  assert.ok(stories[0].publishedAt > stories[1].publishedAt);
});

test('a fetch error leaves held stories intact and the state shows it', async () => {
  let broken = false;
  const newest = urlAt(newestAt(T0));
  const s = stub({
    serve: (url, at) => {
      if (broken && url !== newest) {
        throw Object.assign(new Error('secret body text'), {
          code: 'ECONNRESET',
        });
      }
      return url === newest ? new Response(zipTable(row(at + 60_000))) : null;
    },
  });
  const { window, warnings } = build(s);
  await window.refresh({});
  assert.equal(window.stories().length, 1);
  broken = true;
  const before = s.exportCalls().length;
  await window.refresh({});
  assert.ok(s.exportCalls().length > before, 'the erroring exports were asked');
  assert.equal(window.stories().length, 1);
  assert.equal(window.coverage().state, 'partial');
  assert.ok(warnings.length > 0);
  assert.ok(!JSON.stringify(warnings).includes('secret body text'));
  assert.deepEqual(warnings[0], [
    '[sa-news] gdelt export failed',
    'ECONNRESET',
  ]);
});

test('log labels are a string code, a string cause code, else the name', async () => {
  const labels = [];
  for (const make of [
    () => Object.assign(new Error('m'), { code: 42 }),
    () => new TypeError('m', { cause: { code: 'ENOTFOUND' } }),
    () => Object.assign(new RangeError('m'), { code: 7 }),
  ]) {
    const s = stub({
      serve: () => {
        throw make();
      },
    });
    const { window, warnings } = build(s);
    await window.refresh({});
    labels.push(warnings[0][1]);
  }
  assert.deepEqual(labels, ['Error', 'ENOTFOUND', 'RangeError']);
});

test('errors give up an export only after 3 counted tries, 5 minutes apart', async () => {
  const bad = urlAt(newestAt(T0));
  const s = stub({
    serve: (url, at) =>
      url === bad
        ? new Response('boom', { status: 503 })
        : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  const count = () => s.exportCalls().filter((c) => c.url === bad).length;
  // Three quick refreshes: only the first asks (spacing), nothing given up.
  for (let i = 0; i < 3; i++) await window.refresh({});
  assert.equal(count(), 1);
  s.clock.now += 6 * 60_000;
  await window.refresh({});
  assert.equal(count(), 2);
  s.clock.now += 6 * 60_000;
  await window.refresh({});
  assert.equal(count(), 3);
  s.clock.now += 6 * 60_000;
  await window.refresh({});
  assert.equal(count(), 3, 'given up after the third counted try');
});

test('three quick 503 refreshes with the bad export alone do not give up', async () => {
  const bad = urlAt(newestAt(T0));
  const s = stub({
    serve: (url, at) =>
      url === bad
        ? new Response('boom', { status: 503 })
        : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  for (let i = 0; i < 3; i++) {
    await window.refresh({});
    s.clock.now += 6 * 60_000;
  }
  assert.equal(s.exportCalls().filter((c) => c.url === bad).length, 3);
  assert.ok(window.coverage().missing > 0);
});

test('an error while nothing else is readable is not counted', async () => {
  const s = stub({ serve: () => new Response('boom', { status: 503 }) });
  const { window, warnings } = build(s);
  for (let i = 0; i < 5; i++) {
    await window.refresh({});
    s.clock.now += 6 * 60_000;
  }
  // Every export asked again each refresh, none given up on.
  const first = urlAt(newestAt(T0));
  assert.equal(s.exportCalls().filter((c) => c.url === first).length, 5);
  assert.equal(window.coverage().state, 'failed');
  assert.ok(JSON.stringify(warnings).includes('HTTP_503'));
  assert.ok(!JSON.stringify(warnings).includes('boom'));
});

test('an unreadable lastupdate is failed with nothing held, and keeps the last good list', async () => {
  let down = true;
  const s = stub({ latest: () => (down ? null : newestAt(s.clock.now)) });
  const { window } = build(s);
  await window.refresh({});
  assert.equal(window.coverage().state, 'failed');
  assert.equal(s.exportCalls().length, 0);
  down = false;
  await window.refresh({});
  assert.equal(window.coverage().state, 'partial');
  down = true;
  await window.refresh({});
  assert.equal(window.coverage().state, 'partial');
  assert.equal(window.coverage().hoursCovered, 6);
  assert.ok(window.stories().length > 0);
});

async function fullWindow(s, window) {
  for (let i = 0; i < 8; i++) await window.refresh({});
  assert.deepEqual(window.coverage(), {
    hoursCovered: 24,
    missing: 0,
    complete: true,
    state: 'ok',
  });
}

test('a full window and a lastupdate failure stays at 24 h and ok', async () => {
  let down = false;
  const s = stub({ latest: () => (down ? null : newestAt(s.clock.now)) });
  const { window } = build(s);
  await fullWindow(s, window);
  down = true;
  await window.refresh({});
  assert.deepEqual(window.coverage(), {
    hoursCovered: 24,
    missing: 0,
    complete: true,
    state: 'ok',
  });
});

test('a full window and an erroring refresh is partial and keeps its hours', async () => {
  let broken = false;
  const s = stub({
    serve: (url, at) => {
      if (broken) throw Object.assign(new Error('x'), { code: 'ECONNRESET' });
      return new Response(zipTable(row(at + 60_000)));
    },
  });
  const { window } = build(s);
  await fullWindow(s, window);
  // Three minutes on: the 12:15 export is listed and its read errors.
  s.clock.now = T0 + 9 * 60_000;
  broken = true;
  await window.refresh({});
  const c = window.coverage();
  assert.equal(c.state, 'partial');
  assert.equal(c.hoursCovered, 23.75);
});

test('a transient 404 at the newest export does not zero the hours', async () => {
  const newest = urlAt(newestAt(T0));
  let hide = false;
  const s = stub({
    serve: (url, at) =>
      hide && url === newest ? null : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  hide = true;
  for (let i = 0; i < 9; i++) await window.refresh({});
  const c = window.coverage();
  assert.equal(c.hoursCovered, 23.75);
  assert.equal(c.missing, 1);
  assert.equal(c.state, 'partial');
  hide = false;
  await window.refresh({});
  assert.deepEqual(window.coverage(), {
    hoursCovered: 24,
    missing: 0,
    complete: true,
    state: 'ok',
  });
});

test('an export never published, 6 h back, is gone at once and completes the window', async () => {
  const never = urlAt(newestAt(T0) - 24 * STEP);
  const s = stub({
    serve: (url, at) =>
      url === never ? null : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  for (let i = 0; i < 8; i++) await window.refresh({});
  assert.deepEqual(window.coverage(), {
    hoursCovered: 23.75,
    missing: 0,
    complete: true,
    state: 'ok',
  });
});

test('twelve exports 6 h back answering 404 are gone on the first read and backfill goes on', async () => {
  const gap = new Set();
  for (let i = 24; i < 36; i++) gap.add(urlAt(newestAt(T0) - i * STEP));
  const s = stub({
    serve: (url, at) =>
      gap.has(url) ? null : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  for (let i = 0; i < 4; i++) await window.refresh({});
  const asked = s.exportCalls().map((c) => c.url);
  for (const url of gap) assert.equal(asked.filter((u) => u === url).length, 1);
  // The fourth refresh went past the gap.
  assert.ok(asked.includes(urlAt(newestAt(T0) - 36 * STEP)));
  assert.ok(asked.includes(urlAt(newestAt(T0) - 47 * STEP)));
});

test('a hole that may still fill costs only its own quarter hour', async () => {
  const hole = urlAt(newestAt(T0) - 3 * STEP);
  const s = stub({
    serve: (url, at) =>
      url === hole ? null : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  for (let i = 0; i < 9; i++) await window.refresh({});
  assert.deepEqual(window.coverage(), {
    hoursCovered: 23.75,
    missing: 1,
    complete: false,
    state: 'partial',
  });
});

test('every errored export is asked once in 5 minutes, back to back', async () => {
  const s = stub({ serve: () => new Response('boom', { status: 503 }) });
  const { window } = build(s);
  for (let i = 0; i < 3; i++) await window.refresh({});
  // Each refresh goes on to the next 12; none is asked a second time.
  assert.equal(s.exportCalls().length, 36);
  assert.equal(new Set(s.exportCalls().map((c) => c.url)).size, 36);
});

test('an errored refresh with nothing missing is partial, the next is ok', async () => {
  const L = { at: newestAt(T0) };
  const bad = urlAt(newestAt(T0) + STEP);
  const s = stub({
    latest: () => L.at,
    serve: (url, at) =>
      url === bad
        ? new Response('boom', { status: 503 })
        : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  for (let i = 0; i < 8; i++) await window.refresh({});
  const states = [];
  // Each step lists one more export; the bad one fails its third counted try
  // on the third, in a refresh that reads the new export.
  for (let step = 2; step <= 5; step++) {
    L.at = newestAt(T0) + step * STEP;
    s.clock.now = L.at + 60_000;
    await window.refresh({});
    states.push(window.coverage());
  }
  assert.equal(states[0].state, 'partial');
  assert.equal(states[2].state, 'partial');
  assert.equal(states[2].missing, 0);
  assert.equal(states[3].state, 'ok');
});

test('exports answering 404 while lastupdate is down are not given up', async () => {
  let down = false;
  const s = stub({
    latest: () => (down ? null : newestAt(T0)),
    serve: (url, at) =>
      down ? null : new Response(zipTable(row(at + 60_000))),
  });
  const { window } = build(s);
  for (let i = 0; i < 3; i++) await window.refresh({});
  assert.equal(window.coverage().hoursCovered, 9);
  down = true;
  for (let i = 0; i < 3; i++) {
    s.clock.now += 6 * 60_000;
    await window.refresh({});
  }
  // Exports far older than 90 minutes answered 404, and are still wanted.
  assert.equal(window.coverage().hoursCovered, 9);
  assert.ok(
    window.coverage().missing >= 56,
    `missing ${window.coverage().missing}`,
  );
  down = false;
  s.clock.now += 6 * 60_000;
  for (let i = 0; i < 10; i++) await window.refresh({});
  // The window slid on while lastupdate stood still: 23.5 h are listed.
  assert.equal(window.coverage().hoursCovered, 23.5);
  assert.equal(window.coverage().complete, true);
  assert.equal(window.coverage().state, 'ok');
});

test('a pre-aborted signal gives loading, not failed', async () => {
  const s = stub();
  const { window } = build(s);
  const abort = new AbortController();
  abort.abort();
  await window.refresh({ signal: abort.signal });
  assert.equal(window.coverage().state, 'loading');
});

test('the deny list is applied to the places read', async () => {
  const s = stub();
  const { window } = build(s, { denied: (name) => name === 'Johannesburg' });
  await window.refresh({});
  assert.deepEqual(window.stories(), []);
});

test('refresh resolves to how many exports it read', async () => {
  const s = stub();
  const { window } = build(s);
  assert.deepEqual(await window.refresh({}), { read: 12 });
  const none = stub({ serve: () => null });
  assert.deepEqual(await build(none).window.refresh({}), { read: 0 });
});
