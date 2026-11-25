import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaFacilitiesLayer } from './index.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { createStubRenderer } from '../../render/stub/index.js';
import { bindRenderer } from '../../render/rendererOf.js';
import { fromDegrees, positionToEcef } from '../../geo/ellipsoid.js';
import { setLocale, setMessageOverrides } from '../../i18n/index.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const FETCHED = '2026-11-25T08:00:00.000Z';

const health = (id, extra = {}) => ({
  id,
  name: `Sample Clinic ${id}`,
  kind: 'clinic',
  lat: -29.5,
  lon: 25.5,
  ...extra,
});
const schools = (id, extra = {}) => ({
  id,
  name: `Example School ${id}`,
  lat: -28.5,
  lon: 24.5,
  level: 'Primary',
  connectivity: 'yes',
  ...extra,
});
const payload = (set, records, extra = {}) => ({
  set,
  fetchedAt: FETCHED,
  updated: null,
  stale: false,
  records,
  ...extra,
});

test.beforeEach((t) => {
  t.mock.method(console, 'log', () => {});
});

const sourceOf = (value) => ({ getSnapshot: async () => value });
const liveSet = (draw, suffix) =>
  [...draw.sets.values()].find(
    (record) => !record.disposed && record.spec.id.endsWith(suffix),
  );

function harness(set, source, { clickCard = () => null } = {}) {
  const overlay = { entries: new Map(), visible: null };
  const viewer = { scene: { pick: () => null } };
  const { draw } = bindFakeDraw(viewer);
  const input = fakeInputUnderLabel(viewer);
  let pickResult = null;
  viewer.scene.pick = () => pickResult;
  const layer = createSaFacilitiesLayer({
    set,
    source,
    overlayHost: {
      setEntries: (id, entries) => overlay.entries.set(id, entries),
      setVisible: (id, visible) => {
        overlay.visible = visible;
      },
      clearSource: (id) => overlay.entries.delete(id),
      hitTest: () => null,
    },
    inputFor: () => input.input,
    picking: {
      resolvePickId: (picked) => picked?.id?.id ?? picked?.id ?? null,
      isOwnedByOtherLayer: () => false,
      clickCard: (event) => clickCard(event),
    },
  });
  layer.init(viewer);
  layer.enable();
  const dotsId = liveSet(draw, ':dots').spec.id;
  return {
    layer,
    overlay,
    click: (id, setId = dotsId) => {
      pickResult = id ? { id: { set: setId, id } } : null;
      input.click({ x: 10, y: 10 });
    },
    dots: () => liveSet(draw, ':dots'),
  };
}

const CASES = {
  health: {
    id: 'sa-health-facilities',
    name: 'SA health facilities',
    source: 'healthsites.io · OpenStreetMap',
    icon: undefined,
    size: 12,
    ring: true,
    make: health,
    colors: { hospital: 0xeb5757, doctors: 0xbb6bd9, other: 0xbdbdbd },
    colorKey: (kind) => ({ kind }),
  },
  schools: {
    id: 'sa-schools',
    name: 'SA schools (Giga)',
    source: 'Giga · DBE',
    size: 8,
    ring: false,
    make: schools,
    colors: { yes: 0x27ae60, no: 0xeb5757, unknown: 0x9e9e9e },
    colorKey: (connectivity) => ({ connectivity }),
  },
};

for (const [set, c] of Object.entries(CASES)) {
  test(`${set}: draws one dot per record with the contract fields`, async () => {
    const h = harness(set, sourceOf(payload(set, [c.make(`${set}:a`)])));
    assert.equal(await h.layer.update(), true);
    const dots = h.dots();
    assert.match(dots.spec.id, new RegExp(`^${c.id}:\\d+:dots$`));
    assert.equal(dots.kind, 'icons');
    assert.equal(dots.spec.clampTo, 'both');
    assert.equal(dots.spec.horizonCull, true);
    assert.deepEqual(dots.spec.recede, {});
    assert.equal(dots.show, true);
    const dot = dots.items.get(`${c.id}:${set}:a`);
    assert.ok(dot, 'item id is <layer id>:<record id>');
    assert.equal(dot.height, 'clampGround');
    assert.equal(dot.disableDepthTest, Number.POSITIVE_INFINITY);
    assert.deepEqual(dot.size, [c.size, c.size]);
    assert.ok(typeof dot.image.svg === 'string', 'a generated circle sprite');
    assert.equal(dot.pixelSize, undefined);
    assert.equal(
      dot.image.svg.includes('#fff'),
      c.ring,
      'white ring only on health',
    );
    assert.ok(dot.pos);
    assert.equal(h.layer.id, c.id);
    assert.equal(h.layer.name, c.name);
    assert.equal(h.layer.source, c.source);
    assert.equal(h.layer.updateInterval, 21600000);
    assert.equal(h.layer.getStats().count, 1);
  });

  test(`${set}: sprites take the class colour`, async () => {
    const records = Object.keys(c.colors).map((k, i) =>
      c.make(`${set}:k${i}`, { ...c.colorKey(k), lat: -26 - i }),
    );
    const h = harness(set, sourceOf(payload(set, records)));
    await h.layer.update();
    Object.values(c.colors).forEach((hex, i) => {
      const { svg } = h.dots().items.get(`${c.id}:${set}:k${i}`).image;
      assert.ok(
        svg.includes(`fill="#${hex.toString(16).padStart(6, '0')}"`),
        svg,
      );
    });
  });

  test(`${set}: the real stub renderer places a dot`, async () => {
    const renderer = createStubRenderer();
    const viewer = {};
    bindRenderer(viewer, renderer);
    const api = Object.values(renderer).find(
      (v) => v && typeof v.drawnPosition === 'function',
    );
    const layer = createSaFacilitiesLayer({
      set,
      source: sourceOf(payload(set, [c.make(`${set}:a`)])),
    });
    layer.init(viewer);
    layer.enable();
    await layer.update();
    const setId = api.sets().find((id) => id.endsWith(':dots'));
    assert.ok(setId?.startsWith(`${c.id}:`), 'a dots set is drawn');
    assert.equal(api.setRecord(setId).kind, 'icons');
    const itemId = `${c.id}:${set}:a`;
    assert.ok(api.setRecord(setId).items.get(itemId), 'the dot is stored');
    const placed = api.drawnPosition({ set: setId, id: itemId });
    assert.ok(placed, 'the dot is placed');
    const rec = c.make('x');
    const want = positionToEcef(fromDegrees(rec.lon, rec.lat));
    const got = positionToEcef(placed);
    assert.ok(
      Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z) < 5000,
      'within 5 km of the place',
    );
  });

  test(`${set}: a click shows the card; after a miss the next click still does`, async () => {
    const h = harness(
      set,
      sourceOf(
        payload(set, [c.make(`${set}:a`), c.make(`${set}:b`, { lat: -30 })]),
      ),
    );
    await h.layer.update();
    h.click(`${c.id}:${set}:a`);
    const entries = h.overlay.entries.get(c.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, `${c.id}-card:${set}:a`);
    assert.equal(entries[0].interactive, false);
    assert.equal(
      entries[0].position.x,
      h.dots().items.get(`${c.id}:${set}:a`).pos.x,
    );
    h.click('other:1', 'other:set');
    assert.equal(h.overlay.entries.get(c.id)?.length ?? 0, 0);
    assert.notEqual(h.overlay.visible, false, 'the source is not hidden');
    h.click(`${c.id}:${set}:b`);
    assert.equal(h.overlay.entries.get(c.id)[0].id, `${c.id}-card:${set}:b`);
    h.click(null);
    assert.equal(h.overlay.entries.get(c.id)?.length ?? 0, 0);
    assert.notEqual(h.overlay.visible, false);
  });

  test(`${set}: a card painted on top takes the click and keeps the selection`, async () => {
    let cardHit = null;
    const h = harness(set, sourceOf(payload(set, [c.make(`${set}:a`)])), {
      clickCard: () => cardHit,
    });
    await h.layer.update();
    h.click(`${c.id}:${set}:a`);
    cardHit = { sourceId: 'sa-weather-warnings', entryId: 'x' };
    h.click(null);
    assert.equal(h.overlay.entries.get(c.id).length, 1);
  });

  test(`${set}: a pick from another set is not this layer's dot`, async () => {
    const h = harness(set, sourceOf(payload(set, [c.make(`${set}:a`)])));
    await h.layer.update();
    h.click(`${c.id}:${set}:a`, 'sa-news:9:dots');
    assert.equal(h.overlay.entries.get(c.id)?.length ?? 0, 0);
  });

  test(`${set}: a refresh that drops the selected record clears only its card`, async () => {
    let next = payload(set, [
      c.make(`${set}:a`),
      c.make(`${set}:b`, { lat: -30 }),
    ]);
    const h = harness(set, { getSnapshot: async () => next });
    await h.layer.update();
    h.click(`${c.id}:${set}:a`);
    next = payload(set, [c.make(`${set}:b`, { lat: -30 })]);
    await h.layer.update();
    assert.equal(h.overlay.entries.get(c.id)?.length ?? 0, 0);
    assert.notEqual(h.overlay.visible, false);
  });

  test(`${set}: disable hides the set and clears the card`, async () => {
    const h = harness(set, sourceOf(payload(set, [c.make(`${set}:a`)])));
    await h.layer.update();
    h.click(`${c.id}:${set}:a`);
    h.layer.disable();
    assert.equal(h.dots().show, false);
    assert.equal(h.overlay.entries.get(c.id), undefined);
  });

  test(`${set}: analyst records carry id, name, kind, lat and lon`, async () => {
    const h = harness(set, sourceOf(payload(set, [c.make(`${set}:a`)])));
    await h.layer.update();
    const records = h.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.deepEqual(Object.keys(records[0]).sort(), [
      'id',
      'kind',
      'lat',
      'lon',
      'name',
    ]);
    assert.equal(records[0].id, `${set}:a`);
    assert.equal(h.layer.getAnalystRecords(0).length, 1);
  });
}

test('health legend counts every class in order, zero included, with the blurb', async () => {
  const h = harness(
    'health',
    sourceOf(
      payload('health', [
        health('a', { kind: 'clinic' }),
        health('b', { kind: 'clinic', lat: -30 }),
        health('c', { kind: 'dentist', lat: -31 }),
      ]),
    ),
  );
  await h.layer.update();
  const { legend, info } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((r) => [r.label, r.count, r.color]),
    [
      ['Hospital', 0, '#eb5757'],
      ['Clinic', 2, '#f2994a'],
      ['Doctor', 0, '#bb6bd9'],
      ['Pharmacy', 0, '#27ae60'],
      ['Dentist', 1, '#56ccf2'],
      ['Other', 0, '#bdbdbd'],
    ],
  );
  assert.equal(
    legend[0].blurb,
    'Hospitals, clinics, doctors, pharmacies and dentists mapped in OpenStreetMap, via healthsites.io.',
  );
  assert.equal(info, undefined);
});

test('schools legend counts the connectivity states with the blurb', async () => {
  const h = harness(
    'schools',
    sourceOf(
      payload('schools', [
        schools('s1', { connectivity: 'no' }),
        schools('s2', { connectivity: 'no', lat: -30 }),
        schools('s3', { connectivity: 'yes', lat: -31 }),
      ]),
    ),
  );
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((r) => [r.label, r.count, r.color]),
    [
      ['Connected', 1, '#27ae60'],
      ['Not connected', 2, '#eb5757'],
      ['Unknown', 0, '#9e9e9e'],
    ],
  );
  assert.equal(
    legend[0].blurb,
    'School locations from Giga, coloured by whether the school is connected to the internet.',
  );
});

test('a stale payload says when the copy was made, in SAST', async () => {
  const h = harness(
    'health',
    sourceOf(
      payload('health', [health('a')], {
        stale: true,
        fetchedAt: '2026-11-24T23:30:00.000Z',
      }),
    ),
  );
  await h.layer.update();
  assert.equal(
    h.layer.getRowControls().info,
    'Showing the last copy from Nov 25, 2026; refresh failed',
  );
});

test('the stale date is one locale-aware date, in that locale’s own order', async (t) => {
  t.after(() => {
    setLocale('en');
    setMessageOverrides({});
  });
  const h = harness(
    'health',
    sourceOf(
      payload('health', [health('a')], {
        stale: true,
        fetchedAt: '2026-11-24T23:30:00.000Z',
      }),
    ),
  );
  await h.layer.update();
  setLocale('ja');
  setMessageOverrides({
    ja: { 'Showing the last copy from {date}; refresh failed': '{date}' },
  });
  // Year first, as Japanese writes it; not "25日 11月 2026年".
  assert.equal(h.layer.getRowControls().info, '2026年11月25日');
  setLocale('de');
  setMessageOverrides({
    de: { 'Showing the last copy from {date}; refresh failed': '{date}' },
  });
  assert.equal(h.layer.getRowControls().info, '25. Nov. 2026');
});

test('a stale payload without a usable fetchedAt drops the date, not the line', async () => {
  for (const fetchedAt of [null, 'nope']) {
    const h = harness(
      'health',
      sourceOf(payload('health', [health('a')], { stale: true, fetchedAt })),
    );
    await h.layer.update();
    assert.equal(
      h.layer.getRowControls().info,
      'Showing the last copy; refresh failed',
    );
  }
});

test('a source that fails with nothing held says the data is unavailable', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let next = new Error('SA facilities HTTP 503');
  const h = harness('schools', {
    getSnapshot: async () => {
      if (next instanceof Error) throw next;
      return next;
    },
  });
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getRowControls().info, 'Data unavailable');
  assert.equal(h.layer.getStats().error, 'SA facilities HTTP 503');
  next = payload('schools', [schools('a')]);
  assert.equal(await h.layer.update(), true);
  assert.equal(h.layer.getRowControls().info, undefined);
  assert.equal(h.layer.getStats().error, null);
});

test('a failed refresh keeps the dots and does not claim the data is unavailable', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let next = payload('health', [health('a')]);
  const h = harness('health', {
    getSnapshot: async () => {
      if (next instanceof Error) throw next;
      return next;
    },
  });
  await h.layer.update();
  next = new Error('SA facilities HTTP 502');
  assert.equal(await h.layer.update(), false);
  assert.equal(h.dots().items.size, 1);
  assert.equal(h.layer.getRowControls().info, undefined);
  assert.equal(h.layer.getStats().error, 'SA facilities HTTP 502');
  next = { records: 'x' };
  assert.equal(await h.layer.update(), false);
  assert.equal(h.dots().items.size, 1);
});

test('the normaliser drops bad records before they are drawn', async () => {
  const h = harness(
    'health',
    sourceOf(
      payload('health', [
        health('a'),
        health('b', { lat: NaN }),
        health('c', { kind: 'morgue' }),
      ]),
    ),
  );
  await h.layer.update();
  assert.equal(h.dots().items.size, 1);
  assert.equal(h.layer.getStats().count, 1);
});

test('legend class names read their own contexts, not the shared keys', async (t) => {
  t.after(() => setMessageOverrides({}));
  setMessageOverrides({
    en: {
      Hospital: 'WRONG',
      Other: 'WRONG',
      Connected: 'WRONG',
      Unknown: 'WRONG',
      'health facility|Hospital': 'Hospitaal',
      'health facility|Other': 'Ander',
      'internet access|Connected': 'Gekoppel',
      'internet access|Unknown': 'Onbekend',
    },
  });
  const a = harness('health', sourceOf(payload('health', [health('a')])));
  await a.layer.update();
  const healthRows = a.layer.getRowControls().legend;
  assert.equal(healthRows[0].label, 'Hospitaal');
  assert.equal(healthRows[5].label, 'Ander');
  const b = harness('schools', sourceOf(payload('schools', [schools('a')])));
  await b.layer.update();
  const schoolRows = b.layer.getRowControls().legend;
  assert.equal(schoolRows[0].label, 'Gekoppel');
  assert.equal(schoolRows[2].label, 'Onbekend');
});

test('records of one class share one sprite, built once per colour', async () => {
  const h = harness(
    'health',
    sourceOf(payload('health', [health('a'), health('b', { lat: -30 })])),
  );
  await h.layer.update();
  const [a, b] = [...h.dots().items.values()];
  assert.equal(a.image, b.image);
});

test('legend counts are computed once per update, not per call', async () => {
  const h = harness('health', sourceOf(payload('health', [health('a')])));
  await h.layer.update();
  const first = h.layer.getRowControls().legend;
  assert.equal(first[1].count, 1);
  assert.deepEqual(h.layer.getRowControls().legend, first);
});

test('an unknown set or a missing source is refused', () => {
  assert.throws(
    () => createSaFacilitiesLayer({ set: 'roads', source: sourceOf({}) }),
    TypeError,
  );
  assert.throws(() => createSaFacilitiesLayer({ set: 'health' }), TypeError);
});
