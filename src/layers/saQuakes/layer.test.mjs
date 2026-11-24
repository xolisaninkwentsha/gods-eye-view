import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaQuakesLayer } from './index.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const quake = (stableId, ageMs, extra = {}) => ({
  stableId,
  lon: 28 + (stableId.charCodeAt(0) % 10) / 10,
  lat: -26,
  depthKm: null,
  mag: 2.6,
  magType: 'ml',
  timeMs: NOW - ageMs,
  region: 'South Africa',
  network: 'SASN',
  ...extra,
});

const liveSet = (draw, suffix) =>
  [...draw.sets.values()].find(
    (record) => !record.disposed && record.spec.id.endsWith(suffix),
  );

function harness(source, options = {}) {
  const overlay = { entries: new Map(), visible: null, cleared: 0 };
  const viewer = { scene: { pick: () => null } };
  const { draw } = bindFakeDraw(viewer);
  const input = fakeInputUnderLabel(viewer);
  let pickResult = null;
  viewer.scene.pick = () => pickResult;
  let now = options.now ?? NOW;
  const layer = createSaQuakesLayer({
    source,
    now: () => now,
    overlayHost: {
      setEntries: (id, entries) => overlay.entries.set(id, entries),
      setVisible: (id, visible) => {
        overlay.visible = visible;
      },
      clearSource: (id) => {
        overlay.cleared++;
        overlay.entries.delete(id);
      },
      hitTest: () => null,
    },
    inputFor: () => input.input,
    picking: {
      resolvePickId: (picked) => picked?.id?.id ?? picked?.id ?? null,
      isOwnedByOtherLayer: () => false,
      clickCard: () => null,
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  const dotsId = liveSet(draw, ':dots').spec.id;
  return {
    layer,
    draw,
    overlay,
    setNow: (ms) => {
      now = ms;
    },
    click: (id) => {
      pickResult = id ? { id: { set: dotsId, id } } : null;
      input.click({ x: 10, y: 10 });
    },
    dots: () => liveSet(draw, ':dots'),
  };
}

const sourceOf = (rows) => ({ getSnapshot: async () => rows });
const red = 0xeb / 255;
const amber = 0xf2 / 255;

test('draws a dot per event, newest last, coloured by age', async () => {
  const h = harness(
    sourceOf([
      quake('N', 2 * HOUR, { mag: 4.5 }),
      quake('W', 3 * DAY),
      quake('M', 20 * DAY),
    ]),
  );
  assert.equal(await h.layer.update(), true);
  assert.deepEqual(
    [...h.dots().items.keys()],
    ['sa-quake:M', 'sa-quake:W', 'sa-quake:N'],
  );
  assert.match(h.dots().spec.id, /^sa-earthquakes:\d+:dots$/);
  assert.equal(h.dots().spec.clampTo, 'both');
  const newest = h.dots().items.get('sa-quake:N');
  assert.ok(Math.abs(newest.color[0] - red) < 1e-9, 'newest is red');
  assert.equal(newest.pixelSize, 6 + 3 * 2.5);
  assert.deepEqual(newest.outlineColor, [1, 1, 1, 0.9]);
  assert.equal(newest.outlineWidth, 1);
  const week = h.dots().items.get('sa-quake:W');
  assert.ok(Math.abs(week.color[0] - amber) < 1e-9);
  assert.equal(h.dots().show, true);
  assert.equal(h.layer.getStats().count, 3);
  assert.equal(h.layer.id, 'sa-earthquakes');
  assert.equal(h.layer.name, 'SA earthquakes (30 days)');
  assert.equal(h.layer.updateInterval, 600000);
});

test('clicking a dot shows its card and clicking empty ground clears it', async () => {
  const h = harness(sourceOf([quake('A', HOUR)]));
  await h.layer.update();
  h.click('sa-quake:A');
  const entries = h.overlay.entries.get('sa-earthquakes');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-quake-card:A');
  assert.ok(entries[0].position, 'card carries a world anchor');
  h.click(null);
  assert.equal(h.overlay.entries.get('sa-earthquakes')?.length ?? 0, 0);
});

test('an empty list draws nothing and is not an error', async () => {
  const h = harness(sourceOf([]));
  assert.equal(await h.layer.update(), true);
  assert.equal(h.dots().items.size, 0);
  assert.equal(h.layer.getStats().error, null);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.layer.getRowControls().legend.length, 3);
});

test('disable clears', async () => {
  const h = harness(sourceOf([quake('A', HOUR)]));
  await h.layer.update();
  h.click('sa-quake:A');
  h.layer.disable();
  assert.equal(h.dots().show, false);
  assert.equal(h.overlay.entries.get('sa-earthquakes'), undefined);
  assert.equal(h.overlay.visible, false);
});

test('the selected event ageing out clears its card but not the source', async () => {
  let rows = [quake('A', 29 * DAY), quake('B', HOUR)];
  const h = harness({ getSnapshot: async () => rows });
  await h.layer.update();
  h.click('sa-quake:A');
  assert.equal(h.overlay.entries.get('sa-earthquakes').length, 1);
  rows = [quake('B', HOUR)];
  await h.layer.update();
  assert.equal(h.overlay.entries.get('sa-earthquakes'), undefined);
  h.click('sa-quake:B');
  const entries = h.overlay.entries.get('sa-earthquakes');
  assert.equal(entries[0].id, 'sa-quake-card:B');
  assert.equal(h.overlay.visible, true, 'the card source stays visible');
});

test('an unchanged snapshot does not redraw, but ageing a band does', async () => {
  const h = harness(sourceOf([quake('A', 23 * HOUR)]));
  await h.layer.update();
  const before = h.dots().writes;
  await h.layer.update();
  assert.equal(h.dots().writes, before);
  h.setNow(NOW + 2 * HOUR);
  await h.layer.update();
  assert.equal(h.dots().writes, before + 1);
  const dot = h.dots().items.get('sa-quake:A');
  assert.ok(Math.abs(dot.color[0] - amber) < 1e-9, 'now in the week band');
});

test('the legend counts the age bands and analyst records list events', async () => {
  const h = harness(
    sourceOf([quake('A', HOUR), quake('B', 2 * HOUR), quake('C', 3 * DAY)]),
  );
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((r) => [r.label, r.count]),
    [
      ['Last 24 hours', 2],
      ['Last 7 days', 1],
      ['Last 30 days', 0],
    ],
  );
  assert.match(legend[0].blurb, /seismograph network/);
  const [record] = h.layer.getAnalystRecords(1);
  assert.deepEqual(Object.keys(record).sort(), [
    'id',
    'lat',
    'lon',
    'magnitude',
    'region',
    'timeMs',
  ]);
});

test('a source error is reported in getStats', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let fail = false;
  const h = harness({
    getSnapshot: async () => {
      if (fail) throw new Error('EMSC HTTP 502');
      return [quake('A', HOUR)];
    },
  });
  await h.layer.update();
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().error, 'EMSC HTTP 502');
});
