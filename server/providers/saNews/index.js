// /api/sa-news: South African stories of the last 24 hours, from GDELT's
// 15-minute exports and eight outlet feeds, joined by article address. Kept in
// memory only. The refresh loop starts on the first request and never
// overlaps itself; a request only ever waits for the very first read.
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { errorLabel } from './errorLabel.js';
import { createGdeltWindow, hash, normalizeUrl } from './gdelt.js';
import { matchPlace, deniedPlace, townNear } from './places.js';
import { createFeeds } from './rss.js';

const DAY_MS = 86_400_000;
const GDELT_FAST_MS = 2_000;
const GDELT_SLOW_MS = 5 * 60_000;
const FEEDS_MS = 15 * 60_000;

/**
 * One story per article and per id. GDELT's stories keep their id, kind and
 * place; one whose place is a listed town within 25 km takes the town's
 * position, so both sources share one spiral there. A feed item with the same
 * address lends its title, source and link and the earlier time. A feed item
 * alone is a 'headline' when its title names a town. Stories older than 24 h
 * before `nowMs` are dropped. Of two stories with one id (GDELT addresses
 * that differ only in the query share one) the earlier is kept. Newest first.
 */
export function mergeStories(gdeltStories, feedItems, nowMs) {
  const since = nowMs - DAY_MS;
  const byId = new Map();
  // Holds `story` unless it is out of the window or a story with its id is
  // no later.
  const keep = (story) => {
    if (story.publishedAt < since) return;
    const held = byId.get(story.id);
    if (!held || story.publishedAt < held.publishedAt)
      byId.set(story.id, story);
  };
  for (const story of gdeltStories) {
    const town = townNear(story.place, story.lat, story.lon);
    keep({
      ...story,
      ...(town ? { lat: town.lat, lon: town.lon } : {}),
      via: ['gdelt'],
    });
  }
  // Built from the stories kept, so an outlet twin joins the one kept.
  const byKey = new Map();
  for (const story of byId.values()) {
    const key = normalizeUrl(story.url);
    if (key) byKey.set(key, story);
  }
  for (const item of feedItems) {
    const key = normalizeUrl(item.url);
    if (!key) continue;
    const twin = byKey.get(key);
    if (twin) {
      if (twin.via.length === 1 && twin.via[0] === 'gdelt') {
        twin.title = item.title;
        twin.source = item.source;
        twin.url = item.url;
        twin.publishedAt = Math.min(twin.publishedAt, item.publishedAt);
        twin.via = ['gdelt', 'rss'];
      }
      continue;
    }
    const place = matchPlace(item.title);
    if (!place) continue;
    const story = {
      id: `rss:${hash(key)}`,
      kind: 'headline',
      title: item.title,
      source: item.source,
      url: item.url,
      place: place.name,
      lat: place.lat,
      lon: place.lon,
      publishedAt: item.publishedAt,
      via: ['rss'],
    };
    keep(story);
    byKey.set(key, story);
  }
  return [...byId.values()]
    .filter((story) => story.publishedAt >= since)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Vite plugin for /api/sa-news. `firstWaitMs` caps how long the first request
 * waits for the first read. The loop stops when the dev or preview server
 * closes (Vite restarts it in-process and builds a new provider) or on
 * `closeBundle`, whichever comes first.
 */
export function saNewsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  log = console,
  firstWaitMs = 10_000,
} = {}) {
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 60,
    globalMax: 600,
    now,
  });
  const gdelt = createGdeltWindow({
    fetchImpl,
    now,
    log,
    denied: deniedPlace,
  });
  const feeds = createFeeds({ fetchImpl, now, log });

  const abort = new AbortController();
  const timers = new Set();
  let closed = false;
  let first = null;

  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timer.unref?.();
    timers.add(timer);
    return timer;
  };
  const cancel = (timer) => {
    clearTimeout(timer);
    timers.delete(timer);
  };

  // One refresh, then the next after `delayAfter(result)`; a chain never
  // overlaps itself. The returned promise (the first refresh) never rejects.
  function loop(label, refresh, delayAfter) {
    const step = async () => {
      let result;
      try {
        result = await refresh({ signal: abort.signal });
      } catch (error) {
        if (!closed)
          log.warn(`[sa-news] ${label} refresh failed`, errorLabel(error));
      }
      if (!closed) later(step, delayAfter(result));
    };
    return step();
  }

  /** Starts the loops once; resolves after the first read or the cap. */
  function ready() {
    if (!first) {
      const runs = Promise.all([
        loop('gdelt', gdelt.refresh, (result) =>
          result?.read > 0 && !gdelt.coverage().complete
            ? GDELT_FAST_MS
            : GDELT_SLOW_MS,
        ),
        loop('feeds', feeds.refresh, () => FEEDS_MS),
      ]);
      let cap;
      const capped = new Promise((resolve) => {
        cap = later(resolve, firstWaitMs);
      });
      first = Promise.race([runs, capped]).finally(() => cancel(cap));
    }
    return first;
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const route = (req.url || '/').split('?')[0];
    if (route !== '/' && route !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    try {
      await ready();
      const at = now();
      json(200, {
        fetchedAt: new Date(at).toISOString(),
        stories: mergeStories(gdelt.stories(), feeds.items(), at),
        status: { gdelt: gdelt.coverage(), rss: feeds.status() },
      });
    } catch (error) {
      log.warn('[sa-news] request failed', errorLabel(error));
      json(502, { error: 'sa_news_unavailable' });
    }
  }

  /**
   * Stops the loop and aborts what is in flight; idempotent. Logs one line,
   * by name only, when the loop had started.
   */
  function stop() {
    if (closed) return;
    closed = true;
    abort.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (first) {
      const note = typeof log.info === 'function' ? log.info : log.warn;
      note?.call(log, '[sa-news] stopped');
    }
  }

  function install(server) {
    server.middlewares.use('/api/sa-news', handler);
    // Vite restarts the server in-process; the old loop must not live on.
    server.httpServer?.once('close', stop);
  }

  return {
    name: 'sa-news',
    configureServer: install,
    configurePreviewServer: install,
    // Middleware mode has no httpServer to hang 'close' on.
    closeBundle: stop,
  };
}
