import assert from 'node:assert/strict';
import test from 'node:test';
import { FACILITY_SETS, fetchHdxResource } from './hdx.js';

// Everything below is synthetic: a stubbed HDX with made-up resources.
const ID = 'a4d76cfe-798d-4db7-ba8f-110282d613b2';
const OTHER_ID = 'b5e87dfe-898e-5ec8-cb90-221393e724c3';
const DOWNLOAD = `https://data.humdata.org/dataset/d1/resource/${ID}/download/south-africa.geojson`;
const SIGNED = `https://s3.us-east-1.amazonaws.com/hdx-production-filestore/resources/${ID}/south-africa.geojson?X-Amz-Signature=secret`;
const SET = FACILITY_SETS.health;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
const pkg = (resource = {}) =>
  json({
    success: true,
    result: {
      resources: [
        { id: 'zzz', name: 'other', url: 'https://x.example/' },
        {
          id: ID,
          name: SET.resource,
          format: 'GeoJSON',
          url: DOWNLOAD,
          last_modified: '2026-09-29T08:01:02.000000',
          ...resource,
        },
      ],
    },
  });
const redirect = (location, status = 302) =>
  new Response(null, {
    status,
    headers: location === null ? {} : { location },
  });

// `answers` are consumed in order; each is a Response or a function of the call.
function stub(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error('unexpected fetch');
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

test('follows one pinned redirect, the second request refusing redirects', async () => {
  const { fetchImpl, calls } = stub(
    pkg(),
    redirect(SIGNED),
    new Response('GEO'),
  );
  let meta;
  const text = await fetchHdxResource(SET, {
    fetchImpl,
    onResource: (m) => {
      meta = m;
    },
  });
  assert.equal(text, 'GEO');
  assert.deepEqual(meta, { updated: '2026-09-29' });
  assert.equal(calls.length, 3);
  assert.equal(
    calls[0].url,
    'https://data.humdata.org/api/3/action/package_show?id=south-africa-healthsites',
  );
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[1].url, DOWNLOAD);
  assert.equal(calls[1].init.redirect, 'manual');
  assert.equal(calls[2].url, SIGNED);
  assert.equal(calls[2].init.redirect, 'error');
  for (const { init } of calls)
    assert.equal(init.headers['User-Agent'], 'GodsEyeView (sa-facilities)');
});

test('a 200 without a redirect is read directly', async () => {
  const { fetchImpl, calls } = stub(pkg(), new Response('DIRECT'));
  assert.equal(await fetchHdxResource(SET, { fetchImpl }), 'DIRECT');
  assert.equal(calls.length, 2);
});

test('redirects elsewhere are refused and nothing is fetched from them', async () => {
  const s3 = 'https://s3.us-east-1.amazonaws.com';
  const prefix = `/hdx-production-filestore/resources`;
  const bad = [
    `https://evil.example/hdx-production-filestore/resources/${ID}/f`,
    `https://s3.us-east-1.amazonaws.com.evil.example${prefix}/${ID}/f`,
    `https://s3.eu-west-1.amazonaws.com${prefix}/${ID}/f`,
    `http://s3.us-east-1.amazonaws.com${prefix}/${ID}/f`,
    `${s3}${prefix}/${OTHER_ID}/f`,
    `${s3}${prefix}/${ID}x/f`,
    `${s3}${prefix}/${ID}`,
    `${s3}/other-bucket/resources/${ID}/f`,
    `${s3}${prefix}/${ID}/../${OTHER_ID}/f`,
    `${s3}:8443${prefix}/${ID}/f`,
    `https://user:pw@s3.us-east-1.amazonaws.com${prefix}/${ID}/f`,
    `https://data.humdata.org/other`,
    '/relative/path',
    'not a url',
    '',
  ];
  for (const location of bad) {
    const { fetchImpl, calls } = stub(pkg(), redirect(location));
    await assert.rejects(
      () => fetchHdxResource(SET, { fetchImpl }),
      (error) => {
        assert.equal(error.code, 'HDX_REDIRECT_REFUSED', location);
        assert.ok(!error.message.includes('evil'));
        return true;
      },
    );
    assert.equal(calls.length, 2, `nothing fetched from ${location}`);
  }
  const { fetchImpl } = stub(pkg(), redirect(null));
  await assert.rejects(() => fetchHdxResource(SET, { fetchImpl }), {
    code: 'HDX_REDIRECT_REFUSED',
  });
});

test('every redirect status is followed; other statuses fail by code', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const { fetchImpl } = stub(
      pkg(),
      redirect(SIGNED, status),
      new Response('x'),
    );
    assert.equal(await fetchHdxResource(SET, { fetchImpl }), 'x');
  }
  for (const [first, code] of [
    [redirect(SIGNED, 304), 'HDX_HTTP_304'],
    [new Response('no', { status: 404 }), 'HDX_HTTP_404'],
    [new Response('no', { status: 503 }), 'HDX_HTTP_503'],
  ]) {
    const { fetchImpl } = stub(pkg(), first);
    await assert.rejects(() => fetchHdxResource(SET, { fetchImpl }), { code });
  }
  // A second hop that answers anything but 200, a redirect included.
  const { fetchImpl } = stub(pkg(), redirect(SIGNED), redirect(SIGNED));
  await assert.rejects(() => fetchHdxResource(SET, { fetchImpl }), {
    code: 'HDX_HTTP_302',
  });
});

test('the package step fails by code', async () => {
  let s = stub(new Response('down', { status: 500 }));
  await assert.rejects(
    () => fetchHdxResource(SET, { fetchImpl: s.fetchImpl }),
    {
      code: 'HDX_PACKAGE_HTTP_500',
    },
  );
  s = stub(new Response('<html>', { status: 200 }));
  await assert.rejects(
    () => fetchHdxResource(SET, { fetchImpl: s.fetchImpl }),
    {
      code: 'PARSE_FAILED',
    },
  );
  s = stub(json({ result: { resources: [{ id: ID, name: 'nope' }] } }));
  await assert.rejects(
    () => fetchHdxResource(SET, { fetchImpl: s.fetchImpl }),
    {
      code: 'HDX_RESOURCE_MISSING',
    },
  );
  s = stub(json({ result: {} }));
  await assert.rejects(
    () => fetchHdxResource(SET, { fetchImpl: s.fetchImpl }),
    {
      code: 'HDX_RESOURCE_MISSING',
    },
  );
  for (const url of [
    'http://data.humdata.org/dataset/d/resource/' + ID + '/download/f',
    `https://evil.example/dataset/d/resource/${ID}/download/f`,
    `https://data.humdata.org/dataset/d/resource/${OTHER_ID}/download/f`,
    `https://data.humdata.org/dataset/d/resource/${ID}/other/f`,
    undefined,
  ]) {
    s = stub(pkg({ url }));
    await assert.rejects(
      () => fetchHdxResource(SET, { fetchImpl: s.fetchImpl }),
      { code: 'HDX_URL_REFUSED' },
      String(url),
    );
    assert.equal(s.calls.length, 1, 'the download is never requested');
  }
});

test('a body over the cap throws RESPONSE_TOO_LARGE', async () => {
  const small = { ...SET, maxBytes: 10 };
  // Declared length.
  let s = stub(
    pkg(),
    new Response('x'.repeat(50), { headers: { 'content-length': '50' } }),
  );
  await assert.rejects(
    () => fetchHdxResource(small, { fetchImpl: s.fetchImpl }),
    {
      code: 'RESPONSE_TOO_LARGE',
    },
  );
  // Streamed, no length, through the pinned redirect.
  const stream = () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('x'.repeat(6)));
          c.enqueue(new TextEncoder().encode('x'.repeat(6)));
          c.close();
        },
      }),
    );
  s = stub(pkg(), redirect(SIGNED), stream());
  await assert.rejects(
    () => fetchHdxResource(small, { fetchImpl: s.fetchImpl }),
    {
      code: 'RESPONSE_TOO_LARGE',
    },
  );
  // The package is capped too (2 MiB).
  s = stub(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(
    () => fetchHdxResource(SET, { fetchImpl: s.fetchImpl }),
    {
      code: 'RESPONSE_TOO_LARGE',
    },
  );
});

test('a request that does not answer in time throws TIMEOUT', async () => {
  const hang = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      ),
    );
  const { fetchImpl } = stub(hang);
  await assert.rejects(
    () => fetchHdxResource(SET, { fetchImpl, timeoutMs: 20 }),
    {
      code: 'TIMEOUT',
    },
  );
});

test('the caller can abort', async () => {
  const ctl = new AbortController();
  const hang = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      ),
    );
  const { fetchImpl } = stub(hang);
  const run = fetchHdxResource(SET, { fetchImpl, signal: ctl.signal });
  ctl.abort();
  await assert.rejects(run, { name: 'AbortError' });
});

test('the sets are frozen with the caps from the spec', () => {
  assert.ok(Object.isFrozen(FACILITY_SETS));
  assert.ok(Object.isFrozen(FACILITY_SETS.health));
  assert.equal(FACILITY_SETS.health.maxBytes, 8 * 1024 * 1024);
  assert.equal(FACILITY_SETS.schools.maxBytes, 4 * 1024 * 1024);
});
