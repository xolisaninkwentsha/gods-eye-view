// Dependency-free reader for Excel 97-2003 (.xls) files: a BIFF8 Workbook stream
// inside a CFB v3 compound file. It reads cell values only (strings and numbers).

const ENDOFCHAIN_MIN = 0xfffffffa; // ids at or above this are special markers
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const ENDOFCHAIN = 0xfffffffe;
const MAX_ROWS = 65536; // BIFF8 limits
const MAX_COLS = 256;
const MAX_CELLS = 1000000;

/** Follow a sector chain through a FAT. Out-of-range ids, loops and unterminated chains throw. */
function chainOf(fat, start) {
  const out = [];
  const seen = new Set();
  let s = start;
  while (s < ENDOFCHAIN_MIN) {
    if (s >= fat.length || seen.has(s)) throw new Error('bad chain');
    seen.add(s);
    out.push(s);
    s = fat[s];
  }
  if (s !== ENDOFCHAIN) throw new Error('chain ends on a reserved id');
  return out;
}

/** Return the bytes of the stream called `Workbook` (or `Book`). */
function readWorkbookStream(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 512 || SIGNATURE.some((b, i) => bytes[i] !== b))
    throw new Error('not cfb');
  const shift = dv.getUint16(0x1e, true);
  const miniShift = dv.getUint16(0x20, true);
  if (shift < 9 || shift > 16 || miniShift > shift)
    throw new Error('bad shift');
  const size = 1 << shift;
  const miniSize = 1 << miniShift;
  const cutoff = dv.getUint32(0x38, true);
  const sector = (id) => {
    const at = (id + 1) * size;
    if (at + size > bytes.length) throw new Error('sector out of range');
    return bytes.subarray(at, at + size);
  };
  const u32s = (buf) =>
    Array.from(new Uint32Array(Uint8Array.from(buf).buffer));

  // FAT sector ids: 109 in the header, the rest in DIFAT sectors.
  const fatIds = [];
  for (let i = 0; i < 109; i++) fatIds.push(dv.getUint32(0x4c + i * 4, true));
  const fatCount = dv.getUint32(0x2c, true);
  const maxSectors = Math.floor(bytes.length / size);
  if (fatCount > maxSectors) throw new Error('fat count exceeds file');
  let difat = dv.getUint32(0x44, true);
  const seenDifat = new Set();
  for (
    let n = Math.min(dv.getUint32(0x48, true), maxSectors);
    n > 0 && fatIds.length < fatCount;
    n--
  ) {
    if (difat >= ENDOFCHAIN_MIN || seenDifat.has(difat))
      throw new Error('bad difat');
    seenDifat.add(difat);
    const ids = u32s(sector(difat));
    difat = ids.pop();
    fatIds.push(...ids);
  }
  if (fatIds.length < fatCount) throw new Error('fat sectors missing');
  const fat = fatIds.slice(0, fatCount).flatMap((id) => u32s(sector(id)));

  const readChain = (table, start, length, get) =>
    Buffer.concat(chainOf(table, start).map(get)).subarray(0, length);
  const dirBytes = readChain(fat, dv.getUint32(0x30, true), Infinity, sector);

  let root = null;
  let book = null;
  for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
    const e = dirBytes.subarray(at, at + 128);
    const nameLen = e.readUInt16LE(0x40);
    const name = e.subarray(0, Math.max(0, nameLen - 2)).toString('utf16le');
    const entry = {
      type: e[0x42],
      start: e.readUInt32LE(0x74),
      size: e.readUInt32LE(0x78),
    };
    if (entry.type === 5 && !root) root = entry;
    else if (
      entry.type === 2 &&
      (name === 'Workbook' || name === 'Book') &&
      !book
    )
      book = entry;
  }
  if (!root || !book) throw new Error('no workbook stream');

  if (book.size >= cutoff) return readChain(fat, book.start, book.size, sector);

  const miniFat = [];
  for (const id of chainOf(fat, dv.getUint32(0x3c, true)))
    miniFat.push(...u32s(sector(id)));
  const miniStream = readChain(fat, root.start, root.size, sector);
  return readChain(miniFat, book.start, book.size, (id) => {
    const at = id * miniSize;
    if (at + miniSize > miniStream.length)
      throw new Error('mini sector out of range');
    return miniStream.subarray(at, at + miniSize);
  });
}

/** Decode RK: bit 1 = signed integer, else the high 30 bits of a double; bit 0 = divide by 100. */
function decodeRk(rk) {
  let v;
  if (rk & 2) v = rk >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 1 ? v / 100 : v;
}

/** Cursor over an SST record and its CONTINUE records (strings may span them). */
function parseSst(segments) {
  let seg = 0;
  let pos = 0;
  const ensure = () => {
    while (pos >= segments[seg].length) {
      if (++seg >= segments.length) throw new Error('sst truncated');
      pos = 0;
    }
  };
  const take = (n) => {
    const out = [];
    while (n > 0) {
      ensure();
      const k = Math.min(n, segments[seg].length - pos);
      out.push(segments[seg].subarray(pos, pos + k));
      pos += k;
      n -= k;
    }
    return Buffer.concat(out);
  };
  const total = take(8).readUInt32LE(4);
  const strings = [];
  for (let i = 0; i < total; i++) {
    const head = take(3);
    const cch = head.readUInt16LE(0);
    let flags = head[2];
    const runs = flags & 0x08 ? take(2).readUInt16LE(0) : 0;
    const ext = flags & 0x04 ? take(4).readUInt32LE(0) : 0;
    let text = '';
    for (let left = cch; left > 0;) {
      const wide = flags & 1;
      const n = Math.min(
        left,
        Math.floor((segments[seg].length - pos) / (wide ? 2 : 1)),
      );
      if (n === 0) {
        // Segment exhausted (or too short for a whole char): the next one restarts with a flags byte.
        if (++seg >= segments.length) throw new Error('sst truncated');
        pos = 0;
        flags = take(1)[0];
        continue;
      }
      text += take(n * (wide ? 2 : 1)).toString(wide ? 'utf16le' : 'latin1');
      left -= n;
    }
    take(runs * 4 + ext);
    strings.push(text);
  }
  return strings;
}

/** Read a BIFF8 string of a LABEL record: cch u16, flags u8, chars. */
function labelText(d, at) {
  const cch = d.readUInt16LE(at);
  const wide = d[at + 2] & 1;
  const start = at + 3;
  return d
    .subarray(start, start + cch * (wide ? 2 : 1))
    .toString(wide ? 'utf16le' : 'latin1');
}

/**
 * Read every worksheet of an .xls file.
 * @param {Uint8Array} bytes
 * @returns {Array<Array<Array<string|number|null>>>} sheets, rows, cells (rows padded with null)
 */
export function readXlsSheets(bytes) {
  try {
    const wb = readWorkbookStream(bytes);
    const records = [];
    for (let at = 0; at + 4 <= wb.length;) {
      const len = wb.readUInt16LE(at + 2);
      if (at + 4 + len > wb.length) throw new Error('record overruns stream');
      records.push({
        type: wb.readUInt16LE(at),
        data: wb.subarray(at + 4, at + 4 + len),
      });
      at += 4 + len;
    }

    let strings = [];
    const sheets = [];
    let cells = null; // Map "row,col" -> value for the open worksheet
    let depth = 0; // BOF nesting: charts and the like open BOFs inside a sheet
    for (let i = 0; i < records.length; i++) {
      const { type, data } = records[i];
      if (type === 0x0809) {
        depth++;
        if (depth === 1 && data.readUInt16LE(2) === 0x0010) cells = new Map();
      } else if (type === 0x000a) {
        if (depth === 1 && cells) sheets.push(cells);
        cells = null;
        depth = Math.max(0, depth - 1);
      } else if (type === 0x00fc && depth === 1 && !cells) {
        const segs = [data];
        while (records[i + 1]?.type === 0x003c) segs.push(records[++i].data);
        strings = parseSst(segs);
      } else if (cells && depth === 1) {
        const put = (r, c, v) => {
          if (v !== undefined) cells.set(`${r},${c}`, [r, c, v]);
        };
        if (type === 0x00fd)
          put(
            data.readUInt16LE(0),
            data.readUInt16LE(2),
            strings[data.readUInt32LE(6)] ?? null,
          );
        else if (type === 0x0203)
          put(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
        else if (type === 0x027e)
          put(
            data.readUInt16LE(0),
            data.readUInt16LE(2),
            decodeRk(data.readUInt32LE(6)),
          );
        else if (type === 0x0204)
          put(data.readUInt16LE(0), data.readUInt16LE(2), labelText(data, 6));
        else if (type === 0x0006 && data.readUInt16LE(12) !== 0xffff) {
          put(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
        } else if (type === 0x00bd) {
          const row = data.readUInt16LE(0);
          const first = data.readUInt16LE(2);
          for (let k = 0, at = 4; at + 6 <= data.length - 2; k++, at += 6) {
            put(row, first + k, decodeRk(data.readUInt32LE(at + 2)));
          }
        }
      }
    }
    return sheets.map((map) => {
      let maxRow = -1;
      let maxCol = -1;
      for (const [r, c] of map.values()) {
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
      }
      if (
        maxRow >= MAX_ROWS ||
        maxCol >= MAX_COLS ||
        (maxRow + 1) * (maxCol + 1) > MAX_CELLS
      ) {
        throw new Error('sheet too large');
      }
      const grid = Array.from({ length: maxRow + 1 }, () =>
        new Array(maxCol + 1).fill(null),
      );
      for (const [r, c, v] of map.values()) grid[r][c] = v;
      return grid;
    });
  } catch {
    throw new Error('xls_unreadable');
  }
}
