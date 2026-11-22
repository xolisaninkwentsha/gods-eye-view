// "Go to my location": one browser location request, then the saved spot, an
// honestly framed rough fix, or a precise fix — or the search bar's message.
// The position goes nowhere but the flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n/index.js';
import {
  chooseDestination,
  createMyLocationAction,
  loadSavedSpot,
  locateFailureText,
  locateOnce,
  roughNoticeText,
  saveSpot,
  SPOT_STORAGE_KEY,
  spotSavedText,
} from './myLocation.js';

setLocale('en');

/** A geolocation double that answers with `outcome` and records its options. */
function fakeGeolocation(outcome) {
  const calls = [];
  return {
    calls,
    getCurrentPosition(success, failure, options) {
      calls.push(options);
      if (outcome.coords) success({ coords: outcome.coords, timestamp: 0 });
      else failure({ code: outcome.code, message: 'fixture' });
    },
  };
}

/** A Storage double over a Map, as localStorage behaves. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

const CAPE_TOWN_ROUGH = { latitude: -33.92, longitude: 18.42, accuracy: 25801 };
// About 25 km east of central Cape Town: where the IP-level fix landed live.
const ROUGH_FIX = { ok: true, latitude: -33.9429, longitude: 18.6876, accuracyM: 25801 };
// A saved spot in the City Bowl, ~25 km from that rough fix: inside its range.
const HOME = { lat: -33.9301, lon: 18.4172 };

test('a fix resolves to its position and accuracy', async () => {
  const geolocation = fakeGeolocation({ coords: CAPE_TOWN_ROUGH });
  assert.deepEqual(await locateOnce({ geolocation, secure: true }), {
    ok: true,
    latitude: -33.92,
    longitude: 18.42,
    accuracyM: 25801,
  });
});

test('it asks once, allowing a cold first fix 30 s, for a fix no older than a minute', async () => {
  // The first live click after the permission prompt failed at 10 s;
  // Chrome's network location is suspected of taking that long cold.
  const geolocation = fakeGeolocation({ coords: CAPE_TOWN_ROUGH });
  await locateOnce({ geolocation, secure: true });
  assert.equal(geolocation.calls.length, 1);
  assert.deepEqual(geolocation.calls[0], {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 60000,
  });
});

test('no geolocation, or an insecure page, is unavailable; code 1 is denied; codes 2 and 3 are not found', async () => {
  assert.deepEqual(await locateOnce({ geolocation: undefined, secure: true }), {
    ok: false,
    reason: 'unavailable',
  });
  // Opened over a LAN IP the API exists but refuses; say so, not "denied".
  const insecure = fakeGeolocation({ code: 1 });
  assert.deepEqual(await locateOnce({ geolocation: insecure, secure: false }), {
    ok: false,
    reason: 'unavailable',
  });
  assert.equal(insecure.calls.length, 0, 'an insecure page never asks');
  assert.deepEqual(
    await locateOnce({ geolocation: fakeGeolocation({ code: 1 }), secure: true }),
    { ok: false, reason: 'denied' },
  );
  for (const code of [2, 3])
    assert.deepEqual(
      await locateOnce({ geolocation: fakeGeolocation({ code }), secure: true }),
      { ok: false, reason: 'notFound' },
      `code ${code}`,
    );
});

test('a geolocation that throws instead of answering is not found', async () => {
  const geolocation = {
    getCurrentPosition() {
      throw new Error('blocked by policy');
    },
  };
  assert.deepEqual(await locateOnce({ geolocation, secure: true }), {
    ok: false,
    reason: 'notFound',
  });
});

test('each failure reads as the search bar message', () => {
  assert.equal(locateFailureText('unavailable'), 'Browser location is unavailable');
  assert.equal(locateFailureText('denied'), 'Location access was not allowed');
  assert.equal(locateFailureText('notFound'), 'Location not found');
});

test('a precise fix is framed close in, by its accuracy', () => {
  assert.deepEqual(
    chooseDestination({ ok: true, latitude: -33.9, longitude: 18.4, accuracyM: 40 }, HOME),
    { kind: 'precise', latitude: -33.9, longitude: 18.4, accuracyM: 40, rangeM: 500 },
  );
  assert.equal(
    chooseDestination({ ok: true, latitude: 1, longitude: 2, accuracyM: 1800 }, null).rangeM,
    4500,
  );
});

test('a rough fix uses the saved spot when the spot lies within its range', () => {
  assert.deepEqual(chooseDestination(ROUGH_FIX, HOME), {
    kind: 'saved',
    latitude: -33.9301,
    longitude: 18.4172,
    accuracyM: 25801,
  });
});

test('a rough fix far from the saved spot is framed instead', () => {
  const johannesburg = { lat: -26.2041, lon: 28.0473 };
  const choice = chooseDestination(ROUGH_FIX, johannesburg);
  assert.equal(choice.kind, 'rough');
  assert.equal(choice.latitude, -33.9429);
  assert.equal(choice.rangeM, 64503);
});

test('a rough fix with no saved spot is framed, its range clamped to 5–250 km', () => {
  const at = (accuracyM) =>
    chooseDestination({ ok: true, latitude: 1, longitude: 2, accuracyM }, null);
  assert.equal(at(25801).kind, 'rough');
  assert.equal(at(2500).rangeM, 6250);
  assert.equal(at(2100).rangeM, 5250);
  assert.equal(at(500000).rangeM, 250000);
  assert.equal(at(Number.NaN).kind, 'rough', 'an unknown accuracy is not trusted');
  assert.equal(at(Number.NaN).rangeM, 250000);
});

test('the rough notice names the accuracy in whole kilometres', () => {
  assert.equal(
    roughNoticeText(25801),
    'Rough location (±26 km). Right-click the button to save your exact spot.',
  );
  assert.equal(
    roughNoticeText(Number.NaN),
    'Rough location (±250 km). Right-click the button to save your exact spot.',
  );
});

test('a saved spot round-trips through storage under its key', () => {
  const storage = memoryStorage();
  assert.equal(saveSpot({ lat: -33.9301, lon: 18.4172 }, { storage }), true);
  assert.ok(storage.map.has(SPOT_STORAGE_KEY));
  assert.deepEqual(loadSavedSpot({ storage }), { lat: -33.9301, lon: 18.4172 });
});

test('blocked, corrupt or off-globe storage gives no spot', () => {
  const blocked = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(loadSavedSpot({ storage: blocked }), null);
  assert.equal(saveSpot(HOME, { storage: blocked }), false);
  assert.equal(loadSavedSpot({ storage: memoryStorage({ [SPOT_STORAGE_KEY]: '{oops' }) }), null);
  assert.equal(
    loadSavedSpot({ storage: memoryStorage({ [SPOT_STORAGE_KEY]: '{"lat":95,"lon":18}' }) }),
    null,
  );
  assert.equal(saveSpot({ lat: Number.NaN, lon: 18 }, { storage: memoryStorage() }), false);
  assert.equal(loadSavedSpot({ storage: undefined }), null);
});

test('saving reads as the search bar message', () => {
  assert.equal(spotSavedText(true), 'Saved the centre of this view as your spot');
  assert.equal(spotSavedText(false), 'Your spot could not be saved');
});

/** An action wired to recording doubles. */
function action(locate, spot = null) {
  const flights = [];
  const framed = [];
  const errors = [];
  const notices = [];
  const busy = [];
  const myLocation = createMyLocationAction({
    locate,
    loadSpot: () => spot,
    goTo: async (place) => {
      flights.push(place);
      return true;
    },
    frame: async (place, rangeM) => {
      framed.push([place, rangeM]);
      return true;
    },
    showError: (text) => errors.push(text),
    showNotice: (text) => notices.push(text),
    setBusy: (value) => busy.push(value),
  });
  return { myLocation, flights, framed, errors, notices, busy };
}

test('with a saved spot inside a rough fix, the action lands on the spot and says nothing', async () => {
  const run = action(async () => ROUGH_FIX, HOME);
  assert.equal(await run.myLocation.run(), true);
  assert.deepEqual(run.flights, [{ latitude: -33.9301, longitude: 18.4172 }]);
  assert.deepEqual(run.framed, []);
  assert.deepEqual(run.notices, []);
  assert.deepEqual(run.errors, []);
  assert.deepEqual(run.busy, [true, false]);
});

test('a rough fix with no spot is framed and explained', async () => {
  const run = action(async () => ROUGH_FIX);
  assert.equal(await run.myLocation.run(), true);
  assert.deepEqual(run.framed, [[{ latitude: -33.9429, longitude: 18.6876 }, 64503]]);
  assert.deepEqual(run.notices, [
    'Rough location (±26 km). Right-click the button to save your exact spot.',
  ]);
  assert.deepEqual(run.flights, []);
});

test('a precise fix is framed by its accuracy with no notice', async () => {
  const run = action(async () => ({ ok: true, latitude: -33.9, longitude: 18.4, accuracyM: 30 }));
  assert.equal(await run.myLocation.run(), true);
  assert.deepEqual(run.framed, [[{ latitude: -33.9, longitude: 18.4 }, 500]]);
  assert.deepEqual(run.notices, []);
});

test('the action shows the failure text and does not fly', async () => {
  const run = action(async () => ({ ok: false, reason: 'denied' }));
  assert.equal(await run.myLocation.run(), false);
  assert.deepEqual(run.flights, []);
  assert.deepEqual(run.framed, []);
  assert.deepEqual(run.errors, ['Location access was not allowed']);
  assert.deepEqual(run.busy, [true, false]);
});

test('a fix that arrives after a newer request neither flies nor speaks', async () => {
  for (const outcome of [ROUGH_FIX, { ok: false, reason: 'notFound' }]) {
    const run = action(async () => outcome, HOME);
    let current = true;
    const pending = run.myLocation.run({ isCurrent: () => current });
    current = false; // the user searched for somewhere else meanwhile
    assert.equal(await pending, false);
    assert.deepEqual(run.flights, []);
    assert.deepEqual(run.framed, []);
    assert.deepEqual(run.errors, []);
    assert.deepEqual(run.notices, []);
    assert.deepEqual(run.busy, [true, false], 'the button is usable again');
  }
});

test('a second click while locating is ignored', async () => {
  let release;
  let locateCalls = 0;
  const run = action(() => {
    locateCalls += 1;
    return new Promise((resolve) => {
      release = () => resolve(ROUGH_FIX);
    });
  }, HOME);
  const first = run.myLocation.run();
  assert.equal(run.myLocation.busy(), true);
  assert.equal(await run.myLocation.run(), false, 'the second click does nothing');
  release();
  assert.equal(await first, true);
  assert.equal(locateCalls, 1);
  assert.equal(run.flights.length, 1);
  assert.equal(run.myLocation.busy(), false, 'usable again afterwards');
});

test('a flight that fails clears the busy state', async () => {
  const busy = [];
  const myLocation = createMyLocationAction({
    locate: async () => ROUGH_FIX,
    loadSpot: () => HOME,
    goTo: async () => {
      throw new Error('search runner gone');
    },
    frame: async () => true,
    showError: () => {},
    showNotice: () => {},
    setBusy: (value) => busy.push(value),
  });
  assert.equal(await myLocation.run(), false);
  assert.deepEqual(busy, [true, false]);
  assert.equal(myLocation.busy(), false);
});
