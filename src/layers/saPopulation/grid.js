// Pure helpers for the Kontur population grid. No Node imports: the browser
// layer imports this file, and scripts/sa-population.mjs uses it to build
// sa-population-grid.json.

export const POPULATION_FLOOR = 100;

export const SA_GRID_BOX = Object.freeze({
  west: 16,
  south: -35.5,
  east: 33.5,
  north: -22,
});

export const POPULATION_BANDS = Object.freeze([
  Object.freeze({ min: 100, color: '#ffffb2' }),
  Object.freeze({ min: 1000, color: '#fecc5c' }),
  Object.freeze({ min: 10000, color: '#fd8d3c' }),
  Object.freeze({ min: 50000, color: '#f03b20' }),
  Object.freeze({ min: 200000, color: '#bd0026' }),
]);

const EARTH_RADIUS = 6378137;

// Index of the highest band whose minimum the count reaches, or -1 below 100.
export function populationBand(people) {
  let band = -1;
  for (let i = 0; i < POPULATION_BANDS.length; i += 1) {
    if (people >= POPULATION_BANDS[i].min) band = i;
  }
  return band;
}

// Centre of a GeoPackage geometry's header envelope, or null when the blob has
// the wrong magic or carries no envelope.
export function gpkgEnvelopeCentre(blob) {
  if (!blob || blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) {
    return null;
  }
  const flags = blob[3];
  const code = (flags >> 1) & 7;
  if (code < 1 || code > 4) return null;
  if (blob.length < 40) return null;
  const little = (flags & 1) === 1;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const minx = view.getFloat64(8, little);
  const maxx = view.getFloat64(16, little);
  const miny = view.getFloat64(24, little);
  const maxy = view.getFloat64(32, little);
  return { x: (minx + maxx) / 2, y: (miny + maxy) / 2 };
}

// EPSG:3857 metres to degrees.
export function mercatorToLonLat(x, y) {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat =
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return { lon, lat };
}

// Sums people into cellDeg cells keyed by floor index. south and west are the
// cell's south-west corner, rounded to 1 decimal (never -0).
export function binPopulation(rows, cellDeg = 0.1) {
  const cells = new Map();
  for (const { lon, lat, people } of rows) {
    const row = Math.floor(lat / cellDeg);
    const col = Math.floor(lon / cellDeg);
    const key = `${row},${col}`;
    const cell = cells.get(key);
    if (cell) {
      cell.people += people;
    } else {
      cells.set(key, {
        south: Math.round(row * cellDeg * 10) / 10 + 0,
        west: Math.round(col * cellDeg * 10) / 10 + 0,
        people,
      });
    }
  }
  return cells;
}
