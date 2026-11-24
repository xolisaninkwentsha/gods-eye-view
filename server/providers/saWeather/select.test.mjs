import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_GAP_MS,
  RECENT_MAX_AGE_MS,
  RECENT_MAX_FILES,
  currentWarningAreas,
  recentWarningFiles,
} from './select.js';

const t = (iso) => Date.parse(iso);

const ring = (x, y) => [
  [x, y],
  [x + 0.1, y],
  [x + 0.1, y + 0.1],
  [x, y],
];
const AREAS = {
  X: { desc: 'X', ring: ring(28, -26) },
  Y: { desc: 'Y', ring: ring(29, -27) },
  Z: { desc: 'Z', ring: ring(30, -28) },
};
const LEVEL_BAND = (level) => (level >= 9 ? 'red' : level >= 5 ? 'orange' : 'yellow');

function info(level, onsetIso, expiresIso, areaKeys, extra = {}) {
  return {
    event: 'Thunderstorms',
    severity: 'Moderate',
    levelText: `Level ${level}`,
    level,
    band: LEVEL_BAND(level),
    onsetMs: t(onsetIso),
    expiresMs: t(expiresIso),
    headline: 'h',
    description: 'd',
    instruction: 'i',
    areas: areaKeys.map((k) => AREAS[k]),
    ...extra,
  };
}

let counter = 0;
function file(office, hazard, sentIso, infos, msgType = 'Update', status = 'Actual') {
  counter += 1;
  return {
    name: `${office}_CAP_${hazard}_${counter}.xml`,
    office,
    hazard,
    alert: {
      identifier: `id${counter}`,
      sentMs: t(sentIso),
      status,
      msgType,
      infos,
    },
  };
}

const byName = (areas, name) => areas.find((a) => a.name === name);

test('an evening warning stays when a next-day issue arrives', () => {
  const files = [
    file('GP', 'SevereThunderstorms', '2026-11-22T07:20:00+02:00', [
      info(2, '2026-11-22T15:00:00+02:00', '2026-11-22T23:59:00+02:00', ['X', 'Y']),
    ]),
    file('GP', 'SevereThunderstorms', '2026-11-22T17:33:00+02:00', [
      info(2, '2026-11-23T14:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X', 'Y']),
    ]),
  ];
  const areas = currentWarningAreas(files, t('2026-11-22T18:00:00+02:00'));
  assert.equal(areas.length, 2);
  assert.equal(byName(areas, 'X').warnings.length, 2);
  assert.equal(byName(areas, 'Y').warnings.length, 2);
});

const pair = () => [
  file('GP', 'SevereThunderstorms', '2026-11-23T10:43:00+02:00', [
    info(4, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X']),
  ]),
  file('GP', 'SevereThunderstorms', '2026-11-23T10:53:00+02:00', [
    info(4, '2026-11-24T00:00:00+02:00', '2026-11-24T18:59:00+02:00', ['X']),
  ]),
  file('GP', 'SevereThunderstorms', '2026-11-23T11:04:00+02:00', [
    info(2, '2026-11-24T01:00:00+02:00', '2026-11-24T20:59:00+02:00', ['X', 'Y']),
  ]),
];

test('files minutes apart are one issue and never replace each other', () => {
  const areas = currentWarningAreas(pair(), t('2026-11-23T12:00:00+02:00'));
  assert.equal(byName(areas, 'X').warnings.length, 3);
  assert.equal(byName(areas, 'Y').warnings.length, 1);
});

test('a later issue replaces only the areas it names', () => {
  const files = [
    file('GP', 'SevereThunderstorms', '2026-11-22T17:33:00+02:00', [
      info(2, '2026-11-23T14:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X', 'Y', 'Z']),
    ]),
    file('GP', 'SevereThunderstorms', '2026-11-23T10:43:00+02:00', [
      info(4, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X']),
    ]),
  ];
  const areas = currentWarningAreas(files, t('2026-11-23T12:00:00+02:00'));
  assert.equal(areas.length, 3);
  assert.deepEqual(byName(areas, 'X').warnings.map((w) => w.level), [4]);
  assert.deepEqual(byName(areas, 'Y').warnings.map((w) => w.level), [2]);
  assert.deepEqual(byName(areas, 'Z').warnings.map((w) => w.level), [2]);
});

test("a morning re-issue replaces yesterday's for the same areas", () => {
  const files = [
    ...pair(),
    file('GP', 'SevereThunderstorms', '2026-11-24T08:56:00+02:00', [
      info(4, '2026-11-24T13:00:00+02:00', '2026-11-24T22:59:00+02:00', ['X']),
      info(2, '2026-11-24T13:00:00+02:00', '2026-11-24T20:59:00+02:00', ['X', 'Y']),
    ]),
  ];
  const areas = currentWarningAreas(files, t('2026-11-24T10:00:00+02:00'));
  const sent = t('2026-11-24T08:56:00+02:00');
  for (const a of areas) for (const w of a.warnings) assert.equal(w.sentMs, sent);
  assert.equal(byName(areas, 'X').warnings.length, 2);
  assert.equal(byName(areas, 'Y').warnings.length, 1);
});

test('expired warnings are dropped and an area left empty is gone', () => {
  const files = [
    file('GP', 'SevereThunderstorms', '2026-11-24T07:00:00+02:00', [
      info(2, '2026-11-24T07:30:00+02:00', '2026-11-24T08:59:00+02:00', ['X']),
    ]),
  ];
  assert.deepEqual(currentWarningAreas(files, t('2026-11-24T10:00:00+02:00')), []);
});

test('a later Cancel removes the areas it lists', () => {
  const files = [
    file('GP', 'SevereThunderstorms', '2026-11-23T08:00:00+02:00', [
      info(2, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X', 'Y']),
    ]),
    file(
      'GP',
      'SevereThunderstorms',
      '2026-11-23T11:00:00+02:00',
      [info(2, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X'])],
      'Cancel',
    ),
  ];
  const areas = currentWarningAreas(files, t('2026-11-23T12:00:00+02:00'));
  assert.equal(areas.length, 1);
  assert.equal(areas[0].name, 'Y');
});

test('non-Actual files are ignored', () => {
  const files = [
    file(
      'GP',
      'SevereThunderstorms',
      '2026-11-23T08:00:00+02:00',
      [info(2, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X'])],
      'Alert',
      'Test',
    ),
  ];
  assert.deepEqual(currentWarningAreas(files, t('2026-11-23T12:00:00+02:00')), []);
});

test('two hazards on one area merge into one area', () => {
  const files = [
    file('KZN', 'DamagingWinds', '2026-11-23T08:00:00+02:00', [
      info(2, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X'], { event: 'Damaging Winds' }),
    ]),
    file('KZN', 'SevereThunderstorms', '2026-11-23T08:10:00+02:00', [
      info(6, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X']),
    ]),
  ];
  // Note: level 6 is orange, level 2 is yellow.
  const areas = currentWarningAreas(files, t('2026-11-23T12:00:00+02:00'));
  assert.equal(areas.length, 1);
  assert.equal(areas[0].band, 'orange');
  assert.deepEqual(areas[0].warnings.map((w) => w.band), ['orange', 'yellow']);
  assert.match(areas[0].stableId, /^za-wx:[0-9a-f]+$/);
  assert.deepEqual(areas[0].polygons, [[AREAS.X.ring]]);
});

test("issues are grouped by sent, not by the file name's time", () => {
  const a = file('GP', 'SevereThunderstorms', '2026-11-23T08:00:00+02:00', [
    info(2, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X']),
  ]);
  const b = file('GP', 'SevereThunderstorms', '2026-11-23T08:20:00+02:00', [
    info(4, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X']),
  ]);
  a.name = 'GP_CAP_SevereThunderstorms_20261123_060000.xml';
  b.name = 'GP_CAP_SevereThunderstorms_20261123_080000.xml';
  const areas = currentWarningAreas([a, b], t('2026-11-23T12:00:00+02:00'));
  assert.equal(byName(areas, 'X').warnings.length, 2);
});

test('recentWarningFiles keeps four days, newest first, at most sixty', () => {
  const now = t('2026-11-24T12:00:00+02:00');
  const entries = Array.from({ length: 70 }, (_, i) => ({
    name: `GP_CAP_X_${i}.xml`,
    office: 'GP',
    hazard: 'X',
    nameMs: now + 3_600_000 - i * (6 * 86_400_000 / 70),
  }));
  const out = recentWarningFiles(entries, now);
  assert.ok(out.length <= RECENT_MAX_FILES);
  assert.equal(out.length, 48);
  for (const e of out) {
    assert.ok(e.nameMs > now - RECENT_MAX_AGE_MS && e.nameMs <= now + 3_600_000);
  }
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].nameMs >= out[i].nameMs);
  assert.equal(ISSUE_GAP_MS, 3_600_000);

  const dense = Array.from({ length: 100 }, (_, i) => ({
    name: `GP_CAP_X_${i}.xml`,
    office: 'GP',
    hazard: 'X',
    nameMs: now - i * 3_000_000,
  }));
  const capped = recentWarningFiles(dense, now);
  assert.equal(capped.length, 60);
  assert.equal(capped[0].nameMs, now);
});

test('long texts are cut', () => {
  const files = [
    file('GP', 'SevereThunderstorms', '2026-11-23T08:00:00+02:00', [
      info(2, '2026-11-23T13:00:00+02:00', '2026-11-23T23:59:00+02:00', ['X'], {
        description: 'a'.repeat(700),
        instruction: 'b'.repeat(500),
      }),
    ]),
  ];
  const [area] = currentWarningAreas(files, t('2026-11-23T12:00:00+02:00'));
  const w = area.warnings[0];
  assert.equal(w.description.length, 600);
  assert.ok(w.description.endsWith('…'));
  assert.equal(w.instruction.length, 400);
  assert.ok(w.instruction.endsWith('…'));
});
