import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saElectionsProxy } from './index.js';
import {
  IEC_PROVINCES,
  provinceCsvUrl,
  seatFileUrl,
  headProvince,
  streamProvince,
  fetchSeatFile,
} from './iec.js';
import { buildXls } from './testWorkbook.mjs';

// Everything below is synthetic: made-up councils, wards, votes and seat files.
const ANC = 'AFRICAN NATIONAL CONGRESS';
const DA = 'DEMOCRATIC ALLIANCE';
const EFF = 'ECONOMIC FREEDOM FIGHTERS';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 23, 6, 0, 0);
const LM = Date.UTC(2026, 10, 7, 9, 30, 0);
const ON = { SA_ELECTIONS_RESULTS: '1' };
const IEC_HOST = 'results.elections.org.za';
const MDB_HOST = 'services7.arcgis.com';
const UA = 'GodsEyeView (sa-elections)';
const HEADER =
  'Province,Municipality,Ward,VotingDistrict,VotingStationName,RegisteredVoters,BallotType,SpoiltVotes,PartyName,TotalValidVotes,DateGenerated';

// One council per province (GP has six), two wards each. Ward ids are 8 digits:
// 10 + province index, then council number and ward number.
const pad3 = (n) => String(n).padStart(3, '0');
const COUNCILS = Object.fromEntries(
  IEC_PROVINCES.map((code, p) => [
    code,
    Array.from({ length: code === 'GP' ? 6 : 1 }, (_, c) => ({
      code,
      catB: `${code}${pad3(c + 1)}`,
      wards: [1, 2].map((w) => `${10 + p}${pad3(c + 1)}${pad3(w)}`),
    })),
  ]),
);
const ALL_COUNCILS = Object.values(COUNCILS).flat();
const VOTES = {
  ward1: [
    [ANC, 60],
    [DA, 40],
  ],
  ward2: [
    [DA, 70],
    [EFF, 30],
  ],
  pr: [
    [ANC, 100],
    [DA, 110],
    [EFF, 30],
  ],
};

/** A province CSV: BOM, CRLF or LF by province, no final line terminator. */
function provinceCsv(code, votes = {}) {
  const eol = IEC_PROVINCES.indexOf(code) % 2 ? '\n' : '\r\n';
  const lines = [HEADER];
  for (const { catB, wards } of COUNCILS[code]) {
    const v = { ...VOTES, ...votes[catB] };
    const row = (ward, ballot, party, n) =>
      [
        code,
        `${catB} - TOWN ${catB}`,
        `Ward ${ward}`,
        `${ward}1`,
        '"Saal, Ëlandsfontein"',
        100,
        ballot,
        1,
        party,
        n,
        '2026/11/07',
      ].join(',');
    for (const [party, n] of v.ward1)
      lines.push(row(wards[0], 'Ward', party, n));
    for (const [party, n] of v.ward2)
      lines.push(row(wards[1], 'Ward', party, n));
    v.pr.forEach(([party, n], i) =>
      lines.push(row(wards[i % 2], 'PR', party, n)),
    );
    lines.push(row(wards[0], 'DC 40%', ANC, 999));
  }
  return `﻿${lines.join(eol)}`;
}

/** A seat workbook laid out like the IEC's; parties are [name, seats, ward seats, PR seats]. */
function seatXls(
  parties = [
    [DA, 2, 1, 1],
    [ANC, 1, 1, 0],
    [EFF, 1, 0, 1],
  ],
  independents = 0,
) {
  const total = parties.reduce((sum, p) => sum + p[1], 0);
  return buildXls([
    [
      ['Seat Calculation Detail'],
      ['Total Seats Available in Municipality - (B)', null, null, total],
      ['Independent Ward Councillors Elected - (C)', null, null, independents],
      [],
      [
        null,
        'Party Name',
        'Total Party Seats (x)',
        'Ward Seats (y)',
        'PR List Seats (x-y)',
      ],
      ...parties.map(([name, seats, ward, pr]) => [
        null,
        name,
        seats,
        ward,
        pr,
      ]),
      [null, 'Total Party Seats', total, null, null],
    ],
  ]);
}

const square = [
  [
    [28, -26],
    [28.1, -26],
    [28.1, -26.1],
    [28, -26],
  ],
];
function boundaryPage(level) {
  const geometry = { type: 'Polygon', coordinates: square };
  const features =
    level === 'wards'
      ? ALL_COUNCILS.flatMap(({ catB, wards }) =>
          wards.map((id, i) => ({
            type: 'Feature',
            properties: {
              WardID: Number(id),
              CAT_B: catB,
              WardNo: i + 1,
              MUNICNAME: `Town ${catB}`,
              Province: 'Test',
            },
            geometry,
          })),
        )
      : [...ALL_COUNCILS.map(({ catB }) => catB), 'ZZ999'].map((catB) => ({
          type: 'Feature',
          properties: {
            CAT_B: catB,
            MUNICNAME: `Town ${catB}`,
            PROVINCE: 'Test',
            CATEGORY: 'B',
          },
          geometry,
        }));
  return { type: 'FeatureCollection', features };
}

/** Fake MDB and IEC. Records every call and the peak number of open CSV and seat downloads. */
function upstream({ gate } = {}) {
  const up = {
    calls: [],
    lastModified: Object.fromEntries(IEC_PROVINCES.map((c) => [c, LM])),
    votes: {},
    seats: {},
    csvStatus: {},
    csvBreak: {},
    csvHold: {},
    mdbStatus: 200,
    open: { csv: 0, seat: 0 },
    peak: { csv: 0, seat: 0 },
  };
  const tracked = (kind, bytes, chunk, breakAfterFirst = false) => {
    up.open[kind] += 1;
    up.peak[kind] = Math.max(up.peak[kind], up.open[kind]);
    let at = 0;
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        up.open[kind] -= 1;
      }
    };
    return new ReadableStream({
      async pull(controller) {
        await new Promise((resolve) => setImmediate(resolve));
        if (breakAfterFirst && at > 0) {
          finish();
          controller.error(new Error('connection reset'));
          return;
        }
        if (at >= bytes.length) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(at, at + chunk));
        at += chunk;
      },
      cancel: finish,
    });
  };
  up.fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw);
    const method = init.method ?? 'GET';
    up.calls.push({ url, method });
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers?.['User-Agent'], UA);
    assert.ok(init.signal instanceof AbortSignal);
    if (url.hostname === MDB_HOST) {
      if (up.mdbStatus !== 200)
        return new Response('down', { status: up.mdbStatus });
      return Response.json(
        boundaryPage(url.pathname.includes('Wards') ? 'wards' : 'councils'),
      );
    }
    assert.equal(url.hostname, IEC_HOST);
    if (gate) await gate;
    const csv =
      /^\/home\/LGEPublicReports\/1887\/Downloadable%20Party%20Results\/([A-Z]{2})\.csv$/.exec(
        url.pathname,
      );
    if (csv) {
      const code = csv[1];
      const headers = {
        'Last-Modified': new Date(up.lastModified[code]).toUTCString(),
      };
      if (method === 'HEAD') return new Response(null, { headers });
      if (up.csvHold[code]) await up.csvHold[code];
      if (up.csvStatus[code])
        return new Response('nope', { status: up.csvStatus[code] });
      const bytes = new TextEncoder().encode(provinceCsv(code, up.votes));
      return new Response(tracked('csv', bytes, 97, up.csvBreak[code]), {
        headers,
      });
    }
    const seat =
      /^\/home\/LGEPublicReports\/1887\/Seat%20Calculation%20Detail\/([A-Z]{2})\/([A-Z0-9]+)\.xls$/.exec(
        url.pathname,
      );
    assert.ok(seat, `unexpected IEC path ${url.pathname}`);
    assert.equal(method, 'GET');
    const [, code, catB] = seat;
    assert.ok(
      COUNCILS[code].some((c) => c.catB === catB),
      `${catB} is not a council of ${code}`,
    );
    const answer = up.seats[catB] ?? seatXls();
    if (typeof answer === 'number')
      return new Response('missing', { status: answer });
    return new Response(tracked('seat', answer, 512));
  };
  return up;
}

/** An fs.promises stand-in that records which paths each call touched. */
function recordingFs() {
  const ops = [];
  const impl = {};
  for (const name of [
    'readFile',
    'writeFile',
    'appendFile',
    'rename',
    'mkdir',
    'rm',
    'unlink',
    'open',
    'copyFile',
    'truncate',
  ]) {
    impl[name] = (...args) => {
      ops.push({
        name,
        paths: name === 'rename' ? args.slice(0, 2) : [args[0]],
      });
      return fs.promises[name](...args);
    };
  }
  return { impl, ops };
}

let peers = 0;
function install(options) {
  const plugin = saElectionsProxy(options);
  assert.equal(plugin.name, 'sa-elections');
  const handlers = {};
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    plugin[hook]({
      middlewares: {
        use(mount, handler) {
          assert.equal(mount, '/api/sa-elections');
          handlers[hook] = handler;
        },
      },
    });
  }
  return async (
    url = '/councils',
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
}

const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));
// Polls back off to 20 ms, so a slow machine waits up to ~5 s with at most 300 requests:
// under the frozen test clock every poll counts toward the 600-per-minute global quota.
async function until(check, label) {
  for (let i = 0; i < 300; i++) {
    const value = await check();
    if (value) return value;
    await tick(Math.min(20, 2 + i));
  }
  throw new Error(`timed out waiting for ${label}`);
}
async function settle() {
  for (let i = 0; i < 25; i++) await tick();
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const byId = (res) => Object.fromEntries(res.body.areas.map((a) => [a.id, a]));
const iecCalls = (calls) => calls.filter((c) => c.url.hostname === IEC_HOST);
const untilResults = (request, status, url = '/councils') =>
  until(async () => {
    const res = await request(url);
    return res.body.results === status && res;
  }, `results ${status}`);

async function setup(t, { env = ON, gate, fsImpl } = {}) {
  const cacheDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'gev-sa-elections-'),
  );
  t.after(() => fs.promises.rm(cacheDir, { recursive: true, force: true }));
  const up = upstream({ gate });
  const clock = { now: T0 };
  const request = install({
    fetchImpl: up.fetchImpl,
    now: () => clock.now,
    cacheDir,
    env,
    ...(fsImpl ? { fsImpl } : {}),
  });
  return { up, clock, cacheDir, request };
}

// ---------------------------------------------------------------- iec.js

test('IEC URLs follow the published patterns with spaces encoded', () => {
  assert.deepEqual(IEC_PROVINCES, [
    'EC',
    'FS',
    'GP',
    'KN',
    'NP',
    'MP',
    'NW',
    'NC',
    'WP',
  ]);
  assert.equal(
    provinceCsvUrl('WP'),
    'https://results.elections.org.za/home/LGEPublicReports/1887/Downloadable%20Party%20Results/WP.csv',
  );
  assert.equal(
    seatFileUrl('WP', 'CPT'),
    'https://results.elections.org.za/home/LGEPublicReports/1887/Seat%20Calculation%20Detail/WP/CPT.xls',
  );
  assert.equal(seatFileUrl('KN', 'KZN212').endsWith('/KN/KZN212.xls'), true);
  assert.throws(() => provinceCsvUrl('XX'), /unknown_province/);
  for (const bad of ['../GP', 'cpt', 'DC1', '__proto__', ''])
    assert.throws(() => seatFileUrl('WP', bad), /unknown_council/, bad);
});

test('headProvince returns Last-Modified in milliseconds, or null without one', async () => {
  const seen = [];
  const lastModified = await headProvince('NC', {
    fetchImpl: async (url, init) => {
      seen.push([url, init.method, init.redirect, init.headers['User-Agent']]);
      return new Response(null, {
        headers: { 'Last-Modified': new Date(LM).toUTCString() },
      });
    },
  });
  assert.equal(lastModified, LM);
  assert.deepEqual(seen, [[provinceCsvUrl('NC'), 'HEAD', 'error', UA]]);
  assert.equal(
    await headProvince('NC', { fetchImpl: async () => new Response(null) }),
    null,
  );
  await assert.rejects(
    headProvince('NC', {
      fetchImpl: async () => new Response(null, { status: 404 }),
    }),
    /upstream_unavailable/,
  );
});

test('streamProvince parses a body split mid-line, mid-CRLF and mid-character', async () => {
  for (const eol of ['\r\n', '\n']) {
    const row = (ballot, party, votes) =>
      [
        'WP',
        'WP001 - TOWN',
        'Ward 18001001',
        '1',
        '"Saal, Kaap"',
        100,
        ballot,
        1,
        party,
        votes,
        'x',
      ].join(',');
    const text = `﻿${[HEADER, row('Ward', '"PARTI ÉÈ, KAAP"', 5), row('Ward', DA, 7), row('PR', DA, 9)].join(eol)}`;
    const bytes = new TextEncoder().encode(text);
    const calls = [];
    // One byte per chunk: every split point, including inside "\r\n" and inside "É".
    const tally = await streamProvince('WP', {
      fetchImpl: async (url, init) => {
        calls.push([
          url,
          init.method ?? 'GET',
          init.redirect,
          init.headers['User-Agent'],
        ]);
        let at = 0;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (at >= bytes.length) controller.close();
              else controller.enqueue(bytes.slice(at, ++at));
            },
          }),
        );
      },
    });
    assert.deepEqual(calls, [[provinceCsvUrl('WP'), 'GET', 'error', UA]]);
    const ward = tally.wards.get('18001001');
    assert.deepEqual(
      [...ward.votes],
      [
        ['PARTI ÉÈ, KAAP', 5],
        [DA, 7],
      ],
    );
    assert.equal(ward.registered, 100);
    assert.deepEqual(
      [...tally.councils.get('WP001').prVotes],
      [[DA, 9]],
      JSON.stringify(eol),
    );
  }
});

test('streamProvince stops past 80 MiB and cancels the download', async () => {
  const MIB = 1024 * 1024;
  const filler = new TextEncoder().encode(
    `${'x'.repeat(64 * 1024 - 1)}\n`.repeat(16),
  );
  assert.equal(filler.byteLength, MIB);
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${HEADER}\n`));
    },
    pull(controller) {
      if (sent >= 120) return controller.close();
      sent += 1;
      controller.enqueue(filler);
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    streamProvince('GP', { fetchImpl: async () => new Response(body) }),
    {
      code: 'RESPONSE_TOO_LARGE',
    },
  );
  assert.equal(cancelled, true);
  assert.ok(sent < 90, `read ${sent} MiB`);
  let declaredCancelled = false;
  const declared = new Response(
    new ReadableStream({
      cancel() {
        declaredCancelled = true;
      },
    }),
    { headers: { 'Content-Length': String(80 * MIB + 1) } },
  );
  await assert.rejects(
    streamProvince('GP', { fetchImpl: async () => declared }),
    { code: 'RESPONSE_TOO_LARGE' },
  );
  assert.equal(declaredCancelled, true);
});

test('streamProvince gives up when the caller aborts, and on a bad header', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const endless = new ReadableStream({
    pull(c) {
      c.enqueue(new TextEncoder().encode(`${HEADER}\n`));
      controller.abort();
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    streamProvince('EC', {
      fetchImpl: async () => new Response(endless),
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    streamProvince('EC', {
      fetchImpl: async () => new Response('not,the,header\n1,2,3\n'),
    }),
    /csv_header/,
  );
  await assert.rejects(
    streamProvince('EC', {
      fetchImpl: async () => new Response('gone', { status: 404 }),
    }),
    /upstream_unavailable/,
  );
});

test('fetchSeatFile reads at most 1 MiB', async () => {
  const bytes = seatXls();
  const seen = [];
  const got = await fetchSeatFile('WP', 'WP001', {
    fetchImpl: async (url, init) => {
      seen.push([url, init.redirect, init.headers['User-Agent']]);
      return new Response(bytes);
    },
  });
  assert.deepEqual(new Uint8Array(got), new Uint8Array(bytes));
  assert.deepEqual(seen, [[seatFileUrl('WP', 'WP001'), 'error', UA]]);
  await assert.rejects(
    fetchSeatFile('WP', 'WP001', {
      fetchImpl: async () => new Response(new Uint8Array(1024 * 1024 + 1)),
    }),
    { code: 'RESPONSE_TOO_LARGE' },
  );
});

// ---------------------------------------------------------------- the provider

test('with the switch off it serves boundaries only and never calls the IEC', async (t) => {
  const { up, request } = await setup(t, { env: {} });
  for (const level of ['councils', 'wards']) {
    const res = await request(`/${level}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.level, level);
    assert.equal(res.body.results, 'off');
    assert.equal(res.body.resultsAsOf, null);
    assert.equal(res.body.boundariesAsOf, T0);
    assert.equal(
      res.body.areas.length,
      level === 'wards' ? ALL_COUNCILS.length * 2 : ALL_COUNCILS.length + 1,
    );
    assert.ok(res.body.areas.every((a) => a.result === null));
  }
  await settle();
  assert.equal(
    up.calls.filter((c) => c.url.href.includes('elections.org.za')).length,
    0,
  );
  assert.equal(up.calls.length, 2);
});

test('nothing is fetched until the first request', async (t) => {
  const fsr = recordingFs();
  const { up, request } = await setup(t, { fsImpl: fsr.impl });
  await settle();
  assert.equal(up.calls.length, 0);
  assert.deepEqual(fsr.ops, []);
  const res = await request('/wards');
  assert.equal(res.status, 200);
  assert.ok(up.calls.some((c) => c.url.hostname === MDB_HOST));
  assert.ok(fsr.ops.some((op) => op.name === 'readFile'));
  await untilResults(request, 'ok', '/wards');
});

test('first request answers loading, then ok with council and ward results joined', async (t) => {
  const gate = deferred();
  const { up, request, cacheDir } = await setup(t, { gate: gate.promise });
  const first = await request('/councils');
  assert.equal(first.status, 200);
  assert.equal(first.body.results, 'loading');
  assert.equal(first.body.resultsAsOf, null);
  assert.ok(first.body.areas.every((a) => a.result === null));
  gate.resolve();

  const done = await untilResults(request, 'ok');
  assert.equal(done.body.resultsAsOf, LM);
  assert.equal(done.headers['X-Data-Stale'], undefined);
  const councils = byId(done);
  const wp = councils.WP001.result;
  assert.deepEqual(wp.largest, { party: DA, seats: 2 });
  assert.equal(wp.totalSeats, 4);
  assert.equal(wp.majority, false);
  assert.equal(wp.seatCheck, 'ok');
  assert.deepEqual(
    wp.parties.map((p) => [p.party, p.seats]),
    [
      [DA, 2],
      [ANC, 1],
      [EFF, 1],
    ],
  );
  assert.equal(councils.WP001.name, 'Town WP001');
  assert.equal(
    councils.ZZ999.result,
    null,
    'an area the IEC does not list has no result',
  );
  assert.ok(
    ALL_COUNCILS.every(({ catB }) => councils[catB].result?.seatCheck === 'ok'),
  );

  const wards = byId(await request('/wards'));
  const [w1, w2] = COUNCILS.WP[0].wards;
  assert.equal(wards[w1].result.winner.party, ANC);
  assert.equal(wards[w1].result.winner.share, 0.6);
  assert.equal(wards[w1].result.runnerUp.party, DA);
  assert.equal(wards[w1].result.confirmed, true);
  assert.equal(wards[w2].result.winner.party, DA);
  assert.equal(wards[w2].wardNo, 2);

  // At most 2 provinces and 4 seat files at a time; GP alone has six councils.
  assert.equal(up.peak.csv, 2);
  assert.equal(up.peak.seat, 4);
  const gets = iecCalls(up.calls).filter((c) => c.method === 'GET');
  assert.equal(gets.filter((c) => c.url.pathname.endsWith('.csv')).length, 9);
  assert.deepEqual(
    gets
      .filter((c) => c.url.pathname.endsWith('.xls'))
      .map((c) => c.url.pathname.split('/').slice(-2).join('/'))
      .sort(),
    ALL_COUNCILS.map(({ code, catB }) => `${code}/${catB}.xls`).sort(),
  );

  const saved = JSON.parse(
    await fs.promises.readFile(path.join(cacheDir, 'results.json'), 'utf8'),
  );
  assert.equal(saved.version, 1);
  assert.deepEqual(
    Object.keys(saved.provinces).sort(),
    [...IEC_PROVINCES].sort(),
  );
  assert.equal(saved.provinces.WP.lastModified, LM);
  assert.equal(saved.provinces.WP.councils.WP001.seatCheck, 'ok');
  assert.equal(saved.provinces.WP.wards[w1].winner.party, ANC);
});

test('provinces are served as they land while the first run is still loading', async (t) => {
  const hold = deferred();
  const { up, request } = await setup(t);
  up.csvHold.GP = hold.promise;
  await request('/councils');
  const partial = await until(async () => {
    const res = await request('/councils');
    return byId(res).WP001.result !== null && res;
  }, 'WP before GP');
  assert.equal(partial.body.results, 'loading');
  assert.equal(byId(partial).GP001.result, null);
  hold.resolve();
  const done = byId(await untilResults(request, 'ok'));
  assert.equal(done.GP001.result.seatCheck, 'ok');
});

test('a failed province keeps its previous results and marks the answer stale', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { up, clock, request } = await setup(t);
  await request('/councils');
  const before = byId(await untilResults(request, 'ok'));

  up.lastModified.NC = LM + DAY;
  up.csvStatus.NC = 404;
  clock.now += DAY + 1;
  await request('/councils');
  const stale = await untilResults(request, 'stale');
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  const after = byId(stale);
  assert.deepEqual(after.NC001.result, before.NC001.result);
  assert.ok(ALL_COUNCILS.every(({ catB }) => after[catB].result !== null));
  assert.equal(stale.body.resultsAsOf, LM);
  assert.ok(warn.mock.calls.some((c) => String(c.arguments[0]).includes('NC')));
});

const callTail = (c) =>
  `${c.method} ${c.url.pathname.split('/').slice(-2).join('/')}`;

test('a province that breaks off on the first run leaves only its own areas without results', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { up, clock, request } = await setup(t);
  up.csvBreak.KN = true;
  await request('/councils');
  const councils = byId(await untilResults(request, 'stale'));
  assert.equal(councils.KN001.result, null);
  assert.ok(
    ALL_COUNCILS.filter((c) => c.code !== 'KN').every(
      ({ catB }) => councils[catB].result !== null,
    ),
  );

  // The missing province is retried an hour after the failure, alone, and reads loading meanwhile.
  const mark = up.calls.length;
  clock.now += HOUR - 1;
  await request('/councils');
  await settle();
  assert.equal(up.calls.length, mark, 'no retry within the hour');
  up.csvBreak = {};
  clock.now += 2;
  assert.equal((await request('/councils')).body.results, 'loading');
  assert.ok(byId(await untilResults(request, 'ok')).KN001.result);
  await settle();
  assert.deepEqual(up.calls.slice(mark).map(callTail).sort(), [
    'GET Downloadable%20Party%20Results/KN.csv',
    'GET KN/KN001.xls',
    'HEAD Downloadable%20Party%20Results/KN.csv',
  ]);
});

test('a cache missing some provinces fetches only those, and reads loading meanwhile', async (t) => {
  const first = await setup(t);
  await first.request('/councils');
  await untilResults(first.request, 'ok');
  const file = path.join(first.cacheDir, 'results.json');
  const saved = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  delete saved.provinces.KN;
  delete saved.provinces.WP;
  await fs.promises.writeFile(file, JSON.stringify(saved));

  // A restart an hour later, with KN's download held back.
  const hold = deferred();
  const up = upstream();
  up.csvHold.KN = hold.promise;
  const request = install({
    fetchImpl: up.fetchImpl,
    now: () => T0 + HOUR,
    cacheDir: first.cacheDir,
    env: ON,
  });
  const res = await request('/councils');
  assert.equal(res.body.results, 'loading');
  assert.equal(
    byId(res).EC001.result.seatCheck,
    'ok',
    'cached provinces are served at once',
  );
  assert.equal(byId(res).KN001.result, null);
  const partial = await until(async () => {
    const r = await request('/councils');
    return byId(r).WP001.result !== null && r;
  }, 'WP filled in');
  assert.equal(partial.body.results, 'loading');
  hold.resolve();
  assert.equal(
    byId(await untilResults(request, 'ok')).KN001.result.seatCheck,
    'ok',
  );
  await settle();
  assert.deepEqual(up.calls.map(callTail).sort(), [
    'GET Downloadable%20Party%20Results/KN.csv',
    'GET Downloadable%20Party%20Results/WP.csv',
    'GET KN/KN001.xls',
    'GET WP/WP001.xls',
    'HEAD Downloadable%20Party%20Results/KN.csv',
    'HEAD Downloadable%20Party%20Results/WP.csv',
  ]);
});

test('a seat file that failed is fetched again on the next daily check', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { up, clock, request, cacheDir } = await setup(t);
  up.seats.NC001 = 404;
  up.seats.FS001 = 503;
  await request('/councils');
  const before = byId(await untilResults(request, 'ok'));
  assert.equal(before.NC001.result.seatCheck, 'unchecked');
  assert.equal(before.FS001.result.seatCheck, 'unchecked');

  // Same Last-Modified everywhere. NC's file now reads cleanly; FS's disagrees with its wards.
  const mark = up.calls.length;
  delete up.seats.NC001;
  up.seats.FS001 = seatXls([
    [DA, 3, 2, 1],
    [ANC, 1, 0, 1],
  ]);
  clock.now += DAY + 1;
  await request('/councils');
  const after = await until(async () => {
    const res = await request('/councils');
    const c = byId(res);
    return (
      c.NC001.result.seatCheck !== 'unchecked' &&
      c.FS001.result.seatCheck !== 'unchecked' &&
      res
    );
  }, 'seat files retried');
  await settle();
  const councils = byId(after);
  assert.equal(councils.NC001.result.seatCheck, 'ok');
  assert.equal(councils.NC001.result.totalSeats, 4);
  assert.deepEqual(councils.NC001.result.largest, { party: DA, seats: 2 });
  assert.equal(councils.FS001.result.seatCheck, 'mismatch');
  assert.equal(after.body.results, 'ok');
  const wards = byId(await request('/wards'));
  for (const id of COUNCILS.NC[0].wards)
    assert.equal(wards[id].result.confirmed, true, id);
  for (const id of COUNCILS.FS[0].wards)
    assert.equal(wards[id].result.confirmed, false, id);
  assert.equal(wards[COUNCILS.FS[0].wards[0]].result.winner.party, ANC);

  const later = up.calls.slice(mark).filter((c) => c.url.hostname === IEC_HOST);
  assert.equal(later.filter((c) => c.method === 'HEAD').length, 9);
  assert.deepEqual(
    later
      .filter((c) => c.method === 'GET')
      .map(callTail)
      .sort(),
    ['GET FS/FS001.xls', 'GET NC/NC001.xls'],
  );
  const saved = JSON.parse(
    await fs.promises.readFile(path.join(cacheDir, 'results.json'), 'utf8'),
  );
  assert.equal(saved.provinces.NC.councils.NC001.seatCheck, 'ok');
  assert.equal(
    saved.provinces.FS.wards[COUNCILS.FS[0].wards[0]].confirmed,
    false,
  );

  // Nothing is left to retry, so the next day's check is HEADs only.
  const quiet = up.calls.length;
  clock.now += DAY + 1;
  await request('/councils');
  await until(
    () => up.calls.slice(quiet).filter((c) => c.method === 'HEAD').length === 9,
    'nine HEADs',
  );
  await settle();
  assert.ok(up.calls.slice(quiet).every((c) => c.method === 'HEAD'));
});

test('with no results at all a failed run answers failed and retries after an hour', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { up, clock, request } = await setup(t);
  for (const code of IEC_PROVINCES) up.csvStatus[code] = 503;
  await request('/councils');
  const failed = await untilResults(request, 'failed');
  assert.equal(failed.body.resultsAsOf, null);
  assert.ok(failed.body.areas.every((a) => a.result === null));

  const mark = up.calls.length;
  clock.now += HOUR - 1;
  await request('/councils');
  await settle();
  assert.equal(up.calls.length, mark, 'no retry within the hour');

  up.csvStatus = {};
  clock.now += 2;
  assert.equal((await request('/councils')).body.results, 'loading');
  await untilResults(request, 'ok');
});

test('an unchanged Last-Modified does not download again', async (t) => {
  const { up, clock, request } = await setup(t);
  await request('/councils');
  await untilResults(request, 'ok');
  const mark = up.calls.length;

  clock.now += DAY - 1;
  await request('/councils');
  await settle();
  assert.equal(up.calls.length, mark, 'no check within a day');

  clock.now += 2;
  await request('/councils');
  await until(
    () => up.calls.slice(mark).filter((c) => c.method === 'HEAD').length === 9,
    'nine HEADs',
  );
  await settle();
  const later = up.calls.slice(mark);
  assert.equal(later.length, 9);
  assert.ok(
    later.every((c) => c.method === 'HEAD' && c.url.hostname === IEC_HOST),
  );
  assert.equal((await request('/councils')).body.results, 'ok');
});

test('a changed Last-Modified re-reads only that province', async (t) => {
  const { up, clock, request } = await setup(t);
  await request('/wards');
  await untilResults(request, 'ok', '/wards');
  const mark = up.calls.length;
  const [w1] = COUNCILS.WP[0].wards;
  const [e1] = COUNCILS.EC[0].wards;

  up.lastModified.WP = LM + DAY;
  up.votes.WP001 = {
    ward1: [
      [ANC, 80],
      [DA, 20],
    ],
  };
  clock.now += DAY + 1;
  await request('/wards');
  const updated = await until(async () => {
    const res = await request('/wards');
    return byId(res)[w1].result?.winner.share === 0.8 && res;
  }, 'WP re-read');
  await settle();
  assert.equal(updated.body.resultsAsOf, LM + DAY);
  assert.equal(byId(updated)[e1].result.winner.share, 0.6);
  const later = up.calls.slice(mark);
  assert.equal(later.filter((c) => c.method === 'HEAD').length, 9);
  assert.deepEqual(
    later
      .filter((c) => c.method === 'GET')
      .map((c) => c.url.pathname.split('/').slice(-2).join('/')),
    ['Downloadable%20Party%20Results/WP.csv', 'WP/WP001.xls'],
  );
});

test('results are replaced by rename, never written in place', async (t) => {
  const fsr = recordingFs();
  const { up, clock, request, cacheDir } = await setup(t, { fsImpl: fsr.impl });
  await request('/councils');
  await untilResults(request, 'ok');
  up.lastModified.EC = LM + DAY;
  clock.now += DAY + 1;
  await request('/councils');
  await until(
    async () => (await request('/councils')).body.resultsAsOf === LM + DAY,
    'EC re-read',
  );
  await settle();

  const target = path.join(cacheDir, 'results.json');
  const written = new Set();
  for (const op of fsr.ops) {
    if (op.name === 'readFile' || op.name === 'mkdir') continue;
    if (op.name === 'rename') {
      assert.ok(
        written.has(op.paths[0]),
        `renames only a temp file it wrote: ${op.paths[0]}`,
      );
      assert.equal(path.dirname(op.paths[1]), cacheDir);
      continue;
    }
    assert.equal(op.name, 'writeFile', `unexpected ${op.name}`);
    const [file] = op.paths;
    assert.equal(path.dirname(file), cacheDir);
    assert.match(path.basename(file), /\.tmp$/);
    assert.notEqual(file, target);
    written.add(file);
  }
  const intoResults = fsr.ops.filter(
    (op) => op.name === 'rename' && op.paths[1] === target,
  );
  assert.ok(
    intoResults.length >= 2,
    `results.json renamed into place ${intoResults.length} times`,
  );
  assert.deepEqual((await fs.promises.readdir(cacheDir)).sort(), [
    'boundaries-councils.json',
    'results.json',
  ]);
  const saved = JSON.parse(await fs.promises.readFile(target, 'utf8'));
  assert.equal(saved.provinces.EC.lastModified, LM + DAY);
});

test('a council with a mismatched seat check marks its wards unconfirmed', async (t) => {
  const { up, request } = await setup(t);
  // The votes give ANC one ward and DA one; this seat file says DA won both.
  up.seats.WP001 = seatXls([
    [DA, 3, 2, 1],
    [ANC, 1, 0, 1],
  ]);
  await request('/councils');
  const councils = byId(await untilResults(request, 'ok'));
  assert.equal(councils.WP001.result.seatCheck, 'mismatch');
  assert.equal(councils.EC001.result.seatCheck, 'ok');
  const wards = byId(await request('/wards'));
  const [w1, w2] = COUNCILS.WP[0].wards;
  assert.equal(wards[w1].result.confirmed, false);
  assert.equal(wards[w2].result.confirmed, false);
  assert.equal(
    wards[w1].result.winner.party,
    ANC,
    'the vote-based winner still stands',
  );
  for (const id of COUNCILS.EC[0].wards)
    assert.equal(wards[id].result.confirmed, true);
});

test('a seat file that cannot be read leaves only that council unchecked', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { up, request } = await setup(t);
  up.seats.NC001 = 404;
  up.seats.FS001 = new Uint8Array([1, 2, 3]);
  await request('/councils');
  const councils = byId(await untilResults(request, 'ok'));
  for (const id of ['NC001', 'FS001']) {
    assert.equal(councils[id].result.seatCheck, 'unchecked', id);
    assert.equal(councils[id].result.totalSeats, null, id);
    assert.ok(councils[id].result.parties.length > 0, id);
  }
  assert.equal(councils.WP001.result.seatCheck, 'ok');
  const logged = warn.mock.calls.map((c) => String(c.arguments[0]));
  assert.equal(logged.filter((m) => m.includes('NC/NC001')).length, 1);
  assert.equal(logged.filter((m) => m.includes('FS/FS001')).length, 1);
});

test('a restart serves the cached copy and only checks Last-Modified', async (t) => {
  const first = await setup(t);
  await first.request('/councils');
  await untilResults(first.request, 'ok');

  const up = upstream();
  const request = install({
    fetchImpl: up.fetchImpl,
    now: () => T0 + HOUR,
    cacheDir: first.cacheDir,
    env: ON,
  });
  const res = await request('/councils');
  assert.equal(res.body.results, 'ok');
  assert.equal(res.body.boundariesAsOf, T0);
  assert.equal(byId(res).WP001.result.seatCheck, 'ok');
  await until(() => up.calls.length === 9, 'nine HEADs');
  await settle();
  assert.equal(up.calls.length, 9);
  assert.ok(up.calls.every((c) => c.method === 'HEAD'));
});

test('an unreadable or empty cache file counts as absent', async (t) => {
  const { up, request, cacheDir } = await setup(t);
  await fs.promises.writeFile(
    path.join(cacheDir, 'results.json'),
    '{"version":1,"provinces":',
  );
  await fs.promises.writeFile(
    path.join(cacheDir, 'boundaries-councils.json'),
    JSON.stringify({ version: 1, fetchedAt: T0, areas: [] }),
  );
  const res = await request('/councils');
  assert.equal(res.status, 200);
  assert.equal(res.body.results, 'loading');
  assert.equal(res.body.areas.length, ALL_COUNCILS.length + 1);
  assert.ok(up.calls.some((c) => c.url.hostname === MDB_HOST));
  await untilResults(request, 'ok');
});

test('without any boundaries it answers 502, and retries after a minute', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { up, clock, request } = await setup(t, { env: {} });
  up.mdbStatus = 503;
  const res = await request('/councils');
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'sa_elections_unavailable' });
  const mark = up.calls.length;
  assert.equal((await request('/councils')).status, 502);
  assert.equal(up.calls.length, mark, 'no retry within a minute');
  up.mdbStatus = 200;
  clock.now += 60_001;
  assert.equal((await request('/councils')).status, 200);
});

test('boundaries are refreshed after a week, and a failed refresh keeps the last good copy', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { up, clock, request, cacheDir } = await setup(t, { env: {} });
  assert.equal((await request('/councils')).body.boundariesAsOf, T0);

  up.mdbStatus = 503;
  clock.now += 7 * DAY + 1;
  const old = await request('/councils');
  assert.equal(old.status, 200);
  assert.equal(old.body.boundariesAsOf, T0);
  await until(() => up.calls.length === 2, 'background refresh');
  await settle();
  const kept = await request('/councils');
  assert.equal(kept.body.boundariesAsOf, T0);
  assert.equal(kept.headers['X-Data-Stale'], 'true');
  assert.equal(up.calls.length, 2, 'a failed refresh waits an hour');

  up.mdbStatus = 200;
  clock.now += HOUR;
  await request('/councils');
  await until(
    async () => (await request('/councils')).body.boundariesAsOf === clock.now,
    'refreshed',
  );
  const saved = JSON.parse(
    await fs.promises.readFile(
      path.join(cacheDir, 'boundaries-councils.json'),
      'utf8',
    ),
  );
  assert.equal(saved.fetchedAt, clock.now);
});

test('refuses unknown paths, other methods and rate-limited clients', async (t) => {
  const fsr = recordingFs();
  const { up, request } = await setup(t, { env: {}, fsImpl: fsr.impl });
  const post = await request('/councils', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  for (const url of ['/', '/nope', '/councils/extra', '/wards/../councils'])
    assert.equal((await request(url)).status, 404, url);
  const crossSite = await request('/councils', {
    headers: {
      host: 'localhost:5173',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
  });
  assert.equal(crossSite.status, 403);
  assert.equal(up.calls.length, 0, 'refusals reach no upstream');
  assert.deepEqual(fsr.ops, [], 'refusals touch no file');

  let last;
  for (let i = 0; i < 61; i++)
    last = await request('/councils', {
      peer: '10.0.0.9',
      hook: 'configurePreviewServer',
    });
  assert.equal(last.status, 429);
  assert.equal(last.headers['Retry-After'], '60');
  assert.equal(last.body.error, 'rate_limited');
  assert.equal((await request('/councils', { peer: '10.0.0.10' })).status, 200);
});
