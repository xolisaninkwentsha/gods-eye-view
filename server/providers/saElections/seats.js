// Reads an IEC "Seat Calculation Detail" workbook into council seat counts per party.
import { readXlsSheets } from './xls.js';
import { normalizePartyName } from '../../../src/layers/saElections/parties.js';

/**
 * @typedef {{ party: string, seats: number, wardSeats: number, prSeats: number }} PartySeats
 * @typedef {{ totalSeats: number, independentWardSeats: number, parties: PartySeats[] }} SeatSheet
 */

const unreadable = () => new Error('seat_sheet_unreadable');

const toNumber = (cell) => {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (
    typeof cell === 'string' &&
    cell.trim() !== '' &&
    Number.isFinite(Number(cell))
  )
    return Number(cell);
  return null;
};
const text = (cell) =>
  typeof cell === 'string' ? cell.replace(/\s+/g, ' ').trim() : '';

/** First number on the first row whose first text cell starts with `label`. */
function labelledNumber(rows, label) {
  for (const row of rows) {
    const first = row.find((c) => text(c) !== '');
    if (first === undefined || !text(first).startsWith(label)) continue;
    for (const cell of row) {
      const n = toNumber(cell);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * @param {Array<Array<string|number|null>>} rows
 * @returns {SeatSheet}
 */
export function parseSeatSheet(rows) {
  const totalSeats = labelledNumber(
    rows,
    'Total Seats Available in Municipality',
  );
  const independentWardSeats = labelledNumber(
    rows,
    'Independent Ward Councillors Elected',
  );
  const headerAt = rows.findIndex((row) =>
    row.some((c) => text(c) === 'Total Party Seats (x)'),
  );
  if (totalSeats === null || independentWardSeats === null || headerAt < 0)
    throw unreadable();

  const header = rows[headerAt];
  const totalCol = header.findIndex((c) => text(c) === 'Total Party Seats (x)');
  const wardCol = header.findIndex((c) => text(c).startsWith('Ward Seats'));
  const prCol = header.findIndex((c) => text(c).startsWith('PR List Seats'));
  const nameCol = header.findIndex((c) => text(c) === 'Party Name');
  if (wardCol < 0 || prCol < 0 || nameCol < 0) throw unreadable();

  // Rows whose names normalize alike ("X" and "X (PF)") are one party: their seats are summed,
  // in the order each party first appears.
  /** @type {Map<string, PartySeats>} */
  const byParty = new Map();
  let closed = false;
  for (const row of rows.slice(headerAt + 1)) {
    const name = text(row[nameCol]);
    if (name === '') continue;
    if (name.startsWith('Total')) {
      closed = true;
      break;
    }
    const seats = toNumber(row[totalCol]);
    if (seats === null) throw unreadable();
    if (seats === 0) continue;
    const party = normalizePartyName(name);
    const entry = byParty.get(party) ?? {
      party,
      seats: 0,
      wardSeats: 0,
      prSeats: 0,
    };
    entry.seats += seats;
    entry.wardSeats += toNumber(row[wardCol]) ?? 0;
    entry.prSeats += toNumber(row[prCol]) ?? 0;
    byParty.set(party, entry);
  }
  if (!closed) throw unreadable();
  return { totalSeats, independentWardSeats, parties: [...byParty.values()] };
}

/**
 * The first sheet that parses. The IEC splits the totals and the final seat table over two
 * sheets, so when no single sheet parses, the sheets are tried joined in order.
 * @param {Uint8Array} bytes
 * @returns {SeatSheet}
 */
export function readSeatFile(bytes) {
  const sheets = readXlsSheets(bytes);
  const attempts = [...sheets, sheets.flat()];
  for (const rows of attempts) {
    try {
      return parseSeatSheet(rows);
    } catch (err) {
      if (err.message !== 'seat_sheet_unreadable') throw err;
    }
  }
  throw unreadable();
}
