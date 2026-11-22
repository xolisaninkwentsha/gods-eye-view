import { t } from '../i18n/index.js';

/**
 * "Go to my location": ask the browser for one position and fly there. On a
 * device without Wi-Fi or GPS the browser's fix is only as good as the
 * internet connection's location (tens of kilometres), so:
 *
 * - a saved spot (right-click the button) wins when the fix is rough and the
 *   spot lies inside the fix's error range: exact at home, live elsewhere;
 * - otherwise a rough fix is framed wide enough to show its whole error area,
 *   with a notice, instead of landing on a confident but wrong street;
 * - a precise fix is framed close in, by its accuracy.
 *
 * The lookup itself sends the position nowhere: the flight uses it, and the
 * saved spot stays in this browser's storage.
 */

/** One fresh-enough fix, no older than a minute. The first live click timed
 * out at 10 s — a cold network-location fix is suspected of taking that long
 * — so it gets 30 s; once warm, the browser answers at once. */
const POSITION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 30_000,
  maximumAge: 60_000,
});

/** GeolocationPositionError.PERMISSION_DENIED */
const PERMISSION_DENIED = 1;

/**
 * The longest a request may wait for any answer. The browser's own timeout
 * starts only once permission is given, so a permission prompt nobody answers
 * would otherwise keep the button waiting forever; a granted request ends
 * within its 30 s, so this only cuts off an unanswered prompt.
 */
const ANSWER_WITHIN_MS = 45_000;
const NO_ANSWER = Symbol('noAnswer');

/** Where the saved spot lives in this browser. */
export const SPOT_STORAGE_KEY = 'gev:my-location-spot:v1';
/** A fix less certain than this is rough: it is framed, or the spot used. */
export const ROUGH_FIX_M = 2_000;
/** How far outside a rough fix's error radius a saved spot may still lie. */
export const SAVED_SPOT_SLACK_M = 5_000;
const FRAME_FACTOR = 2.5;
const PRECISE_RANGE_M = Object.freeze([500, 5_000]);
const ROUGH_RANGE_M = Object.freeze([5_000, 250_000]);
const EARTH_RADIUS_M = 6_371_000;

/**
 * Ask the browser for the viewer's position once.
 *
 * @param {{geolocation?: Geolocation, secure?: boolean, answerWithinMs?: number}} [options]
 *   `secure` is the page's isSecureContext: browsers refuse location to an
 *   insecure page (the app opened over a LAN IP), which is "unavailable", not
 *   a refusal the viewer could change. `answerWithinMs` bounds the whole wait,
 *   permission prompt included; an answer after it is ignored.
 * @returns {Promise<{ok: true, latitude: number, longitude: number, accuracyM: number}
 *   | {ok: false, reason: 'unavailable'|'denied'|'notFound'|'noAnswer'}>}
 */
export async function locateOnce({
  geolocation = globalThis.navigator?.geolocation,
  secure = globalThis.isSecureContext,
  answerWithinMs = ANSWER_WITHIN_MS,
} = {}) {
  if (
    secure === false ||
    !geolocation ||
    typeof geolocation.getCurrentPosition !== 'function'
  )
    return { ok: false, reason: 'unavailable' };
  try {
    const position = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(NO_ANSWER), answerWithinMs);
      const answer = (settle) => (value) => {
        clearTimeout(timer);
        settle(value);
      };
      try {
        geolocation.getCurrentPosition(answer(resolve), answer(reject), {
          ...POSITION_OPTIONS,
        });
      } catch (error) {
        answer(reject)(error);
      }
    });
    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      return { ok: false, reason: 'notFound' };
    return {
      ok: true,
      latitude,
      longitude,
      accuracyM: Number(position?.coords?.accuracy),
    };
  } catch (error) {
    if (error === NO_ANSWER) return { ok: false, reason: 'noAnswer' };
    return {
      ok: false,
      reason: error?.code === PERMISSION_DENIED ? 'denied' : 'notFound',
    };
  }
}

/**
 * Whether the browser will ask the viewer before answering: the Permissions
 * API's state for location. Null when the browser cannot say.
 *
 * @param {{permissions?: Permissions}} [options]
 * @returns {Promise<'granted'|'denied'|'prompt'|null>}
 */
export async function locationPermission({
  permissions = globalThis.navigator?.permissions,
} = {}) {
  try {
    const state = (await permissions?.query?.({ name: 'geolocation' }))?.state;
    return state === 'granted' || state === 'denied' || state === 'prompt'
      ? state
      : null;
  } catch {
    return null;
  }
}

/** Great-circle distance in metres. */
function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/** A rough fix's range: wide enough to show the whole error area. */
function roughRangeM(accuracyM) {
  return Number.isFinite(accuracyM)
    ? Math.round(clamp(FRAME_FACTOR * accuracyM, ROUGH_RANGE_M))
    : ROUGH_RANGE_M[1];
}

/**
 * Where a fix should take the camera.
 *
 * @param {{latitude: number, longitude: number, accuracyM: number}} fix
 * @param {{lat: number, lon: number}|null} savedSpot
 * @returns {{kind: 'saved'|'rough'|'precise', latitude: number,
 *   longitude: number, accuracyM: number, rangeM?: number}}
 */
export function chooseDestination(fix, savedSpot) {
  const { latitude, longitude, accuracyM } = fix;
  const precise = Number.isFinite(accuracyM) && accuracyM <= ROUGH_FIX_M;
  if (precise)
    return {
      kind: 'precise',
      latitude,
      longitude,
      accuracyM,
      rangeM: Math.round(clamp(FRAME_FACTOR * accuracyM, PRECISE_RANGE_M)),
    };
  if (
    savedSpot &&
    Number.isFinite(accuracyM) &&
    distanceM({ lat: latitude, lon: longitude }, savedSpot) <=
      accuracyM + SAVED_SPOT_SLACK_M
  )
    return {
      kind: 'saved',
      latitude: savedSpot.lat,
      longitude: savedSpot.lon,
      accuracyM,
    };
  return {
    kind: 'rough',
    latitude,
    longitude,
    accuracyM,
    rangeM: roughRangeM(accuracyM),
  };
}

/** Browser storage, or null where it is blocked. */
function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const onGlobe = (point) =>
  Number.isFinite(point?.lat) &&
  Number.isFinite(point?.lon) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lon) <= 180;

/**
 * The viewer's saved spot, or null (none, blocked, corrupt or off the globe).
 * @param {{storage?: Storage|null}} [options]
 * @returns {{lat: number, lon: number}|null}
 */
export function loadSavedSpot({ storage = safeLocalStorage() } = {}) {
  try {
    const raw = storage?.getItem(SPOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const spot = { lat: Number(parsed?.lat), lon: Number(parsed?.lon) };
    return onGlobe(spot) ? spot : null;
  } catch {
    return null;
  }
}

/**
 * Save `point` as the viewer's spot in this browser.
 * @param {{lat: number, lon: number}} point
 * @param {{storage?: Storage|null}} [options]
 * @returns {boolean} Whether it was saved.
 */
export function saveSpot(point, { storage = safeLocalStorage() } = {}) {
  if (!storage || !onGlobe(point)) return false;
  try {
    storage.setItem(
      SPOT_STORAGE_KEY,
      JSON.stringify({ lat: point.lat, lon: point.lon }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The search bar's error line for a failed location request.
 * @param {string} reason
 * @returns {string}
 */
export function locateFailureText(reason) {
  if (reason === 'unavailable') return t('Browser location is unavailable');
  if (reason === 'denied') return t('Location access was not allowed');
  if (reason === 'noAnswer')
    return t('The browser did not answer. Click the button to try again.');
  return t('Location not found');
}

/** Shown while the browser's permission prompt waits for the viewer. */
export function promptHintText() {
  return t("Choose Allow in the browser's location prompt");
}

/** The notice for a rough fix, its accuracy in whole kilometres. */
export function roughNoticeText(accuracyM) {
  const km = Number.isFinite(accuracyM)
    ? Math.max(1, Math.round(accuracyM / 1000))
    : ROUGH_RANGE_M[1] / 1000;
  return t(
    'Rough location (±{km} km). Centre the map on your spot, then right-click the button to save it.',
    { km },
  );
}

/** The message after saving the spot. */
export function spotSavedText(saved) {
  return saved
    ? t('Saved the centre of this view as your spot')
    : t('Your spot could not be saved');
}

/**
 * The search bar's message for a refused flight: the runner's own reason for
 * people when it gave one (the search bar's `ActionFailed.reason`), else the
 * general one. The same words a refused chip or command shows.
 * @param {unknown} failure what the flight threw
 * @returns {string}
 */
export function flightFailureText(failure) {
  const reason = /** @type {{reason?: unknown}} */ (failure ?? {}).reason;
  return typeof reason === 'string' && reason
    ? t('Unable to complete this action: {reason}', { reason })
    : t('Unable to complete this action. Please try again.');
}

/**
 * The button's behaviour: one request at a time; then the saved spot, a
 * framed rough fix or a framed precise fix; otherwise the failure message.
 * While the browser's permission prompt waits, the line says so; a silent
 * landing clears it again. A request superseded meanwhile (`isCurrent()`
 * false) does nothing at all.
 *
 * @param {{locate?: typeof locateOnce,
 *   permission?: typeof locationPermission,
 *   loadSpot?: () => ({lat: number, lon: number}|null),
 *   goTo: (place: {latitude: number, longitude: number}) => Promise<unknown>,
 *   frame: (place: {latitude: number, longitude: number}, rangeM: number) => Promise<unknown>,
 *   showError: (text: string) => void,
 *   showNotice: (text: string) => void,
 *   setBusy: (busy: boolean) => void}} options
 * @returns {{run: (options?: {isCurrent?: () => boolean}) => Promise<boolean>,
 *   busy: () => boolean}}
 */
export function createMyLocationAction({
  locate = locateOnce,
  permission = locationPermission,
  loadSpot = loadSavedSpot,
  goTo,
  frame,
  showError,
  showNotice,
  setBusy,
}) {
  let pending = false;
  return {
    busy: () => pending,
    async run({ isCurrent = () => true } = {}) {
      if (pending) return false;
      pending = true;
      setBusy(true);
      // Whether a hint about the browser's prompt is on the line, and whether
      // the browser has answered (after which no hint may appear).
      let hinted = false;
      let answered = false;
      const clearHint = () => {
        if (hinted && isCurrent()) showNotice('');
      };
      try {
        const located = locate();
        // The permission check runs beside the request, never ahead of it.
        void Promise.resolve()
          .then(() => permission())
          .then(
            (state) => {
              if (state !== 'prompt' || answered || !isCurrent()) return;
              hinted = true;
              showNotice(promptHintText());
            },
            () => {},
          );
        const fix = await located;
        answered = true;
        if (!isCurrent()) return false;
        if (!fix.ok) {
          showError(locateFailureText(fix.reason));
          return false;
        }
        const destination = chooseDestination(fix, loadSpot());
        const place = {
          latitude: destination.latitude,
          longitude: destination.longitude,
        };
        // A flight resolves false when the viewer interrupted it: no notice then.
        const arrived =
          destination.kind === 'saved'
            ? await goTo(place)
            : await frame(place, destination.rangeM);
        if (arrived !== false && destination.kind === 'rough' && isCurrent()) {
          showNotice(roughNoticeText(destination.accuracyM));
          return true;
        }
        clearHint();
        return arrived !== false;
      } catch (failure) {
        // A refused flight says so, as a refused search-bar action does.
        if (isCurrent()) showError(flightFailureText(failure));
        return false;
      } finally {
        pending = false;
        setBusy(false);
      }
    },
  };
}
