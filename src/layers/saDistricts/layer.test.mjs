import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaDistrictsLayer } from './index.js';
import { normalizeGovernance } from '../saGovernance/records.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { createStubRenderer } from '../../render/stub/index.js';
import { bindRenderer } from '../../render/rendererOf.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const ring = [
  [28.0, -26.2],
  [28.1, -26.2],
  [28.1, -26.1],
  [28.0, -26.2],
];
const district = (code, extra = {}) => ({
  id: code,
  stableId: code,
  code,
  name: `District ${code}`,
  province: 'Gauteng',
  category: 'C',
  polygons: [[ring], [ring]],
  members: [{ code: `${code}-1`, name: 'Local' }],
  ...extra,
});
const gov = normalizeGovernance({
  audits: { year: 2025, byCode: {} },
  auditsStatus: 'ok',
  interventions: {
    asOf: '2026-08',
    rows: [{ code: 'DC1', since: '2025', type: 'Section 139(1)(b)' }],
  },
});

const liveSet = (draw, suffix) =>
  [...draw.sets.values()].find(
    (record) => !record.disposed && record.spec.id.endsWith(suffix),
  );

const sourceOf = ({ districts, governance }) => ({
  getDistricts: async () => {
    if (districts instanceof Error) throw districts;
    return { areas: districts, stale: false, fetchedAt: null };
  },
  getSnapshot: async () => {
    if (governance instanceof Error) throw governance;
    return governance;
  },
});

function harness(source) {
  const overlay = { entries: new Map(), visible: null, cleared: 0 };
  const viewer = { scene: { pick: () => null } };
  const { draw } = bindFakeDraw(viewer);
  const input = fakeInputUnderLabel(viewer);
  let pickResult = null;
  viewer.scene.pick = () => pickResult;
  const layer = createSaDistrictsLayer({
    source,
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
  layer.enable();
  return {
    layer,
    overlay,
    click: (suffix, id) => {
      pickResult = id
        ? { id: { set: liveSet(draw, suffix).spec.id, id } }
        : null;
      input.click({ x: 10, y: 10 });
    },
    fills: () => liveSet(draw, ':fills'),
    lines: () => liveSet(draw, ':lines'),
  };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('outlines are red for listed districts and grey for the rest; fills are not pickable', async () => {
  const h = harness(
    sourceOf({
      districts: [district('DC1'), district('DC2')],
      governance: gov,
    }),
  );
  assert.equal(await h.layer.update(), true);
  assert.deepEqual(
    [...h.lines().items.keys()],
    [
      'sa-district:DC1:0',
      'sa-district:DC1:1',
      'sa-district:DC2:0',
      'sa-district:DC2:1',
    ],
  );
  const red = h.lines().items.get('sa-district:DC1:0');
  assert.equal(red.mode, 'draped');
  assert.equal(red.widthPx, 3);
  assert.equal(red.style.kind, 'solid');
  assert.ok(near(red.style.color[0], 0xeb / 255));
  assert.notEqual(red.pickable, false);
  const grey = h.lines().items.get('sa-district:DC2:0');
  assert.ok(near(grey.style.color[0], 0xd0 / 255));
  for (const fill of h.fills().items.values()) {
    assert.equal(fill.pickable, false);
    assert.equal(fill.height, 'clampGround');
    assert.equal(fill.fill[3], 0.03);
    assert.equal(fill.geometry.kind, 'polygon');
  }
  assert.equal(h.fills().spec.pickable, false, 'the fills set is unpickable');
  assert.notEqual(h.lines().spec.pickable, false, 'the lines set is pickable');
  // Above the council and ward sets (default 0), whichever layer drew first.
  assert.ok(h.lines().spec.groundOrder > 0, 'the outlines draw over councils');
  assert.equal(h.fills().spec.groundOrder ?? 0, 0, 'the fills stay under');
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.id, 'sa-districts-2026');
});

test('clicking an outline opens the card; clicking a fill does nothing', async () => {
  const h = harness(
    sourceOf({ districts: [district('DC1')], governance: gov }),
  );
  await h.layer.update();
  h.click(':fills', 'sa-district:DC1:0');
  assert.equal(h.overlay.entries.get('sa-districts-2026'), undefined);
  h.click(':lines', 'sa-district:DC1:1');
  const entries = h.overlay.entries.get('sa-districts-2026');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-district-card:DC1');
  assert.ok(entries[0].position, 'card carries a world anchor');
  assert.equal(entries[0].accent, '#eb5757');
  h.click(null);
  assert.equal(h.overlay.entries.get('sa-districts-2026')?.length ?? 0, 0);
});

test('governance failing draws every outline grey and the card says the audit is unavailable', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const h = harness(
    sourceOf({
      districts: [district('DC1')],
      governance: new Error('down'),
    }),
  );
  assert.equal(await h.layer.update(), true);
  const line = h.lines().items.get('sa-district:DC1:0');
  assert.ok(near(line.style.color[0], 0xd0 / 255));
  h.click(':lines', 'sa-district:DC1:0');
  const [card] = h.overlay.entries.get('sa-districts-2026');
  assert.equal(card.details.at(-1), 'Audit: unavailable');
  const { legend } = h.layer.getRowControls();
  assert.equal(legend.length, 1);
  assert.equal(legend[0].label, 'District');
  assert.equal(
    legend[0].blurb,
    'Intervention list unavailable\nClick a district outline for its card.',
  );
});

test('districts failing fails the update and keeps the last drawn set', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let fail = false;
  const h = harness({
    getDistricts: async () => {
      if (fail) throw new Error('MDB HTTP 502');
      return { areas: [district('DC1')], stale: false, fetchedAt: null };
    },
    getSnapshot: () => {
      throw new Error('sync throw');
    },
  });
  await h.layer.update();
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().error, 'MDB HTTP 502');
  assert.equal(h.lines().items.size, 2);
});

test('the legend counts listed and all districts', async () => {
  const h = harness(
    sourceOf({
      districts: [district('DC1'), district('DC2'), district('DC3')],
      governance: gov,
    }),
  );
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((r) => [r.label, r.color, r.count]),
    [
      ['Section 139 (CoGTA list, Aug 2026)', '#eb5757', 1],
      ['District', '#d0d7de', 3],
    ],
  );
  assert.equal(legend[0].blurb, 'Click a district outline for its card.');
});

test('disable hides the sets and clears the card', async () => {
  const h = harness(
    sourceOf({ districts: [district('DC1')], governance: gov }),
  );
  await h.layer.update();
  h.click(':lines', 'sa-district:DC1:0');
  h.layer.disable();
  assert.equal(h.fills().show, false);
  assert.equal(h.lines().show, false);
  assert.equal(h.overlay.entries.get('sa-districts-2026'), undefined);
  assert.equal(h.overlay.visible, false);
});

test('an update that drops the selected district clears the card but keeps the source visible', async () => {
  let areas = [district('DC1'), district('DC2')];
  const h = harness({
    getDistricts: async () => ({ areas, stale: false, fetchedAt: null }),
    getSnapshot: async () => gov,
  });
  await h.layer.update();
  h.click(':lines', 'sa-district:DC1:0');
  areas = [district('DC2')];
  await h.layer.update();
  assert.equal(h.overlay.entries.get('sa-districts-2026'), undefined);
  assert.notEqual(h.overlay.visible, false);
});

test('the real stub renderer places an outline', async () => {
  const renderer = createStubRenderer();
  const viewer = {};
  bindRenderer(viewer, renderer);
  const api = Object.values(renderer).find(
    (v) => v && typeof v.drawnPosition === 'function',
  );
  const layer = createSaDistrictsLayer({
    source: sourceOf({ districts: [district('DC1')], governance: gov }),
  });
  layer.init(viewer);
  layer.enable();
  await layer.update();
  const lineSet = api.sets().find((id) => id.endsWith(':lines'));
  assert.ok(lineSet?.startsWith('sa-districts-2026:'), 'a lines set is drawn');
  const record = api.setRecord(lineSet);
  assert.equal(record.kind, 'lines');
  const line = record.items.get('sa-district:DC1:0');
  assert.ok(line, 'the outline is placed');
  assert.equal(line.positions.length, ring.length);
  const fillSet = api.sets().find((id) => id.endsWith(':fills'));
  assert.equal(api.setRecord(fillSet).items.size, 2);
});
