import test from 'node:test';
import assert from 'node:assert/strict';
import { readXlsSheets } from './xls.js';
import { buildXls } from './testWorkbook.mjs';

test('reads strings and numbers from a synthetic workbook', () => {
  const grid = [['Party Name', 'Total Party Seats (x)'], ['DEMOCRATIC ALLIANCE', 140]];
  assert.deepEqual(readXlsSheets(buildXls([grid])), [grid]);
});

test('reads a string split across CONTINUE records', () => {
  // Mixed with a non-Latin-1 char so the string is stored as UTF-16.
  const name = 'PARTY Ā '.repeat(50).slice(0, 300);
  assert.equal(name.length, 300);
  const grid = [[name, 'second string after the split', 9]];
  assert.deepEqual(readXlsSheets(buildXls([grid], { sstChunkBytes: 64 })), [grid]);
  // The same holds for a compressed (8-bit) string split across records.
  const ascii = 'ABCDEFGHIJ'.repeat(30);
  assert.deepEqual(readXlsSheets(buildXls([[[ascii, 'x']]], { sstChunkBytes: 64 })), [[[ascii, 'x']]]);
});

test('decodes RK integers and RK hundredths', () => {
  const grid = [[{ rk: (7 << 2) | 2 }, { rk: (1234 << 2) | 3 }, { rk: ((-5 << 2) | 2) >>> 0 }, { rk: 0x3ff80000 }]];
  assert.deepEqual(readXlsSheets(buildXls([grid])), [[[7, 12.34, -5, 1.5]]]);
});

test('reads a stream stored in the mini stream', () => {
  const grid = [['small', 1]];
  const bytes = buildXls([grid]);
  assert.ok(bytes.length < 4096 + 512 * 8);
  assert.deepEqual(readXlsSheets(bytes), [grid]);
});

test('reads a stream stored in regular sectors and several sheets', () => {
  const rows = Array.from({ length: 200 }, (_, i) => [`Council ${i}`, i, i * 1.5]);
  const sheets = [rows, [['only', 'second sheet']]];
  const bytes = buildXls(sheets);
  assert.ok(bytes.length > 4096 + 512 * 3);
  assert.deepEqual(readXlsSheets(bytes), sheets);
});

test('pads ragged rows and empty cells with null', () => {
  const out = readXlsSheets(buildXls([[['a'], [null, 2, 'c']]]));
  assert.deepEqual(out, [[['a', null, null], [null, 2, 'c']]]);
});

test('refuses bytes that are not a compound file', () => {
  assert.throws(() => readXlsSheets(new Uint8Array(1000)), /xls_unreadable/);
  assert.throws(() => readXlsSheets(new Uint8Array(0)), /xls_unreadable/);
  assert.throws(() => readXlsSheets(buildXls([[['a']]]).subarray(0, 700)), /xls_unreadable/);
});
