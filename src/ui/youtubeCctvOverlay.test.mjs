import '../testSupport/registerDom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYoutubeCctvOverlay } from './youtubeCctvOverlay.js';

const CAMERA = Object.freeze({
  id: 'za-youtube',
  name: 'Table Mountain & Bloubergstrand',
  feedType: 'youtube',
  youtubeVideoId: 'Yql-FpQkDr8',
  credit: 'Table Mountain Live Stream',
  sourceUrl: 'https://www.youtube.com/@TableMountainLiveStream',
});
const OTHER = Object.freeze({
  ...CAMERA,
  id: 'za-clifton',
  name: 'Clifton 4th Beach',
  youtubeVideoId: 'IGu55JrxyHU',
});

/**
 * Mount the overlay with a recording player factory: each created player
 * remembers its video, host and state callback, and counts its destroys.
 */
function mountOverlay(t) {
  const players = [];
  const createPlayer = ({ host, videoId, onChange }) => {
    const player = { host, videoId, onChange, destroyed: 0 };
    players.push(player);
    onChange({ state: 'loading', reason: null });
    return {
      destroy() {
        player.destroyed += 1;
      },
    };
  };
  const overlay = createYoutubeCctvOverlay({ createPlayer });
  t.after(() => overlay?.dispose());
  const { document } = globalThis.window;
  const q = (selector) => document.querySelector(selector);
  return { overlay, players, q };
}

test('selecting a YouTube camera shows its name, credit and Play without loading YouTube', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  assert.equal(q('.yci-panel').hidden, false);
  assert.match(q('.yci-panel header').textContent, /Table Mountain & Bloubergstrand/);
  assert.equal(q('.yci-credit').textContent, 'Table Mountain Live Stream');
  assert.equal(
    q('.yci-credit').getAttribute('href'),
    'https://www.youtube.com/@TableMountainLiveStream',
  );
  assert.equal(q('.yci-play').hidden, false);
  assert.equal(
    q('.yci-note').textContent,
    'Video plays from YouTube, which sees your IP address.',
  );
  assert.equal(players.length, 0, 'nothing reaches YouTube before Play');
});

test('Play creates the player with the camera video ID inside the window', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  assert.equal(players.length, 1);
  assert.equal(players[0].videoId, 'Yql-FpQkDr8');
  assert.ok(q('.yci-panel').contains(players[0].host));
  assert.equal(q('.yci-play').hidden, true);
});

test('choosing another camera, nothing, or disposing destroys the player', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  overlay.setCamera(OTHER);
  assert.equal(players[0].destroyed, 1, 'another camera stops the stream');
  assert.equal(players.length, 1, 'the next camera waits for its own Play');
  assert.equal(q('.yci-play').hidden, false);

  q('.yci-play').click();
  overlay.setCamera(null);
  assert.equal(players[1].destroyed, 1, 'no camera stops the stream');
  assert.equal(q('.yci-panel').hidden, true);

  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  overlay.dispose();
  assert.equal(players[2].destroyed, 1, 'dispose stops the stream');
});

test('routine updates for the same camera keep the stream playing', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  overlay.setCamera({ ...CAMERA });
  assert.equal(players[0].destroyed, 0);
  assert.equal(players.length, 1);
});

test('closing the window stops the stream until the camera is picked again', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  q('.yci-panel header button').click();
  assert.equal(players[0].destroyed, 1);
  assert.equal(q('.yci-panel').hidden, true);
  overlay.setCamera(CAMERA);
  assert.equal(q('.yci-panel').hidden, true, 'a routine update keeps it closed');
  overlay.setCamera(CAMERA, { reselected: true });
  assert.equal(q('.yci-panel').hidden, false, 'picking it again reopens it');
});

test('offline and unavailable streams say so and link to YouTube', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  players[0].onChange({ state: 'offline', reason: 'timeout' });
  assert.equal(q('.yci-status').textContent, 'Stream is offline');
  assert.equal(q('.yci-open').hidden, false);
  assert.equal(
    q('.yci-open').getAttribute('href'),
    'https://www.youtube.com/watch?v=Yql-FpQkDr8',
  );
  players[0].onChange({ state: 'unavailable', reason: 'error-150' });
  assert.equal(q('.yci-status').textContent, 'This stream cannot play here');
  players[0].onChange({ state: 'playing', reason: null });
  assert.equal(q('.yci-status').hidden, true);
  assert.equal(q('.yci-open').hidden, true);
});

test('Try again replaces a failed player with a fresh one', (t) => {
  const { overlay, players, q } = mountOverlay(t);
  overlay.setCamera(CAMERA);
  q('.yci-play').click();
  players[0].onChange({ state: 'offline', reason: 'ended' });
  q('.yci-retry').click();
  assert.equal(players[0].destroyed, 1);
  assert.equal(players.length, 2);
  assert.equal(players[1].videoId, 'Yql-FpQkDr8');
});
