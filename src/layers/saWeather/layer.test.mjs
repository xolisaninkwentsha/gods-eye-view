import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaWeatherLayer } from './index.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const ring = [
  [28.0, -26.2],
  [28.1, -26.2],
  [28.1, -26.1],
  [28.0, -26.2],
];
const NOW = Date.parse('2026-11-24T10:00:00Z');
const HOUR = 3600 * 1000;

const warning = (band, expiresMs, extra = {}) => ({
  event: `${band} event`,
  level: { yellow: 2, orange: 6, red: 9 }[band],
  band,
  levelText: 'Level',
  severity: 'Moderate',
  onsetMs: NOW - HOUR,
  expiresMs,
  sentMs: NOW - 2 * HOUR,
  headline: 'h',
  description: 'd',
  instruction: 'i',
  office: 'GP',
  ...extra,
});
const area = (stableId, band, expiresMs = NOW + 5 * HOUR, extra = {}) => ({
  stableId,
  name: `Area ${stableId}`,
  polygons: [[ring]],
  band,
  warnings: [warning(band, expiresMs)],
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
  const layer = createSaWeatherLayer({
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
  const fillsId = liveSet(draw, ':fills').spec.id;
  return {
    layer,
    draw,
    overlay,
    setNow: (ms) => {
      now = ms;
    },
    click: (id) => {
      pickResult = id ? { id: { set: fillsId, id } } : null;
      input.click({ x: 10, y: 10 });
    },
    fills: () => liveSet(draw, ':fills'),
    lines: () => liveSet(draw, ':lines'),
  };
}

const sourceOf = (rows) => ({
  getSnapshot: async () => rows,
});

test('draws one fill per area, red last', async () => {
  const h = harness(
    sourceOf([area('Y', 'yellow'), area('R', 'red'), area('O', 'orange')]),
  );
  assert.equal(await h.layer.update(), true);
  assert.deepEqual(
    [...h.fills().items.keys()],
    ['sa-weather:Y:0', 'sa-weather:O:0', 'sa-weather:R:0'],
  );
  const fill = h.fills().items.get('sa-weather:R:0');
  assert.equal(fill.height, 'clampGround');
  assert.equal(fill.fill[3], 0.35);
  assert.ok(Math.abs(fill.fill[0] - 0xeb / 255) < 1e-9, 'red');
  const line = h.lines().items.get('sa-weather:R:0');
  assert.equal(line.mode, 'draped');
  assert.equal(line.widthPx, 2);
  assert.equal(line.style.color[3], 0.9);
  assert.equal(h.fills().show, true);
  assert.equal(h.layer.getStats().count, 3);
  assert.equal(h.layer.id, 'sa-weather-warnings');
  assert.equal(h.layer.name, 'SA weather warnings');
});

test('drops warnings that expired since the server answered', async () => {
  const h = harness(
    sourceOf([
      area('A', 'orange', NOW + HOUR),
      area('B', 'red', NOW + 5 * HOUR),
      {
        ...area('C', 'yellow', NOW + 5 * HOUR),
        warnings: [
          warning('yellow', NOW + 5 * HOUR),
          warning('yellow', NOW + HOUR, { event: 'gone' }),
        ],
      },
    ]),
    { now: NOW + 2 * HOUR },
  );
  await h.layer.update();
  assert.deepEqual(
    [...h.fills().items.keys()],
    ['sa-weather:C:0', 'sa-weather:B:0'],
  );
  const records = h.layer.getAnalystRecords();
  const c = records.find((r) => r.id === 'C');
  assert.equal(c.warnings, 1);
  assert.equal(h.layer.getStats().count, 2);
});

test('clicking an area shows its card and clicking empty ground clears it', async () => {
  const h = harness(sourceOf([area('A', 'red')]));
  await h.layer.update();
  h.click('sa-weather:A:0');
  const entries = h.overlay.entries.get('sa-weather-warnings');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-weather-card:A');
  assert.ok(entries[0].position, 'card carries a world anchor');
  h.click(null);
  assert.equal(h.overlay.entries.get('sa-weather-warnings')?.length ?? 0, 0);
});

test("the selected area's card goes when its warnings expire", async () => {
  const h = harness(
    sourceOf([
      area('A', 'red', NOW + HOUR),
      area('B', 'yellow', NOW + 9 * HOUR),
    ]),
  );
  await h.layer.update();
  h.click('sa-weather:A:0');
  assert.equal(h.overlay.entries.get('sa-weather-warnings').length, 1);
  h.setNow(NOW + 2 * HOUR);
  await h.layer.update();
  assert.deepEqual([...h.fills().items.keys()], ['sa-weather:B:0']);
  assert.equal(h.overlay.entries.get('sa-weather-warnings'), undefined);
  assert.ok(h.overlay.cleared >= 1);
});

test('cards still show for another area after the selected one expires', async () => {
  const h = harness(
    sourceOf([
      area('A', 'red', NOW + HOUR),
      area('B', 'yellow', NOW + 9 * HOUR),
    ]),
  );
  await h.layer.update();
  h.click('sa-weather:A:0');
  h.setNow(NOW + 2 * HOUR);
  await h.layer.update();
  h.click('sa-weather:B:0');
  const entries = h.overlay.entries.get('sa-weather-warnings');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-weather-card:B');
  assert.equal(h.overlay.visible, true, 'the card source stays visible');
});

test('an unchanged snapshot does not redraw', async () => {
  const h = harness(sourceOf([area('A', 'red')]));
  await h.layer.update();
  const before = h.fills().writes;
  assert.equal(await h.layer.update(), true);
  assert.equal(h.fills().writes, before);
});

test('an expiry that changes the drawn warnings redraws', async () => {
  const h = harness(
    sourceOf([
      {
        ...area('A', 'red'),
        warnings: [
          warning('red', NOW + 5 * HOUR),
          warning('orange', NOW + HOUR),
        ],
      },
    ]),
  );
  await h.layer.update();
  const before = h.fills().writes;
  h.setNow(NOW + 2 * HOUR);
  await h.layer.update();
  assert.equal(h.fills().writes, before + 1);
});

test('with no warnings the legend says so', async () => {
  const h = harness(sourceOf([]));
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(legend[0], {
    label: 'No warnings in force',
    color: '#9aa4ad',
    count: null,
  });
  assert.deepEqual(
    legend.slice(1).map((r) => [r.label, r.count]),
    [
      ['Yellow', 0],
      ['Orange', 0],
      ['Red', 0],
    ],
  );
  assert.match(legend[1].blurb, /SAWS impact-based warnings/);
});

test('the legend counts the areas in each band', async () => {
  const h = harness(
    sourceOf([area('A', 'red'), area('B', 'red'), area('C', 'yellow')]),
  );
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.equal(legend.length, 3);
  assert.deepEqual(
    legend.map((r) => [r.label, r.count]),
    [
      ['Yellow', 1],
      ['Orange', 0],
      ['Red', 2],
    ],
  );
  assert.ok(legend[0].blurb);
  const [record] = h.layer.getAnalystRecords(1);
  assert.equal(record.events, 'yellow event');
});

test('disable hides the sets and clears the card', async () => {
  const h = harness(sourceOf([area('A', 'red')]));
  await h.layer.update();
  h.click('sa-weather:A:0');
  h.layer.disable();
  assert.equal(h.fills().show, false);
  assert.equal(h.lines().show, false);
  assert.equal(h.overlay.entries.get('sa-weather-warnings'), undefined);
  assert.equal(h.overlay.visible, false);
});

test('a source error is reported in getStats', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let fail = false;
  const h = harness({
    getSnapshot: async () => {
      if (fail) throw new Error('SAWS HTTP 502');
      return [area('A', 'red')];
    },
  });
  await h.layer.update();
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().error, 'SAWS HTTP 502');
});
