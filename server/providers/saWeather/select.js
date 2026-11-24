// Pure: pick the SAWS warnings in force and merge them per drawn area.
// SAWS sends no `references`, so replacement is inferred "per area, by issue".

export const ISSUE_GAP_MS = 3_600_000;
export const RECENT_MAX_AGE_MS = 4 * 86_400_000;
export const RECENT_MAX_FILES = 60;

const FUTURE_SLACK_MS = 3_600_000;
const DESCRIPTION_MAX = 600;
const INSTRUCTION_MAX = 400;
const BAND_RANK = { red: 0, orange: 1, yellow: 2 };

const bandRank = (band) => BAND_RANK[band] ?? 3;

export function recentWarningFiles(entries, nowMs) {
  return entries
    .filter((e) => e.nameMs > nowMs - RECENT_MAX_AGE_MS && e.nameMs <= nowMs + FUTURE_SLACK_MS)
    .sort((a, b) => b.nameMs - a.nameMs)
    .slice(0, RECENT_MAX_FILES);
}

function cut(text, max) {
  const s = text ?? '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// 32-bit FNV-1a over UTF-16 code units, as 8 hex digits.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const ringKey = (ring) => ring.map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join(' ');

const windowOf = (info, sentMs) => ({
  start: info.onsetMs ?? sentMs,
  end: info.expiresMs ?? Infinity,
});

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function currentWarningAreas(files, nowMs) {
  // Rule 1 and 2: Actual files only, grouped by office|hazard, numbered into issues.
  const groups = new Map();
  for (const f of files) {
    if (f.alert?.status !== 'Actual') continue;
    const key = `${f.office}|${f.hazard}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const pairs = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.alert.sentMs - b.alert.sentMs);
    const issues = [];
    let issue = 0;
    let prevSent = null;
    for (const f of group) {
      if (prevSent !== null && f.alert.sentMs - prevSent > ISSUE_GAP_MS) issue += 1;
      prevSent = f.alert.sentMs;
      issues.push(issue);
    }

    // Rule 3: a later issue that names the same area over an overlapping window replaces.
    group.forEach((f, i) => {
      if (f.alert.msgType === 'Cancel') return;
      for (const info of f.alert.infos) {
        const w = windowOf(info, f.alert.sentMs);
        for (const area of info.areas) {
          const replaced = group.some(
            (g, j) =>
              issues[j] > issues[i] &&
              g.alert.infos.some(
                (gi) =>
                  gi.areas.some((ga) => ga.desc === area.desc) &&
                  overlaps(w, windowOf(gi, g.alert.sentMs)),
              ),
          );
          if (!replaced) pairs.push({ file: f, info, area });
        }
      }
    });
  }

  // Rule 4 and 5: drop expired, merge by desc plus ring.
  const merged = new Map();
  for (const { file, info, area } of pairs) {
    if (info.expiresMs !== null && info.expiresMs !== undefined && info.expiresMs <= nowMs) continue;
    const rk = ringKey(area.ring);
    const key = `${area.desc}|${rk}`;
    let rec = merged.get(key);
    if (!rec) {
      rec = {
        stableId: `za-wx:${fnv1a(key)}`,
        name: area.desc,
        polygons: [[area.ring]],
        band: null,
        warnings: [],
      };
      merged.set(key, rec);
    }
    const sentMs = file.alert.sentMs;
    const dup = rec.warnings.some(
      (w) =>
        w.event === info.event &&
        w.level === info.level &&
        w.onsetMs === info.onsetMs &&
        w.expiresMs === info.expiresMs &&
        w.sentMs === sentMs,
    );
    if (dup) continue;
    rec.warnings.push({
      event: info.event,
      level: info.level,
      band: info.band,
      levelText: info.levelText,
      severity: info.severity,
      onsetMs: info.onsetMs,
      expiresMs: info.expiresMs,
      sentMs,
      headline: info.headline,
      description: cut(info.description, DESCRIPTION_MAX),
      instruction: cut(info.instruction, INSTRUCTION_MAX),
      office: file.office,
    });
  }

  const areas = [...merged.values()];
  for (const a of areas) {
    a.warnings.sort(
      (x, y) => bandRank(x.band) - bandRank(y.band) || (x.onsetMs ?? x.sentMs) - (y.onsetMs ?? y.sentMs),
    );
    a.band = a.warnings.reduce((best, w) => (bandRank(w.band) < bandRank(best) ? w.band : best), null);
  }
  return areas.sort((a, b) => (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0));
}
