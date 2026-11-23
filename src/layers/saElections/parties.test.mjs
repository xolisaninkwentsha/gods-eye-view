import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePartyName,
  partyStyle,
  OTHER_COLOR,
  PARTY_STYLES,
} from './parties.js';

function hue(hex) {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const bucket = (hex) => Math.round(hue(hex) / 30) % 12;

test('normalizes forfeiture marks, spacing and case', () => {
  assert.equal(normalizePartyName(' ActionSA (PF) '), 'ACTIONSA');
  assert.equal(
    normalizePartyName('VRYHEIDSFRONT PLUS \n FREEDOM FRONT PLUS'),
    'VRYHEIDSFRONT PLUS FREEDOM FRONT PLUS',
  );
});

test('ANC and MK are told apart', () => {
  const anc = partyStyle('AFRICAN NATIONAL CONGRESS').color;
  const mk = partyStyle('UMKHONTO WESIZWE PARTY').color;
  assert.notEqual(anc, mk);
  assert.notEqual(bucket(anc), bucket(mk));
});

test('known parties get a short name and a colour', () => {
  assert.equal(partyStyle('DEMOCRATIC ALLIANCE').short, 'DA');
  assert.equal(partyStyle('ECONOMIC FREEDOM FIGHTERS (PF)').short, 'EFF');
  assert.equal(
    partyStyle('VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS').short,
    'FF Plus',
  );
  assert.equal(partyStyle('INDEPENDENT').short, 'Independent');
  for (const style of Object.values(PARTY_STYLES))
    assert.match(style.color, /^#[0-9a-f]{6}$/i);
});

test('an unknown party is Other', () => {
  const s = partyStyle("DEMOCRATIC PEOPLE'S ALTERNATIVE");
  assert.equal(s.color, OTHER_COLOR);
  assert.equal(s.short, "Democratic People's Alternative");
  assert.notEqual(OTHER_COLOR.toLowerCase(), '#9aa4ad');
});

test('every FF Plus spelling reaches one canonical key and style', () => {
  const key = 'VRYHEIDSFRONT PLUS FREEDOM FRONT PLUS';
  const spellings = [
    'VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS',
    'VRYHEIDSFRONT PLUS \n FREEDOM FRONT PLUS',
    'VRYHEIDSFRONT PLUS|FREEDOM FRONT PLUS',
  ];
  for (const s of spellings) {
    assert.equal(normalizePartyName(s), key);
    assert.deepEqual(partyStyle(s), PARTY_STYLES[key]);
    assert.equal(partyStyle(s).short, 'FF Plus');
  }
  assert.equal(
    Object.keys(PARTY_STYLES).filter((k) => k.startsWith('VRYHEIDSFRONT'))
      .length,
    1,
  );
});
