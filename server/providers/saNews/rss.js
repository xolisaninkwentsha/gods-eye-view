// Headlines from South African outlets' RSS and Atom feeds. Parsing is plain
// text scanning (no XML library); a feed is read at most every 15 minutes and
// only its headline, link and time are kept, in memory.

import { readResponseTextCapped } from '../common/http.js';
import { errorLabel } from './errorLabel.js';
import { normalizeUrl } from './gdelt.js';

export const SA_FEEDS = [
  { id: 'iol', name: 'IOL', url: 'https://iol.co.za/rss/' },
  {
    id: 'dailymaverick',
    name: 'Daily Maverick',
    url: 'https://www.dailymaverick.co.za/dmrss/',
  },
  {
    id: 'timeslive',
    name: 'TimesLIVE',
    url: 'https://www.timeslive.co.za/arc/outboundfeeds/rss/',
  },
  { id: 'mg', name: 'Mail & Guardian', url: 'https://mg.co.za/rss/' },
  {
    id: 'groundup',
    name: 'GroundUp',
    url: 'https://groundup.org.za/sitenews/rss/',
  },
  { id: 'enca', name: 'eNCA', url: 'https://www.enca.com/rss.xml' },
  {
    id: 'citizen',
    name: 'The Citizen',
    url: 'https://www.citizen.co.za/feed/',
  },
  { id: 'sanews', name: 'SAnews', url: 'https://www.sanews.gov.za/rss.xml' },
];

const DAY_MS = 86_400_000;
const FUTURE_MS = 3_600_000;
const REFRESH_MS = 15 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const USER_AGENT = 'GodsEyeView (sa-news)';
const PARALLEL = 4;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (whole, dec, hex, name) => {
      if (name) return NAMED[name] ?? whole;
      const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    },
  );
}

// Every scan below moves forward with indexOf or a global regex that matches
// a fixed prefix, and gives up when a closing mark is missing, so a hostile or
// truncated body costs time linear in its size.
const MAX_ITEMS = 200;
const MAX_TITLE = 300;
const MAX_RAW_TITLE = 4000;

function unwrapCdata(text) {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<![CDATA[', at);
    const close = open < 0 ? -1 : text.indexOf(']]>', open + 9);
    if (close < 0) return out + text.slice(at);
    out += text.slice(at, open) + text.slice(open + 9, close);
    at = close + 3;
  }
}

function stripTags(text) {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<', at);
    const close = open < 0 ? -1 : text.indexOf('>', open);
    if (close < 0) return out + text.slice(at);
    out += `${text.slice(at, open)} `;
    at = close + 1;
  }
}

// A title or link's text: CDATA unwrapped, tags stripped, entities decoded
// once, whitespace collapsed.
const cleanText = (raw) =>
  decodeEntities(stripTags(unwrapCdata(raw)))
    .replace(/\s+/g, ' ')
    .trim();

// The open tags named `name`, as text, in order; stops at one with no `>`.
function* openTags(block, name) {
  const re = new RegExp(`<${name}(?=[\\s/>])`, 'gi');
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const end = block.indexOf('>', m.index);
    if (end < 0) return;
    yield { tag: block.slice(m.index, end + 1), end: end + 1 };
    re.lastIndex = end + 1;
  }
}

// Text of the first <name>...</name>; null when it is unclosed or absent.
function tagText(block, name) {
  for (const { tag, end } of openTags(block, name)) {
    if (tag.endsWith('/>')) continue;
    const close = new RegExp(`</${name}\\s*>`, 'gi');
    close.lastIndex = end;
    const m = close.exec(block);
    return m ? block.slice(end, m.index) : null;
  }
  return null;
}

function attribute(tag, name) {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

// RSS: the text of <link>. Atom: href of the alternate (or rel-less) <link>.
function linkOf(block) {
  const text = tagText(block, 'link');
  if (text !== null) return decodeEntities(unwrapCdata(text).trim());
  for (const { tag } of openTags(block, 'link')) {
    const rel = attribute(tag, 'rel');
    const href = attribute(tag, 'href');
    if (href && (rel === null || rel.toLowerCase() === 'alternate'))
      return decodeEntities(href.trim());
  }
  return null;
}

function dateOf(block) {
  for (const tag of ['pubDate', 'published', 'updated']) {
    const text = tagText(block, tag);
    if (text === null) continue;
    const ms = Date.parse(cleanText(text));
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * The recent headlines of an RSS or Atom feed: {title, url, publishedAt}.
 * Links must be http(s) and are kept as written; `normalizeUrl` is only the
 * duplicate key. An item without a date takes the time it was first seen
 * (`firstSeen`: normalised link -> ms, filled in here). Items older than 24 h
 * or over 1 h ahead of `nowMs` are dropped.
 */
export function parseFeed(xml, { nowMs, firstSeen } = {}) {
  const items = [];
  const seen = new Set();
  const text = String(xml ?? '');
  const opens = /<(item|entry)(?=[\s/>])/gi;
  const closes = { item: /<\/item\s*>/gi, entry: /<\/entry\s*>/gi };
  for (
    let m = opens.exec(text);
    m && items.length < MAX_ITEMS;
    m = opens.exec(text)
  ) {
    const gt = text.indexOf('>', m.index);
    if (gt < 0) break;
    opens.lastIndex = gt + 1;
    if (text[gt - 1] === '/') continue;
    const close = closes[m[1].toLowerCase()];
    close.lastIndex = gt + 1;
    const end = close.exec(text);
    if (!end) break;
    opens.lastIndex = end.index + end[0].length;
    const block = text.slice(gt + 1, end.index);
    let title = cleanText(
      (tagText(block, 'title') ?? '').slice(0, MAX_RAW_TITLE),
    );
    if (title.length > MAX_TITLE)
      title = `${title.slice(0, MAX_TITLE - 1)}\u2026`;
    const url = linkOf(block);
    const key = normalizeUrl(url);
    if (!title || !key || seen.has(key)) continue;
    let publishedAt = dateOf(block);
    if (publishedAt === null) {
      publishedAt = firstSeen?.get(key) ?? nowMs;
      firstSeen?.set(key, publishedAt);
    }
    if (publishedAt < nowMs - DAY_MS || publishedAt > nowMs + FUTURE_MS)
      continue;
    seen.add(key);
    items.push({ title, url, publishedAt });
  }
  return items;
}

/**
 * The outlet feeds, kept in memory. `refresh` reads each feed last tried 15
 * minutes ago or more (all on the first call), 4 at a time; a failed feed
 * keeps its items and is tried again on the same cadence. A caller's abort
 * leaves everything as it was and is no attempt. `items` and `status` only
 * read memory.
 */
export function createFeeds({
  fetchImpl,
  now = Date.now,
  log = { warn() {} },
} = {}) {
  const states = new Map(
    SA_FEEDS.map((feed) => [
      feed.id,
      { feed, status: 'loading', items: [], attemptedAt: -Infinity },
    ]),
  );
  // normalised link -> ms, for items the feed gives no date.
  const firstSeen = new Map();
  let running = null;

  async function readFeed(feed, signal) {
    const response = await fetchImpl(feed.url, {
      redirect: 'error',
      headers: { 'User-Agent': USER_AGENT },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel?.().catch?.(() => {});
      throw Object.assign(new Error('status'), {
        code: `HTTP_${response.status}`,
      });
    }
    return readResponseTextCapped(response, MAX_BYTES, signal);
  }

  async function run({ signal } = {}) {
    const at = now();
    for (const [key, ms] of firstSeen)
      if (ms < at - DAY_MS) firstSeen.delete(key);
    const due = [...states.values()].filter(
      (state) => at - state.attemptedAt >= REFRESH_MS,
    );
    let next = 0;
    const worker = async () => {
      while (next < due.length) {
        if (signal?.aborted) return;
        const state = due[next++];
        try {
          const xml = await readFeed(state.feed, signal);
          state.items = parseFeed(xml, { nowMs: at, firstSeen });
          state.status = 'ok';
        } catch (error) {
          // A read the caller cut short is no fault of the feed's.
          if (signal?.aborted) return;
          state.status = 'failed';
          log.warn('[sa-news] feed failed', state.feed.id, errorLabel(error));
        }
        state.attemptedAt = at;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL, due.length) }, worker),
    );
  }

  /** Reads the feeds that are due; a call during a read joins it. */
  function refresh(options = {}) {
    running ??= run(options).finally(() => {
      running = null;
    });
    return running;
  }

  /** The held headlines inside the 24 h window, one per article. */
  function items() {
    const at = now();
    const seen = new Set();
    const out = [];
    for (const { feed, items: held } of states.values()) {
      for (const item of held) {
        if (item.publishedAt < at - DAY_MS || item.publishedAt > at + FUTURE_MS)
          continue;
        const key = normalizeUrl(item.url);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...item, source: feed.name });
      }
    }
    return out;
  }

  function status() {
    return Object.fromEntries(
      [...states].map(([id, state]) => [id, state.status]),
    );
  }

  return { refresh, items, status };
}
