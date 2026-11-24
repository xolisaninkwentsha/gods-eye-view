import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSaWeatherAreas,
  SA_WEATHER_BANDS,
  saWeatherBandRank,
  saWeatherBandAccent,
  SA_WEATHER_OVERLAY_SOURCE_ID,
} from './records.js';

const ring = [
  [18, -33],
  [19, -33],
  [19, -34],
  [18, -33],
];
const warning = { event: 'Rain', level: 5, expiresMs: 2000, sentMs: 1000 };
const area = (extra = {}) => ({
  stableId: 'za-wx:ab',
  name: 'Cape',
  polygons: [[ring]],
  band: 'orange',
  warnings: [warning],
  ...extra,
});

test('valid areas pass through', () => {
  const rows = normalizeSaWeatherAreas([area()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stableId, 'za-wx:ab');
});

test('areas with no warnings, a bad ring or no stableId are dropped', () => {
  const rows = normalizeSaWeatherAreas([
    area({ warnings: [] }),
    area({ warnings: [{ ...warning, expiresMs: null }] }),
    area({ polygons: [[[[1, 2]]]] }),
    area({ polygons: [[[[999, 2], [1, 2], [1, 3], [999, 2]]]] }),
    area({ stableId: undefined }),
    null,
    area({ stableId: 'za-wx:ok' }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.stableId),
    ['za-wx:ok'],
  );
});

test('a non-array gives null', () => {
  assert.equal(normalizeSaWeatherAreas({}), null);
  assert.equal(normalizeSaWeatherAreas(undefined), null);
});

test('bands, ranks and accents', () => {
  assert.deepEqual(SA_WEATHER_BANDS, ['yellow', 'orange', 'red']);
  assert.equal(SA_WEATHER_OVERLAY_SOURCE_ID, 'sa-weather-warnings');
  assert.deepEqual(
    [null, 'yellow', 'orange', 'red'].map(saWeatherBandRank),
    [0, 1, 2, 3],
  );
  assert.equal(saWeatherBandAccent('yellow'), '#f2c94c');
  assert.equal(saWeatherBandAccent('orange'), '#f2994a');
  assert.equal(saWeatherBandAccent('red'), '#eb5757');
  assert.equal(saWeatherBandAccent(null), '#9aa4ad');
});
