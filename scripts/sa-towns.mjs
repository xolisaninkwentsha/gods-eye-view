// One-off generator for server/providers/saNews/sa-towns.json.
// Run by hand: node scripts/sa-towns.mjs
// then: npx prettier --write server/providers/saNews/sa-towns.json
// Downloads GeoNames ZA.zip into memory only; nothing but the JSON is written.
import { writeFileSync } from 'node:fs';
import https from 'node:https';
import { inflateRawSync } from 'node:zlib';

const URL_ZIP = 'https://download.geonames.org/export/dump/ZA.zip';
const OUT = new URL(
  '../server/providers/saNews/sa-towns.json',
  import.meta.url,
);
const MIN_POPULATION = 5000;
const MAX_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

// Throws unless the town count is plausible, so nothing is written.
function assertTownCount(n) {
  if (!(n >= 550 && n <= 650)) throw new Error(`unexpected town count ${n}`);
}

// TLS stays on. https.get does not follow redirects and any non-200 rejects,
// so a 3xx is refused (the equivalent of redirect: 'error').
function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'GodsEyeView (sa-news)' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('download exceeds size cap'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
  });
}

// Reads sizes from the central directory: a local header may carry zeros when
// the entry uses a data descriptor.
function readZipEntry(zip, wanted) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50)
      throw new Error('bad central header');
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      if (zip.readUInt32LE(local) !== 0x04034b50)
        throw new Error('bad local header');
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return data;
      // ZA.txt unpacks to about 12 MB; a far larger entry is refused.
      if (method === 8)
        return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
      throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} not in zip`);
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

const text = readZipEntry(await download(URL_ZIP), 'ZA.txt').toString('utf8');
const byName = new Map();
for (const line of text.split('\n')) {
  const f = line.split('\t');
  if (f.length < 15 || f[6] !== 'P') continue;
  const population = Number(f[14]);
  const name = f[1].trim();
  const lat = round4(Number(f[4]));
  const lon = round4(Number(f[5]));
  if (
    !name ||
    !(population >= MIN_POPULATION) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    continue;
  }
  const seen = byName.get(name);
  if (!seen || population > seen.population)
    byName.set(name, { name, lat, lon, population });
}
const towns = [...byName.values()].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
);
assertTownCount(towns.length);
writeFileSync(
  OUT,
  JSON.stringify({
    source: 'GeoNames (geonames.org), CC BY 4.0',
    generated: new Date().toISOString().slice(0, 10),
    towns,
  }),
);
console.log(`${towns.length} towns`);
