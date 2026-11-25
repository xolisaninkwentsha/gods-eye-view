import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSaNewsCard } from './cards.js';
import { setMessageOverrides } from '../../i18n/index.js';

const MIN = 60_000;
// 2026-11-24 23:30 UTC is 01:30 SAST on the 25th.
const published = Date.parse('2026-11-24T23:30:00Z');
const story = (over = {}) => ({
  id: 'abc',
  kind: 'violence',
  title: 'Synthetic headline',
  url: 'https://example.org/a',
  source: 'Example Outlet',
  publishedAt: published,
  place: 'Sampleville',
  ...over,
});

test('the card lines, accent and interactivity', () => {
  const card = buildSaNewsCard(story(), published + 5 * MIN);
  assert.equal(card.id, 'sa-news-card:abc');
  assert.equal(card.title, 'Synthetic headline');
  assert.equal(card.interactive, true);
  assert.equal(card.accent, '#eb5757');
  assert.equal(card.selected, true);
  assert.equal(card.accessibilityLabel, 'Open the story: Synthetic headline');
  assert.deepEqual(card.details, [
    'Sampleville',
    'Example Outlet · 5m ago (Wed 25 Nov 01:30 SAST)',
    'Violence',
    'Click to open the story ↗',
  ]);
  assert.equal('activate' in card, false);
});

test('the SAST line does not depend on the machine zone', () => {
  const card = buildSaNewsCard(story(), published + MIN);
  assert.match(card.details[1], /Wed 25 Nov 01:30 SAST\)$/);
});

test('relative time buckets', () => {
  const line = (delta) =>
    buildSaNewsCard(story(), published + delta).details[1];
  assert.match(line(-MIN), /· just now \(/);
  assert.match(line(NaN), /· just now \(/);
  assert.match(line(30_000), /· <1m ago \(/);
  assert.match(line(89 * MIN), /· 89m ago \(/);
  assert.match(line(90 * MIN), /· 2h ago \(/);
  assert.match(line(23 * 60 * MIN), /· 23h ago \(/);
});

test('each kind takes its own colour and label', () => {
  const k = (kind) => buildSaNewsCard(story({ kind }), published);
  assert.equal(k('protest').accent, '#f2994a');
  assert.equal(k('event').accent, '#8fa6bf');
  assert.equal(k('headline').accent, '#2bb3a3');
  assert.equal(k('event').details[2], 'Other event');
});

test('long lines are cut to 90 characters ending in an ellipsis', () => {
  const long = 'W'.repeat(120);
  const card = buildSaNewsCard(
    story({ title: long, place: long, source: long }),
    published,
  );
  assert.equal(card.title.length, 90);
  assert.ok(card.title.endsWith('…'));
  for (const line of card.details) assert.ok(line.length <= 90);
  assert.equal(card.details[0].length, 90);
  assert.equal(card.details[1].length, 90);
  // The accessibility label keeps the full title.
  assert.ok(card.accessibilityLabel.includes(long));
  // A line of exactly 90 characters is untouched.
  const exact = buildSaNewsCard(story({ title: 'a'.repeat(90) }), published);
  assert.equal(exact.title, 'a'.repeat(90));
});

test('a missing place leaves out the place line', () => {
  const card = buildSaNewsCard(story({ place: '' }), published);
  assert.equal(card.details.length, 3);
  assert.equal(card.details[0].startsWith('Example Outlet'), true);
});

test('the kind line goes through t()', (t) => {
  t.after(() => setMessageOverrides({}));
  setMessageOverrides({ en: { Violence: 'Geweld' } });
  const card = buildSaNewsCard(story(), published + MIN);
  assert.ok(card.details.includes('Geweld'));
});
