import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeatSheet, readSeatFile } from './seats.js';
import { buildXls } from './testWorkbook.mjs';

const quotaBlock = [
  ['Seat Calculation Detail'],
  [],
  ['Quota - (Q)', null, null, null, null, null, null, 9000],
  ['Total Seats Available in Municipality - (B)', null, null, null, null, null, null, 231],
  ['Independent Ward Councillors Elected - (C)', null, null, null, null, null, null, 0],
  [],
  ['Party Name', null, null, 'Total Valid Votes', null, 'Round 2 \nAllocation', 'Total Party Seats'],
  ['DEMOCRATIC ALLIANCE', null, null, 1000, null, '0', 140],
];
const seatTable = [
  [null, null, 'Party Name', 'Total Party Seats (x)', 'Ward Seats (y)', 'PR List Seats (x-y)'],
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
    { party: 'AFRICAN NATIONAL CONGRESS', seats: 60, wardSeats: 0, prSeats: 60 },
    { party: 'DEMOCRATIC ALLIANCE', seats: 140, wardSeats: 100, prSeats: 40 },
    { party: 'VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS', seats: 31, wardSeats: 0, prSeats: 31 },
  ],
};

test('parses totals and the per-party seat table', () => {
  assert.deepEqual(parseSeatSheet([...quotaBlock, [], ...seatTable]), expected);
});

test('reads the independent ward councillor count', () => {
  const rows = [...quotaBlock, ...seatTable].map((r) =>
    String(r[0]).startsWith('Independent Ward') ? [r[0], null, null, null, null, null, null, 3] : r);
  assert.equal(parseSeatSheet(rows).independentWardSeats, 3);
});

test('refuses a sheet without the seat table', () => {
  assert.throws(() => parseSeatSheet(quotaBlock), { message: 'seat_sheet_unreadable' });
  assert.throws(() => parseSeatSheet(seatTable), { message: 'seat_sheet_unreadable' });
  assert.throws(() => parseSeatSheet([]), { message: 'seat_sheet_unreadable' });
});

test('readSeatFile reads one sheet that holds everything', () => {
  assert.deepEqual(readSeatFile(buildXls([[...quotaBlock, ...seatTable]])), expected);
});

test('readSeatFile reads totals and table split over two sheets', () => {
  assert.deepEqual(readSeatFile(buildXls([quotaBlock, seatTable])), expected);
});

test('readSeatFile skips an unrelated sheet and refuses a workbook with no seats', () => {
  assert.deepEqual(readSeatFile(buildXls([[['nothing here']], [...quotaBlock, ...seatTable]])), expected);
  assert.throws(() => readSeatFile(buildXls([[['nothing here']]])), { message: 'seat_sheet_unreadable' });
});
