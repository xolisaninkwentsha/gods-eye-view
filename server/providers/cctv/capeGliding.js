/**
 * Cape Gliding Club (Worcester, Western Cape) webcams. The club publishes no
 * fixed image URL: each frame's file name carries its timestamp, and the
 * club's own page asks a WordPress lookup for the latest one. The server does
 * the same, pinned twice: the lookup must be exactly the club's
 * `get_latest_camera_image` call for camera 1–4, and the JPEG it names must
 * sit in that same camera's folder on the club's site. Anything else is
 * refused without a second request.
 */

import { pinnedCameraUrl } from './normalize.js';

export const CAPE_GLIDING_SOURCE_KIND = 'capegliding-latest';

const ORIGIN = 'https://www.capegliding.co.za';
const LOOKUP_PATH = '/wp-admin/admin-ajax.php';
const LOOKUP_ACTION = 'get_latest_camera_image';
const IMAGE_FOLDER = `${ORIGIN}/wp-content/uploads/camera-cache/`;

/**
 * The camera number of an exact lookup URL, or null.
 * @param {string} lookupUrl
 * @returns {number|null}
 */
function lookupCameraNumber(lookupUrl) {
  let url;
  try {
    url = new URL(String(lookupUrl || ''));
  } catch {
    return null;
  }
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.pathname !== LOOKUP_PATH ||
    url.hash ||
    [...url.searchParams.keys()].sort().join(',') !== 'action,camera' ||
    url.searchParams.get('action') !== LOOKUP_ACTION
  )
    return null;
  const match = /^camera([1-4])$/.exec(url.searchParams.get('camera') || '');
  return match ? Number(match[1]) : null;
}

/** Read at most `maxBytes` of a response body as text, or null when larger. */
async function readCappedText(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Ask the club's lookup for the camera's latest JPEG and return its URL when
 * it is pinned to that camera's folder; otherwise null. Never follows a
 * redirect and never fetches anything but an exact lookup URL.
 *
 * @param {string} lookupUrl
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number}} [options]
 * @returns {Promise<string|null>}
 */
export async function resolveCapeGlidingFrameUrl(
  lookupUrl,
  { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 16384 } = {},
) {
  const camera = lookupCameraNumber(lookupUrl);
  if (!camera) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Cape Gliding lookup timed out', 'TimeoutError'),
      ),
    timeoutMs,
  );
  try {
    const response = await fetchImpl(lookupUrl, {
      headers: { 'User-Agent': 'gods-eye-view-cctv-proxy/1.0' },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const text = await readCappedText(response, maxBytes);
    if (text === null) return null;
    const body = JSON.parse(text);
    if (body?.success !== true || typeof body?.data?.url !== 'string')
      return null;
    return pinnedCameraUrl(body.data.url, `${IMAGE_FOLDER}camera${camera}/`);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
