import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  POPULATION_BANDS,
  POPULATION_FLOOR,
  SA_GRID_BOX,
  binPopulation,
  gpkgEnvelopeCentre,
  mercatorToLonLat,
  populationBand,
} from './grid.js';

function header({ little, code = 1, magic = [0x47, 0x50], env }) {
  const bytes = new Uint8Array(8 + 32);
  const view = new DataView(bytes.buffer);
  bytes[0] = magic[0];
  bytes[1] = magic[1];
  bytes[3] = (little ? 1 : 0) | (code << 1);
  env.forEach((v, i) => view.setFloat64(8 + i * 8, v, little));
  return bytes;
}

test('envelope centre reads little-endian and big-endian headers', () => {
  const env = [10, 20, 100, 300];
  for (const little of [true, false]) {
    assert.deepEqual(gpkgEnvelopeCentre(header({ little, env })), {
      x: 15,
      y: 200,
    });
  }
});

test('envelope centre is null for a bad magic or no envelope', () => {
  const env = [10, 20, 100, 300];
  assert.equal(
    gpkgEnvelopeCentre(header({ little: true, env, magic: [0x58, 0x58] })),
    null,
  );
  assert.equal(
    gpkgEnvelopeCentre(header({ little: true, env, code: 0 })),
    null,
  );
});

test('mercatorToLonLat converts known points', () => {
  const o = mercatorToLonLat(0, 0);
  assert.equal(o.lon, 0);
  assert.equal(o.lat, 0);
  const jhb = mercatorToLonLat(3117000, -3005000);
  assert.ok(Math.abs(jhb.lon - 28) < 0.01);
  assert.ok(Math.abs(jhb.lat - -26.05) < 0.01);
});

test('binPopulation sums within a cell and splits across edges', () => {
  const cells = binPopulation([
    { lon: 27.81, lat: -26.31, people: 10 },
    { lon: 27.89, lat: -26.39, people: 5 },
    { lon: 27.91, lat: -26.39, people: 7 },
    { lon: 27.89, lat: -26.41, people: 3 },
  ]);
  assert.equal(cells.size, 3);
  const a = [...cells.values()].find(
    (c) => c.west === 27.8 && c.south === -26.4,
  );
  assert.deepEqual(a, { south: -26.4, west: 27.8, people: 15 });
  assert.ok(
    [...cells.values()].some(
      (c) => c.west === 27.9 && c.south === -26.4 && c.people === 7,
    ),
  );
  assert.ok(
    [...cells.values()].some(
      (c) => c.west === 27.8 && c.south === -26.5 && c.people === 3,
    ),
  );
});

test('population bands have the right edges', () => {
  assert.equal(POPULATION_FLOOR, 100);
  assert.equal(POPULATION_BANDS.length, 5);
  assert.ok(Object.isFrozen(POPULATION_BANDS));
  assert.equal(populationBand(99), -1);
  assert.equal(populationBand(100), 0);
  assert.equal(populationBand(999), 0);
  assert.equal(populationBand(1000), 1);
  assert.equal(populationBand(200000), 4);
});

test('the committed grid is plausible', () => {
  const grid = JSON.parse(
    readFileSync(new URL('./sa-population-grid.json', import.meta.url), 'utf8'),
  );
  assert.equal(grid.cellDeg, 0.1);
  assert.ok(grid.cells.length >= 5500 && grid.cells.length <= 7500);
  assert.ok(grid.total >= 55e6 && grid.total <= 66e6);
  const { west, south, east, north } = SA_GRID_BOX;
  for (const [s, w, people] of grid.cells) {
    assert.ok(people >= 100);
    assert.ok(s >= south && s + 0.1 <= north + 1e-9, `south ${s}`);
    assert.ok(w >= west && w + 0.1 <= east + 1e-9, `west ${w}`);
  }
});

test('the generator keeps its caps and guards', () => {
  const source = readFileSync(
    new URL('../../../scripts/sa-population.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /maxOutputLength: 128 \* 1024 \* 1024/);
  assert.match(source, /450_?000/);
  assert.match(source, /560_?000/);
  assert.match(source, /55_?000_?000/);
  assert.match(source, /66_?000_?000/);
  assert.match(source, /5_?500/);
  assert.match(source, /7_?500/);
});
