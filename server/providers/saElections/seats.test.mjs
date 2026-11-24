import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeatSheet, readSeatFile } from './seats.js';
import { buildXls } from './testWorkbook.mjs';

const quotaBlock = [
  ['Seat Calculation Detail'],
  [],
  ['Quota - (Q)', null, null, null, null, null, null, 9000],
  [
    'Total Seats Available in Municipality - (B)',
    null,
    null,
    null,
    null,
    null,
    null,
    231,
  ],
  [
    'Independent Ward Councillors Elected - (C)',
    null,
    null,
    null,
    null,
    null,
    null,
    0,
  ],
  [],
  [
    'Party Name',
    null,
    null,
    'Total Valid Votes',
    null,
    'Round 2 \nAllocation',
    'Total Party Seats',
  ],
  ['DEMOCRATIC ALLIANCE', null, null, 1000, null, '0', 140],
];
const seatTable = [
  [
    null,
    null,
    'Party Name',
    'Total Party Seats (x)',
    'Ward Seats (y)',
    'PR List Seats (x-y)',
  ],
  [null, null, 'AFRICAN NATIONAL CONGRESS', '60', '0', 60],
  [null, null, 'DEMOCRATIC ALLIANCE', 140, 100, 40],
  [null, null, 'ACTIONSA (PF)', 0, 0, 0],
  [null, null, 'VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS', 31, '0', 31],
  [null, null, 'Total Party Seats', 231, 100, 131],
  [null, null, 'Independents', null, '0', null],
];
const expected = {
  totalSeats: 231,
  independentWardSeats: 0,
  parties: [
    {
      party: 'AFRICAN NATIONAL CONGRESS',
      seats: 60,
      wardSeats: 0,
      prSeats: 60,
    },
    { party: 'DEMOCRATIC ALLIANCE', seats: 140, wardSeats: 100, prSeats: 40 },
    {
      party: 'VRYHEIDSFRONT PLUS FREEDOM FRONT PLUS',
      seats: 31,
      wardSeats: 0,
      prSeats: 31,
    },
  ],
};

test('parses totals and the per-party seat table', () => {
  assert.deepEqual(parseSeatSheet([...quotaBlock, [], ...seatTable]), expected);
});

test('rows that name the same party are summed into one entry', () => {
  const rows = [
    ...quotaBlock,
    seatTable[0],
    [null, null, 'DEMOCRATIC ALLIANCE', 100, 60, 40],
    [null, null, 'ACTIONSA', 2, 1, 1],
    [null, null, 'ACTIONSA (PF)', '3', 0, 3],
    [null, null, 'DEMOCRATIC  ALLIANCE', 10, 5, 5],
    [null, null, 'Total Party Seats', 115, 66, 49],
  ];
  assert.deepEqual(parseSeatSheet(rows).parties, [
    { party: 'DEMOCRATIC ALLIANCE', seats: 110, wardSeats: 65, prSeats: 45 },
    { party: 'ACTIONSA', seats: 5, wardSeats: 1, prSeats: 4 },
  ]);
});

test('reads the independent ward councillor count', () => {
  const rows = [...quotaBlock, ...seatTable].map((r) =>
    String(r[0]).startsWith('Independent Ward')
      ? [r[0], null, null, null, null, null, null, 3]
      : r,
  );
  assert.equal(parseSeatSheet(rows).independentWardSeats, 3);
});

test('refuses a sheet without the seat table', () => {
  assert.throws(() => parseSeatSheet(quotaBlock), {
    message: 'seat_sheet_unreadable',
  });
  assert.throws(() => parseSeatSheet(seatTable), {
    message: 'seat_sheet_unreadable',
  });
  assert.throws(() => parseSeatSheet([]), { message: 'seat_sheet_unreadable' });
});

test('readSeatFile reads one sheet that holds everything', () => {
  assert.deepEqual(
    readSeatFile(buildXls([[...quotaBlock, ...seatTable]])),
    expected,
  );
});

test('readSeatFile reads totals and table split over two sheets', () => {
  assert.deepEqual(readSeatFile(buildXls([quotaBlock, seatTable])), expected);
});

test('readSeatFile skips an unrelated sheet and refuses a workbook with no seats', () => {
  assert.deepEqual(
    readSeatFile(buildXls([[['nothing here']], [...quotaBlock, ...seatTable]])),
    expected,
  );
  assert.throws(() => readSeatFile(buildXls([[['nothing here']]])), {
    message: 'seat_sheet_unreadable',
  });
});

const labelRow = (letter, n) => [
  `Ward Councillors Seats from Parties with no PR List - (${letter}) `,
  null,
  null,
  null,
  null,
  null,
  null,
  n,
];
const noPrTail = (extra) => [
  [null, null, 'Total Party Seats', 231, 100, 131],
  [null, null, 'Independents', 0],
  ...extra,
  [null, null, 'Total Seats', 37, 36, 73],
];

test('parties with no PR list are read from between the totals and Total Seats', () => {
  const rows = [
    ...quotaBlock,
    labelRow('D', 13),
    ...seatTable.slice(0, 5),
    ...noPrTail([[null, null, 'UNITED DEMOCRATIC MOVEMENT **', '13']]),
  ];
  const got = parseSeatSheet(rows);
  assert.deepEqual(got.parties.slice(0, 3), expected.parties);
  assert.deepEqual(got.parties[3], {
    party: 'UNITED DEMOCRATIC MOVEMENT',
    seats: 13,
    wardSeats: 13,
    prSeats: 0,
  });
  assert.equal(got.parties.length, 4);
});

test('a no-PR-list party merges with a main-table row of the same name', () => {
  const rows = [
    ...quotaBlock,
    ...seatTable.slice(0, 5),
    ...noPrTail([[null, null, 'DEMOCRATIC ALLIANCE *', 2]]),
  ];
  const da = parseSeatSheet(rows).parties.find(
    (p) => p.party === 'DEMOCRATIC ALLIANCE',
  );
  assert.deepEqual(da, {
    party: 'DEMOCRATIC ALLIANCE',
    seats: 142,
    wardSeats: 102,
    prSeats: 40,
  });
});

test('the no-PR-list label must agree with the rows read', () => {
  const rows = (n) => [
    ...quotaBlock,
    labelRow('D', n),
    ...seatTable.slice(0, 5),
    ...noPrTail([[null, null, 'UNITED DEMOCRATIC MOVEMENT **', 13]]),
  ];
  assert.doesNotThrow(() => parseSeatSheet(rows(13)));
  assert.throws(() => parseSeatSheet(rows(12)), {
    message: 'seat_sheet_unreadable',
  });
});

test('a label at 0 with no extra rows parses', () => {
  const rows = [
    ...quotaBlock,
    labelRow('F', 0),
    ...seatTable.slice(0, 5),
    ...noPrTail([]),
  ];
  assert.deepEqual(parseSeatSheet(rows).parties, expected.parties);
});

test('readSeatFile reads the no-PR-list layout over two sheets', () => {
  const sheet0 = [...quotaBlock, labelRow('D', 13)];
  const sheet1 = [
    ...seatTable.slice(0, 5),
    ...noPrTail([[null, null, 'UNITED DEMOCRATIC MOVEMENT **', 13]]),
  ];
  const got = readSeatFile(buildXls([sheet0, sheet1]));
  assert.equal(got.parties.at(-1).party, 'UNITED DEMOCRATIC MOVEMENT');
  assert.equal(got.parties.at(-1).seats, 13);
});
