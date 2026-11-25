import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaPopulationLayer } from './index.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { createStubRenderer } from '../../render/stub/index.js';
import { bindRenderer } from '../../render/rendererOf.js';
import { setMessageOverrides } from '../../i18n/index.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const GRID = {
  cellDeg: 0.1,
  total: 60489559,
  cells: [
    [-26.3, 27.9, 1234],
    [-33.9, 18.4, 250000],
    [-29.1, 26.2, 150],
  ],
};

test.beforeEach((t) => {
  setMessageOverrides({});
  t.mock.method(console, 'log', () => {});
});

const liveFills = (draw) =>
  [...draw.sets.values()].find(
    (record) => !record.disposed && record.spec.id.endsWith(':fills'),
  );

function harness(loadGrid = async () => GRID) {
  const overlay = { entries: new Map(), visible: null };
  const viewer = { scene: { pick: () => null } };
  const { draw } = bindFakeDraw(viewer);
  const input = fakeInputUnderLabel(viewer);
  let pickResult = null;
  viewer.scene.pick = () => pickResult;
  const layer = createSaPopulationLayer({
    loadGrid,
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
      clickCard: () => null,
    },
  });
  layer.init(viewer);
  layer.enable();
  const setId = liveFills(draw).spec.id;
  return {
    layer,
    overlay,
    click: (id) => {
      pickResult = id ? { id: { set: setId, id } } : null;
      input.click({ x: 10, y: 10 });
    },
    fills: () => liveFills(draw),
  };
}

test('draws one flat ground fill per cell with band colour and alpha', async () => {
  const h = harness();
  assert.equal(await h.layer.update(), true);
  const fills = h.fills();
  assert.match(fills.spec.id, /^sa-population:\d+:fills$/);
  assert.equal(fills.kind, 'shapes');
  assert.equal(fills.spec.clampTo, 'both');
  assert.equal(fills.show, true);
  assert.equal(fills.items.size, 3);
  const item = fills.items.get('sa-population:0');
  assert.equal(item.height, 'clampGround');
  assert.equal(item.geometry.kind, 'polygon');
  const [ring] = item.geometry.rings;
  const corner = ({ lon, lat }) => [lon, lat].map((v) => Math.round(v * 10));
  assert.deepEqual(ring.map(corner), [
    [279, -263],
    [280, -263],
    [280, -262],
    [279, -262],
    [279, -263],
  ]);
  const [r, g, b, a] = item.fill;
  assert.equal(a, 0.55);
  assert.deepEqual(
    [r, g, b].map((v) => Math.round(v * 255)),
    [0xfe, 0xcc, 0x5c],
  );
  assert.equal(item.outline, undefined);
  assert.equal(fills.items.get('sa-population:1').fill[0] * 255, 0xbd);
  assert.equal(h.layer.id, 'sa-population');
  assert.equal(h.layer.name, 'SA population (Kontur 2023)');
  assert.equal(h.layer.source, 'Kontur');
  assert.equal(h.layer.updateInterval, 0);
  assert.equal(h.layer.getStats().count, 3);
});

test('the real stub renderer stores a fill', async () => {
  const renderer = createStubRenderer();
  const viewer = {};
  bindRenderer(viewer, renderer);
  const api = Object.values(renderer).find(
    (v) => v && typeof v.drawnPosition === 'function',
  );
  const layer = createSaPopulationLayer({ loadGrid: async () => GRID });
  layer.init(viewer);
  layer.enable();
  await layer.update();
  const setId = api.sets().find((id) => id.endsWith(':fills'));
  assert.ok(setId?.startsWith('sa-population:'), 'a fills set is drawn');
  assert.equal(api.setRecord(setId).kind, 'shapes');
  assert.ok(api.setRecord(setId).items.get('sa-population:0'));
  // A polygon has no single position for drawnPosition; the stub keeps the
  // item the layer drew, so its square is what is checked.
  const item = api.setRecord(setId).items.get('sa-population:0');
  assert.equal(item.height, 'clampGround');
  const lons = item.geometry.rings[0].map((p) => p.lon);
  const lats = item.geometry.rings[0].map((p) => p.lat);
  assert.deepEqual(
    [Math.min(...lons), Math.max(...lons)].map((v) => Math.round(v * 10)),
    [279, 280],
  );
  assert.deepEqual(
    [Math.min(...lats), Math.max(...lats)].map((v) => Math.round(v * 10)),
    [-263, -262],
  );
});

test('a click shows the card; a miss clears it without hiding the source', async () => {
  const h = harness();
  await h.layer.update();
  h.click('sa-population:0');
  const entries = h.overlay.entries.get('sa-population');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-population-card:0');
  assert.equal(entries[0].title, 'About 1,200 people in this 10 km square');
  assert.deepEqual(entries[0].details, ['Kontur Population 2023 (modelled)']);
  assert.equal(entries[0].interactive, false);
  assert.ok(entries[0].position);
  h.click(null);
  assert.equal(h.overlay.entries.get('sa-population'), undefined);
  assert.notEqual(h.overlay.visible, false);
  h.click('sa-population:1');
  assert.equal(
    h.overlay.entries.get('sa-population')[0].title,
    'About 250,000 people in this 10 km square',
  );
});

test('the legend counts each band and states the total', async () => {
  const h = harness();
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((row) => row.label),
    ['100–999', '1,000–9,999', '10,000–49,999', '50,000–199,999', '200,000+'],
  );
  assert.deepEqual(
    legend.map((row) => row.count),
    [1, 1, 0, 0, 1],
  );
  assert.deepEqual(
    legend.map((row) => row.color),
    ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
  );
  assert.match(legend[0].blurb, /^People per square of about 10 km/);
  assert.match(legend[0].blurb, /Squares with fewer than 100 people/);
  assert.ok(legend[0].blurb.endsWith('60.5 million people in all'));
});

test('disable hides the fills and clears the card', async () => {
  const h = harness();
  await h.layer.update();
  h.click('sa-population:0');
  h.layer.disable();
  assert.equal(h.fills().show, false);
  assert.equal(h.overlay.entries.get('sa-population'), undefined);
  assert.equal(h.overlay.visible, false);
});

test('the grid loads once across two enables', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls += 1;
    return GRID;
  });
  await h.layer.update();
  h.layer.disable();
  h.layer.enable();
  await h.layer.update();
  assert.equal(calls, 1);
  assert.equal(h.fills().items.size, 3);
  assert.equal(h.fills().show, true);
});

test('a failed load says so and a later update retries', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return GRID;
  });
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getRowControls().info, 'Data unavailable');
  assert.equal(await h.layer.update(), true);
  assert.equal(h.layer.getRowControls().info, undefined);
  assert.equal(calls, 2);
});

test('analyst records list the most populous squares first', async () => {
  const h = harness();
  await h.layer.update();
  assert.deepEqual(h.layer.getAnalystRecords(), [
    { id: 'sa-population:1', people: 250000, south: -33.9, west: 18.4 },
    { id: 'sa-population:0', people: 1234, south: -26.3, west: 27.9 },
    { id: 'sa-population:2', people: 150, south: -29.1, west: 26.2 },
  ]);
  h.layer.disable();
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('the committed grid has the shape the layer reads', async () => {
  const { loadBundledJson } = await import('../../data/bundledJson.js');
  const data = await loadBundledJson(
    new URL('./sa-population-grid.json', import.meta.url),
  );
  assert.equal(data.cellDeg, 0.1);
  assert.ok(Array.isArray(data.cells) && data.cells.length > 0);
  assert.equal(data.cells[0].length, 3);
});
