import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGigaSchools, parseHealthSites } from './parse.js';

// Everything below is synthetic: made-up facilities and schools.
const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
const feature = (props, geometry) => ({
  type: 'Feature',
  properties: props,
  geometry,
});
const collection = (...features) =>
  JSON.stringify({ type: 'FeatureCollection', features });
const props = (extra = {}) => ({
  osm_id: 101,
  osm_type: 'node',
  amenity: 'hospital',
  name: 'Test Hospital',
  ...extra,
});

test('health: a point is kept as it is', () => {
  const [r] = parseHealthSites(
    collection(
      feature(
        props({ operator: 'Province', addr_city: 'Durban' }),
        point(31.02, -29.85),
      ),
    ),
  );
  assert.deepEqual(r, {
    id: 'node/101',
    name: 'Test Hospital',
    kind: 'hospital',
    lat: -29.85,
    lon: 31.02,
    operator: 'Province',
    city: 'Durban',
  });
});

test('health: a polygon becomes the vertex mean of its first outer ring', () => {
  const ring = [
    [28, -26],
    [28.2, -26],
    [28.2, -26.2],
    [28, -26.2],
    [28, -26],
  ];
  const [poly, multi] = parseHealthSites(
    collection(
      feature(props({ osm_type: 'way', osm_id: 7 }), {
        type: 'Polygon',
        coordinates: [ring],
      }),
      feature(props({ osm_type: 'relation', osm_id: 8 }), {
        type: 'MultiPolygon',
        coordinates: [
          [ring],
          [
            [
              [20, -30],
              [20.1, -30],
              [20, -30.1],
              [20, -30],
            ],
          ],
        ],
      }),
    ),
  );
  assert.equal(poly.id, 'way/7');
  assert.ok(
    Math.abs(poly.lon - 28.1) < 1e-9 && Math.abs(poly.lat + 26.1) < 1e-9,
  );
  assert.equal(multi.id, 'relation/8');
  assert.ok(Math.abs(multi.lon - 28.1) < 1e-9);
});

test('health: an unknown or missing amenity is other, an empty name is null', () => {
  const rows = parseHealthSites(
    collection(
      feature(
        props({ osm_id: 1, amenity: 'surgery', name: '' }),
        point(30, -29),
      ),
      feature(
        props({ osm_id: 2, amenity: undefined, name: '   ' }),
        point(30, -29),
      ),
      feature(
        props({ osm_id: 3, amenity: 'social_facility', name: undefined }),
        point(30, -29),
      ),
      feature(props({ osm_id: 4, amenity: 'pharmacy' }), point(30, -29)),
    ),
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.name]),
    [
      ['other', null],
      ['other', null],
      ['other', null],
      ['pharmacy', 'Test Hospital'],
    ],
  );
  assert.ok(!('operator' in rows[0]) && !('city' in rows[0]));
});

test('health: strings are capped at 120 characters', () => {
  const [r] = parseHealthSites(
    collection(
      feature(
        props({
          name: 'n'.repeat(500),
          operator: 'o'.repeat(500),
          addr_city: 'c'.repeat(500),
        }),
        point(30, -29),
      ),
    ),
  );
  assert.equal(r.name.length, 120);
  assert.equal(r.operator.length, 120);
  assert.equal(r.city.length, 120);
});

test('health: records without a finite position inside the SA box are dropped', () => {
  const rows = parseHealthSites(
    collection(
      feature(props({ osm_id: 1 }), point(0, 0)),
      feature(props({ osm_id: 2 }), point(15.9, -30)),
      feature(props({ osm_id: 3 }), point(34, -30)),
      feature(props({ osm_id: 4 }), point(30, -21.9)),
      feature(props({ osm_id: 5 }), point(30, -35.6)),
      feature(props({ osm_id: 6 }), {
        type: 'Point',
        coordinates: [null, -30],
      }),
      feature(props({ osm_id: 7 }), {
        type: 'Point',
        coordinates: ['30', '-30'],
      }),
      feature(props({ osm_id: 8 }), null),
      feature(props({ osm_id: 9 }), { type: 'Polygon', coordinates: [[]] }),
      feature(props({ osm_id: 10 }), {
        type: 'LineString',
        coordinates: [[30, -30]],
      }),
      feature(props({ osm_id: 11 }), point(16, -35.5)),
      feature(props({ osm_id: 12 }), point(33.5, -22)),
    ),
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ['node/11', 'node/12'],
  );
});

test('health: text that is not a feature collection fails by code', () => {
  for (const text of ['<html>', '{}', '{"features":3}', '']) {
    assert.throws(() => parseHealthSites(text), { code: 'PARSE_FAILED' });
  }
});

const HEADER = 'school_name,longitude,latitude,education_level,connectivity';

test('schools: a BOM on the header, columns by name, ids by data row', () => {
  const csv = `﻿${HEADER}\nEXAMPLE PRIMARY SCHOOL,29.317,-27.481,Primary,Yes\n`;
  assert.deepEqual(parseGigaSchools(csv), [
    {
      id: 'school:1',
      name: 'EXAMPLE PRIMARY SCHOOL',
      lat: -27.481,
      lon: 29.317,
      level: 'Primary',
      connectivity: 'yes',
    },
  ]);
  // Columns reordered.
  const [r] = parseGigaSchools(
    'connectivity,latitude,education_level,longitude,school_name\nNo,-29,Secondary,31,Moved School',
  );
  assert.deepEqual(
    [r.name, r.lat, r.lon, r.level, r.connectivity],
    ['Moved School', -29, 31, 'Secondary', 'no'],
  );
});

test('schools: quotes, doubled quotes, commas and newlines inside quotes', () => {
  const csv = [
    HEADER,
    '"St Mary\'s, ""Boys"" High",28.1,-26.2,Secondary,No',
    '"Two\nlines School",28.2,-26.3,Primary,Yes',
    '"",28.3,-26.4,Primary,Yes',
  ].join('\r\n');
  const rows = parseGigaSchools(csv);
  assert.equal(rows[0].name, 'St Mary\'s, "Boys" High');
  assert.equal(rows[1].name, 'Two\nlines School');
  assert.equal(rows[2].name, null);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['school:1', 'school:2', 'school:3'],
  );
});

test('schools: levels are case-folded to the spec spelling', () => {
  const rows = parseGigaSchools(
    [
      HEADER,
      'a,28,-26,Primary And Secondary,Yes',
      'b,28,-26,Primary and Secondary,Yes',
      'c,28,-26,pre-primary,Yes',
      'd,28,-26,Unknown,Yes',
      'e,28,-26,Other,Yes',
      'f,28,-26,Odd Value,Yes',
      'g,28,-26,,Yes',
      'h,28,-26,SECONDARY,Yes',
    ].join('\n'),
  );
  assert.deepEqual(
    rows.map((r) => r.level),
    [
      'Primary and Secondary',
      'Primary and Secondary',
      'Pre-Primary',
      'Unknown',
      'Other',
      'Unknown',
      'Unknown',
      'Secondary',
    ],
  );
});

test('schools: connectivity is yes, no or unknown', () => {
  const rows = parseGigaSchools(
    [
      HEADER,
      'a,28,-26,Primary,Yes',
      'b,28,-26,Primary,NO',
      'c,28,-26,Primary,Unknown',
      'd,28,-26,Primary,',
      'e,28,-26,Primary,maybe',
    ].join('\n'),
  );
  assert.deepEqual(
    rows.map((r) => r.connectivity),
    ['yes', 'no', 'unknown', 'unknown', 'unknown'],
  );
});

test('schools: blank, non-numeric and out-of-box coordinates are dropped, ids hold still', () => {
  const rows = parseGigaSchools(
    [
      HEADER,
      'blank lon,,-26,Primary,Yes',
      'blank lat,28,,Primary,Yes',
      'spaces,  ,  ,Primary,Yes',
      'text,abc,-26,Primary,Yes',
      'zero,0,0,Primary,Yes',
      'north,28,-21,Primary,Yes',
      'kept,28,-26,Primary,Yes',
      '',
      'short row',
      'kept too,29,-27,Primary,Yes',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.name]),
    [
      ['school:7', 'kept'],
      ['school:9', 'kept too'],
    ],
  );
});

test('schools: a file without coordinate columns fails by code', () => {
  assert.throws(() => parseGigaSchools(''), { code: 'PARSE_FAILED' });
  assert.throws(() => parseGigaSchools('a,b\n1,2'), { code: 'PARSE_FAILED' });
});
