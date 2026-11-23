// Turns an IEC province results CSV into ward winners and council seat outcomes.
import { normalizePartyName } from '../../../src/layers/saElections/parties.js';

/**
 * @typedef {{ prVotes: Map<string, number>, registered: number, wardCast: number, prCast: number }} CouncilTally
 * @typedef {{ catB: string, wardNo: number, votes: Map<string, number>, registered: number, wardCast: number, prCast: number }} WardTally
 * @typedef {{ councils: Map<string, CouncilTally>, wards: Map<string, WardTally> }} ProvinceTally
 * @typedef {{ party: string, votes: number, share: number }} WardPlace
 * @typedef {{ winner: WardPlace|null, runnerUp: WardPlace|null, tie: boolean, margin: number|null, turnout: number|null, confirmed: boolean }} WardResult
 * @typedef {import('./seats.js').SeatSheet} SeatSheet
 */

const REQUIRED = [
  'Municipality', 'Ward', 'VotingDistrict', 'RegisteredVoters', 'BallotType', 'SpoiltVotes', 'PartyName', 'TotalValidVotes',
];
export const INDEPENDENT = 'INDEPENDENT';

/**
 * RFC 4180 records from an async iterable of lines (line terminators already removed). Works one
 * record at a time; a quoted field may span lines, which rejoin with "\n". A leading BOM is
 * dropped and blank lines between records are skipped.
 * @param {AsyncIterable<string>} lines
 * @returns {AsyncGenerator<string[]>}
 */
export async function* csvRecords(lines) {
  let record = [];
  let field = '';
  let inQuotes = false;
  let first = true;
  for await (let line of lines) {
    if (first) {
      first = false;
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }
    if (!inQuotes && line === '') continue;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch !== '"') field += ch;
        else if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === ',') {
        record.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    if (inQuotes) { field += '\n'; continue; }
    record.push(field);
    yield record;
    record = [];
    field = '';
  }
  // An unterminated quote at end of input still yields what was read.
  if (inQuotes || record.length > 0) {
    record.push(field);
    yield record;
  }
}

const num = (text) => {
  const n = Number(String(text ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};
const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);

/**
 * Sums a province CSV into per-ward and per-council tallies. District council (DC) rows are
 * ignored. Registered voters count once per voting district, spoilt once per district and ballot.
 * @param {AsyncIterable<string[]>} records
 * @returns {Promise<ProvinceTally>}
 */
export async function aggregateProvince(records) {
  /** @type {ProvinceTally} */
  const tally = { councils: new Map(), wards: new Map() };
  const seenDistricts = new Set();
  const seenSpoilt = new Set();
  let col = null;
  for await (const rec of records) {
    if (col === null) {
      col = {};
      for (const name of REQUIRED) {
        const at = rec.findIndex((h) => h.trim() === name);
        if (at < 0) throw new Error('csv_header');
        col[name] = at;
      }
      continue;
    }
    const ballot = (rec[col.BallotType] ?? '').trim();
    if (ballot !== 'Ward' && ballot !== 'PR') continue;
    const wardId = (rec[col.Ward] ?? '').replace(/\D/g, '');
    if (wardId === '') continue;
    const catB = (rec[col.Municipality] ?? '').split(' - ')[0].trim();

    let council = tally.councils.get(catB);
    if (!council) {
      council = { prVotes: new Map(), registered: 0, wardCast: 0, prCast: 0 };
      tally.councils.set(catB, council);
    }
    let ward = tally.wards.get(wardId);
    if (!ward) {
      ward = { catB, wardNo: Number(wardId.slice(-3)), votes: new Map(), registered: 0, wardCast: 0, prCast: 0 };
      tally.wards.set(wardId, ward);
    }

    const district = `${wardId}|${(rec[col.VotingDistrict] ?? '').trim()}`;
    if (!seenDistricts.has(district)) {
      seenDistricts.add(district);
      const registered = num(rec[col.RegisteredVoters]);
      ward.registered += registered;
      council.registered += registered;
    }
    const cast = ballot === 'Ward' ? 'wardCast' : 'prCast';
    const spoiltKey = `${district}|${ballot}`;
    if (!seenSpoilt.has(spoiltKey)) {
      seenSpoilt.add(spoiltKey);
      const spoilt = num(rec[col.SpoiltVotes]);
      ward[cast] += spoilt;
      council[cast] += spoilt;
    }
    const party = normalizePartyName(rec[col.PartyName]);
    const valid = num(rec[col.TotalValidVotes]);
    ward[cast] += valid;
    council[cast] += valid;
    if (ballot === 'Ward') add(ward.votes, party, valid);
    else add(council.prVotes, party, valid);
  }
  if (col === null) throw new Error('csv_header');
  return tally;
}

const turnoutOf = (t) => (t.registered > 0 ? Math.max(t.wardCast, t.prCast) / t.registered : null);

/**
 * Ward winner from ward-ballot votes. `share` and `margin` are 0-1 fractions of the ward's valid
 * votes (margin = winner share minus runner-up share). An exact tie for first has no winner.
 * `confirmed` starts true for a decided ward; the provider clears it when the council's seat check fails.
 * @param {WardTally} ward
 * @returns {WardResult}
 */
export function wardOutcome(ward) {
  const ranked = [...ward.votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  let total = 0;
  for (const [, v] of ward.votes) total += v;
  const place = ([party, votes]) => ({ party, votes, share: total > 0 ? votes / total : 0 });
  const first = ranked[0] ? place(ranked[0]) : null;
  const second = ranked[1] ? place(ranked[1]) : null;
  const tie = first !== null && first.votes > 0 && second !== null && second.votes === first.votes;
  const decided = first !== null && first.votes > 0 && !tie;
  return {
    winner: decided ? first : null,
    runnerUp: second,
    tie,
    margin: first && second ? first.share - second.share : null,
    turnout: turnoutOf(ward),
    confirmed: decided,
  };
}

/**
 * Compares computed ward wins per party with the seat file's ward seats; wins by INDEPENDENT are
 * compared with `independentWardSeats`. A tied ward has no winner, so it is a mismatch.
 * @param {WardResult[]} wardResults
 * @param {SeatSheet} seats
 * @returns {'ok'|'mismatch'}
 */
export function seatCheck(wardResults, seats) {
  const wins = new Map();
  for (const r of wardResults) {
    if (r.winner === null) return 'mismatch';
    add(wins, r.winner.party, 1);
  }
  if ((wins.get(INDEPENDENT) ?? 0) !== seats.independentWardSeats) return 'mismatch';
  const expected = new Map();
  for (const p of seats.parties) if (p.party !== INDEPENDENT && p.wardSeats > 0) expected.set(p.party, p.wardSeats);
  for (const [party, n] of wins) {
    if (party !== INDEPENDENT && expected.get(party) !== n) return 'mismatch';
  }
  for (const [party, n] of expected) if ((wins.get(party) ?? 0) !== n) return 'mismatch';
  return 'ok';
}

/**
 * Council outcome from PR votes and (when the seat file was read) seats. Parties come from the
 * seat file, sorted by seats then PR votes; without a seat file they are the PR-vote parties,
 * with null seats. `seatCheck` is 'unchecked' here; the provider sets it from `seatCheck()` once
 * the council's ward results are known.
 * @param {CouncilTally} council
 * @param {SeatSheet|null} seats
 */
export function councilOutcome(council, seats) {
  let prTotal = 0;
  for (const [, v] of council.prVotes) prTotal += v;
  const prVotesOf = (party) => council.prVotes.get(party) ?? 0;
  const shareOf = (votes) => (prTotal > 0 ? votes / prTotal : 0);
  const turnout = turnoutOf(council);

  if (!seats) {
    const parties = [...council.prVotes]
      .map(([party, prVotes]) => ({ party, seats: null, wardSeats: null, prSeats: null, prVotes, prShare: shareOf(prVotes) }))
      .sort((a, b) => b.prVotes - a.prVotes);
    return { largest: null, totalSeats: null, majority: null, parties, turnout, seatCheck: 'unchecked' };
  }
  const parties = seats.parties
    .map((p) => ({ ...p, prVotes: prVotesOf(p.party), prShare: shareOf(prVotesOf(p.party)) }))
    .sort((a, b) => b.seats - a.seats || b.prVotes - a.prVotes);
  const top = parties[0] ?? null;
  return {
    largest: top ? { party: top.party, seats: top.seats } : null,
    totalSeats: seats.totalSeats,
    majority: top ? top.seats > seats.totalSeats / 2 : false,
    parties,
    turnout,
    seatCheck: 'unchecked',
  };
}
