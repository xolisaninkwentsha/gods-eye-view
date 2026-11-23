import test from 'node:test';
import assert from 'node:assert/strict';
import { MDB_LAYERS, fetchBoundaries } from './boundaries.js';

const ring = [
  [28, -26],
  [28.1, -26],
  [28.1, -26.1],
  [28, -26],
];
const poly = { type: 'Polygon', coordinates: [ring] };
const ward = (id, no = 1, geometry = poly) => ({
  type: 'Feature',
  properties: {
    WardID: id,
    CAT_B: 'JHB',
    WardNo: no,
    MUNICNAME: 'City of Johannesburg',
    Province: 'Gauteng',
  },
  geometry,
});
const council = (id, geometry = poly) => ({
  type: 'Feature',
  properties: {
    CAT_B: id,
    MUNICNAME: `Name ${id}`,
    PROVINCE: 'Gauteng',
    CATEGORY: 'A',
  },
  geometry,
});
const page = (features, exceeded) => ({
  type: 'FeatureCollection',
  features,
  ...(exceeded ? { exceededTransferLimit: true } : {}),
});

function fake(pages) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const body = pages[Math.min(calls.length - 1, pages.length - 1)];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchImpl, calls };
}

test('pages until the service says it is complete', async () => {
  const { fetchImpl, calls } = fake([
    page([ward(1), ward(2)], true),
    page([ward(3)]),
  ]);
  const areas = await fetchBoundaries('wards', { fetchImpl });
  assert.deepEqual(
    areas.map((a) => a.id),
    ['1', '2', '3'],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('resultOffset'), '0');
  assert.equal(calls[1].url.searchParams.get('resultOffset'), '2');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(
    calls[0].init.headers['User-Agent'],
    'GodsEyeView (sa-elections)',
  );
});

test('maps council and ward attributes to areas', async () => {
  const c = await fetchBoundaries('councils', {
    fetchImpl: fake([page([council('JHB')])]).fetchImpl,
  });
  assert.deepEqual(c[0], {
    id: 'JHB',
    name: 'Name JHB',
    code: 'JHB',
    province: 'Gauteng',
    category: 'A',
    polygons: [[ring]],
  });
  const w = await fetchBoundaries('wards', {
    fetchImpl: fake([page([ward(79800001, 7)])]).fetchImpl,
  });
  assert.deepEqual(w[0], {
    id: '79800001',
    name: 'Ward 7',
    code: 'JHB',
    province: 'Gauteng',
    wardNo: 7,
    municipality: 'City of Johannesburg',
    polygons: [[ring]],
  });
});

test('accepts MultiPolygon and drops bad geometry', async () => {
  const multi = { type: 'MultiPolygon', coordinates: [[ring], [ring]] };
  const bad = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 1],
      ],
    ],
  };
  const areas = await fetchBoundaries('wards', {
    fetchImpl: fake([
      page([
        ward(1, 1, multi),
        ward(2, 2, bad),
        ward(3, 3, null),
        ward(4, 4, { type: 'Point', coordinates: [1, 1] }),
      ]),
    ]).fetchImpl,
  });
  assert.deepEqual(
    areas.map((a) => a.id),
    ['1'],
  );
  assert.equal(areas[0].polygons.length, 2);
});

test('refuses an incomplete set', async () => {
  await assert.rejects(
    fetchBoundaries('wards', {
      fetchImpl: fake([page([ward(1)], true)]).fetchImpl,
    }),
    /incomplete_boundaries/,
  );
  await assert.rejects(
    fetchBoundaries('wards', {
      fetchImpl: fake([page([ward(1, 1, null)])]).fetchImpl,
    }),
    /incomplete_boundaries/,
  );
});

test('asks ArcGIS for simplified WGS84 GeoJSON', async () => {
  const { fetchImpl, calls } = fake([page([council('A')])]);
  await fetchBoundaries('councils', { fetchImpl });
  const { url } = calls[0];
  assert.ok(MDB_LAYERS.councils.endsWith('/FeatureServer/0'));
  assert.equal(`${url.origin}${url.pathname}`, `${MDB_LAYERS.councils}/query`);
  const q = url.searchParams;
  assert.equal(q.get('maxAllowableOffset'), '0.001');
  assert.equal(q.get('outSR'), '4326');
  assert.equal(q.get('f'), 'geojson');
  assert.equal(q.get('geometryPrecision'), '5');
  assert.equal(q.get('resultRecordCount'), '2000');
  assert.equal(q.get('where'), '1=1');
  assert.equal(q.get('outFields'), 'CAT_B,MUNICNAME,PROVINCE,CATEGORY');
});
