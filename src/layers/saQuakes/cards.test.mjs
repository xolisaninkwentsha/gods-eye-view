import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SA_QUAKE_AGE_ACCENTS,
  buildSaQuakeCard,
  saQuakeAgeBand,
  saQuakeDotPx,
} from './cards.js';

const at = (iso) => Date.parse(iso);
const HOUR = 3600 * 1000;
const row = {
  stableId: '20261121_0000100',
  lon: 28.2,
  lat: -26.3,
  depthKm: null,
  mag: 2.6,
  magType: 'ml',
  timeMs: at('2026-11-21T15:11:16Z'),
  region: 'South Africa',
  network: 'SASN',
};

test('the card shows magnitude, class, place and SAST time', () => {
  const card = buildSaQuakeCard(row, at('2026-11-22T00:00:00Z'));
  assert.equal(card.id, 'sa-quake-card:20261121_0000100');
  assert.equal(card.title, 'M2.6 · Minor');
  assert.equal(card.details[0], 'South Africa');
  assert.equal(card.details[1], 'Sat 21 Nov 17:11 SAST');
  assert.ok(card.details.includes('Network: SASN'));
  assert.equal(card.details.at(-1), 'Source: EMSC-CSEM SeismicPortal');
  assert.equal(card.accent, SA_QUAKE_AGE_ACCENTS.day);
});

test('the network line is left out when the feed names none', () => {
  const card = buildSaQuakeCard({ ...row, network: null }, row.timeMs);
  assert.equal(
    card.details.some((line) => line.startsWith('Network')),
    false,
  );
});

test('age bands split at a day and a week', () => {
  const now = at('2026-11-24T00:00:00Z');
  assert.equal(saQuakeAgeBand(now - 23 * HOUR, now), 'day');
  assert.equal(saQuakeAgeBand(now - 24 * HOUR, now), 'week');
  assert.equal(saQuakeAgeBand(now - 6 * 24 * HOUR, now), 'week');
  assert.equal(saQuakeAgeBand(now - 7 * 24 * HOUR, now), 'month');
  assert.deepEqual(SA_QUAKE_AGE_ACCENTS, {
    day: '#eb5757',
    week: '#f2994a',
    month: '#f2c94c',
  });
});

test('dot size grows with magnitude within 6 to 16 px', () => {
  assert.equal(saQuakeDotPx(1), 6);
  assert.equal(saQuakeDotPx(2), 6);
  assert.equal(saQuakeDotPx(3), 9);
  assert.ok(saQuakeDotPx(4) > saQuakeDotPx(3));
  assert.equal(saQuakeDotPx(9), 16);
});
