// IEC (Electoral Commission of South Africa) files for the 4 November 2026 local election
// (event 1887): one detailed results CSV per province, one seat calculation workbook per council.
import { readResponseBytesCapped } from '../common/http.js';
import { csvRecords, aggregateProvince } from './results.js';

/** @typedef {import('./results.js').ProvinceTally} ProvinceTally */

export const IEC_PROVINCES = Object.freeze([
  'EC',
  'FS',
  'GP',
  'KN',
  'NP',
  'MP',
  'NW',
  'NC',
  'WP',
]);

const IEC_EVENT = 'https://results.elections.org.za/home/LGEPublicReports/1887';
const USER_AGENT = 'GodsEyeView (sa-elections)';
const MIB = 1024 * 1024;
const CSV_CAP_BYTES = 80 * MIB;
const CSV_TIMEOUT_MS = 10 * 60_000;
// Real rows are about 200 bytes; a "line" this long means the body is not the results CSV.
const MAX_LINE_CHARS = MIB;
const SEAT_CAP_BYTES = MIB;
const SEAT_TIMEOUT_MS = 60_000;
const HEAD_TIMEOUT_MS = 30_000;

const defaultFetch = (...args) => globalThis.fetch(...args);
const tooLarge = () =>
  Object.assign(new Error('results_too_large'), { code: 'RESPONSE_TOO_LARGE' });

/**
 * MDB/IEC council codes (CPT, NC061, KZN212). Council codes come from CSV text, so anything
 * else, district councils (DC1...) included, is never put into a URL or used as a key.
 * @param {unknown} code
 */
export const isCouncilCode = (code) =>
  typeof code === 'string' &&
  /^[A-Z]{2,3}\d{0,3}$/.test(code) &&
  !/^DC\d/.test(code);

function province(code) {
  if (!IEC_PROVINCES.includes(code)) throw new Error('unknown_province');
  return code;
}

/** @param {string} code IEC province code */
export const provinceCsvUrl = (code) =>
  `${IEC_EVENT}/${encodeURIComponent('Downloadable Party Results')}/${province(code)}.csv`;

/** @param {string} code IEC province code @param {string} catB council code */
export function seatFileUrl(code, catB) {
  if (!isCouncilCode(catB)) throw new Error('unknown_council');
  return `${IEC_EVENT}/${encodeURIComponent('Seat Calculation Detail')}/${province(code)}/${catB}.xls`;
}

const withTimeout = (signal, ms) => {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

async function iecFetch(url, { fetchImpl, signal, method = 'GET' }) {
  const response = await fetchImpl(url, {
    method,
    signal,
    redirect: 'error',
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw Object.assign(new Error('upstream_unavailable'), {
      status: response.status,
    });
  }
  return response;
}

/**
 * The province file's Last-Modified time in ms, or null when it sends none.
 * @param {string} code
 * @returns {Promise<number|null>}
 */
export async function headProvince(
  code,
  { fetchImpl = defaultFetch, signal } = {},
) {
  const response = await iecFetch(provinceCsvUrl(code), {
    fetchImpl,
    signal: withTimeout(signal, HEAD_TIMEOUT_MS),
    method: 'HEAD',
  });
  await response.body?.cancel().catch(() => {});
  const ms = Date.parse(response.headers.get('last-modified') ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/** Lines of a decoded text stream without their "\n" or "\r\n"; a last unterminated line counts. */
async function* splitLines(text) {
  let carry = '';
  for await (const chunk of text) {
    const buffer = carry + chunk;
    let start = 0;
    for (
      let at = buffer.indexOf('\n');
      at >= 0;
      at = buffer.indexOf('\n', start)
    ) {
      yield buffer.slice(
        start,
        at > start && buffer.charCodeAt(at - 1) === 13 ? at - 1 : at,
      );
      start = at + 1;
    }
    carry = buffer.slice(start);
    if (carry.length > MAX_LINE_CHARS) throw new Error('csv_line_too_long');
  }
  if (carry.endsWith('\r')) carry = carry.slice(0, -1);
  if (carry !== '') yield carry;
}

/**
 * Streams one province CSV straight into the tally: bytes are counted as they arrive (80 MiB
 * cap), decoded, split into lines and aggregated. The body is never buffered whole or written
 * to disk. Any failure cancels the download.
 * @param {string} code
 * @returns {Promise<ProvinceTally>}
 */
export async function streamProvince(
  code,
  { fetchImpl = defaultFetch, signal } = {},
) {
  const combined = withTimeout(signal, CSV_TIMEOUT_MS);
  const response = await iecFetch(provinceCsvUrl(code), {
    fetchImpl,
    signal: combined,
  });
  const declared = Number(response.headers.get('content-length'));
  if (
    !response.body ||
    (Number.isFinite(declared) && declared > CSV_CAP_BYTES)
  ) {
    await response.body?.cancel().catch(() => {});
    throw response.body ? tooLarge() : new Error('upstream_unavailable');
  }
  let total = 0;
  const counted = new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > CSV_CAP_BYTES) controller.error(tooLarge());
      else controller.enqueue(chunk);
    },
  });
  const text = response.body
    .pipeThrough(counted, { signal: combined })
    .pipeThrough(new TextDecoderStream());
  return aggregateProvince(csvRecords(splitLines(text)));
}

/**
 * One council's seat calculation workbook (1 MiB cap, 60 s).
 * @param {string} code IEC province code
 * @param {string} catB council code
 * @returns {Promise<Uint8Array>}
 */
export async function fetchSeatFile(
  code,
  catB,
  { fetchImpl = defaultFetch, signal } = {},
) {
  const combined = withTimeout(signal, SEAT_TIMEOUT_MS);
  const response = await iecFetch(seatFileUrl(code, catB), {
    fetchImpl,
    signal: combined,
  });
  return readResponseBytesCapped(response, SEAT_CAP_BYTES, combined);
}
