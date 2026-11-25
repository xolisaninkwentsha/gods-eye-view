import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaNewsLayer } from './index.js';
import { fakeInputUnderLabel } from '../../input/testDoubles.mjs';
import { createStubRenderer } from '../../render/stub/index.js';
import { bindRenderer } from '../../render/rendererOf.js';
import { fromDegrees, positionToEcef } from '../../geo/ellipsoid.js';
import { setMessageOverrides } from '../../i18n/index.js';
import { bindFakeDraw } from '../../testSupport/fakeDrawPort.mjs';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const MIN = 60 * 1000;

const story = (id, extra = {}) => ({
  id,
  kind: 'headline',
  title: `Story ${id}`,
  url: `https://example.org/${id}`,
  source: 'IOL',
  publishedAt: NOW - 30 * MIN,
  place: 'Soweto',
  lat: -26.25,
  lon: 27.85,
  via: ['rss'],
  ...extra,
});
const payload = (stories, status = null) => ({
  fetchedAt: NOW,
  stories,
  status,
});
test.beforeEach((t) => {
  t.mock.method(console, 'log', () => {});
});

const sourceOf = (value) => ({ getSnapshot: async () => value });

const liveSet = (draw, suffix) =>
  [...draw.sets.values()].find(
    (record) => !record.disposed && record.spec.id.endsWith(suffix),
  );

function harness(
  source,
  { openExternal = () => {}, clickCard = () => null } = {},
) {
  const overlay = { entries: new Map(), visible: null, cleared: 0 };
  const viewer = { scene: { pick: () => null } };
  const { draw } = bindFakeDraw(viewer);
  const input = fakeInputUnderLabel(viewer);
  let pickResult = null;
  viewer.scene.pick = () => pickResult;
  const layer = createSaNewsLayer({
    source,
    now: () => NOW,
    openExternal,
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
      clickCard: (event) => clickCard(event),
    },
  });
  layer.init(viewer);
  layer.enable();
  const dotsId = liveSet(draw, ':dots').spec.id;
  return {
    layer,
    draw,
    overlay,
    click: (id, set = dotsId) => {
      pickResult = id ? { id: { set, id } } : null;
      input.click({ x: 10, y: 10 });
    },
    dots: () => liveSet(draw, ':dots'),
  };
}

const COLORS = {
  violence: 0xeb5757,
  protest: 0xf2994a,
  event: 0x8fa6bf,
  headline: 0x2bb3a3,
};

test('draws one dot per story with the contract fields and horizon cull', async () => {
  const h = harness(sourceOf(payload([story('a')])));
  assert.equal(await h.layer.update(), true);
  const set = h.dots();
  assert.match(set.spec.id, /^sa-news:\d+:dots$/);
  assert.equal(set.kind, 'points');
  assert.equal(set.spec.clampTo, 'both');
  assert.equal(set.spec.horizonCull, true);
  assert.equal(set.show, true);
  const dot = set.items.get('sa-news:a');
  assert.ok(dot, 'item id is sa-news:<story id>');
  assert.equal(dot.height, 'clampGround');
  assert.equal(dot.disableDepthTest, Number.POSITIVE_INFINITY);
  assert.equal(dot.pixelSize, 7);
  assert.deepEqual(dot.outlineColor, [1, 1, 1, 0.9]);
  assert.equal(dot.outlineWidth, 1);
  assert.ok(dot.pos, 'a position');
  assert.equal(h.layer.id, 'sa-news');
  assert.equal(h.layer.name, 'SA news (24h)');
  assert.equal(h.layer.icon, '📰');
  assert.equal(h.layer.source, 'GDELT · SA outlets');
  assert.equal(h.layer.updateInterval, 300000);
  assert.equal(h.layer.getStats().count, 1);
});

test('the real stub renderer places a dot', async () => {
  const renderer = createStubRenderer();
  const viewer = {};
  bindRenderer(viewer, renderer);
  const api = Object.values(renderer).find(
    (v) => v && typeof v.drawnPosition === 'function',
  );
  const layer = createSaNewsLayer({ source: sourceOf(payload([story('a')])) });
  layer.init(viewer);
  layer.enable();
  await layer.update();
  const setId = api.sets().find((id) => id.endsWith(':dots'));
  assert.ok(setId?.startsWith('sa-news:'), 'a dots set is drawn');
  const record = api.setRecord(setId);
  assert.equal(record.kind, 'points');
  assert.ok(record.items.get('sa-news:a'), 'the dot is stored');
  const placed = api.drawnPosition({ set: setId, id: 'sa-news:a' });
  assert.ok(placed, 'the dot is placed');
  const want = positionToEcef(fromDegrees(27.85, -26.25));
  const got = positionToEcef(placed);
  assert.ok(
    Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z) < 5000,
    'within 5 km of the place',
  );
});

test('dots take the kind colour', async () => {
  const stories = Object.keys(COLORS).map((kind, i) =>
    story(`k${i}`, { kind, lat: -26 - i, lon: 28 + i }),
  );
  const h = harness(sourceOf(payload(stories)));
  await h.layer.update();
  Object.entries(COLORS).forEach(([, hex], i) => {
    const [r, g, b] = h.dots().items.get(`sa-news:k${i}`).color;
    assert.ok(Math.abs(r - ((hex >> 16) & 255) / 255) < 1e-9);
    assert.ok(Math.abs(g - ((hex >> 8) & 255) / 255) < 1e-9);
    assert.ok(Math.abs(b - (hex & 255) / 255) < 1e-9);
  });
});

test('stories at one place get distinct positions, oldest drawn first', async () => {
  const h = harness(
    sourceOf(
      payload([
        story('new', { publishedAt: NOW - MIN }),
        story('old', { publishedAt: NOW - 600 * MIN }),
        story('mid', { publishedAt: NOW - 60 * MIN }),
      ]),
    ),
  );
  await h.layer.update();
  const items = [...h.dots().items.values()];
  assert.deepEqual(
    items.map((i) => i.id),
    ['sa-news:old', 'sa-news:mid', 'sa-news:new'],
  );
  const keys = new Set(items.map((i) => JSON.stringify(i.pos)));
  assert.equal(keys.size, 3);
});

test('clicking a dot shows its card; activating opens the link', async () => {
  const opened = [];
  const h = harness(sourceOf(payload([story('a')])), {
    openExternal: (url) => opened.push(url),
  });
  await h.layer.update();
  h.click('sa-news:a');
  const entries = h.overlay.entries.get('sa-news');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-news-card:a');
  assert.ok(entries[0].position, 'card carries a world anchor');
  assert.equal(entries[0].position.x, h.dots().items.get('sa-news:a').pos.x);
  assert.equal(entries[0].activate(), true);
  assert.deepEqual(opened, ['https://example.org/a']);
});

test("a click on the selected card opens the story; another source's card does not", async () => {
  const opened = [];
  let cardHit = null;
  const h = harness(sourceOf(payload([story('a')])), {
    openExternal: (url) => opened.push(url),
    clickCard: () => cardHit,
  });
  await h.layer.update();
  h.click('sa-news:a');
  cardHit = { sourceId: 'sa-news', entryId: 'sa-news-card:a' };
  h.click(null);
  assert.deepEqual(opened, ['https://example.org/a']);
  assert.equal(h.overlay.entries.get('sa-news').length, 1, 'selection stays');
  cardHit = { sourceId: 'sa-weather-warnings', entryId: 'sa-news-card:a' };
  h.click(null);
  cardHit = { sourceId: 'sa-news', entryId: 'sa-news-card:other' };
  h.click(null);
  assert.deepEqual(opened, ['https://example.org/a']);
});

test('a click on another layer clears the card without hiding; the next dot click shows one', async () => {
  const h = harness(sourceOf(payload([story('a'), story('b', { lat: -30 })])));
  await h.layer.update();
  h.click('sa-news:a');
  assert.equal(h.overlay.entries.get('sa-news').length, 1);
  h.click('other:1', 'other:set');
  assert.equal(h.overlay.entries.get('sa-news')?.length ?? 0, 0);
  assert.notEqual(h.overlay.visible, false, 'the source is not hidden');
  h.click('sa-news:b');
  const entries = h.overlay.entries.get('sa-news');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sa-news-card:b');
});

test('a click on empty ground clears the card', async () => {
  const h = harness(sourceOf(payload([story('a')])));
  await h.layer.update();
  h.click('sa-news:a');
  h.click(null);
  assert.equal(h.overlay.entries.get('sa-news')?.length ?? 0, 0);
  assert.notEqual(h.overlay.visible, false);
});

test('the legend counts the four kinds in order, zero included', async () => {
  const h = harness(
    sourceOf(
      payload([
        story('a', { kind: 'protest' }),
        story('b', { kind: 'protest', lat: -30 }),
        story('c', { kind: 'headline', lat: -31 }),
      ]),
    ),
  );
  await h.layer.update();
  const { legend } = h.layer.getRowControls();
  assert.deepEqual(
    legend.map((r) => [r.label, r.count, r.color]),
    [
      ['Violence', 0, '#eb5757'],
      ['Protest', 2, '#f2994a'],
      ['Other event', 0, '#8fa6bf'],
      ['Headline', 1, '#2bb3a3'],
    ],
  );
  assert.equal(
    legend[0].blurb,
    'GDELT events placed at city level and SA outlet headlines matched to town names. Click a card to open the story.',
  );
});

const infoOf = async (status) => {
  const h = harness(sourceOf(payload([story('a')], status)));
  await h.layer.update();
  return h.layer.getRowControls().info;
};

test('a partial GDELT window says how many hours are loaded, never overstating', async () => {
  const info = await infoOf({
    gdelt: { hoursCovered: 6.58, complete: false, state: 'partial' },
  });
  assert.equal(info, 'GDELT: 6.5 of 24 h loaded');
  assert.doesNotMatch(info, /so far|last/i);
});

test('a missing hoursCovered reads as 0 hours loaded', async () => {
  assert.equal(
    await infoOf({ gdelt: { complete: false, state: 'loading' } }),
    'GDELT: 0 of 24 h loaded',
  );
});

test('a complete GDELT window and healthy outlets give no info line', async () => {
  assert.equal(
    await infoOf({
      gdelt: { hoursCovered: 24, complete: true, state: 'ok' },
      rss: { iol: 'ok', mg: 'ok' },
    }),
    undefined,
  );
  assert.equal(await infoOf(null), undefined);
  assert.equal(await infoOf({ gdelt: null, rss: null }), undefined);
});

test('GDELT down and failed outlets are named on the info line', async () => {
  assert.equal(
    await infoOf({
      gdelt: { hoursCovered: 3, complete: false, state: 'failed' },
      rss: { iol: 'failed', mg: 'ok', enca: 'failed', citizen: 'loading' },
    }),
    'GDELT unavailable · Headlines: 2 of 4 outlets unavailable',
  );
});

test('the blurb is only the explanation', async () => {
  const h = harness(
    sourceOf(
      payload([story('a')], {
        gdelt: { hoursCovered: 3, complete: false, state: 'partial' },
      }),
    ),
  );
  await h.layer.update();
  assert.doesNotMatch(h.layer.getRowControls().legend[0].blurb, /\n|GDELT:/);
});

test('legend kind names go through t()', async (t) => {
  t.after(() => setMessageOverrides({}));
  setMessageOverrides({ en: { Violence: 'Geweld', Headline: 'Opskrif' } });
  const h = harness(sourceOf(payload([story('a')])));
  await h.layer.update();
  const labels = h.layer.getRowControls().legend.map((r) => r.label);
  assert.deepEqual(labels, ['Geweld', 'Protest', 'Other event', 'Opskrif']);
});

test('a failed or malformed snapshot keeps the dots and reports the error', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let next = payload([story('a')]);
  const h = harness({
    getSnapshot: async () => {
      if (next instanceof Error) throw next;
      return next;
    },
  });
  await h.layer.update();
  next = new Error('SA news HTTP 502');
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().error, 'SA news HTTP 502');
  assert.equal(h.dots().items.size, 1);
  next = { fetchedAt: 1, status: null };
  assert.equal(await h.layer.update(), false);
  assert.ok(h.layer.getStats().error);
  assert.equal(h.dots().items.size, 1);
  next = payload([story('a')]);
  assert.equal(await h.layer.update(), true);
  assert.equal(h.layer.getStats().error, null);
});

test('analyst records use the place position, not the spiral offset', async () => {
  const h = harness(
    sourceOf(
      payload([story('a'), story('b', { publishedAt: NOW - 90 * MIN })]),
    ),
  );
  await h.layer.update();
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  for (const r of records) {
    assert.equal(r.lat, -26.25);
    assert.equal(r.lon, 27.85);
  }
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'id',
    'kind',
    'lat',
    'lon',
    'name',
    'place',
    'publishedAt',
    'source',
  ]);
  assert.equal(records[0].id, 'a', 'newest first');
  assert.equal(records.find((r) => r.id === 'a').name, 'Story a');
  assert.equal(h.layer.getAnalystRecords(1).length, 1);
});

test('disable hides the set and clears the card', async () => {
  const h = harness(sourceOf(payload([story('a')])));
  await h.layer.update();
  h.click('sa-news:a');
  h.layer.disable();
  assert.equal(h.dots().show, false);
  assert.equal(h.overlay.entries.get('sa-news'), undefined);
});
