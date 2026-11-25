import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SA_ALIASES,
  SA_HEADLINE_DENY_NAMES,
  deniedPlace,
  matchPlace,
  townNear,
} from './places.js';

const TOWNS = JSON.parse(
  readFileSync(new URL('./sa-towns.json', import.meta.url), 'utf8'),
);
const placeOf = (title) => matchPlace(title)?.name ?? null;

test('sa-towns.json has a sane town count and the key towns', () => {
  const names = TOWNS.towns.map((t) => t.name);
  assert.ok(names.length >= 550 && names.length <= 650, `${names.length}`);
  assert.ok(names.includes('Johannesburg'));
  assert.ok(names.includes('Mbombela'));
  assert.equal(new Set(names).size, names.length, 'town names are unique');
  for (const t of TOWNS.towns) {
    assert.ok(
      t.name.trim() && Number.isFinite(t.lat) && Number.isFinite(t.lon),
    );
  }
});

test('the town generator caps the unzipped town file at 64 MiB', () => {
  // Running the generator downloads and writes, so its source is checked.
  const source = readFileSync(
    new URL('../../../scripts/sa-towns.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /inflateRawSync\(\s*data,\s*\{\s*maxOutputLength:\s*64 \* 1024 \* 1024,?\s*\}\s*,?\s*\)/,
  );
});

test('every alias points at a town in sa-towns.json', () => {
  const names = new Set(TOWNS.towns.map((t) => t.name));
  for (const [alias, target] of Object.entries(SA_ALIASES)) {
    assert.ok(names.has(target), `${alias} -> ${target}`);
  }
});

test('places headlines shaped like real ones', () => {
  // Synthetic wording: no real person or case is named.
  const cases = [
    ['Artist found dead in Riebeek West', 'Riebeek West'],
    ['Councillor re-elected Polokwane mayor', 'Polokwane'],
    ['Two suspects arrested in Gqeberha robbery case', 'Gqeberha'],
    ['Joburg lawyer opens office near Sandton hotel', 'Johannesburg'],
    ['Court rejects claim against Soshanguve school', 'Soshanguve'],
    ['Cape Town Stadium confirms interest', 'Cape Town'],
    ["Polokwane's mayor", 'Polokwane'],
    ['Cape Town-based firm wins tender', 'Cape Town'],
    ['George Bush visits Cape Town', 'Cape Town'],
  ];
  for (const [title, name] of cases) assert.equal(placeOf(title), name, title);
});

test('renamed towns place at the listed town', () => {
  const cases = [
    ['Makhanda', 'Grahamstown'],
    ['Mahikeng', 'Mafikeng'],
    ['Komani', 'Queenstown'],
    ['Makhado', 'Louis Trichardt'],
    ['Tembisa', 'Thembisa'],
    ['Witbank', 'Emalahleni'],
    ['Bela-Bela', 'Bela Bela'],
    ['eMkhondo', 'Piet Retief'],
    ['Uitenhage', 'Kariega'],
    ["King William's Town", 'Qonce'],
    ['Umtata', 'Mthatha'],
    ['Ballito', 'Ballitoville'],
  ];
  for (const [alias, town] of cases) {
    assert.equal(SA_ALIASES[alias], town, alias);
    assert.equal(placeOf(`Water cuts hit ${alias} homes`), town, alias);
  }
});

test('people, teams, foreign places and Title Case words are not placed', () => {
  const titles = [
    'AB de Villiers backs Proteas',
    'Lebogang Maile defends housing plan',
    'Ngcobo wins gold for South Africa',
    'Theunissen named in Bok squad',
    'Wepener returns to Sharks',
    'Le Roux recalled to Springbok squad',
    'Stella Ndabeni-Abrahams resigns',
    'Leslie Sedibe appointed',
    'Two Brits arrested at airport',
    'Newcastle beat Arsenal',
    'Proteas seal series win in Adelaide',
    'Wellington Phoenix sign striker',
    'Aberdeen FC sack manager',
    'Storm hits North Carolina coast',
    'Bochum stun Bayern',
    'Stanford study on sleep',
    "Winnie Mandela's legacy debated",
    'Cabinet Retreat Ends With Plan',
  ];
  for (const title of titles) assert.equal(matchPlace(title), null, title);
});

test('a skipped name does not end the scan', () => {
  // A headline-denied span.
  assert.equal(placeOf('Prince Albert of Monaco visits Durban'), 'Durban');
  // A town after a surname particle, lower-case or Capitalised.
  assert.equal(placeOf('AB De Villiers opens Pretoria academy'), 'Pretoria');
  // Without a particle before it the town still places.
  assert.equal(placeOf('Floods hit Villiers'), 'Villiers');
});

test('an all-caps word or a number is not a surname particle', () => {
  const cases = [
    ['DA Joburg mayoral candidate unveils plan', 'Johannesburg'],
    ['DA Cape Town caucus elects leader', 'Cape Town'],
    ['DA Tshwane councillors walk out', 'Pretoria'],
    ['Ten Durban schools closed after floods', 'Durban'],
  ];
  for (const [title, name] of cases) assert.equal(placeOf(title), name, title);
  assert.equal(matchPlace('AB de Villiers backs Proteas'), null);
});

test('a curly apostrophe matches as a straight one', () => {
  assert.equal(placeOf('Flood warning for King William’s Town'), 'Qonce');
});

test('every headline-only deny name is a town GDELT keeps', () => {
  const names = new Set(TOWNS.towns.map((t) => t.name));
  assert.ok(SA_HEADLINE_DENY_NAMES.length > 0);
  for (const name of SA_HEADLINE_DENY_NAMES) {
    assert.ok(names.has(name), `${name} is in sa-towns.json`);
    assert.equal(deniedPlace(name), false, name);
  }
  assert.equal(deniedPlace('Newcastle'), false);
  assert.equal(deniedPlace('Wellington'), false);
});

test('an alias resolves to its town coordinates', () => {
  const joburg = TOWNS.towns.find((t) => t.name === 'Johannesburg');
  assert.deepEqual(matchPlace('Joburg taxi strike'), {
    name: 'Johannesburg',
    lat: joburg.lat,
    lon: joburg.lon,
  });
});

test('does not place colliding or placeless headlines', () => {
  const titles = [
    'Tshituka cleared ahead of Springbok debut',
    'Transalloys to cut jobs at Mpumalanga plant',
    'J Cole concert puts FNB Stadium out of running for Soweto derby',
    'soweto DERBY tickets sell out',
    'George Bush',
    "ANC's quest for hegemony",
    'Floods hit KwaZulu-Natal',
    'Drought in the Northern Cape',
  ];
  for (const title of titles) assert.equal(matchPlace(title), null, title);
});

test('townNear finds a town by its exact name within 25 km', () => {
  const joburg = TOWNS.towns.find((t) => t.name === 'Johannesburg');
  const town = { name: 'Johannesburg', lat: joburg.lat, lon: joburg.lon };
  // 1 degree of latitude is 111.19 km on a 6371 km sphere.
  const south = (km) => joburg.lat - km / 111.195;
  assert.deepEqual(townNear('Johannesburg', south(24), joburg.lon), town);
  assert.equal(townNear('Johannesburg', south(26), joburg.lon), null);
  // Exact names only: no alias, no other case, no unlisted place.
  assert.equal(townNear('Joburg', joburg.lat, joburg.lon), null);
  assert.equal(townNear('johannesburg', joburg.lat, joburg.lon), null);
  assert.equal(townNear('Mamelodi', -25.72, 28.39), null);
  assert.equal(townNear('Johannesburg', Number.NaN, 28), null);
});

test('deniedPlace is case-insensitive and trims', () => {
  assert.equal(deniedPlace('kwazulu'), true);
  assert.equal(deniedPlace(' Madlanga '), true);
  assert.equal(deniedPlace('GAUTENG'), true);
  assert.equal(deniedPlace('Johannesburg'), false);
});
