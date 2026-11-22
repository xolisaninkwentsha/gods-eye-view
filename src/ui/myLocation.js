import { t } from '../i18n/index.js';

/**
 * "Go to my location": ask the browser for one position and fly there
 * through the search bar's coordinate route, which answers a coordinate
 * locally, so the position goes to no server and no place-name service.
 * Only the browser's own location service sees anything, to work it out.
 * Nothing is stored and nothing follows the viewer afterwards.
 */

/**
 * One fresh-enough fix, no older than a minute. A cold first fix from the
 * browser's network location can take well over 10 s (the first live click
 * timed out at 10 s), so it gets 30 s; once warm, it answers at once.
 */
const POSITION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 30_000,
  maximumAge: 60_000,
});

/** GeolocationPositionError.PERMISSION_DENIED */
const PERMISSION_DENIED = 1;

/**
 * Ask the browser for the viewer's position once.
 *
 * @param {{geolocation?: Geolocation}} [options]
 * @returns {Promise<{ok: true, latitude: number, longitude: number}
 *   | {ok: false, reason: 'unavailable'|'denied'|'notFound'}>}
 */
export async function locateOnce({
  geolocation = globalThis.navigator?.geolocation,
} = {}) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function')
    return { ok: false, reason: 'unavailable' };
  try {
    const position = await new Promise((resolve, reject) => {
      geolocation.getCurrentPosition(resolve, reject, { ...POSITION_OPTIONS });
    });
    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      return { ok: false, reason: 'notFound' };
    return { ok: true, latitude, longitude };
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === PERMISSION_DENIED ? 'denied' : 'notFound',
    };
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
  return t('Location not found');
}

/**
 * The button's behaviour: one request at a time; on a fix, fly there with
 * `goTo`; otherwise show the failure in the search bar.
 *
 * @param {{locate?: typeof locateOnce,
 *   goTo: (place: {latitude: number, longitude: number}) => Promise<unknown>,
 *   showError: (text: string) => void,
 *   setBusy: (busy: boolean) => void}} options
 * @returns {{run: () => Promise<boolean>, busy: () => boolean}}
 */
export function createMyLocationAction({
  locate = locateOnce,
  goTo,
  showError,
  setBusy,
}) {
  let pending = false;
  return {
    busy: () => pending,
    async run() {
      if (pending) return false;
      pending = true;
      setBusy(true);
      try {
        const fix = await locate();
        if (!fix.ok) {
          showError(locateFailureText(fix.reason));
          return false;
        }
        await goTo({ latitude: fix.latitude, longitude: fix.longitude });
        return true;
      } catch {
        return false;
      } finally {
        pending = false;
        setBusy(false);
      }
    },
  };
}
