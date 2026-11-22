// A camera that sets streetViewFallback: false must never spend the Google
// key: a failed upstream gets the synthetic card, and its upstream is asked at
// most once per frameRefreshMs. Cameras without the flag keep the fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cctvProxy } from '../../server/providers/cctv.js';

const UPSTREAM = 'https://cams.upstream.invalid/still.jpg';

/**
 * Serve the real CCTV middleware over a real socket with `sources` as the
 * only catalog, `upstream` answering every non-Google fetch, and counters for
 * both kinds of request.
 */
async function startServer(t, sources, upstream) {
  const saved = { ...process.env };
  process.env.CCTV_SOURCES_JSON = JSON.stringify(sources);
  process.env.CCTV_SOURCES_FILE = 'absent-source-file.json';
  process.env.CCTV_FORCE_AUSTIN = '0';
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'fixture-key';
  delete process.env.GOOGLE_MAPS_API_KEY;
  const nativeFetch = globalThis.fetch;
  const counts = { streetView: 0, upstream: 0 };
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://maps.googleapis.com/')) {
      counts.streetView += 1;
      return new Response('street-view', {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    counts.upstream += 1;
    return upstream();
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
  const getFrame = (id) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port,
            path: `/api/cctv/frame/${id}`,
            headers: { host: `localhost:${port}` },
            agent: false,
          },
          (res) => {
            res.resume();
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                type: res.headers['content-type'],
                source: res.headers['x-cctv-source'],
              }),
            );
          },
        )
        .on('error', reject);
    });
  return { counts, getFrame };
}

const failingUpstream = () => new Response(null, { status: 503 });
const jpegUpstream = () =>
  new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
    headers: { 'content-type': 'image/jpeg' },
  });

function camera(id, extra = {}) {
  return {
    id,
    name: `Fixture ${id}`,
    lat: -33.9,
    lon: 18.42,
    feedType: 'image',
    url: UPSTREAM,
    snapshotUrl: UPSTREAM,
    ...extra,
  };
}

test('an opted-out camera whose upstream fails gets the synthetic card, never Street View', async (t) => {
  const { counts, getFrame } = await startServer(
    t,
    [camera('za-fixture', { streetViewFallback: false })],
    failingUpstream,
  );
  const frame = await getFrame('za-fixture');
  assert.equal(frame.status, 200);
  assert.equal(frame.type, 'image/svg+xml');
  assert.equal(frame.source, 'synthetic');
  assert.equal(counts.streetView, 0);
});

test('an opted-out camera is fetched at most once per frameRefreshMs', async (t) => {
  const { counts, getFrame } = await startServer(
    t,
    [
      camera('za-refresh', {
        streetViewFallback: false,
        frameRefreshMs: 600000,
      }),
    ],
    jpegUpstream,
  );
  const first = await getFrame('za-refresh');
  const second = await getFrame('za-refresh');
  assert.equal(first.status, 200);
  assert.equal(first.type, 'image/jpeg');
  assert.equal(second.status, 200);
  assert.equal(second.type, 'image/jpeg');
  assert.equal(counts.upstream, 1, 'the second frame came from the cache');
});

test('a camera without the flag still falls back to Street View', async (t) => {
  const { counts, getFrame } = await startServer(
    t,
    [camera('plain-fixture')],
    failingUpstream,
  );
  const frame = await getFrame('plain-fixture');
  assert.equal(frame.source, 'streetview');
  assert.equal(counts.streetView, 1);
});
