// YouTube live webcams travel through the camera catalog as feedType
// 'youtube' with a validated video ID. The server never fetches YouTube: a
// frame request for one is the synthetic LIVE ON YOUTUBE card, never an
// upstream fetch and never the key-bearing Street View fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cctvProxy } from '../../server/providers/cctv.js';
import { normalizeYoutubeVideoId } from '../../server/providers/cctv/normalize.js';

const STILL = {
  id: 'za-still',
  name: 'Still fixture',
  lat: -33.9,
  lon: 18.42,
  feedType: 'image',
  url: 'https://cams.upstream.invalid/still.jpg',
  snapshotUrl: 'https://cams.upstream.invalid/still.jpg',
  streetViewFallback: false,
};
const YOUTUBE = {
  id: 'za-youtube',
  name: 'Table Mountain & Bloubergstrand',
  lat: -33.81,
  lon: 18.46,
  feedType: 'youtube',
  youtubeVideoId: 'Yql-FpQkDr8',
  sourceUrl: 'https://www.youtube.com/@TableMountainLiveStream',
  streetViewFallback: false,
};

/** Serve the real CCTV middleware with `sources` as the only catalog. */
async function startServer(t, sources) {
  const saved = { ...process.env };
  process.env.CCTV_SOURCES_JSON = JSON.stringify(sources);
  process.env.CCTV_SOURCES_FILE = 'absent-source-file.json';
  process.env.CCTV_FORCE_AUSTIN = '0';
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'fixture-key';
  delete process.env.GOOGLE_MAPS_API_KEY;
  const nativeFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(null, { status: 503 });
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
  const get = (path) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port,
            path: `/api/cctv${path}`,
            headers: { host: `localhost:${port}` },
            agent: false,
          },
          (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        )
        .on('error', reject);
    });
  return { fetched, get };
}

test('normalizeYoutubeVideoId keeps only an 11-character ID', () => {
  assert.equal(normalizeYoutubeVideoId('Yql-FpQkDr8'), 'Yql-FpQkDr8');
  assert.equal(normalizeYoutubeVideoId('Yql-FpQkDr8x'), '');
  assert.equal(normalizeYoutubeVideoId('https://youtu.be/Yql-FpQkDr8'), '');
  assert.equal(normalizeYoutubeVideoId('Yql FpQkDr8'), '');
  assert.equal(normalizeYoutubeVideoId(undefined), '');
});

test('a YouTube camera reaches /sources with its video ID and a still camera does not carry one', async (t) => {
  const { get } = await startServer(t, [STILL, YOUTUBE]);
  const { sources } = JSON.parse((await get('/sources')).body);
  const youtube = sources.find((s) => s.id === 'za-youtube');
  const still = sources.find((s) => s.id === 'za-still');
  assert.equal(youtube?.feedType, 'youtube');
  assert.equal(youtube?.youtubeVideoId, 'Yql-FpQkDr8');
  assert.equal(still?.youtubeVideoId, '');
});

test('a YouTube record with a bad ID is dropped and its neighbours still load', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  const bad = { ...YOUTUBE, id: 'za-bad', youtubeVideoId: 'not-an-id' };
  const { get } = await startServer(t, [STILL, bad]);
  const { sources } = JSON.parse((await get('/sources')).body);
  const ids = sources.map((s) => s.id);
  assert.ok(!ids.includes('za-bad'), 'the bad YouTube record is dropped');
  assert.ok(ids.includes('za-still'), 'its neighbour still loads');
  assert.equal(warnings.filter((w) => w.includes('za-bad')).length, 1);
});

test('a YouTube camera frame is the LIVE ON YOUTUBE card with no upstream or Street View fetch', async (t) => {
  // Without the Street View opt-out: the YouTube type alone keeps Google out.
  const { streetViewFallback: _optOut, ...youtubeOnly } = YOUTUBE;
  const { fetched, get } = await startServer(t, [youtubeOnly]);
  const frame = await get('/frame/za-youtube');
  assert.equal(frame.status, 200);
  assert.equal(frame.headers['content-type'], 'image/svg+xml');
  assert.equal(frame.headers['x-cctv-source'], 'synthetic');
  assert.match(frame.body, /LIVE ON YOUTUBE/);
  assert.deepEqual(fetched, [], 'nothing was fetched, Google included');
});
