import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createSaElectionsLayer } from './index.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';
import { fakeCameraPort } from '../../testSupport/fakeCameraPort.mjs';

const ANC = 'AFRICAN NATIONAL CONGRESS';
const DA = 'DEMOCRATIC ALLIANCE';
const ring = [
  [28.0, -26.2],
  [28.1, -26.2],
  [28.1, -26.1],
  [28.0, -26.2],
];
const liveSet = (draw, suffix) =>
  [...draw.sets.values()].find(
    (record) => !record.disposed && record.spec.id.endsWith(suffix),
  );

const council = (id, party, majority, extra = {}) => ({
  id,
  name: `Council ${id}`,
  code: id,
  polygons: [[ring]],
  result: party
    ? {
        largest: { party, seats: 60 },
        totalSeats: 100,
        majority,
        parties: [{ party, seats: 60 }],
        turnout: 0.5,
      }
    : null,
  ...extra,
});
const ward = (id, party) => ({
  id,
  name: `Ward ${id}`,
  municipality: 'Metro',
  polygons: [[ring], [ring]],
  result: party
    ? {
        winner: { party, votes: 10, share: 0.6 },
        runnerUp: null,
        tie: false,
        margin: 0.2,
        turnout: 0.4,
        confirmed: true,
      }
    : null,
});
const payload = (level, areas, results = 'ok') => ({
  level,
  results,
  resultsAsOf: 1,
  boundariesAsOf: 1,
  areas,
});

function harness(level, source, options = {}) {
  const overlay = { entries: new Map(), visible: null };
  const viewer = { scene: { pick: () => null } };
  const cam = options.pose ? fakeCameraPort({ pose: options.pose }) : null;
  const { draw } = bindFakeDraw(viewer, cam ? { camera: cam.port } : {});
  const input = fakeInputUnderLabel(viewer);
  let pickResult = null;
  viewer.scene.pick = () => pickResult;
  const layer = createSaElectionsLayer({
    level,
    source,
    maxCameraHeightM: options.maxCameraHeightM ?? null,
    repollMs: options.repollMs,
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
  layer.enable(viewer);
  const fillsId = liveSet(draw, ':fills').spec.id;
  return {
    layer,
    viewer,
    draw,
    cam,
    overlay,
    click: (id) => {
      pickResult = id ? { id: { set: fillsId, id } } : null;
      input.click({ x: 10, y: 10 });
    },
    fills: () => liveSet(draw, ':fills'),
    lines: () => liveSet(draw, ':lines'),
  };
}

const sourceOf = (data) => ({ getSnapshot: async () => data });

test('draws a fill and an outline per polygon in party colours', async () => {
  const h = harness(
    'wards',
    sourceOf(payload('wards', [ward('w1', ANC), ward('w2', DA)])),
  );
  assert.equal(await h.layer.update(), true);
  const ids = ['w1:0', 'w1:1', 'w2:0', 'w2:1'].map((s) => `sa-wards:${s}`);
  assert.deepEqual([...h.fills().items.keys()], ids);
  assert.deepEqual([...h.lines().items.keys()], ids);
  const fill = h.fills().items.get(ids[0]);
  assert.equal(fill.height, 'clampGround');
  assert.equal(fill.geometry.kind, 'polygon');
  assert.equal(fill.fill[3], 0.5);
  assert.ok(Math.abs(fill.fill[1] - 0x9d / 255) < 1e-9, 'ANC green');
  const line = h.lines().items.get(ids[0]);
  assert.equal(line.mode, 'draped');
  assert.equal(line.widthPx, 1);
  assert.equal(line.positions.length, ring.length);
  assert.equal(h.fills().show, true);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getStats().stale, false);
  assert.equal(h.layer.id, 'sa-wards-2026');
  assert.equal(h.layer.name, 'SA wards 2026');
});

test('no-majority councils are faint and seat-less ones are outline only', async () => {
  const h = harness(
    'councils',
    sourceOf(
      payload('councils', [
        council('A', ANC, true),
        council('B', DA, false),
        council('C', null, false),
      ]),
    ),
  );
  await h.layer.update();
  assert.equal(h.fills().items.get('sa-councils:A:0').fill[3], 0.5);
  assert.equal(h.fills().items.get('sa-councils:B:0').fill[3], 0.15);
  assert.equal(h.fills().items.has('sa-councils:C:0'), false);
  const grey = h.lines().items.get('sa-councils:C:0');
  assert.ok(grey, 'every area has an outline');
  assert.equal(grey.widthPx, 2);
  assert.ok(Math.abs(grey.style.color[0] - 0x9a / 255) < 1e-9);
  assert.equal(h.layer.id, 'sa-councils-2026');
});

test('results off draws outlines only and says so in the legend', async () => {
  // With the switch off the server sends every area without a result.
  const h = harness(
    'councils',
    sourceOf(payload('councils', [council('A', null)], 'off')),
  );
  await h.layer.update();
  assert.equal(h.fills().items.size, 0);
  assert.equal(h.lines().items.size, 1);
  const { legend } = h.layer.getRowControls();
  assert.equal(legend.length, 1);
  assert.equal(legend[0].blurb, 'Results are off');
});

test('while loading, the areas that have results are drawn and carded', async (t) => {
  const h = harness(
    'wards',
    sourceOf(payload('wards', [ward('w1', ANC), ward('w2', null)], 'loading')),
  );
  t.after(() => h.layer.destroy());
  assert.equal(await h.layer.update(), true);
  assert.deepEqual(
    [...h.fills().items.keys()],
    ['sa-wards:w1:0', 'sa-wards:w1:1'],
  );
  assert.equal(h.lines().items.size, 4, 'every area has an outline');
  const grey = h.lines().items.get('sa-wards:w2:0');
  assert.ok(Math.abs(grey.style.color[0] - 0x9a / 255) < 1e-9);
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((row) => [row.label, row.count]),
    [
      ['ANC', 1],
      ['Other', 0],
    ],
  );
  assert.equal(legend[0].blurb, 'Downloading results from the IEC…');
  h.click('sa-wards:w1:0');
  assert.equal(
    h.overlay.entries.get('sa-wards-2026')[0].details[0],
    'ANC 60.0%',
  );
  h.click('sa-wards:w2:0');
  assert.deepEqual(h.overlay.entries.get('sa-wards-2026')[0].details, [
    'Downloading results from the IEC…',
  ]);
});

test('councils while loading: results drawn, the rest wait, and later say so', async (t) => {
  let state = 'loading';
  const h = harness('councils', {
    getSnapshot: async () =>
      payload(
        'councils',
        [council('A', ANC, true), council('B', DA, false), council('C', null)],
        state,
      ),
  });
  t.after(() => h.layer.destroy());
  await h.layer.update();
  assert.equal(h.fills().items.get('sa-councils:A:0').fill[3], 0.5);
  assert.equal(h.fills().items.get('sa-councils:B:0').fill[3], 0.15);
  assert.equal(h.fills().items.has('sa-councils:C:0'), false);
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((row) => row.label),
    ['ANC', 'DA', 'Other'],
  );
  assert.match(legend[0].blurb, /Downloading results from the IEC…/);
  assert.match(
    legend[0].blurb,
    /Faint: no party holds more than half the seats/,
  );
  h.click('sa-councils:A:0');
  assert.equal(
    h.overlay.entries.get('sa-councils-2026')[0].details[0],
    'ANC · 60 of 100 seats',
  );
  h.click('sa-councils:C:0');
  assert.deepEqual(h.overlay.entries.get('sa-councils-2026')[0].details, [
    'Downloading results from the IEC…',
  ]);
  state = 'ok';
  await h.layer.update();
  assert.deepEqual(h.overlay.entries.get('sa-councils-2026')[0].details, [
    'No result for this council',
  ]);
  assert.equal(
    h.layer.getRowControls().legend[0].blurb,
    'Faint: no party holds more than half the seats',
  );
});

test('while loading with no results at all the legend keeps one status row', async (t) => {
  const h = harness(
    'councils',
    sourceOf(payload('councils', [council('A', null)], 'loading')),
  );
  t.after(() => h.layer.destroy());
  await h.layer.update();
  assert.equal(h.fills().items.size, 0);
  assert.equal(h.lines().items.size, 1);
  const { legend } = h.layer.getRowControls();
  assert.equal(legend.length, 1);
  assert.equal(legend[0].label, 'SA councils 2026');
  assert.equal(legend[0].count, 1);
  assert.equal(legend[0].blurb, 'Downloading results from the IEC…');
});

test("a click opens that area's card", async () => {
  const h = harness('wards', sourceOf(payload('wards', [ward('w1', ANC)])));
  await h.layer.update();
  h.click('sa-wards:w1:1');
  const entries = h.overlay.entries.get('sa-wards-2026');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-ward-card:w1');
  assert.ok(entries[0].position, 'card carries a world anchor');
  h.click(null);
  assert.equal(h.overlay.entries.get('sa-wards-2026')?.length ?? 0, 0);
});

test('the legend has at most 12 rows ending in Other', async () => {
  const parties = Array.from({ length: 14 }, (_, i) => `PARTY ${i}`);
  const areas = parties.flatMap((p, i) =>
    Array.from({ length: 14 - i }, (_, j) => ward(`${i}-${j}`, p)),
  );
  const h = harness('wards', sourceOf(payload('wards', areas)));
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.equal(legend.length, 12);
  assert.equal(legend.at(-1).label, 'Other');
  assert.equal(legend[0].count, 14);
  assert.equal(legend.at(-1).count, 3 + 2 + 1);
  const small = harness(
    'councils',
    sourceOf(
      payload('councils', [council('A', ANC, true), council('B', DA, false)]),
    ),
  );
  await small.layer.update();
  const rows = small.layer.getRowControls().legend;
  assert.deepEqual(
    rows.map((r) => r.label),
    ['ANC', 'DA', 'Other'],
  );
  assert.match(rows[0].blurb, /Faint: no party holds more than half the seats/);
});

test('while loading it re-polls once, and disabling cancels the re-poll', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let calls = 0;
    let state = 'loading';
    const source = {
      getSnapshot: async () => {
        calls++;
        return payload('wards', [ward('w1', ANC)], state);
      },
    };
    const h = harness('wards', source, { repollMs: 5000 });
    await h.layer.update();
    assert.equal(calls, 1);
    state = 'ok';
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, 're-polled after repollMs');
    mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, 'no re-poll once results are in');

    state = 'loading';
    await h.layer.update();
    assert.equal(calls, 3);
    h.layer.disable();
    // Enabled again, a leaked timer would now get past the enabled check.
    h.layer.enable();
    mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 3, 'disable cancelled the re-poll');

    await h.layer.update();
    assert.equal(calls, 4);
    h.layer.destroy();
    h.layer.init(h.viewer);
    h.layer.enable();
    mock.timers.tick(60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 4, 'destroy cancelled the re-poll');
  } finally {
    mock.timers.reset();
  }
});

test('above maxCameraHeightM the wards hide', async () => {
  const h = harness('wards', sourceOf(payload('wards', [ward('w1', ANC)])), {
    maxCameraHeightM: 500_000,
    pose: { height: 2_000_000 },
  });
  await h.layer.update();
  assert.equal(h.fills().show, false);
  assert.equal(h.lines().show, false);
  h.cam.setPose({ height: 100_000 });
  h.cam.emit('moveEnd');
  assert.equal(h.fills().show, true);
  assert.equal(h.lines().show, true);
  h.cam.setPose({ height: 900_000 });
  h.cam.emit('moveEnd');
  assert.equal(h.fills().show, false);
  h.layer.disable();
  assert.equal(h.cam.listenerCount('moveEnd'), 0);
});

test('without a height limit there is no camera subscription', () => {
  const h = harness('wards', sourceOf(payload('wards', [])), {
    pose: { height: 1 },
  });
  assert.equal(h.cam.listenerCount('moveEnd'), 0);
  assert.equal(h.fills().show, true);
});

test('stats report a stale payload and a failed fetch', async () => {
  let fail = false;
  const h = harness('councils', {
    getSnapshot: async () => {
      if (fail) throw new Error('SA elections HTTP 502');
      return payload('councils', [council('A', ANC, true)], 'stale');
    },
  });
  await h.layer.update();
  assert.equal(h.layer.getStats().stale, true);
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().error, 'SA elections HTTP 502');
});

/** Run the pending re-poll timer and let its fetch settle. */
async function repoll(ms = 5000) {
  mock.timers.tick(ms);
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
}

test('a failed fetch while loading keeps re-polling, and disable or destroy still cancel', async (t) => {
  t.mock.method(console, 'warn', () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let calls = 0;
    let answer = 'loading';
    const source = {
      getSnapshot: async () => {
        calls++;
        if (answer === 'fail') throw new Error('SA elections HTTP 502');
        return payload('wards', [ward('w1', ANC)], answer);
      },
    };
    const h = harness('wards', source, { repollMs: 5000 });
    let fired = 0;
    h.layer.setRowControlsListener(() => fired++);
    await h.layer.update();
    assert.equal(calls, 1);

    answer = 'fail';
    await repoll();
    assert.equal(calls, 2);
    assert.equal(fired, 1, 'the row hears of the failed re-poll');
    assert.equal(h.layer.getStats().error, 'SA elections HTTP 502');
    assert.equal(h.fills().items.size, 2, 'the last fills stay');
    await repoll();
    assert.equal(calls, 3, 'a failed fetch while loading re-polls');
    assert.equal(fired, 2);

    answer = 'ok';
    await repoll();
    assert.equal(calls, 4);
    assert.equal(fired, 3);
    assert.equal(h.layer.getStats().error, null);
    await repoll(60_000);
    assert.equal(calls, 4, 'no re-poll once results are in');

    // A re-poll a failure scheduled is cancelled by disable...
    answer = 'loading';
    await h.layer.update();
    answer = 'fail';
    await repoll();
    assert.equal(calls, 6);
    h.layer.disable();
    h.layer.enable();
    await repoll(60_000);
    assert.equal(calls, 6, 'disable cancelled the re-poll');

    // ...and by destroy.
    await h.layer.update();
    assert.equal(calls, 7);
    h.layer.destroy();
    h.layer.init(h.viewer);
    h.layer.enable();
    await repoll(60_000);
    assert.equal(calls, 7, 'destroy cancelled the re-poll');
  } finally {
    mock.timers.reset();
  }
});

test('a first fetch that fails re-polls while the status is still loading', async (t) => {
  t.mock.method(console, 'warn', () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let calls = 0;
    const h = harness(
      'wards',
      {
        getSnapshot: async () => {
          calls++;
          if (calls === 1) throw new Error('SA elections HTTP 502');
          return payload('wards', [ward('w1', ANC)], 'ok');
        },
      },
      { repollMs: 5000 },
    );
    assert.equal(await h.layer.update(), false);
    await repoll();
    assert.equal(calls, 2);
    assert.equal(h.fills().items.size, 2);
    await repoll(60_000);
    assert.equal(calls, 2);
  } finally {
    mock.timers.reset();
  }
});

test('the row listener fires when a re-poll update completes', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let state = 'loading';
    const h = harness(
      'wards',
      { getSnapshot: async () => payload('wards', [ward('w1', ANC)], state) },
      { repollMs: 5000 },
    );
    let fired = 0;
    h.layer.setRowControlsListener(() => fired++);
    await h.layer.update();
    assert.equal(fired, 0, 'the lifecycle reports its own updates');
    state = 'ok';
    mock.timers.tick(5000);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(fired, 1);
    assert.equal(h.layer.getRowControls().legend[0].label, 'ANC');
    h.layer.setRowControlsListener(null);
    h.layer.destroy();
  } finally {
    mock.timers.reset();
  }
});
