import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSaDistrictCard } from './cards.js';
import { normalizeGovernance } from '../saGovernance/records.js';

const gov = normalizeGovernance({
  audits: {
    year: 2025,
    byCode: { DC1: { opinion: 'qualified', label: 'Qualified' } },
  },
  auditsStatus: 'ok',
  interventions: {
    asOf: '2026-08',
    rows: [{ code: 'DC1', since: '2025', type: 'Section 139(1)(b)' }],
  },
});

const members = (n) =>
  Array.from({ length: n }, (_, i) => ({
    code: `M${i}`,
    name: `Local Municipality Number ${i}`,
  }));
const area = (extra = {}) => ({
  id: 'DC1',
  code: 'DC1',
  name: 'Alfred Nzo',
  province: 'Eastern Cape',
  category: 'C',
  members: members(2),
  ...extra,
});

test('a listed district card has the title, province, category, councils and governance lines', () => {
  const card = buildSaDistrictCard(area(), gov);
  assert.equal(card.id, 'sa-district-card:DC1');
  assert.equal(card.title, 'Alfred Nzo (DC1)');
  assert.equal(card.accent, '#eb5757');
  assert.equal(card.selected, true);
  assert.equal(card.interactive, false);
  assert.deepEqual(card.details.slice(0, 3), [
    'Eastern Cape',
    'District municipality',
    'Councils: Local Municipality Number 0, Local Municipality Number 1',
  ]);
  assert.equal(card.details[3], 'Audit 2024/25: Qualified');
  assert.match(card.details[4], /^Section 139 since 2025/);
  assert.equal(card.details[5], 'Type: Section 139(1)(b)');
});

test('an unlisted district is grey', () => {
  const card = buildSaDistrictCard(area({ code: 'DC9', id: 'DC9' }), gov);
  assert.equal(card.accent, '#d0d7de');
  assert.equal(card.details.at(-1), 'Audit 2024/25: no data');
});

test('a long member list is cut to as many names as fit, then the count', () => {
  const card = buildSaDistrictCard(area({ members: members(8) }), gov);
  const line = card.details.find((l) => l.startsWith('Councils:'));
  assert.ok(line.length <= 90, `${line.length}`);
  assert.match(line, /, … \(\+\d+\)$/);
  const shown = line.split('Local Municipality Number').length - 1;
  assert.equal(line.endsWith(`(+${8 - shown})`), true);
  assert.ok(shown >= 1 && shown < 8);
});

test('a metro says it is also a council and has no Councils line', () => {
  const card = buildSaDistrictCard(
    area({ category: 'A', members: members(1) }),
    gov,
  );
  assert.equal(card.details[1], 'Metro (also a council)');
  assert.ok(!card.details.some((l) => l.startsWith('Councils:')));
});

test('without governance the card says the audit is unavailable', () => {
  const card = buildSaDistrictCard(area(), null);
  assert.equal(card.accent, '#d0d7de');
  assert.equal(card.details.at(-1), 'Audit: unavailable');
  assert.ok(!card.details.some((l) => l.startsWith('Section 139')));
});

test('every line, including the title, is cut to 90 characters', () => {
  const card = buildSaDistrictCard(
    area({ name: 'N'.repeat(120), province: 'P'.repeat(120) }),
    gov,
  );
  assert.ok(card.title.length <= 90 && card.title.endsWith('…'));
  for (const line of card.details) assert.ok(line.length <= 90, line);
});
