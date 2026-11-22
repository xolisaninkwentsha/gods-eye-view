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
  locationPermission,
  promptHintText,
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

test('a request nobody answers ends at its time limit', { timeout: 2000 }, async () => {
  // Chrome's permission prompt left open: the browser never calls back, and
  // its own timeout only starts once permission is given.
  let answerLate;
  const geolocation = {
    getCurrentPosition(success) {
      answerLate = () => success({ coords: CAPE_TOWN_ROUGH, timestamp: 0 });
    },
  };
  const result = locateOnce({ geolocation, secure: true, answerWithinMs: 20 });
  assert.deepEqual(await result, { ok: false, reason: 'noAnswer' });
  answerLate(); // "Allow", long after: nothing changes, nothing throws
  assert.deepEqual(await result, { ok: false, reason: 'noAnswer' });
});

test('an answer in time clears the time limit', async () => {
  const cleared = [];
  const realClear = globalThis.clearTimeout;
  globalThis.clearTimeout = (id) => {
    cleared.push(id);
    return realClear(id);
  };
  try {
    const result = await locateOnce({
      geolocation: fakeGeolocation({ coords: CAPE_TOWN_ROUGH }),
      secure: true,
      answerWithinMs: 60_000,
    });
    assert.equal(result.ok, true);
    assert.equal(cleared.length, 1, 'the 60 s timer was cancelled, not left running');
  } finally {
    globalThis.clearTimeout = realClear;
  }
});

test('each failure reads as the search bar message', () => {
  assert.equal(locateFailureText('unavailable'), 'Browser location is unavailable');
  assert.equal(locateFailureText('denied'), 'Location access was not allowed');
  assert.equal(locateFailureText('notFound'), 'Location not found');
  assert.equal(
    locateFailureText('noAnswer'),
    'The browser did not answer. Click the button to try again.',
  );
});

test("locationPermission reads the browser's answer, or null", async () => {
  const asks = [];
  const answering = (state) => ({
    query: async (descriptor) => {
      asks.push(descriptor);
      return { state };
    },
  });
  assert.equal(await locationPermission({ permissions: answering('prompt') }), 'prompt');
  assert.equal(await locationPermission({ permissions: answering('granted') }), 'granted');
  assert.equal(await locationPermission({ permissions: answering('denied') }), 'denied');
  assert.deepEqual(asks[0], { name: 'geolocation' });
  assert.equal(await locationPermission({ permissions: answering('mystery') }), null);
  assert.equal(await locationPermission({ permissions: undefined }), null);
  assert.equal(
    await locationPermission({
      permissions: {
        query: async () => {
          throw new TypeError('geolocation is not a valid permission name');
        },
      },
    }),
    null,
  );
  assert.equal(await locationPermission({ permissions: { query: () => { throw new Error('sync'); } } }), null);
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
    'Rough location (±26 km). Centre the map on your spot, then right-click the button to save it.',
  );
  assert.equal(
    roughNoticeText(Number.NaN),
    'Rough location (±250 km). Centre the map on your spot, then right-click the button to save it.',
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

/**
 * An action wired to recording doubles. `flight` is how each flight ends, as
 * the search bar's runner reports it: true when it arrives, false when it was
 * interrupted, or a throw when the app refused it.
 */
function action(locate, spot = null, flight = async () => true, permission = async () => 'granted') {
  const flights = [];
  const framed = [];
  const errors = [];
  const notices = [];
  const busy = [];
  const myLocation = createMyLocationAction({
    locate,
    permission,
    loadSpot: () => spot,
    goTo: async (place) => {
      flights.push(place);
      return flight();
    },
    frame: async (place, rangeM) => {
      framed.push([place, rangeM]);
      return flight();
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
    'Rough location (±26 km). Centre the map on your spot, then right-click the button to save it.',
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

/** A refusal as the search bar's runner throws it, with its reason for people when it gave one. */
function refused(reason = '') {
  return async () => {
    throw Object.assign(new Error(reason), { reason });
  };
}

test('a flight the app refuses says so, framed or to the saved spot', async () => {
  for (const spot of [null, HOME]) {
    const run = action(async () => ROUGH_FIX, spot, refused());
    assert.equal(await run.myLocation.run(), false);
    assert.equal(run.flights.length + run.framed.length, 1, 'it tried to fly');
    assert.deepEqual(run.errors, ['Unable to complete this action. Please try again.']);
    assert.deepEqual(run.notices, [], 'no rough notice over a refusal');
    assert.deepEqual(run.busy, [true, false]);
  }
});

test("a refused flight passes on the app's own reason", async () => {
  const run = action(async () => ROUGH_FIX, null, refused('The camera is busy following a contact'));
  assert.equal(await run.myLocation.run(), false);
  assert.deepEqual(run.errors, [
    'Unable to complete this action: The camera is busy following a contact',
  ]);
});

test('an interrupted flight shows no rough notice', async () => {
  const run = action(async () => ROUGH_FIX, null, async () => false);
  assert.equal(await run.myLocation.run(), false);
  assert.equal(run.framed.length, 1);
  assert.deepEqual(run.notices, []);
  assert.deepEqual(run.errors, [], 'the viewer stopped it; nothing went wrong');
});

test('a refusal after a newer request stays silent', async () => {
  let current = true;
  const run = action(async () => ROUGH_FIX, null, async () => {
    current = false; // the user searched for somewhere else during the flight
    throw Object.assign(new Error(''), { reason: '' });
  });
  assert.equal(await run.myLocation.run({ isCurrent: () => current }), false);
  assert.deepEqual(run.errors, []);
  assert.deepEqual(run.busy, [true, false]);
});

const HINT = "Choose Allow in the browser's location prompt";

/** A location request the test answers when it chooses. */
function heldLocate(outcome) {
  let release;
  const locate = () =>
    new Promise((resolve) => {
      release = () => resolve(outcome);
    });
  return { locate, release: () => release() };
}

/** Let the action's awaited steps run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("while the browser's prompt waits, the action says so", async () => {
  assert.equal(promptHintText(), HINT);
  // Then the saved spot: a silent landing clears the hint.
  {
    const held = heldLocate(ROUGH_FIX);
    const run = action(held.locate, HOME, undefined, async () => 'prompt');
    const pending = run.myLocation.run();
    await settle();
    assert.deepEqual(run.notices, [HINT], 'shown before the browser answers');
    held.release();
    assert.equal(await pending, true);
    assert.deepEqual(run.notices, [HINT, ''], 'cleared on a silent landing');
    assert.deepEqual(run.flights, [{ latitude: -33.9301, longitude: 18.4172 }]);
  }
  // A rough fix: its notice replaces the hint.
  {
    const held = heldLocate(ROUGH_FIX);
    const run = action(held.locate, null, undefined, async () => 'prompt');
    const pending = run.myLocation.run();
    await settle();
    held.release();
    await pending;
    assert.deepEqual(run.notices, [
      HINT,
      'Rough location (±26 km). Centre the map on your spot, then right-click the button to save it.',
    ]);
  }
  // A refusal: its error replaces the hint.
  {
    const held = heldLocate({ ok: false, reason: 'denied' });
    const run = action(held.locate, null, undefined, async () => 'prompt');
    const pending = run.myLocation.run();
    await settle();
    held.release();
    assert.equal(await pending, false);
    assert.deepEqual(run.notices, [HINT]);
    assert.deepEqual(run.errors, ['Location access was not allowed']);
  }
});

test('no prompt, no hint', async () => {
  for (const state of ['granted', null]) {
    const held = heldLocate(ROUGH_FIX);
    const run = action(held.locate, HOME, undefined, async () => state);
    const pending = run.myLocation.run();
    await settle();
    assert.deepEqual(run.notices, [], `${state}: nothing shown while waiting`);
    held.release();
    await pending;
    assert.deepEqual(run.notices, [], `${state}: nothing to clear either`);
  }
});

test('a slow permission check never holds up the request', async () => {
  let located = 0;
  const run = action(
    async () => {
      located += 1;
      return ROUGH_FIX;
    },
    HOME,
    undefined,
    () => new Promise(() => {}), // a check that never answers
  );
  const pending = run.myLocation.run();
  await settle();
  assert.equal(located, 1, 'the request started at once');
  assert.equal(await Promise.race([pending, settle().then(() => 'stuck')]), true);
});

test('a request that runs out of time releases the button with its message', async () => {
  const run = action(async () => ({ ok: false, reason: 'noAnswer' }), null, undefined, async () => 'prompt');
  assert.equal(await run.myLocation.run(), false);
  assert.deepEqual(run.errors, ['The browser did not answer. Click the button to try again.']);
  assert.deepEqual(run.busy, [true, false]);
  assert.equal(run.myLocation.busy(), false, 'clickable again');
});

test('a hint is not shown for a request already superseded', async () => {
  const held = heldLocate(ROUGH_FIX);
  const run = action(held.locate, HOME, undefined, async () => 'prompt');
  let current = true;
  const pending = run.myLocation.run({ isCurrent: () => current });
  current = false; // a newer search before the permission check answered
  await settle();
  held.release();
  assert.equal(await pending, false);
  assert.deepEqual(run.notices, []);
  assert.deepEqual(run.errors, []);
});

const VIEW_CHANGED =
  'The view changed while finding your location. Click the button again to go there.';

test('a fix that arrives after the camera was taken does not fly, and says why', async () => {
  for (const spot of [HOME, null]) {
    const run = action(async () => ROUGH_FIX, spot);
    assert.equal(await run.myLocation.run({ cameraTaken: () => true }), false);
    assert.deepEqual(run.flights, [], 'no flight to the saved spot');
    assert.deepEqual(run.framed, [], 'no framing of the rough fix');
    assert.deepEqual(run.notices, [VIEW_CHANGED]);
    assert.deepEqual(run.errors, []);
    assert.deepEqual(run.busy, [true, false]);
  }
  // With the permission hint up, the notice replaces it.
  const held = heldLocate(ROUGH_FIX);
  const run = action(held.locate, HOME, undefined, async () => 'prompt');
  const pending = run.myLocation.run({ cameraTaken: () => true });
  await settle();
  held.release();
  assert.equal(await pending, false);
  assert.deepEqual(run.notices, [HINT, VIEW_CHANGED]);
});

test('a browser failure still shows after the camera was taken', async () => {
  const run = action(async () => ({ ok: false, reason: 'denied' }));
  assert.equal(await run.myLocation.run({ cameraTaken: () => true }), false);
  assert.deepEqual(run.errors, ['Location access was not allowed']);
  assert.deepEqual(run.notices, []);
});

test('the camera is checked when the fix arrives', async () => {
  const held = heldLocate(ROUGH_FIX);
  const run = action(held.locate, HOME);
  let taken = false;
  const pending = run.myLocation.run({ cameraTaken: () => taken });
  await settle();
  taken = true; // the viewer drags the globe while the browser works
  held.release();
  assert.equal(await pending, false);
  assert.deepEqual(run.flights, []);
  assert.deepEqual(run.notices, [VIEW_CHANGED]);
});

test('its own flight does not count as taking the camera', async () => {
  let taken = false;
  // The button's own flight stamps navigation, which the watcher would count.
  const run = action(async () => ROUGH_FIX, null, async () => {
    taken = true;
    return true;
  });
  assert.equal(await run.myLocation.run({ cameraTaken: () => taken }), true);
  assert.equal(run.framed.length, 1);
  assert.deepEqual(run.notices, [
    'Rough location (±26 km). Centre the map on your spot, then right-click the button to save it.',
  ]);
});

test('a request superseded by a search stays silent even if the camera was taken', async () => {
  const run = action(async () => ROUGH_FIX, HOME);
  assert.equal(
    await run.myLocation.run({ isCurrent: () => false, cameraTaken: () => true }),
    false,
  );
  assert.deepEqual(run.notices, []);
  assert.deepEqual(run.errors, []);
  assert.deepEqual(run.flights, []);
});
