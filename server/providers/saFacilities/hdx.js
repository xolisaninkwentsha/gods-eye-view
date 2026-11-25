// HDX downloads for /api/sa-facilities. A dataset is resolved through HDX's
// CKAN API; its download link answers a redirect to a signed S3 address, which
// is followed once and only to HDX's own bucket path for that resource. The
// signed address is never logged, returned or put in an error.
import { readResponseTextCapped } from '../../../src/sources/httpBody.js';

export const FACILITY_SETS = Object.freeze({
  health: Object.freeze({
    dataset: 'south-africa-healthsites',
    resource: 'south-africa-healthsites-geojson',
    maxBytes: 8 * 1024 * 1024,
  }),
  schools: Object.freeze({
    dataset: 'south-africa-school-geolocation-and-connectivity-status',
    resource: 'south-africa-school-geolocation-connectivity-data.csv',
    maxBytes: 4 * 1024 * 1024,
  }),
});

const HDX_HOST = 'data.humdata.org';
const S3_HOST = 's3.us-east-1.amazonaws.com';
const S3_PREFIX = '/hdx-production-filestore/resources/';
const PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const USER_AGENT = 'GodsEyeView (sa-facilities)';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const RESOURCE_ID = /^[A-Za-z0-9-]{8,64}$/;

const coded = (code) => Object.assign(new Error(code), { code });

/** A URL that is exactly https on `host`, no port or credentials; else null. */
function pinned(value, base, host) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== host ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  )
    return null;
  return url;
}

const drop = (response) => {
  void response.body?.cancel().catch(() => {});
};

/**
 * One request with its own 60 s deadline (body read included). `handle` gets
 * the response and the request's signal; whatever it returns is the result.
 */
async function request(
  url,
  { fetchImpl, signal, redirect, timeoutMs, handle },
) {
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      redirect,
      signal: ctl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    });
    return await handle(response, ctl.signal);
  } catch (error) {
    if (timedOut) throw coded('TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The text of one HDX resource. Throws an error whose `code` names what went
 * wrong (HDX_PACKAGE_HTTP_<status>, HDX_RESOURCE_MISSING, HDX_URL_REFUSED,
 * HDX_REDIRECT_REFUSED, HDX_HTTP_<status>, RESPONSE_TOO_LARGE, PARSE_FAILED,
 * TIMEOUT). `onResource({updated})` is told the resource's last-modified day
 * (YYYY-MM-DD) or null once the package is read.
 */
export async function fetchHdxResource(
  set,
  {
    fetchImpl = (...args) => globalThis.fetch(...args),
    signal,
    onResource,
    timeoutMs = TIMEOUT_MS,
  } = {},
) {
  const packageUrl = `https://${HDX_HOST}/api/3/action/package_show?id=${encodeURIComponent(set.dataset)}`;
  const pkg = await request(packageUrl, {
    fetchImpl,
    signal,
    redirect: 'error',
    timeoutMs,
    handle: async (response, sig) => {
      if (response.status !== 200) {
        drop(response);
        throw coded(`HDX_PACKAGE_HTTP_${response.status}`);
      }
      const body = await readResponseTextCapped(
        response,
        PACKAGE_MAX_BYTES,
        sig,
      );
      try {
        return JSON.parse(body);
      } catch {
        throw coded('PARSE_FAILED');
      }
    },
  });
  const resources = Array.isArray(pkg?.result?.resources)
    ? pkg.result.resources
    : [];
  const resource = resources.find(
    (r) => r && typeof r === 'object' && r.name === set.resource,
  );
  if (!resource || typeof resource.id !== 'string')
    throw coded('HDX_RESOURCE_MISSING');
  const id = resource.id;
  if (!RESOURCE_ID.test(id)) throw coded('HDX_RESOURCE_MISSING');
  const downloadUrl =
    typeof resource.url === 'string'
      ? pinned(resource.url, undefined, HDX_HOST)
      : null;
  if (
    !downloadUrl ||
    !downloadUrl.pathname.includes(`/resource/${id}/download/`)
  )
    throw coded('HDX_URL_REFUSED');
  const stamp = String(resource.last_modified ?? '').match(
    /^\d{4}-\d{2}-\d{2}/,
  );
  onResource?.({ updated: stamp ? stamp[0] : null });

  const first = await request(downloadUrl.href, {
    fetchImpl,
    signal,
    redirect: 'manual',
    timeoutMs,
    handle: async (response, sig) => {
      if (response.status === 200)
        return {
          text: await readResponseTextCapped(response, set.maxBytes, sig),
        };
      const status = response.status;
      const location = response.headers.get('location');
      drop(response);
      if (!REDIRECTS.has(status)) throw coded(`HDX_HTTP_${status}`);
      const target = location
        ? pinned(location, downloadUrl.href, S3_HOST)
        : null;
      if (!target || !target.pathname.startsWith(`${S3_PREFIX}${id}/`))
        throw coded('HDX_REDIRECT_REFUSED');
      return { target: target.href };
    },
  });
  if (first.text !== undefined) return first.text;

  return request(first.target, {
    fetchImpl,
    signal,
    redirect: 'error',
    timeoutMs,
    handle: async (response, sig) => {
      if (response.status !== 200) {
        drop(response);
        throw coded(`HDX_HTTP_${response.status}`);
      }
      return readResponseTextCapped(response, set.maxBytes, sig);
    },
  });
}
