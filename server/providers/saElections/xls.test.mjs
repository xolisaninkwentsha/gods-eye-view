import test from 'node:test';
import assert from 'node:assert/strict';
import { readXlsSheets } from './xls.js';
import { buildXls, buildXlsFromStream, bof, rec, u16, u32 } from './testWorkbook.mjs';

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

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const fatSectorOf = (bytes) => Buffer.from(bytes).readUInt32LE(0x4c);

/** Copy `bytes` and let `patch(buffer)` edit the copy. */
const patched = (bytes, patch) => { const b = Buffer.from(bytes); patch(b); return new Uint8Array(b); };

test('reads MULRK, FORMULA cached numbers, LABEL and RK hundredths of a float', () => {
  const grid = [
    [{ mulrk: [(3 << 2) | 2, (250 << 2) | 3, 0x3ff80000] }],
    [{ formula: 42.5 }, { formula: null }, { label: 'plain label' }, { rk: 0x402e0000 | 1 }],
  ];
  assert.deepEqual(readXlsSheets(buildXls([grid])), [[[3, 2.5, 1.5, null], [42.5, null, 'plain label', 0.15]]]);
});

test('reads strings whose rich-text runs and ext data span CONTINUE records', () => {
  const grid = [[
    { rich: 'rich one', runs: 7, ext: 0 },
    { rich: 'ext \u0100 two', runs: 0, ext: 90 },
    { rich: 'both', runs: 20, ext: 70 },
    'after',
  ]];
  const expected = [['rich one', 'ext \u0100 two', 'both', 'after']];
  for (const chunk of [40, 64, 8224]) {
    assert.deepEqual(readXlsSheets(buildXls([grid], { sstChunkBytes: chunk })), [expected], `chunk ${chunk}`);
  }
});

test('reads FAT sectors listed in a DIFAT sector', () => {
  const base = buildXls([[['via difat', 5]]]);
  const fatId = fatSectorOf(base);
  const sectorCount = (base.length - 512) / 512;
  const withDifat = Buffer.concat([Buffer.from(base), Buffer.alloc(512 * 120)]);
  withDifat.writeUInt32LE(110, 0x2c); // 109 header entries + 1 from the DIFAT sector
  for (let i = 0; i < 109; i++) withDifat.writeUInt32LE(fatId, 0x4c + i * 4);
  withDifat.writeUInt32LE(sectorCount, 0x44);
  withDifat.writeUInt32LE(1, 0x48);
  const at = (sectorCount + 1) * 512;
  for (let i = 0; i < 127; i++) withDifat.writeUInt32LE(i === 0 ? fatId : FREESECT, at + i * 4);
  withDifat.writeUInt32LE(ENDOFCHAIN, at + 127 * 4);
  assert.deepEqual(readXlsSheets(new Uint8Array(withDifat)), [[['via difat', 5]]]);
});

test('ends a cyclic DIFAT in xls_unreadable', { timeout: 2000 }, () => {
  const base = buildXls([[['x']]]);
  const fatId = fatSectorOf(base);
  const sectorCount = (base.length - 512) / 512;
  const b = Buffer.concat([Buffer.from(base), Buffer.alloc(512 * 450)]);
  b.writeUInt32LE(400, 0x2c);
  for (let i = 0; i < 109; i++) b.writeUInt32LE(fatId, 0x4c + i * 4);
  b.writeUInt32LE(sectorCount, 0x44);
  b.writeUInt32LE(50, 0x48);
  const at = (sectorCount + 1) * 512;
  for (let i = 0; i < 127; i++) b.writeUInt32LE(fatId, at + i * 4);
  b.writeUInt32LE(sectorCount, at + 127 * 4); // points at itself
  assert.throws(() => readXlsSheets(new Uint8Array(b)), /xls_unreadable/);
  // A FAT count larger than the file can hold is refused too.
  assert.throws(() => readXlsSheets(patched(base, (x) => x.writeUInt32LE(0x7fffffff, 0x2c))), /xls_unreadable/);
});

test('refuses a FAT with an out-of-range id or a cycle', { timeout: 2000 }, () => {
  const base = buildXls([[['x']]]);
  const fatAt = (fatSectorOf(base) + 1) * 512;
  assert.deepEqual(readXlsSheets(base), [[['x']]]);
  assert.throws(() => readXlsSheets(patched(base, (b) => b.writeUInt32LE(5000, fatAt))), /xls_unreadable/);
  assert.throws(() => readXlsSheets(patched(base, (b) => b.writeUInt32LE(0, fatAt))), /xls_unreadable/);
  // A chain that runs into a free sector instead of an end marker.
  assert.throws(() => readXlsSheets(patched(base, (b) => b.writeUInt32LE(FREESECT, fatAt))), /xls_unreadable/);
});

test('refuses a chain that runs past a truncated FAT', { timeout: 2000 }, () => {
  const rows = Array.from({ length: 2500 }, (_, i) => [`Council ${i}`, i, i * 2]);
  const base = buildXls([rows]);
  const nFat = Buffer.from(base).readUInt32LE(0x2c);
  assert.ok(nFat >= 2);
  assert.deepEqual(readXlsSheets(base)[0].length, 2500);
  assert.throws(() => readXlsSheets(patched(base, (b) => b.writeUInt32LE(1, 0x2c))), /xls_unreadable/);
});

test('ends an SST string split mid-character without hanging', { timeout: 2000 }, () => {
  const sst = Buffer.concat([u32(1), u32(1), u16(4), Buffer.from([1]), Buffer.from('A\0B', 'latin1')]);
  const cont = Buffer.concat([Buffer.from([1]), Buffer.from('C\0D\0', 'latin1')]);
  const bytes = buildXlsFromStream(Buffer.concat([
    bof(0x0005), rec(0x00fc, sst), rec(0x003c, cont), rec(0x000a),
    bof(0x0010), rec(0x00fd, Buffer.concat([u16(0), u16(0), u16(0), u32(0)])), rec(0x000a),
  ]));
  let out;
  try { out = readXlsSheets(bytes); } catch (e) { assert.match(e.message, /xls_unreadable/); }
  if (out) assert.equal(out[0][0][0].length, 4);
  // No next segment at all: refused.
  const lone = buildXlsFromStream(Buffer.concat([bof(0x0005), rec(0x00fc, sst), rec(0x000a)]));
  assert.throws(() => readXlsSheets(lone), /xls_unreadable/);
});

test('refuses a sheet whose cells would need an oversized grid', () => {
  const far = Array.from({ length: 65536 }, () => []);
  far[65535] = new Array(255).fill(null).concat([1]);
  assert.throws(() => readXlsSheets(buildXls([far])), /xls_unreadable/);
  assert.throws(() => readXlsSheets(buildXls([[new Array(300).fill(null).concat([1])]])), /xls_unreadable/);
  const edge = [new Array(255).fill(null).concat([1])];
  assert.equal(readXlsSheets(buildXls([edge]))[0][0].length, 256);
});
