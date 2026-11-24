// South African Weather Service warning feed: an RSS index whose items name
// CAP 1.2 files, and the CAP files themselves. Read with hand-written regex,
// like jtwc.js and regional/news.js. Pure parsing, no network.

export const SAWS_FILE_NAME =
  /^([A-Z]{2,3})_CAP_([A-Za-z]+)_(\d{8})_(\d{6})\.xml$/;

const SAWS_CAP_BASE = 'https://www.weathersa.co.za/Documents/Warnings/';

export function sawsCapUrl(name) {
  if (typeof name !== 'string' || !SAWS_FILE_NAME.test(name)) {
    throw new Error('invalid_saws_name');
  }
  return SAWS_CAP_BASE + name;
}

export function sawsBand(level) {
  if (!Number.isInteger(level)) return null;
  if (level >= 1 && level <= 4) return 'yellow';
  if (level >= 5 && level <= 8) return 'orange';
  if (level >= 9 && level <= 10) return 'red';
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// One pass, so CDATA keeps its raw text and `&amp;lt;` decodes only once.
function decodeXml(value) {
  return String(value || '').replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (match, cdata, entity) => {
      if (cdata !== undefined) return cdata;
      if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()];
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    },
  );
}

function capTag(block, tag) {
  return decodeXml(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(
      block,
    )?.[1] || '',
  ).trim();
}

function capBlocks(xml, tag) {
  return [
    ...xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'),
    ),
  ].map((m) => m[1]);
}

function timeMs(text) {
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function parseSawsFeed(xml) {
  const text = String(xml || '');
  if (!/<rss[\s>]/i.test(text) || !/<channel[\s>]/i.test(text)) {
    throw new Error('invalid_saws_feed');
  }
  const seen = new Set();
  const entries = [];
  for (const item of capBlocks(text, 'item')) {
    const ref = capTag(item, 'guid') || capTag(item, 'link');
    const name = ref.split('/').pop();
    const match = SAWS_FILE_NAME.exec(name);
    if (!match || seen.has(name)) continue;
    const [, office, hazard, date, time] = match;
    const nameMs = Date.parse(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T` +
        `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}+02:00`,
    );
    if (!Number.isFinite(nameMs)) continue;
    seen.add(name);
    entries.push({ name, office, hazard, nameMs });
  }
  return entries;
}

// CAP polygons are "lat,lon lat,lon ..."; rings are returned as [lon, lat],
// closed, or null when the polygon is unusable.
function parsePolygon(text) {
  const ring = [];
  for (const pair of text.split(/\s+/).filter(Boolean)) {
    const parts = pair.split(',');
    // Number('') is 0, so an empty coordinate would become a vertex on the equator or meridian.
    if (parts.length !== 2 || parts.some((part) => part.trim() === ''))
      return null;
    const [lat, lon] = parts.map(Number);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      return null;
    }
    ring.push([lon, lat]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) ring.pop();
  if (ring.length < 3) return null;
  ring.push([...ring[0]]);
  return ring;
}

function parseInfo(block) {
  const event = capTag(block, 'event');
  const expiresMs = timeMs(capTag(block, 'expires'));
  if (!event || expiresMs === null) return null;

  let levelText = '';
  for (const param of capBlocks(block, 'parameter')) {
    if (capTag(param, 'valueName') === 'alertType') {
      levelText = capTag(param, 'value');
      break;
    }
  }
  const n = /Warning Level (\d+)/i.exec(levelText);
  const level = n && +n[1] >= 1 && +n[1] <= 10 ? +n[1] : null;

  const areas = [];
  for (const areaBlock of capBlocks(block, 'area')) {
    const desc = capTag(areaBlock, 'areaDesc');
    for (const polygon of capBlocks(areaBlock, 'polygon')) {
      const ring = parsePolygon(decodeXml(polygon).trim());
      if (ring) areas.push({ desc, ring });
    }
  }
  if (!areas.length) return null;

  return {
    event,
    severity: capTag(block, 'severity'),
    levelText,
    level,
    band: sawsBand(level),
    onsetMs: timeMs(capTag(block, 'onset')),
    expiresMs,
    headline: capTag(block, 'headline'),
    description: capTag(block, 'description'),
    instruction: capTag(block, 'instruction'),
    areas,
  };
}

export function parseCapAlert(xml) {
  const text = String(xml || '');
  if (!/<alert[\s>]/i.test(text)) throw new Error('invalid_cap');
  // Header fields sit before the first <info>.
  const head = text.split(/<info[\s>]/i)[0];
  const sentMs = timeMs(capTag(head, 'sent'));
  const status = capTag(head, 'status');
  const msgType = capTag(head, 'msgType');
  if (sentMs === null || !status || !msgType) throw new Error('invalid_cap');
  return {
    identifier: capTag(head, 'identifier'),
    sentMs,
    status,
    msgType,
    infos: capBlocks(text, 'info').map(parseInfo).filter(Boolean),
  };
}
