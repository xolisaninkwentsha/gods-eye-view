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

/** WCAG relative luminance, and the contrast ratio of two colours (1 to 21). */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

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
  assert.equal(partyStyle('SOUTH AFRICAN COMMUNIST PARTY').short, 'SACP');
  for (const style of Object.values(PARTY_STYLES))
    assert.match(style.color, /^#[0-9a-f]{6}$/i);
  const colours = Object.values(PARTY_STYLES).map((s) => s.color.toLowerCase());
  assert.equal(
    new Set(colours).size,
    colours.length,
    'every colour is its own',
  );
  assert.ok(!colours.includes(OTHER_COLOR.toLowerCase()));
});

test('the SACP red is told apart from the EFF red', () => {
  const sacp = partyStyle('SOUTH AFRICAN COMMUNIST PARTY').color;
  assert.notEqual(sacp, OTHER_COLOR, 'not drawn as Other');
  const eff = partyStyle('ECONOMIC FREEDOM FIGHTERS').color;
  assert.ok(
    contrast(sacp, eff) >= 2,
    `contrast with EFF ${contrast(sacp, eff).toFixed(2)}`,
  );
  const anc = partyStyle('AFRICAN NATIONAL CONGRESS').color;
  assert.notEqual(bucket(sacp), bucket(anc));
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
