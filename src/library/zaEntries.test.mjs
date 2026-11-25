import test from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_ENTRIES, LIBRARY_LEDGER, libraryEntry } from './catalog.js';
import { readLibraryLedger } from './selection.js';
import { validateLibraryManifest } from './manifest.js';

const DFFE = ['za-dffe-protected-areas', 'za-dffe-marine-protected-areas'];
const CPT = [
  'za-cpt-load-shedding-blocks',
  'za-cpt-myciti-routes',
  'za-cpt-myciti-stops',
  'za-cpt-health-facilities',
  'za-cpt-fire-stations',
];

test('all seven SA entries are in the catalog and validate', () => {
  for (const id of [...DFFE, ...CPT]) {
    const entry = libraryEntry(id);
    assert.ok(entry, `${id} is not in the catalog`);
    assert.equal(validateLibraryManifest(entry).ok, true, id);
  }
  assert.equal(
    LIBRARY_ENTRIES.filter(({ id }) => id.startsWith('za-')).length,
    7,
  );
});

test('DFFE entries are unpaged geojson and need operator opt-in', () => {
  for (const id of DFFE) {
    const { source, licence } = libraryEntry(id);
    assert.equal(source.format, 'geojson', id);
    assert.equal(source.query.f, 'geojson', id);
    assert.equal(source.maxPages, undefined, `${id} must not page`);
    assert.equal(new URL(source.url).host, 'screening.environment.gov.za', id);
    assert.equal(licence.operatorOptIn, true, id);
  }
});

test('Cape Town entries are paged arcgis on the City host, not opt-in', () => {
  for (const id of CPT) {
    const { source, licence } = libraryEntry(id);
    assert.equal(source.format, 'arcgis', id);
    assert.equal(new URL(source.url).host, 'esapqa.capetown.gov.za', id);
    assert.ok(!licence.operatorOptIn, id);
  }
});

test('every SA entry owns a ledger token', () => {
  const ledger = readLibraryLedger(LIBRARY_LEDGER);
  assert.deepEqual(ledger.errors, []);
  for (const id of [...DFFE, ...CPT])
    assert.ok(ledger.tokenById.has(id), `${id} has no token`);
});
