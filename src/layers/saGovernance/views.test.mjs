import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SA_COUNCIL_VIEWS,
  AUDIT_BANDS,
  auditYearLabel,
  auditBand,
  saGovernanceColor,
  governanceLines,
  formatSaDate,
} from './views.js';
import { normalizeGovernance } from './records.js';

const gov = (over = {}) =>
  normalizeGovernance({
    audits: {
      year: 2024,
      fetchedAt: 1,
      byCode: {
        CPT: { opinion: 'unqualified', label: 'Unqualified - No findings' },
        KZN212: { opinion: 'disclaimer', label: 'Disclaimer' },
        WEIRD: { opinion: 'other', label: 'Other' },
      },
    },
    auditsStatus: 'ok',
    interventions: {
      asOf: '2026-08',
      source: 's',
      rows: [
        {
          code: 'KZN212',
          name: 'Umdoni',
          province: 'KZN',
          type: 'Discretionary intervention',
          since: '2024',
        },
        {
          code: 'LONG',
          name: 'Long',
          province: 'GP',
          type: 'x'.repeat(200),
          since: '2025',
        },
      ],
    },
    metros: {
      rows: [
        {
          code: 'CPT',
          status: 'elected',
          mayor: 'Geordin Hill-Lewis',
          party: 'DA',
          electedOn: '2026-11-19',
          note: 'Coalition note',
          asOf: '2026-11-24',
        },
        {
          code: 'JHB',
          status: 'unresolved',
          note: 'n'.repeat(150),
          asOf: '2026-11-24',
        },
      ],
    },
    districtOf: {
      KZN212: { code: 'DC21', name: 'Ugu' },
      CPT: { code: 'CPT', name: 'City of Cape Town' },
      JHB: { code: 'JHB', name: 'City of Johannesburg' },
    },
    ...over,
  });

test('views list', () => {
  assert.deepEqual(SA_COUNCIL_VIEWS, ['party', 'audit', 'intervention']);
});

test('audit year label', () => {
  assert.equal(auditYearLabel(2024), '2023/24');
  assert.equal(auditYearLabel(2000), '1999/00');
});

test('every band colour', () => {
  const expect = {
    unqualified: '#2e9e5b',
    unqualified_emphasis_of_matter: '#9ccc65',
    qualified: '#f2c94c',
    adverse: '#f2994a',
    disclaimer: '#eb5757',
    outstanding: '#9b6dd6',
  };
  for (const [opinion, color] of Object.entries(expect)) {
    assert.equal(auditBand(opinion).color, color);
  }
  assert.equal(AUDIT_BANDS.length, 7);
  assert.equal(AUDIT_BANDS.at(-1).color, '#9aa4ad');
  assert.equal(AUDIT_BANDS.at(-1).label, 'No audit data');
  assert.deepEqual(
    AUDIT_BANDS.map((b) => b.label),
    [
      'Clean audit',
      'Unqualified with findings',
      'Qualified',
      'Adverse',
      'Disclaimer',
      'Outstanding',
      'No audit data',
    ],
  );
});

test('unknown opinions use the no-data band', () => {
  for (const o of ['other', 'bogus', undefined, null]) {
    assert.equal(auditBand(o).color, '#9aa4ad');
  }
});

test('party view returns null', () => {
  assert.equal(saGovernanceColor({ code: 'CPT' }, 'party', gov()), null);
});

test('audit view colours by opinion and falls back to grey', () => {
  const g = gov();
  assert.deepEqual(saGovernanceColor({ code: 'CPT' }, 'audit', g), {
    color: '#2e9e5b',
    strength: 'strong',
  });
  assert.deepEqual(saGovernanceColor({ code: 'NOPE' }, 'audit', g), {
    color: '#9aa4ad',
    strength: 'strong',
  });
  assert.equal(
    saGovernanceColor({ code: 'CPT' }, 'audit', null).color,
    '#9aa4ad',
  );
  assert.equal(
    saGovernanceColor({ code: 'CPT' }, 'audit', gov({ audits: null })).color,
    '#9aa4ad',
  );
});

test('intervention view is strong for listed, faint otherwise', () => {
  const g = gov();
  assert.deepEqual(saGovernanceColor({ code: 'KZN212' }, 'intervention', g), {
    color: '#eb5757',
    strength: 'strong',
  });
  assert.deepEqual(saGovernanceColor({ code: 'CPT' }, 'intervention', g), {
    color: '#9aa4ad',
    strength: 'faint',
  });
  assert.equal(
    saGovernanceColor({ code: 'CPT' }, 'intervention', null).strength,
    'faint',
  );
});

test('date format is zone-proof', () => {
  assert.equal(formatSaDate('2026-11-19'), '19 Nov 2026');
  assert.equal(formatSaDate('2026-01-01'), '1 Jan 2026');
  assert.equal(formatSaDate('2026-12-31'), '31 Dec 2026');
});

test('lines for null governance are empty', () => {
  assert.deepEqual(governanceLines('CPT', null), []);
});

test('CPT (elected metro) has audit and mayor lines, no district line', () => {
  assert.deepEqual(governanceLines('CPT', gov()), [
    'Audit 2023/24: Unqualified - No findings',
    'Mayor: Geordin Hill-Lewis (DA), elected 19 Nov 2026',
    'Coalition note',
  ]);
});

test('JHB (unresolved) says not yet elected', () => {
  const lines = governanceLines('JHB', gov());
  assert.equal(lines[0], 'Audit 2023/24: no data');
  assert.equal(lines[1], 'Mayor: not yet elected (as of 24 Nov 2026)');
  assert.equal(lines[2].length, 90);
  assert.ok(lines[2].endsWith('…'));
});

test('a listed council has district, audit and section 139 lines', () => {
  assert.deepEqual(governanceLines('KZN212', gov()), [
    'District: Ugu (DC21)',
    'Audit 2023/24: Disclaimer',
    'Section 139 since 2024 (CoGTA list, Aug 2026)',
    'Type: Discretionary intervention',
  ]);
});

test('a council with no audit row says no data', () => {
  assert.deepEqual(governanceLines('ZZZ', gov()), ['Audit 2023/24: no data']);
});

test('audits unavailable says unavailable', () => {
  assert.deepEqual(
    governanceLines('ZZZ', gov({ audits: null, auditsStatus: 'failed' })),
    ['Audit: unavailable'],
  );
});

test('a long type is cut to exactly 90 characters', () => {
  const lines = governanceLines('LONG', gov());
  const type = lines.find((l) => l.startsWith('Type:'));
  assert.equal(type.length, 90);
  assert.ok(type.endsWith('…'));
  for (const l of lines) assert.ok(l.length <= 90);
});
