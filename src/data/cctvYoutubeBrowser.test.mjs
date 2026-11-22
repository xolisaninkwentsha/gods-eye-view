// In the browser, a YouTube live camera keeps its video ID through the
// catalog and is treated like Québec's browser-only cameras: no server frame,
// no 3D projection, its own player after Play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../layers/cctv/catalog.js';
import { createModel } from '../layers/cctv/model.js';

/** The production browser model. */
function browserModel() {
  const parts = {};
  parts.model = createModel({
    state: {},
    services: { focus: {} },
    parts,
    source: {},
  });
  return parts.model;
}

const YOUTUBE_ROW = {
  id: 'za-youtube',
  name: 'Table Mountain & Bloubergstrand',
  city: 'Cape Town',
  cityId: 'za-cape-town',
  provider: 'Table Mountain Live Stream',
  lat: -33.81,
  lon: 18.46,
  feedType: 'youtube',
  sourceKind: 'configured',
  youtubeVideoId: 'Yql-FpQkDr8',
  sourceUrl: 'https://www.youtube.com/@TableMountainLiveStream',
};

test('the browser catalog keeps a YouTube camera video ID', () => {
  const model = browserModel();
  const [camera] = createCatalog({
    state: {},
    services: { locations: { CITY_POIS: {} } },
    parts: { model: { ...model, ensureCameraPose: () => {} } },
    source: {},
  }).buildCatalogFromSources([YOUTUBE_ROW]);
  assert.equal(camera.id, 'za-youtube');
  assert.equal(camera.feedType, 'youtube');
  assert.equal(camera.youtubeVideoId, 'Yql-FpQkDr8');
});

test('isYoutubeCamera needs the youtube feed type and a valid video ID', () => {
  const model = browserModel();
  const youtube = { feedType: 'youtube', youtubeVideoId: 'Yql-FpQkDr8' };
  assert.equal(model.isYoutubeCamera(youtube), true);
  assert.equal(
    model.isYoutubeCamera({ ...youtube, youtubeVideoId: 'not-an-id' }),
    false,
  );
  assert.equal(model.isYoutubeCamera({ ...youtube, feedType: 'image' }), false);
  assert.equal(model.isYoutubeCamera(null), false);
});

test('a YouTube camera takes the browser-overlay path and counts as live', () => {
  const model = browserModel();
  const youtube = { feedType: 'youtube', youtubeVideoId: 'Yql-FpQkDr8' };
  assert.equal(model.isBrowserOverlayCamera(youtube), true);
  assert.equal(model.isVideoFeedCamera(youtube), true);
  assert.equal(
    model.isBrowserOverlayCamera({ feedType: 'image', sourceKind: 'configured' }),
    false,
  );
});
