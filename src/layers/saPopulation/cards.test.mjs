import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSaPopulationCard, formatPeople } from './cards.js';
import { setMessageOverrides } from '../../i18n/index.js';

test.beforeEach(() => setMessageOverrides({}));

test('people are rounded to 2 significant figures and grouped', () => {
  assert.equal(formatPeople(1148776), '1,100,000');
  assert.equal(formatPeople(1234), '1,200');
  assert.equal(formatPeople(150), '150');
  assert.equal(formatPeople(250000), '250,000');
});

test('the card names the rounded people and the source, and links nowhere', () => {
  const card = buildSaPopulationCard([-26.3, 27.9, 1234], 7, 0.1);
  assert.equal(card.id, 'sa-population-card:7');
  assert.equal(card.title, 'About 1,200 people in this 10 km square');
  assert.deepEqual(card.details, ['Kontur Population 2023 (modelled)']);
  assert.equal(card.interactive, false);
  assert.equal(card.accent, '#fecc5c');
  assert.ok(Math.abs(card.anchor.lon - 27.95) < 1e-9);
  assert.ok(Math.abs(card.anchor.lat - -26.25) < 1e-9);
  for (const line of [card.title, ...card.details])
    assert.ok(line.length <= 90);
});
