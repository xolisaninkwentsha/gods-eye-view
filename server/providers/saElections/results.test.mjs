import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeatSheet } from './seats.js';
import {
  csvRecords,
  aggregateProvince,
  councilOutcome,
  wardOutcome,
  seatCheck,
} from './results.js';

const HEADER =
  'Province,Municipality,Ward,VotingDistrict,VotingStationName,RegisteredVoters,BallotType,SpoiltVotes,PartyName,TotalValidVotes,DateGenerated';

async function* lines(text) {
  for (const l of text.split('\n')) yield l;
}
const collect = async (iter) => {
  const out = [];
  for await (const x of iter) out.push(x);
  return out;
};
const tallyOf = (rows) =>
  aggregateProvince(csvRecords(lines([HEADER, ...rows].join('\n'))));
// row(ward, vd, registered, ballot, spoilt, party, votes)
const row = (ward, vd, reg, ballot, spoilt, party, votes) =>
  `XX,ZZ001 - TESTVILLE,Ward ${ward},${vd},Station ${vd},${reg},${ballot},${spoilt},${party},${votes},2026-11-04`;

test('parses quoted fields with commas, quotes and newlines', async () => {
  const text =
    '﻿a,b,c\n1,"x, y","say ""hi"""\n2,"line one\nline two",z\n\n3,,end';
  const records = await collect(csvRecords(lines(text)));
  assert.deepEqual(records, [
    ['a', 'b', 'c'],
    ['1', 'x, y', 'say "hi"'],
    ['2', 'line one\nline two', 'z'],
    ['3', '', 'end'],
  ]);
});

test('sums ward votes across voting districts and counts registered voters once', async () => {
  const rows = [];
  for (const [vd, reg, base] of [
    ['1001', 500, 10],
    ['1002', 300, 20],
  ]) {
    for (const [i, party] of ['ANC', 'DA', 'EFF', 'INDEPENDENT'].entries()) {
      rows.push(row('30601001', vd, reg, 'Ward', 4, party, base + i));
    }
  }
  const { wards, councils } = await tallyOf(rows);
  const ward = wards.get('30601001');
  assert.equal(ward.catB, 'ZZ001');
  assert.equal(ward.wardNo, 1);
  assert.equal(ward.registered, 800);
  assert.equal(ward.votes.get('ANC'), 30);
  assert.equal(ward.votes.get('INDEPENDENT'), 36);
  // valid (10+11+12+13 + 20+21+22+23 = 132) plus spoilt once per district (4 + 4)
  assert.equal(ward.wardCast, 140);
  assert.equal(ward.prCast, 0);
  assert.equal(councils.get('ZZ001').registered, 800);
  assert.equal(councils.get('ZZ001').wardCast, 140);
});

test('ignores the district council ballot', async () => {
  const base = [
    row('30601001', '1001', 500, 'Ward', 2, 'ANC', 10),
    row('30601001', '1001', 500, 'PR', 3, 'ANC', 7),
  ];
  const withDc = [
    ...base,
    row('30601001', '1001', 500, 'DC 40%', 9, 'ANC', 99),
  ];
  const a = await tallyOf(base);
  const b = await tallyOf(withDc);
  assert.deepEqual(b, a);
  assert.equal(b.councils.get('ZZ001').prVotes.get('ANC'), 7);
  assert.equal(b.councils.get('ZZ001').prCast, 10);
});

test('the ward winner is the most ward-ballot votes, with share, runner-up and margin', async () => {
  const { wards } = await tallyOf([
    row('30601002', '2001', 1000, 'Ward', 10, 'ANC', 300),
    row('30601002', '2001', 1000, 'Ward', 10, 'DA', 100),
    row('30601002', '2001', 1000, 'Ward', 10, 'EFF', 100),
    row('30601002', '2001', 1000, 'PR', 5, 'DA', 900),
  ]);
  const r = wardOutcome(wards.get('30601002'));
  assert.equal(r.tie, false);
  assert.equal(r.winner.party, 'ANC');
  assert.equal(r.winner.votes, 300);
  assert.equal(r.winner.share, 0.6);
  assert.equal(r.runnerUp.votes, 100);
  assert.equal(r.runnerUp.share, 0.2);
  assert.ok(Math.abs(r.margin - 0.4) < 1e-9);
  assert.equal(r.turnout, 0.905); // PR cast 905 beats ward cast 510
  assert.equal(r.confirmed, true);
});

test('an exact ward tie has no winner', async () => {
  const { wards } = await tallyOf([
    row('30601003', '3001', 100, 'Ward', 0, 'ANC', 50),
    row('30601003', '3001', 100, 'Ward', 0, 'DA', 50),
    row('30601003', '3001', 100, 'Ward', 0, 'EFF', 10),
  ]);
  const r = wardOutcome(wards.get('30601003'));
  assert.equal(r.winner, null);
  assert.equal(r.tie, true);
  assert.equal(r.margin, 0);
  assert.equal(r.confirmed, false);
});

const seatsOf = (totalSeats, parties, independentWardSeats = 0) => ({
  totalSeats,
  independentWardSeats,
  parties: parties.map(([party, seats, wardSeats]) => ({
    party,
    seats,
    wardSeats,
    prSeats: seats - wardSeats,
  })),
});

test("the council's largest party is by seats, and majority means more than half", async () => {
  const { councils } = await tallyOf([
    row('30601001', '1001', 900, 'PR', 0, 'ANC', 400),
    row('30601001', '1001', 900, 'PR', 0, 'DA', 500),
  ]);
  const council = councils.get('ZZ001');
  const win = councilOutcome(
    council,
    seatsOf(231, [
      ['ANC', 116, 50],
      ['DA', 115, 40],
    ]),
  );
  assert.equal(win.largest.party, 'ANC');
  assert.equal(win.largest.seats, 116);
  assert.equal(win.totalSeats, 231);
  assert.equal(win.majority, true);
  assert.equal(win.parties[0].party, 'ANC');
  assert.equal(win.parties[1].prVotes, 500);
  assert.ok(Math.abs(win.parties[1].prShare - 500 / 900) < 1e-9);
  const lose = councilOutcome(
    council,
    seatsOf(231, [
      ['ANC', 115, 50],
      ['DA', 100, 40],
    ]),
  );
  assert.equal(lose.majority, false);
  // seat tie goes to the higher PR vote
  const tied = councilOutcome(
    council,
    seatsOf(20, [
      ['ANC', 8, 4],
      ['DA', 8, 4],
    ]),
  );
  assert.equal(tied.largest.party, 'DA');
  assert.equal(tied.majority, false);
});

test('without a seat file a council has no seats and is unchecked', async () => {
  const { councils } = await tallyOf([
    row('30601001', '1001', 900, 'Ward', 0, 'ANC', 100),
    row('30601001', '1001', 900, 'PR', 0, 'ANC', 400),
    row('30601001', '1001', 900, 'PR', 0, 'DA', 500),
  ]);
  const r = councilOutcome(councils.get('ZZ001'), null);
  assert.equal(r.largest, null);
  assert.equal(r.totalSeats, null);
  assert.equal(r.majority, null);
  assert.equal(r.seatCheck, 'unchecked');
  assert.equal(r.turnout, 1); // max(100, 900) / 900
});

const winnerOf = (party) => ({
  winner: { party, votes: 1, share: 1 },
  runnerUp: null,
  tie: false,
  margin: null,
  turnout: null,
  confirmed: true,
});

test('seat check flags merged independents', () => {
  const seats = seatsOf(10, [['ANC', 6, 2]], 1);
  const ok = [winnerOf('ANC'), winnerOf('ANC'), winnerOf('INDEPENDENT')];
  assert.equal(seatCheck(ok, seats), 'ok');
  const merged = [
    winnerOf('ANC'),
    winnerOf('ANC'),
    winnerOf('INDEPENDENT'),
    winnerOf('INDEPENDENT'),
  ];
  assert.equal(seatCheck(merged, seats), 'mismatch');
});

test('seat check flags missing wins, extra wins and tied wards', () => {
  const seats = seatsOf(
    10,
    [
      ['ANC', 6, 2],
      ['DA', 3, 1],
    ],
    0,
  );
  assert.equal(
    seatCheck([winnerOf('ANC'), winnerOf('ANC'), winnerOf('DA')], seats),
    'ok',
  );
  assert.equal(
    seatCheck([winnerOf('ANC'), winnerOf('ANC')], seats),
    'mismatch',
  );
  assert.equal(
    seatCheck(
      [winnerOf('ANC'), winnerOf('ANC'), winnerOf('DA'), winnerOf('EFF')],
      seats,
    ),
    'mismatch',
  );
  const tie = {
    winner: null,
    runnerUp: null,
    tie: true,
    margin: 0,
    turnout: null,
    confirmed: false,
  };
  assert.equal(
    seatCheck([winnerOf('ANC'), winnerOf('ANC'), winnerOf('DA'), tie], seats),
    'mismatch',
  );
});

test('party names are normalized so CSV names join with seat-file names', async () => {
  const { wards } = await tallyOf([
    row('30601001', '1001', 100, 'Ward', 0, 'FF PLUS | FF+', 5),
    row('30601001', '1001', 100, 'Ward', 0, 'FF PLUS | FF+', 6),
  ]);
  assert.deepEqual([...wards.get('30601001').votes.keys()], ['FF PLUS FF+']);
});

test('a province lists at most 5,000 wards and 200 councils', async () => {
  const wardRows = (n) =>
    Array.from({ length: n }, (_, i) =>
      row(String(30_000_000 + i), '1', 1, 'Ward', 0, 'ANC', 1),
    );
  assert.equal((await tallyOf(wardRows(5000))).wards.size, 5000);
  await assert.rejects(tallyOf(wardRows(5001)), {
    message: 'csv_too_many_areas',
  });
  const councilRows = (n) =>
    Array.from(
      { length: n },
      (_, i) =>
        `XX,ZZ${String(i).padStart(3, '0')} - TOWN,Ward ${40_000_000 + i},1,Station,1,PR,0,ANC,1,2026-11-04`,
    );
  assert.equal((await tallyOf(councilRows(200))).councils.size, 200);
  await assert.rejects(tallyOf(councilRows(201)), {
    message: 'csv_too_many_areas',
  });
});

test('a missing header column fails loudly', async () => {
  const bad =
    'Province,Municipality,Ward,VotingDistrict,RegisteredVoters,BallotType,SpoiltVotes,PartyName\nXX,ZZ001 - A,Ward 1,1,1,Ward,0,ANC';
  await assert.rejects(aggregateProvince(csvRecords(lines(bad))), {
    message: 'csv_header',
  });
  await assert.rejects(aggregateProvince(csvRecords(lines(''))), {
    message: 'csv_header',
  });
});

test('a seat file that writes NAME * checks ok against a CSV that writes NAME', async () => {
  const { councils, wards } = await tallyOf([
    row('30601001', '1001', 900, 'Ward', 0, 'AFRICAN NATIONAL CONGRESS', 100),
    row('30601001', '1001', 900, 'Ward', 0, 'DEMOCRATIC ALLIANCE', 50),
    row('30601001', '1001', 900, 'PR', 0, 'AFRICAN NATIONAL CONGRESS', 400),
    row('30601001', '1001', 900, 'PR', 0, 'DEMOCRATIC ALLIANCE', 300),
  ]);
  const seats = parseSeatSheet([
    ['Total Seats Available in Municipality - (B)', 3],
    ['Independent Ward Councillors Elected - (C)', 0],
    [
      'Party Name',
      'Total Party Seats (x)',
      'Ward Seats (y)',
      'PR List Seats (x-y)',
    ],
    ['AFRICAN NATIONAL CONGRESS *', 2, 1, 1],
    ['DEMOCRATIC ALLIANCE', 1, 0, 1],
    ['Total Party Seats', 3, 1, 2],
  ]);
  const wardResults = [...wards.values()].map(wardOutcome);
  assert.equal(seatCheck(wardResults, seats), 'ok');
  const r = councilOutcome(councils.get('ZZ001'), seats);
  assert.equal(r.parties[0].party, 'AFRICAN NATIONAL CONGRESS');
  assert.equal(r.parties[0].prVotes, 400);
});
