// One-off generator for src/layers/saPopulation/sa-population-grid.json.
// Run by hand: node scripts/sa-population.mjs
// Downloads Kontur Population South Africa (CC BY 4.0) to a fresh temp dir,
// bins hexagon centres into 0.1 degree cells and writes only the small grid.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  POPULATION_FLOOR,
  binPopulation,
  gpkgEnvelopeCentre,
  mercatorToLonLat,
} from '../src/layers/saPopulation/grid.js';

const URL_GZ =
  'https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_ZA_20231101.gpkg.gz';
const OUT = new URL(
  '../src/layers/saPopulation/sa-population-grid.json',
  import.meta.url,
);
const MAX_BYTES = 48 * 1024 * 1024;
const TIMEOUT_MS = 300_000;

// Each guard throws, so nothing is written when a range is missed.
function assertRange(name, n, min, max) {
  if (!(n >= min && n <= max)) throw new Error(`unexpected ${name} ${n}`);
}
const checkRows = (n) => assertRange('row count', n, 450_000, 560_000);
const checkTotal = (n) => assertRange('total', n, 55_000_000, 66_000_000);
const checkCells = (n) => assertRange('cell count', n, 5_500, 7_500);

// TLS stays on and a redirect is an error. The body is never printed.
async function download(url) {
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'GodsEyeView (sa-population)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('download too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function serialise(grid) {
  const head = JSON.stringify({ ...grid, cells: undefined }).slice(0, -1);
  const lines = grid.cells.map((c) => `[${c.join(',')}]`);
  return `${head},"cells":[\n${lines.join(',\n')}\n]}\n`;
}

const dir = mkdtempSync(join(tmpdir(), 'sa-population-'));
try {
  const gz = await download(URL_GZ);
  const file = join(dir, 'kontur.gpkg');
  writeFileSync(file, gunzipSync(gz, { maxOutputLength: 128 * 1024 * 1024 }));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  let rows = 0;
  let total = 0;
  const points = [];
  try {
    for (const r of db
      .prepare('select geom, population from population')
      .iterate()) {
      rows += 1;
      const people = Number(r.population);
      total += people;
      const centre = gpkgEnvelopeCentre(r.geom);
      if (!centre) continue;
      const { lon, lat } = mercatorToLonLat(centre.x, centre.y);
      points.push({ lon, lat, people });
    }
  } finally {
    db.close();
  }
  total = Math.round(total);
  checkRows(rows);
  checkTotal(total);
  const kept = [...binPopulation(points).values()]
    .filter((c) => c.people >= POPULATION_FLOOR)
    .map((c) => [c.south, c.west, Math.round(c.people)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  checkCells(kept.length);
  writeFileSync(
    OUT,
    serialise({
      source: 'Kontur Population: South Africa (2023-11-01)',
      licence: 'CC BY 4.0',
      url: 'https://data.humdata.org/dataset/kontur-population-south-africa',
      cellDeg: 0.1,
      total,
      cells: kept,
    }),
  );
  console.log(`rows ${rows}, total ${total}, cells ${kept.length}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
