import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SA_COL,
  normalizeUrl,
  parseSaEvents,
  saKind,
  saStories,
} from './gdelt.js';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const stamp = (ms) =>
  new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);

// A synthetic 61-column row; `over` sets columns by SA_COL name.
function row(over = {}) {
  const f = new Array(61).fill('');
  const set = {
    id: '1001',
    rootCode: '14',
    quadClass: '3',
    mentions: '2',
    geoType: '4',
    place: 'Johannesburg, Gauteng, South Africa',
    country: 'SF',
    lat: '-26.2',
    lon: '28.0',
    added: stamp(NOW - 3_600_000),
    url: 'https://www.example.co.za/news/protest-blocks-road-in-johannesburg-cbd',
    ...over,
  };
  for (const [name, value] of Object.entries(set)) f[SA_COL[name]] = value;
  return f.join('\t');
}
const table = (...rows) => rows.join('\n');
const none = () => false;

test('SA_COL holds the GDELT 2.0 columns', () => {
  assert.deepEqual(SA_COL, {
    id: 0,
    rootCode: 28,
    quadClass: 29,
    mentions: 31,
    geoType: 51,
    place: 52,
    country: 53,
    lat: 56,
    lon: 57,
    added: 59,
    url: 60,
  });
});

test('keeps only SF city rows', () => {
  const rows = table(
    row({ id: '1' }),
    row({ id: '2', geoType: '3', place: 'Pretoria, Gauteng, South Africa' }),
    row({ id: '3', geoType: '1', place: 'South Africa' }),
    row({ id: '4', geoType: '5', place: 'Gauteng, South Africa' }),
    row({ id: '5', lat: '0', lon: '0' }),
    row({ id: '6', lat: '', lon: '' }),
    row({ id: '7', country: 'US' }),
    row({ id: '8', url: 'javascript:alert(1)' }),
    row({ id: '9', added: 'garbage' }),
    'too\tshort',
  );
  const events = parseSaEvents(rows, { denied: none });
  assert.deepEqual(
    events.map((e) => e.id),
    ['1', '2'],
  );
  const [first] = events;
  assert.equal(first.root, '14');
  assert.equal(first.quad, '3');
  assert.equal(first.mentions, 2);
  assert.equal(first.place, 'Johannesburg, Gauteng, South Africa');
  assert.equal(first.lat, -26.2);
  assert.equal(first.lon, 28);
  assert.equal(first.addedMs, NOW - 3_600_000);
  assert.match(first.url, /^https:\/\//);
});

test('denied drops Kwazulu and Madlanga by the first place part', () => {
  const seen = [];
  const denied = (name) => {
    seen.push(name);
    return ['Kwazulu', 'Madlanga'].includes(name);
  };
  const events = parseSaEvents(
    table(
      row({ id: '1', place: 'Kwazulu, KwaZulu-Natal, South Africa' }),
      row({ id: '2', place: 'Madlanga, Eastern Cape, South Africa' }),
      row({ id: '3', place: 'Durban, KwaZulu-Natal, South Africa' }),
    ),
    { denied },
  );
  assert.deepEqual(
    events.map((e) => e.id),
    ['3'],
  );
  assert.deepEqual(seen, ['Kwazulu', 'Madlanga', 'Durban']);
});

test('saKind reads roots 14, 18 and 04', () => {
  assert.equal(saKind('14'), 'protest');
  assert.equal(saKind('18'), 'violence');
  assert.equal(saKind('19'), 'violence');
  assert.equal(saKind('20'), 'violence');
  assert.equal(saKind('04'), 'event');
});

test('events of one URL make one story, the most severe kind, earliest time', () => {
  const events = parseSaEvents(
    table(
      row({ id: '1', rootCode: '14', added: stamp(NOW - 7_200_000) }),
      row({ id: '2', rootCode: '18', added: stamp(NOW - 3_600_000) }),
      row({ id: '3', rootCode: '04', added: stamp(NOW - 1_800_000) }),
    ),
    { denied: none },
  );
  const stories = saStories(events, { nowMs: NOW });
  assert.equal(stories.length, 1);
  const [story] = stories;
  assert.equal(story.kind, 'violence');
  assert.equal(story.publishedAt, NOW - 7_200_000);
  assert.equal(story.source, 'example.co.za');
  assert.match(story.id, /^gd:[0-9a-f]{8}$/);
  assert.match(story.place, /^Johannesburg/);
  assert.equal(story.lat, -26.2);
  assert.equal(story.lon, 28);
});

test('protest beats a plain event', () => {
  const events = parseSaEvents(
    table(row({ id: '1', rootCode: '04' }), row({ id: '2', rootCode: '14' })),
    { denied: none },
  );
  assert.equal(saStories(events, { nowMs: NOW })[0].kind, 'protest');
});

test('a story older than 24 h is dropped', () => {
  const events = parseSaEvents(
    table(
      row({ id: '1', added: stamp(NOW - 25 * 3_600_000) }),
      row({
        id: '2',
        added: stamp(NOW - 3_600_000),
        url: 'https://example.co.za/news/another-story-about-cape-town-water-crisis',
        place: 'Cape Town, Western Cape, South Africa',
      }),
    ),
    { denied: none },
  );
  const stories = saStories(events, { nowMs: NOW });
  assert.equal(stories.length, 1);
  assert.match(stories[0].place, /^Cape Town/);
  assert.equal(saStories(events, { nowMs: NOW, windowMs: 10_000 }).length, 0);
});

test('title is the address words, else "Story from <domain>"', () => {
  const events = parseSaEvents(
    table(
      row({ id: '1' }),
      row({ id: '2', url: 'https://www.news24.com/article/12345' }),
    ),
    { denied: none },
  );
  const stories = saStories(events, { nowMs: NOW });
  const byUrl = Object.fromEntries(stories.map((s) => [s.url, s]));
  assert.equal(
    byUrl[
      'https://www.example.co.za/news/protest-blocks-road-in-johannesburg-cbd'
    ].title,
    'Protest blocks road in johannesburg cbd',
  );
  assert.equal(
    byUrl['https://www.news24.com/article/12345'].title,
    'Story from news24.com',
  );
});

test('normalizeUrl', () => {
  assert.equal(
    normalizeUrl('http://WWW.Example.com/a/b/?x=1#frag'),
    'https://example.com/a/b',
  );
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(
    normalizeUrl('https://example.com/a-b/'),
    'https://example.com/a-b',
  );
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('data:text/html,hi'), null);
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl(null), null);
});
