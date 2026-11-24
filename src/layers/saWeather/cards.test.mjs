import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSaWeatherCard,
  formatSastTime,
  formatSastRange,
} from './cards.js';

const at = (iso) => Date.parse(iso);
const base = {
  event: 'Disruptive Rain',
  level: 9,
  band: 'red',
  levelText: 'Red',
  severity: 'Severe',
  onsetMs: at('2026-11-24T11:00:00Z'),
  expiresMs: at('2026-11-24T20:59:00Z'),
  sentMs: at('2026-11-24T08:56:00Z'),
  headline: 'h',
  description: 'Heavy rain.',
  instruction: '',
  office: 'WC',
};
const area = (warnings) => ({
  stableId: 'za-wx:ab',
  name: 'Cape Town',
  polygons: [[[[18, -33], [19, -33], [19, -34], [18, -33]]]],
  band: 'red',
  warnings,
});

test('card lists warnings worst first with SAST times', () => {
  const yellow = {
    ...base,
    event: 'Wind',
    level: 2,
    band: 'yellow',
    levelText: 'Yellow',
  };
  const card = buildSaWeatherCard(area([base, yellow]));
  assert.equal(card.id, 'sa-weather-card:za-wx:ab');
  assert.equal(card.title, 'Cape Town');
  assert.equal(card.accent, '#eb5757');
  assert.equal(card.details[0], 'Red · Level 9 · Disruptive Rain');
  assert.equal(card.details[1], 'Tue 24 Nov 13:00–22:59 SAST');
  assert.equal(card.details[2], 'Issued Tue 24 Nov 10:56');
  assert.equal(card.details[3], 'Heavy rain.');
  assert.ok(card.details.includes('Yellow · Level 2 · Wind'));
  assert.equal(
    card.details.at(-1),
    'Source: South African Weather Service',
  );
  assert.equal(card.interactive, false);
  assert.equal(card.placement, 'above');
});

test('times are SAST whatever the machine zone', () => {
  assert.equal(formatSastTime(at('2026-11-24T11:00:00Z')), 'Tue 24 Nov 13:00');
  assert.equal(
    formatSastRange(at('2026-11-24T11:00:00Z'), at('2026-11-24T20:59:00Z')),
    'Tue 24 Nov 13:00–22:59 SAST',
  );
});

test('a range over midnight names both days', () => {
  assert.equal(
    formatSastRange(at('2026-11-24T11:00:00Z'), at('2026-11-25T04:00:00Z')),
    'Tue 24 Nov 13:00 – Wed 25 Nov 06:00 SAST',
  );
});

test('a null level shows the alert text', () => {
  const card = buildSaWeatherCard(
    area([{ ...base, level: null, band: null, levelText: 'Alert' }]),
  );
  assert.equal(card.details[0], 'Alert · Disruptive Rain');
  assert.equal(card.accent, '#9aa4ad');
});

test('long text is cut', () => {
  const card = buildSaWeatherCard(
    area([
      { ...base, description: 'd'.repeat(500), instruction: 'i'.repeat(300) },
    ]),
  );
  assert.equal(card.details[3].length, 200);
  assert.ok(card.details[3].endsWith('…'));
  assert.equal(card.details[4].length, 160);
  assert.ok(card.details[4].endsWith('…'));
});

test('missing onset falls back to the issue time', () => {
  const card = buildSaWeatherCard(area([{ ...base, onsetMs: null }]));
  assert.ok(card.details[1].startsWith('Tue 24 Nov 10:56'));
});
