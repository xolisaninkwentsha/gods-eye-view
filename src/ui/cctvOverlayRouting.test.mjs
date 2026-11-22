import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayCamerasFor } from './cctvPresentation.js';

const YOUTUBE = { id: 'za-yt', feedType: 'youtube', youtubeVideoId: 'Yql-FpQkDr8' };
const QUEBEC = { id: 'qc-511-1', sourceKind: 'quebec-511-browser' };
const STILL = { id: 'za-still', feedType: 'image', sourceKind: 'configured' };

test('a YouTube camera goes to the YouTube window and hides the frame', () => {
  assert.deepEqual(overlayCamerasFor(YOUTUBE, true), {
    quebec: null,
    youtube: YOUTUBE,
    hideFrame: true,
  });
});

test('a Québec camera still goes to the Québec window', () => {
  assert.deepEqual(overlayCamerasFor(QUEBEC, true), {
    quebec: QUEBEC,
    youtube: null,
    hideFrame: true,
  });
});

test('a still camera, a disabled layer or a bad video ID opens no window', () => {
  const none = { quebec: null, youtube: null, hideFrame: false };
  assert.deepEqual(overlayCamerasFor(STILL, true), none);
  assert.deepEqual(overlayCamerasFor(YOUTUBE, false), none);
  assert.deepEqual(
    overlayCamerasFor({ ...YOUTUBE, youtubeVideoId: 'nope' }, true),
    none,
  );
  assert.deepEqual(overlayCamerasFor(null, true), none);
});
