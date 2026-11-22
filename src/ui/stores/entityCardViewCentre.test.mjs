// The search bar's "save my spot" needs the ground under the middle of the
// screen right now, not the copy the Context panel last read.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia } from 'pinia';
import { useEntityCardStore } from './entityCard.js';

test('viewCentreNow asks the connected shell for the live centre', () => {
  const store = useEntityCardStore(createPinia());
  assert.equal(store.viewCentreNow(), null, 'nothing connected yet');
  let centre = { lat: -33.9301, lon: 18.4172 };
  store.connect({ centre: () => centre });
  assert.deepEqual(store.viewCentreNow(), { lat: -33.9301, lon: 18.4172 });
  centre = { lat: -26.2041, lon: 28.0473 };
  assert.deepEqual(
    store.viewCentreNow(),
    { lat: -26.2041, lon: 28.0473 },
    'read live each time, never cached',
  );
});

test('viewCentreNow is null when the shell cannot say', () => {
  const store = useEntityCardStore(createPinia());
  store.connect({});
  assert.equal(store.viewCentreNow(), null);
  store.connect({
    centre: () => {
      throw new Error('no camera');
    },
  });
  assert.equal(store.viewCentreNow(), null);
});
