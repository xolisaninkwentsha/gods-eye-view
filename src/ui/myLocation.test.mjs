// "Go to my location": one browser location request, turned into either a
// flight through the search bar's coordinate route or the search bar's error
// line. The position goes nowhere but goTo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n/index.js';
import {
  createMyLocationAction,
  locateFailureText,
  locateOnce,
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

const CAPE_TOWN = { latitude: -33.92, longitude: 18.42, accuracy: 1500 };

test('a fix resolves to its latitude and longitude', async () => {
  const geolocation = fakeGeolocation({ coords: CAPE_TOWN });
  assert.deepEqual(await locateOnce({ geolocation }), {
    ok: true,
    latitude: -33.92,
    longitude: 18.42,
  });
});

test('it asks once, allowing a cold first fix 30 s, for a fix no older than a minute', async () => {
  // The first live click after the permission prompt timed out at 10 s;
  // Chrome's network location can take that long cold.
  const geolocation = fakeGeolocation({ coords: CAPE_TOWN });
  await locateOnce({ geolocation });
  assert.equal(geolocation.calls.length, 1);
  assert.deepEqual(geolocation.calls[0], {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 60000,
  });
});

test('no geolocation is unavailable; code 1 is denied; codes 2 and 3 are not found', async () => {
  assert.deepEqual(await locateOnce({ geolocation: undefined }), {
    ok: false,
    reason: 'unavailable',
  });
  assert.deepEqual(await locateOnce({ geolocation: fakeGeolocation({ code: 1 }) }), {
    ok: false,
    reason: 'denied',
  });
  for (const code of [2, 3])
    assert.deepEqual(
      await locateOnce({ geolocation: fakeGeolocation({ code }) }),
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
  assert.deepEqual(await locateOnce({ geolocation }), {
    ok: false,
    reason: 'notFound',
  });
});

test('each failure reads as the search bar message', () => {
  assert.equal(locateFailureText('unavailable'), 'Browser location is unavailable');
  assert.equal(locateFailureText('denied'), 'Location access was not allowed');
  assert.equal(locateFailureText('notFound'), 'Location not found');
});

/** An action wired to recording doubles. */
function action(locate) {
  const flights = [];
  const errors = [];
  const busy = [];
  const myLocation = createMyLocationAction({
    locate,
    goTo: async (place) => {
      flights.push(place);
      return true;
    },
    showError: (text) => errors.push(text),
    setBusy: (value) => busy.push(value),
  });
  return { myLocation, flights, errors, busy };
}

test('the action flies to the fix through goTo and shows no error', async () => {
  const { myLocation, flights, errors, busy } = action(async () => ({
    ok: true,
    latitude: -33.92,
    longitude: 18.42,
  }));
  assert.equal(await myLocation.run(), true);
  assert.deepEqual(flights, [{ latitude: -33.92, longitude: 18.42 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(busy, [true, false]);
});

test('the action shows the failure text and does not fly', async () => {
  const { myLocation, flights, errors, busy } = action(async () => ({
    ok: false,
    reason: 'denied',
  }));
  assert.equal(await myLocation.run(), false);
  assert.deepEqual(flights, []);
  assert.deepEqual(errors, ['Location access was not allowed']);
  assert.deepEqual(busy, [true, false]);
});

test('a second click while locating is ignored', async () => {
  let release;
  let locateCalls = 0;
  const { myLocation, flights } = action(() => {
    locateCalls += 1;
    return new Promise((resolve) => {
      release = () => resolve({ ok: true, latitude: -33.92, longitude: 18.42 });
    });
  });
  const first = myLocation.run();
  assert.equal(myLocation.busy(), true);
  assert.equal(await myLocation.run(), false, 'the second click does nothing');
  release();
  assert.equal(await first, true);
  assert.equal(locateCalls, 1);
  assert.equal(flights.length, 1);
  assert.equal(myLocation.busy(), false, 'usable again afterwards');
});

test('a flight that fails clears the busy state', async () => {
  const busy = [];
  const myLocation = createMyLocationAction({
    locate: async () => ({ ok: true, latitude: 1, longitude: 2 }),
    goTo: async () => {
      throw new Error('search runner gone');
    },
    showError: () => {},
    setBusy: (value) => busy.push(value),
  });
  assert.equal(await myLocation.run(), false);
  assert.deepEqual(busy, [true, false]);
  assert.equal(myLocation.busy(), false);
});
