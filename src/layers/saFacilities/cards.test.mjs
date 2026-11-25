import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSaFacilityCard } from './cards.js';
import { setMessageOverrides } from '../../i18n/index.js';

const clinic = (extra = {}) => ({
  id: 'node/9001',
  name: 'Sample Hill Clinic',
  kind: 'clinic',
  lat: -29.5,
  lon: 25.5,
  ...extra,
});
const school = (extra = {}) => ({
  id: 'school:9001',
  name: 'Example Valley Primary',
  lat: -28.5,
  lon: 24.5,
  level: 'Primary',
  connectivity: 'yes',
  ...extra,
});

test('a health card shows name, kind, operator and the credit line', () => {
  const card = buildSaFacilityCard(
    'health',
    clinic({ operator: 'Sample Health Trust', city: 'Testville' }),
  );
  assert.equal(card.id, 'sa-health-facilities-card:node/9001');
  assert.equal(card.title, 'Sample Hill Clinic');
  assert.deepEqual(card.details, [
    'Clinic',
    'Sample Health Trust',
    'OpenStreetMap via healthsites.io',
  ]);
  assert.equal(card.accent, '#f2994a');
  assert.equal(card.selected, true);
  assert.equal(card.interactive, false);
  assert.equal('activate' in card, false);
});

test('the city is used when there is no operator; neither adds no line', () => {
  assert.deepEqual(
    buildSaFacilityCard('health', clinic({ city: 'Testville' })).details,
    ['Clinic', 'Testville', 'OpenStreetMap via healthsites.io'],
  );
  assert.deepEqual(buildSaFacilityCard('health', clinic()).details, [
    'Clinic',
    'OpenStreetMap via healthsites.io',
  ]);
});

test('an unnamed health record says what kind it is', () => {
  const card = buildSaFacilityCard(
    'health',
    clinic({ name: null, kind: 'hospital' }),
  );
  assert.equal(card.title, 'Hospital (unnamed)');
  assert.equal(card.accent, '#eb5757');
  assert.equal(
    buildSaFacilityCard('health', clinic({ name: '' })).title,
    'Clinic (unnamed)',
  );
});

test('an unnamed title keeps the translated kind as it is, capitals included', async (t) => {
  t.after(() => setMessageOverrides({}));
  setMessageOverrides({
    en: {
      Hospital: 'WRONG',
      'health facility|Hospital': 'Krankenhaus',
      '{kind} (unnamed)': '{kind} (ohne Namen)',
    },
  });
  const card = buildSaFacilityCard(
    'health',
    clinic({ name: null, kind: 'hospital' }),
  );
  assert.equal(card.title, 'Krankenhaus (ohne Namen)');
  assert.equal(card.details[0], 'Krankenhaus');
});

test('the health Other class reads its own context, not the shared Other', async (t) => {
  t.after(() => setMessageOverrides({}));
  setMessageOverrides({
    en: { Other: 'WRONG', 'health facility|Other': 'Other facility' },
  });
  const card = buildSaFacilityCard(
    'health',
    clinic({ name: null, kind: 'other' }),
  );
  assert.equal(card.title, 'Other facility (unnamed)');
  assert.equal(card.details[0], 'Other facility');
});

test('a school card shows name, level, internet state and the credit line', () => {
  const card = buildSaFacilityCard('schools', school());
  assert.equal(card.id, 'sa-schools-card:school:9001');
  assert.equal(card.title, 'Example Valley Primary');
  assert.deepEqual(card.details, [
    'Primary',
    'Internet: connected',
    'Giga school data (ITU–UNICEF)',
  ]);
  assert.equal(card.accent, '#27ae60');
  assert.equal(card.interactive, false);
});

test('school internet states and colours', () => {
  const no = buildSaFacilityCard('schools', school({ connectivity: 'no' }));
  assert.equal(no.details[1], 'Internet: not connected');
  assert.equal(no.accent, '#eb5757');
  const unknown = buildSaFacilityCard(
    'schools',
    school({ connectivity: 'unknown', level: '' }),
  );
  assert.deepEqual(unknown.details, [
    'Internet: unknown',
    'Giga school data (ITU–UNICEF)',
  ]);
  assert.equal(unknown.accent, '#9e9e9e');
});

test('the internet state reads its own context, then is lower-cased', async (t) => {
  t.after(() => setMessageOverrides({}));
  setMessageOverrides({
    en: { Unknown: 'WRONG', 'internet access|Unknown': 'Onbekend' },
  });
  const card = buildSaFacilityCard(
    'schools',
    school({ connectivity: 'unknown' }),
  );
  assert.equal(card.details[1], 'Internet: onbekend');
});

test('school levels read the school level context; Unknown skips the line; others show as sent', async (t) => {
  t.after(() => setMessageOverrides({}));
  // The plain "Primary" is the draw tool's colour; a level must not read it.
  setMessageOverrides({
    en: {
      Primary: 'Primary colour',
      'Pre-Primary': 'WRONG',
      'school level|Primary': 'Laerskool',
      'school level|Pre-Primary': 'Voorskool',
    },
  });
  const lines = (level) =>
    buildSaFacilityCard('schools', school({ level })).details;
  assert.equal(lines('Primary')[0], 'Laerskool');
  assert.equal(lines('Pre-Primary')[0], 'Voorskool');
  assert.equal(lines('Primary and Secondary')[0], 'Primary and Secondary');
  assert.equal(lines('Secondary')[0], 'Secondary');
  assert.equal(lines('Other')[0], 'Other');
  assert.deepEqual(lines('Unknown'), [
    'Internet: connected',
    'Giga school data (ITU–UNICEF)',
  ]);
  assert.equal(lines('Boarding')[0], 'Boarding');
});

test('a null or blank school name is titled Unnamed school', () => {
  assert.equal(
    buildSaFacilityCard('schools', school({ name: null })).title,
    'Unnamed school',
  );
  assert.equal(
    buildSaFacilityCard('schools', school({ name: '  ' })).title,
    'Unnamed school',
  );
});

test('every line is cut to 90 characters, ending in an ellipsis', () => {
  const long = 'N'.repeat(200);
  for (const [set, record] of [
    ['health', clinic({ name: long, operator: long })],
    ['schools', school({ name: long, level: long })],
  ]) {
    const card = buildSaFacilityCard(set, record);
    for (const line of [card.title, ...card.details])
      assert.ok(line.length <= 90, line);
    assert.equal(card.title.length, 90);
    assert.ok(card.title.endsWith('…'));
  }
});
