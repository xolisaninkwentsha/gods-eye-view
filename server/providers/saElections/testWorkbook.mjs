// Test support: builds small synthetic Excel 97-2003 workbooks (BIFF8 inside a
// CFB v3 compound file) so the xls reader can be tested without real data.

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const SECTOR = 512;
const MINI_SECTOR = 64;
const MINI_CUTOFF = 4096;

export const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
export const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
export const rec = (type, data = Buffer.alloc(0)) => Buffer.concat([u16(type), u16(data.length), data]);
const padTo = (buf, n) => Buffer.concat([buf, Buffer.alloc((n - (buf.length % n)) % n)]);

/**
 * SST + CONTINUE records, each holding at most `chunk` data bytes. Entries are
 * { text, runs, ext }: `runs` rich-text runs and `ext` bytes of phonetic data.
 */
function sstRecords(entries, chunk) {
  const records = [];
  let parts = [Buffer.concat([u32(entries.length), u32(entries.length)])];
  let used = 8;
  const push = (b) => { parts.push(b); used += b.length; };
  const flush = () => {
    records.push(rec(records.length ? 0x003c : 0x00fc, Buffer.concat(parts)));
    parts = [];
    used = 0;
  };
  // Raw bytes (rich runs, ext data) may cross a record boundary with no flags byte.
  const pushRaw = (b) => {
    for (let i = 0; i < b.length;) {
      if (chunk - used < 1) flush();
      const n = Math.min(b.length - i, chunk - used);
      push(b.subarray(i, i + n));
      i += n;
    }
  };
  for (const { text, runs = 0, ext = 0 } of entries) {
    const wide = /[^\x00-\xff]/.test(text);
    const flags = (wide ? 1 : 0) | (ext ? 4 : 0) | (runs ? 8 : 0);
    const head = Buffer.concat([u16(text.length), Buffer.from([flags]),
      ...(runs ? [u16(runs)] : []), ...(ext ? [u32(ext)] : [])]);
    if (chunk - used < head.length + (wide ? 2 : 1)) flush();
    push(head);
    for (let i = 0; i < text.length;) {
      const w = wide ? 2 : 1;
      if (chunk - used < w) {
        flush();
        push(Buffer.from([wide ? 1 : 0])); // a continued string restarts with a flags byte
      }
      const n = Math.min(text.length - i, Math.floor((chunk - used) / w));
      push(Buffer.from(text.slice(i, i + n), wide ? 'utf16le' : 'latin1'));
      i += n;
    }
    pushRaw(Buffer.alloc(runs * 4 + ext, 0x41));
  }
  if (used > 0 || !records.length) flush();
  return records;
}

export const bof = (type) => rec(0x0809, Buffer.concat([u16(0x0600), u16(type), Buffer.alloc(12)]));

const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; };

/**
 * Cells: string, number, null, or an object:
 * { rk }, { mulrk: [rk, ...] } (starts at that column), { formula: number | null }
 * (null = a string result, whose cached value is not a number), { label: text },
 * { rich: text, runs, ext } (shared string with rich-text runs and ext data).
 */
function workbookStream(sheets, chunk) {
  const entries = [];
  const index = new Map();
  const intern = (e) => {
    const key = JSON.stringify(e);
    if (!index.has(key)) { index.set(key, entries.length); entries.push(e); }
    return index.get(key);
  };
  for (const sheet of sheets) for (const row of sheet) for (const v of row) {
    if (typeof v === 'string') intern({ text: v });
    else if (v?.rich !== undefined) intern({ text: v.rich, runs: v.runs, ext: v.ext });
  }
  const out = [bof(0x0005), ...sstRecords(entries, chunk), rec(0x000a)];
  for (const sheet of sheets) {
    out.push(bof(0x0010));
    sheet.forEach((row, r) => row.forEach((v, c) => {
      const pos = Buffer.concat([u16(r), u16(c), u16(0)]);
      const add = (type, ...data) => out.push(rec(type, Buffer.concat([pos, ...data])));
      if (typeof v === 'string') add(0x00fd, u32(intern({ text: v })));
      else if (typeof v === 'number') add(0x0203, f64(v));
      else if (v?.rk !== undefined) add(0x027e, u32(v.rk));
      else if (v?.mulrk) {
        out.push(rec(0x00bd, Buffer.concat([u16(r), u16(c), ...v.mulrk.flatMap((rk) => [u16(0), u32(rk)]),
          u16(c + v.mulrk.length - 1)])));
      } else if (v && 'formula' in v) {
        const result = v.formula === null ? Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]) : f64(v.formula);
        add(0x0006, result, Buffer.alloc(6)); // result, flags u16, chn u32
      } else if (v?.label !== undefined) {
        add(0x0204, u16(v.label.length), Buffer.from([0]), Buffer.from(v.label, 'latin1'));
      } else if (v?.rich !== undefined) add(0x00fd, u32(intern({ text: v.rich, runs: v.runs, ext: v.ext })));
    }));
    out.push(rec(0x000a));
  }
  return Buffer.concat(out);
}

function dirEntry(name, type, child, start, size) {
  const e = Buffer.alloc(128);
  if (name) {
    e.write(name, 0, 'utf16le');
    e.writeUInt16LE((name.length + 1) * 2, 0x40);
  }
  e[0x42] = type;
  e[0x43] = 1;
  e.writeUInt32LE(FREESECT, 0x44);
  e.writeUInt32LE(FREESECT, 0x48);
  e.writeUInt32LE(child, 0x4c);
  e.writeUInt32LE(start, 0x74);
  e.writeUInt32LE(size, 0x78);
  return e;
}

/**
 * Build a .xls file. `sheets` is a list of sheets, each a list of rows, each a
 * list of cells: a string, a number, null (empty) or `{ rk: <raw uint32> }`.
 * A workbook stream under 4,096 bytes goes in the mini stream, as in real files.
 * @returns {Uint8Array}
 */
export function buildXls(sheets, { sstChunkBytes = 8224 } = {}) {
  return buildXlsFromStream(workbookStream(sheets, sstChunkBytes));
}

/**
 * Wrap raw BIFF bytes (a Workbook stream) in a compound file. Lets tests hand-craft
 * malformed records.
 * @param {Uint8Array} workbook
 * @returns {Uint8Array}
 */
export function buildXlsFromStream(workbook) {
  const wb = Buffer.from(workbook);
  const mini = wb.length < MINI_CUTOFF;
  // In the mini case the sectors hold the mini stream, indexed by one mini FAT sector.
  const data = padTo(wb, mini ? MINI_SECTOR : SECTOR);
  const sectors = padTo(data, SECTOR);
  const nData = sectors.length / SECTOR;
  const nMini = mini ? 1 : 0;
  let nFat = 1;
  while (nFat * 128 < nData + nMini + 1 + nFat) nFat++;
  if (nFat > 109) throw new Error('workbook too large for the test writer');
  const miniFatId = nData;
  const dirId = nData + nMini;
  const fatId = dirId + 1;

  const fat = new Array(nFat * 128).fill(FREESECT);
  for (let i = 0; i < nData; i++) fat[i] = i < nData - 1 ? i + 1 : ENDOFCHAIN;
  if (mini) fat[miniFatId] = ENDOFCHAIN;
  fat[dirId] = ENDOFCHAIN;
  for (let i = 0; i < nFat; i++) fat[fatId + i] = FATSECT;

  const miniFat = new Array(128).fill(FREESECT);
  const nMiniSectors = data.length / MINI_SECTOR;
  for (let i = 0; i < nMiniSectors && mini; i++) miniFat[i] = i < nMiniSectors - 1 ? i + 1 : ENDOFCHAIN;

  const header = Buffer.alloc(SECTOR);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(nFat, 0x2c);
  header.writeUInt32LE(dirId, 0x30);
  header.writeUInt32LE(MINI_CUTOFF, 0x38);
  header.writeUInt32LE(mini ? miniFatId : ENDOFCHAIN, 0x3c);
  header.writeUInt32LE(nMini, 0x40);
  header.writeUInt32LE(ENDOFCHAIN, 0x44);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < nFat ? fatId + i : FREESECT, 0x4c + i * 4);

  const dir = Buffer.concat([
    dirEntry('Root Entry', 5, 1, mini ? 0 : ENDOFCHAIN, mini ? data.length : 0),
    dirEntry('Workbook', 2, FREESECT, 0, wb.length),
    dirEntry('', 0, FREESECT, 0, 0),
    dirEntry('', 0, FREESECT, 0, 0),
  ]);
  const toBuf = (arr) => Buffer.concat(arr.map(u32));
  return new Uint8Array(Buffer.concat([
    header, sectors, ...(mini ? [toBuf(miniFat)] : []), dir, toBuf(fat),
  ]));
}
