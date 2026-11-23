import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSaCouncilCard,
  buildSaWardCard,
  saAnchorDegrees,
} from './cards.js';

const ANC = 'AFRICAN NATIONAL CONGRESS';
const DA = 'DEMOCRATIC ALLIANCE';
const council = {
  stableId: 'JHB',
  name: 'City of Johannesburg',
  code: 'JHB',
  result: {
    largest: { party: ANC, seats: 130 },
    totalSeats: 270,
    majority: false,
    parties: [
      { party: ANC, seats: 130, prShare: 0.4123 },
      { party: DA, seats: 90, prShare: 0.3 },
      { party: 'ECONOMIC FREEDOM FIGHTERS', seats: 30, prShare: 0.1 },
      { party: 'INDEPENDENT', seats: 20, prShare: 0.05 },
    ],
    turnout: 0.5,
    seatCheck: 'ok',
  },
};

test('council card lists seats, majority, top three, PR share and turnout', () => {
  const card = buildSaCouncilCard(council, 'ok');
  assert.equal(card.title, 'City of Johannesburg (JHB)');
  assert.equal(card.details[0], 'ANC · 130 of 270 seats');
  assert.equal(card.details[1], 'No majority');
  assert.equal(card.details[2], 'ANC 130 · DA 90 · EFF 30');
  assert.equal(card.details[3], 'ANC PR vote 41.2%');
  assert.equal(card.details[4], 'Turnout 50.0%');
  assert.equal(card.selected, true);
  assert.equal(card.interactive, false);
  assert.equal(card.accent, '#1f9d55');
  assert.equal(card.id, 'sa-council-card:JHB');
  assert.equal(card.placement, 'above');
  const majority = buildSaCouncilCard(
    { ...council, result: { ...council.result, majority: true } },
    'stale',
  );
  assert.equal(majority.details[1], 'Majority');
});

test('ward card shows winner, runner-up, margin and turnout, and flags unconfirmed', () => {
  const ward = {
    stableId: 'w1',
    name: 'Ward 5',
    municipality: 'City of Cape Town',
    result: {
      winner: { party: DA, votes: 900, share: 0.5123 },
      runnerUp: { party: ANC, votes: 600, share: 0.3893 },
      tie: false,
      margin: 0.123,
      turnout: 0.4,
      confirmed: true,
    },
  };
  const card = buildSaWardCard(ward, 'ok');
  assert.equal(card.title, 'Ward 5 · City of Cape Town');
  assert.deepEqual(card.details, [
    'DA 51.2%',
    'Runner-up ANC 38.9%',
    'Margin 12.3 points',
    'Turnout 40.0%',
  ]);
  assert.equal(card.accent, '#1b6ec2');
  const flagged = buildSaWardCard(
    { ...ward, result: { ...ward.result, confirmed: false } },
    'ok',
  );
  assert.equal(
    flagged.details.at(-1),
    'Unconfirmed: does not match the IEC seat count',
  );
  const tie = buildSaWardCard(
    {
      ...ward,
      result: { ...ward.result, winner: null, tie: true, confirmed: false },
    },
    'ok',
  );
  assert.deepEqual(tie.details, ['Tie']);
  assert.equal(tie.accent, '#9aa4ad');
});

test('cards say why when results are off, loading or failed', () => {
  assert.deepEqual(buildSaCouncilCard(council, 'off').details, [
    'Results are off',
  ]);
  assert.deepEqual(buildSaCouncilCard(council, 'loading').details, [
    'Downloading results from the IEC…',
  ]);
  assert.deepEqual(
    buildSaWardCard({ ...council, municipality: 'M' }, 'failed').details,
    ['IEC results unavailable'],
  );
  const noSeats = {
    ...council,
    result: {
      ...council.result,
      largest: null,
      totalSeats: null,
      majority: null,
    },
  };
  assert.deepEqual(buildSaCouncilCard(noSeats, 'ok').details, [
    'Seat count unavailable',
  ]);
  assert.equal(buildSaCouncilCard(noSeats, 'ok').accent, '#9aa4ad');
});

test('anchor reuses the drone airspace centroid', () => {
  const sq = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];
  assert.deepEqual(saAnchorDegrees([[sq]]), { lon: 1, lat: 1 });
});
