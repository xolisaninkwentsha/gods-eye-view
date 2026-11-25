import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SA_NEWS_KINDS,
  normalizeSaNews,
  placeStories,
  spiralOffsets,
} from './records.js';

const story = (over = {}) => ({
  id: 's1',
  kind: 'protest',
  title: 'Synthetic protest in town',
  url: 'https://example.org/a',
  source: 'Example Outlet',
  publishedAt: 1_700_000_000_000,
  place: 'Sampleville',
  lat: -26.2,
  lon: 28.04,
  via: ['rss'],
  ...over,
});
const norm = (stories, extra = {}) =>
  normalizeSaNews({ stories, status: null, ...extra });

test('the four kinds carry the fixed colours', () => {
  assert.deepEqual(
    SA_NEWS_KINDS.map((k) => [k.key, k.color]),
    [
      ['violence', '#eb5757'],
      ['protest', '#f2994a'],
      ['event', '#8fa6bf'],
      ['headline', '#2bb3a3'],
    ],
  );
  assert.deepEqual(
    SA_NEWS_KINDS.map((k) => k.label),
    ['Violence', 'Protest', 'Other event', 'Headline'],
  );
});

test('a good story is kept and via defaults to an empty array', () => {
  const out = norm([story({ via: undefined })]);
  assert.equal(out.stories.length, 1);
  assert.deepEqual(out.stories[0].via, []);
  assert.equal(out.stories[0].url, 'https://example.org/a');
});

test('hostile, relative or malformed links are dropped', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    '/relative/path',
    'ftp://example.org/x',
    '',
    null,
  ])
    assert.equal(norm([story({ url })]).stories.length, 0, String(url));
});

test('bad coordinates, kinds, titles, ids and times are dropped', () => {
  const bad = [
    { lat: NaN },
    { lon: Infinity },
    { lat: null },
    { lat: 91 },
    { lon: -181 },
    { kind: 'sport' },
    { title: '   ' },
    { title: 5 },
    { id: '' },
    { id: 7 },
    { publishedAt: NaN },
    { publishedAt: 'yesterday' },
  ];
  for (const over of bad)
    assert.equal(norm([story(over)]).stories.length, 0, JSON.stringify(over));
  assert.equal(norm([story(), null, 'x']).stories.length, 1);
});

test('a non-object payload or non-array stories gives null', () => {
  assert.equal(normalizeSaNews(null), null);
  assert.equal(normalizeSaNews('x'), null);
  assert.equal(normalizeSaNews({ stories: {} }), null);
});

test('a missing status is tolerated and an object status passes through', () => {
  assert.equal(normalizeSaNews({ stories: [] }).status, null);
  assert.equal(normalizeSaNews({ stories: [], status: 'x' }).status, null);
  const status = { gdelt: { state: 'ok' }, rss: {} };
  assert.equal(normalizeSaNews({ stories: [], status }).status, status);
});

test('spiralOffsets puts index 0 at the centre and 54 stay separated', () => {
  assert.deepEqual(spiralOffsets(0), []);
  const o = spiralOffsets(54);
  assert.equal(o.length, 54);
  assert.deepEqual(o[0], { east: 0, north: 0 });
  assert.equal(
    new Set(o.map((p) => `${p.east.toFixed(3)},${p.north.toFixed(3)}`)).size,
    54,
  );
  const nearest = o.map((p, i) =>
    Math.min(
      ...o
        .filter((_, j) => j !== i)
        .map((q) => Math.hypot(p.east - q.east, p.north - q.north)),
    ),
  );
  for (const d of nearest) {
    assert.ok(d >= 0.6 * 700, `too close: ${d}`);
    assert.ok(d <= 1.5 * 700, `too far: ${d}`);
  }
  assert.ok(Math.hypot(o[1].east, o[1].north) > 0);
});

test('spiralOffsets scales with the spacing', () => {
  const a = spiralOffsets(5, 100)[4];
  const b = spiralOffsets(5, 200)[4];
  assert.ok(Math.abs(b.east - 2 * a.east) < 1e-9);
  assert.ok(Math.abs(b.north - 2 * a.north) < 1e-9);
});

test('placeStories groups by place, newest first at the centre', () => {
  const a = story({ id: 'a', publishedAt: 1000 });
  const b = story({ id: 'b', publishedAt: 3000 });
  const c = story({ id: 'c', publishedAt: 2000 });
  const other = story({ id: 'z', lat: -33.9, lon: 18.4 });
  const placed = placeStories([a, b, c, other]);
  const byId = Object.fromEntries(placed.map((s) => [s.id, s]));
  assert.equal(byId.b.lat, a.lat);
  assert.equal(byId.b.lon, a.lon);
  assert.equal(byId.z.lat, -33.9);
  assert.equal(byId.c.placeLat, a.lat);
  assert.equal(byId.c.placeLon, a.lon);
  assert.notEqual(byId.c.lat, a.lat);
  assert.notEqual(byId.a.lat, byId.c.lat);
  const o = spiralOffsets(3);
  const lat = a.lat;
  assert.ok(Math.abs(byId.c.lat - (a.lat + o[1].north / 111_320)) < 1e-12);
  assert.ok(
    Math.abs(
      byId.c.lon -
        (a.lon + o[1].east / (111_320 * Math.cos((lat * Math.PI) / 180))),
    ) < 1e-12,
  );
});

test('placeStories ties break by id and nearby coordinates share a group', () => {
  const x = story({ id: 'x', publishedAt: 5 });
  const y = story({ id: 'y', publishedAt: 5, lat: x.lat + 0.0001 });
  const once = placeStories([y, x]);
  const twice = placeStories([x, y]);
  assert.deepEqual(
    once.find((s) => s.id === 'x'),
    twice.find((s) => s.id === 'x'),
  );
  assert.equal(once.find((s) => s.id === 'x').lat, x.lat);
  assert.notEqual(once.find((s) => s.id === 'y').lat, y.lat);
});
