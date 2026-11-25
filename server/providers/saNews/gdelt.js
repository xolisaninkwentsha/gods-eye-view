// South African stories from GDELT 2.0 15-minute event exports (the
// tab-separated table, 61 columns). Pure: text in, stories out. A story is one
// article (events grouped by storyKey), placed by choosePlaces and titled by
// its address words; nothing here fetches or reads the article.

import { readResponseBytesCapped } from '../common/http.js';
import {
  addressWords,
  articleLink,
  choosePlaces,
  cleanTitle,
  exportAt,
  exportsOfDay,
  fetchLatestExport,
  storyKey,
  unzipExport,
} from '../news/gdeltEvents.js';
import { errorLabel } from './errorLabel.js';

// Columns of the GDELT 2.0 events table (61).
export const SA_COL = {
  id: 0,
  rootCode: 28,
  quadClass: 29,
  mentions: 31,
  geoType: 51,
  place: 52,
  country: 53,
  lat: 56,
  lon: 57,
  added: 59,
  url: 60,
};

const DAY_MS = 86_400_000;
// GDELT geo types 3 (US city) and 4 (world city); South Africa's are 4.
const CITY_TYPES = new Set(['3', '4']);

/** The kind a CAMEO root code makes a story. */
export function saKind(root) {
  const code = String(root ?? '').trim();
  if (code === '14') return 'protest';
  if (['18', '19', '20'].includes(code)) return 'violence';
  return 'event';
}

/**
 * An article's address as one comparable string: https, host in lower case
 * without "www.", no query, hash or trailing slash; null for anything that is
 * not http(s).
 */
export function normalizeUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return `https://${host}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * The South African city events of an export's table. `denied(name)` is given
 * the first part of an event's place and drops it when true (GDELT places
 * events at provinces and people as if they were cities).
 */
export function parseSaEvents(table, { denied = () => false } = {}) {
  const events = [];
  for (const line of String(table ?? '').split('\n')) {
    const f = line.split('\t');
    if (f.length < 61 || f[SA_COL.country] !== 'SF') continue;
    if (!CITY_TYPES.has(f[SA_COL.geoType])) continue;
    const lat = Number(f[SA_COL.lat]);
    const lon = Number(f[SA_COL.lon]);
    if (
      !f[SA_COL.lat] ||
      !f[SA_COL.lon] ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      (lat === 0 && lon === 0)
    )
      continue;
    const url = articleLink(f[SA_COL.url]);
    const added = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(
      f[SA_COL.added],
    );
    if (!url || !added) continue;
    const addedMs = Date.UTC(
      +added[1],
      +added[2] - 1,
      +added[3],
      +added[4],
      +added[5],
      +added[6],
    );
    if (!Number.isFinite(addedMs)) continue;
    const place = f[SA_COL.place].trim();
    if (denied(place.split(',')[0].trim())) continue;
    events.push({
      id: f[SA_COL.id],
      root: f[SA_COL.rootCode],
      quad: f[SA_COL.quadClass],
      mentions: Math.max(1, Number(f[SA_COL.mentions]) || 1),
      place,
      lat,
      lon,
      addedMs,
      url,
      // For choosePlaces: every row kept here is a city.
      precision: 'city',
    });
  }
  return events;
}

const SEVERITY = { event: 0, protest: 1, violence: 2 };

// FNV-1a, 32 bits, as 8 hex digits.
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * One story per article (storyKey): its most severe kind, its earliest time
 * (`publishedAt`, ms), its first chosen place. Stories older than `windowMs`
 * before `nowMs` are dropped.
 */
export function saStories(events, { nowMs, windowMs = DAY_MS } = {}) {
  const groups = new Map();
  for (const event of events) {
    const key = storyKey(event);
    const list = groups.get(key) || [];
    list.push(event);
    groups.set(key, list);
  }
  const stories = [];
  for (const list of groups.values()) {
    const first = list.reduce((a, b) => (b.addedMs < a.addedMs ? b : a));
    if (first.addedMs < nowMs - windowMs) continue;
    const [place] = choosePlaces(list, addressWords(first.url));
    if (!place) continue;
    const kind = list
      .map((e) => saKind(e.root))
      .reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
    const source = new URL(first.url).hostname.replace(/^www\./, '');
    const words = addressWords(first.url);
    const title =
      (words && words.split(' ').length >= 3 && cleanTitle(words)) ||
      `Story from ${source}`;
    stories.push({
      id: `gd:${hash(normalizeUrl(first.url) ?? first.url)}`,
      kind,
      title,
      source,
      url: first.url,
      place: place.place.split(',')[0].trim(),
      lat: place.lat,
      lon: place.lon,
      publishedAt: first.addedMs,
    });
  }
  return stories;
}

const STEP_MS = 15 * 60_000;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'GodsEyeView (sa-news)';
const PER_REFRESH = 12;
const PARALLEL = 4;
const MAX_TRIES = 3;
// An export still answering 404 this long after its time is not coming.
const GONE_MS = 90 * 60_000;
// An export that errored is not asked again sooner than this.
const RETRY_MS = 5 * 60_000;
// A window this long, with nothing retriable missing, counts as whole (the
// newest listed export may lag the current quarter hour).
const COMPLETE_HOURS = 23.5;

/**
 * A 24-hour window of South African events, kept in memory from GDELT's
 * 15-minute exports. Each `refresh` reads up to 12 exports not held yet,
 * newest first, never past the newest lastupdate.txt lists (an early request
 * is answered 404, which GDELT's CDN keeps for an hour). Give-up rules as in
 * the News layer: a 404 is never a try, and an export answering 404 90
 * minutes after its time is gone; an error is a try (3 gives up, 5 minutes apart)
 * only in a refresh that read some export, i.e. while GDELT is answering.
 */
export function createGdeltWindow({
  fetchImpl,
  now = Date.now,
  log = { warn() {} },
  denied = () => false,
} = {}) {
  // url -> events; url -> {tries, at} of its errors; given up on.
  const held = new Map();
  const failures = new Map();
  const gone = new Set();
  // The newest export lastupdate listed (kept when a later read fails), the
  // exports of the window up to it, and how the last refresh went.
  let latest = null;
  let listed = [];
  let latestFailed = false;
  let errored = false;
  let running = null;

  const withAgent = (url, options = {}) =>
    fetchImpl(url, {
      ...options,
      headers: { ...options.headers, 'User-Agent': USER_AGENT },
    });

  async function fetchOne(url, signal) {
    const response = await withAgent(url, {
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) {
      await response.body?.cancel?.().catch?.(() => {});
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      throw Object.assign(new Error('status'), {
        code: `HTTP_${response.status}`,
      });
    }
    const bytes = await readResponseBytesCapped(
      response,
      MAX_EXPORT_BYTES,
      signal,
    );
    return parseSaEvents(await unzipExport(bytes, MAX_EXPORT_BYTES), {
      denied,
    });
  }

  async function run({ signal } = {}) {
    const at = now();
    const day = exportsOfDay(at, 24);
    const read = await fetchLatestExport({ fetchImpl: withAgent, signal });
    latestFailed = read === null && !signal?.aborted;
    if (read !== null) latest = read;
    errored = false;
    const inWindow = new Set(day);
    for (const map of [held, failures])
      for (const url of map.keys()) if (!inWindow.has(url)) map.delete(url);
    for (const url of gone) if (!inWindow.has(url)) gone.delete(url);
    listed =
      latest === null ? [] : day.filter((url) => exportAt(url) <= latest);
    const wanted = listed
      .filter(
        (url) =>
          !held.has(url) &&
          !gone.has(url) &&
          !(at - (failures.get(url)?.at ?? -Infinity) < RETRY_MS),
      )
      .slice(0, PER_REFRESH);
    const failing = [];
    const missing = [];
    let added = 0;
    let next = 0;
    const worker = async () => {
      while (next < wanted.length) {
        if (signal?.aborted) break;
        const url = wanted[next++];
        try {
          const events = await fetchOne(url, signal);
          if (events) {
            held.set(url, events);
            failures.delete(url);
            added += 1;
          } else missing.push(url);
        } catch (error) {
          // A read the caller cut short is no fault of the export's.
          if (signal?.aborted) return;
          errored = true;
          failing.push(url);
          log.warn('[sa-news] gdelt export failed', errorLabel(error));
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, wanted.length) }, worker),
    );
    if (signal?.aborted) errored = false;
    // A 404 is blamed on its export only while GDELT answers (an export read,
    // or lastupdate.txt read); otherwise it is only spaced like an error.
    const answering = added > 0 || !latestFailed;
    for (const url of missing) {
      if (answering) {
        if (at - exportAt(url) >= GONE_MS) gone.add(url);
      } else failures.set(url, { tries: failures.get(url)?.tries ?? 0, at });
    }
    // Every error is spaced; it counts as a try only while GDELT answers.
    for (const url of failing) {
      const tries = (failures.get(url)?.tries ?? 0) + (added > 0 ? 1 : 0);
      failures.set(url, { tries, at });
      if (tries >= MAX_TRIES) gone.add(url);
    }
    return { read: added };
  }

  /** Reads the missing exports; resolves to {read}, how many it read. A call during a read joins it. */
  function refresh(options = {}) {
    running ??= run(options).finally(() => {
      running = null;
    });
    return running;
  }

  function coverage() {
    // Held exports of the window, not a run: a hole costs its own quarter hour.
    const hoursCovered = (held.size * STEP_MS) / 3_600_000;
    const missing = listed.filter(
      (url) => !held.has(url) && !gone.has(url),
    ).length;
    const complete = missing === 0 && hoursCovered >= COMPLETE_HOURS;
    let state;
    if (held.size === 0)
      state =
        latestFailed || errored || (listed.length > 0 && missing === 0)
          ? 'failed'
          : 'loading';
    else state = complete && !errored ? 'ok' : 'partial';
    return { hoursCovered, missing, complete, state };
  }

  function stories() {
    const events = [...held.values()].flat();
    return saStories(events, { nowMs: now() }).sort(
      (a, b) => b.publishedAt - a.publishedAt,
    );
  }

  return { refresh, stories, coverage };
}
