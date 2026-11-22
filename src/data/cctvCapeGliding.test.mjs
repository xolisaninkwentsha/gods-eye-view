// Cape Gliding Club's cameras publish no fixed image URL: a WordPress lookup
// names the latest JPEG. The lookup and the image it names are both pinned to
// the club's site and that camera's folder, and the frame route asks at most
// once per frameRefreshMs without ever reaching Street View.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cctvProxy } from '../../server/providers/cctv.js';
import {
  CAPE_GLIDING_SOURCE_KIND,
  resolveCapeGlidingFrameUrl,
} from '../../server/providers/cctv/capeGliding.js';

const LOOKUP =
  'https://www.capegliding.co.za/wp-admin/admin-ajax.php?action=get_latest_camera_image&camera=camera3';
const IMAGE =
  'https://www.capegliding.co.za/wp-content/uploads/camera-cache/camera3/192.168.11.18_01_20261122140121602_TIMING.jpg';

/** The lookup's real answer shape (captured 22 Nov 2026), with `url` swapped in. */
function lookupBody(url) {
  return JSON.stringify({
    success: true,
    data: {
      url,
      filename: url.split('/').pop(),
      time: 1795348933,
      cached: true,
      stale: false,
    },
  });
}

/** A fetch double answering each URL from `routes`, recording every call. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const route = routes[String(url)];
    return route ? route() : new Response(null, { status: 404 });
  };
  return { calls, impl };
}

const json = (body, init = {}) => () =>
  new Response(body, {
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    ...init,
  });

test('resolves the JSON data.url for the same camera folder', async () => {
  const { calls, impl } = fakeFetch({ [LOOKUP]: json(lookupBody(IMAGE)) });
  assert.equal(await resolveCapeGlidingFrameUrl(LOOKUP, { fetchImpl: impl }), IMAGE);
  assert.deepEqual(calls, [LOOKUP]);
});

test('rejects a lookup URL for another host, path, action or camera 5', async () => {
  const { calls, impl } = fakeFetch({});
  for (const bad of [
    LOOKUP.replace('www.capegliding.co.za', 'evil.example'),
    LOOKUP.replace('http'+'s:', 'http:'),
    LOOKUP.replace('/wp-admin/admin-ajax.php', '/wp-admin/other.php'),
    LOOKUP.replace('get_latest_camera_image', 'delete_everything'),
    LOOKUP.replace('camera=camera3', 'camera=camera5'),
    `${LOOKUP}&extra=1`,
    '',
  ])
    assert.equal(await resolveCapeGlidingFrameUrl(bad, { fetchImpl: impl }), null, bad);
  assert.equal(calls.length, 0, 'no refused lookup is ever fetched');
});

test('rejects data.url on another host or another camera folder', async () => {
  for (const named of [
    IMAGE.replace('www.capegliding.co.za', 'evil.example'),
    IMAGE.replace('/camera3/', '/camera4/'),
    IMAGE.replace('/camera-cache/', '/private/'),
    'https://www.capegliding.co.za/wp-content/uploads/camera-cache/camera3/..%2f..%2fwp-config.php',
  ]) {
    const { impl } = fakeFetch({ [LOOKUP]: json(lookupBody(named)) });
    assert.equal(await resolveCapeGlidingFrameUrl(LOOKUP, { fetchImpl: impl }), null, named);
  }
});

test('malformed JSON, non-200 and oversized bodies resolve to null', async () => {
  const cases = {
    'not json': json('<html>oops</html>'),
    'success false': json(JSON.stringify({ success: false, data: { url: IMAGE } })),
    'missing url': json(JSON.stringify({ success: true, data: {} })),
    'server error': json(lookupBody(IMAGE), { status: 500 }),
    redirect: () =>
      new Response(null, { status: 302, headers: { location: IMAGE } }),
    oversized: json(lookupBody(IMAGE) + ' '.repeat(20000)),
  };
  for (const [name, route] of Object.entries(cases)) {
    const { impl } = fakeFetch({ [LOOKUP]: route });
    assert.equal(await resolveCapeGlidingFrameUrl(LOOKUP, { fetchImpl: impl }), null, name);
  }
});

test('a lookup that never answers resolves to null at the deadline', async () => {
  const hang = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason)),
    );
  assert.equal(
    await resolveCapeGlidingFrameUrl(LOOKUP, { fetchImpl: hang, timeoutMs: 50 }),
    null,
  );
});

test('the frame route makes at most one lookup per frameRefreshMs and never calls Street View', async (t) => {
  const saved = { ...process.env };
  process.env.CCTV_SOURCES_JSON = JSON.stringify([
    {
      id: 'za-capegliding-3',
      name: 'Cape Gliding Club: Slanghoek',
      lat: -33.663,
      lon: 19.415,
      feedType: 'image',
      sourceKind: CAPE_GLIDING_SOURCE_KIND,
      url: LOOKUP,
      frameRefreshMs: 300000,
      streetViewFallback: false,
    },
  ]);
  process.env.CCTV_SOURCES_FILE = 'absent-source-file.json';
  process.env.CCTV_FORCE_AUSTIN = '0';
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'fixture-key';
  const nativeFetch = globalThis.fetch;
  const counts = { lookup: 0, image: 0, google: 0, other: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://maps.googleapis.com/')) {
      counts.google += 1;
      return new Response('sv', { headers: { 'content-type': 'image/jpeg' } });
    }
    if (u === LOOKUP) {
      counts.lookup += 1;
      return json(lookupBody(IMAGE))();
    }
    if (u === IMAGE) {
      counts.image += 1;
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    counts.other += 1;
    return new Response(null, { status: 404 });
  };
  let handler;
  cctvProxy().configureServer({
    middlewares: { use: (_r, fn) => (handler = fn) },
  });
  const server = http.createServer((req, res) => {
    req.url = req.url.replace(/^\/api\/cctv/, '');
    handler(req, res, () => res.end());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.close();
    globalThis.fetch = nativeFetch;
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  const { port } = server.address();
  const getFrame = () =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port,
            path: '/api/cctv/frame/za-capegliding-3',
            headers: { host: `localhost:${port}` },
            agent: false,
          },
          (res) => {
            res.resume();
            res.on('end', () =>
              resolve({
                type: res.headers['content-type'],
                source: res.headers['x-cctv-source'],
              }),
            );
          },
        )
        .on('error', reject);
    });
  const first = await getFrame();
  const second = await getFrame();
  assert.equal(first.type, 'image/jpeg');
  assert.equal(first.source, 'upstream-image');
  assert.equal(second.type, 'image/jpeg');
  assert.deepEqual(counts, { lookup: 1, image: 1, google: 0, other: 0 });
});
