// The sa-elections disk cache: small JSON files, each replaced whole by a rename.
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Parsed JSON, or null when the file is missing or unreadable. */
export async function readJsonFile(fsImpl, file) {
  try {
    return JSON.parse(await fsImpl.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes `value` to a temp file in `dir`, then renames it over `dir/name`, so a crash mid-write
 * leaves the previous file whole. Never throws; a failed write is logged and its temp removed.
 * @returns {Promise<boolean>} whether the file landed
 */
export async function writeJsonAtomic(fsImpl, dir, name, value) {
  const temp = path.join(dir, `.${name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fsImpl.mkdir(dir, { recursive: true });
    await fsImpl.writeFile(temp, JSON.stringify(value));
    await fsImpl.rename(temp, path.join(dir, name));
    return true;
  } catch (err) {
    console.warn(`[sa-elections] cache write ${name} failed: ${err?.message || err}`);
    try {
      await fsImpl.rm?.(temp, { force: true });
    } catch {
      /* nothing to clean */
    }
    return false;
  }
}
