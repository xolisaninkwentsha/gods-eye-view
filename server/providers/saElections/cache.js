// The sa-elections disk cache: small JSON files, each replaced whole by a rename.
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** A temp file `writeJsonAtomic` writes: `.<name>.<pid>.<12 hex>.tmp`. */
const tempName = (name) =>
  `.${name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
const TEMP_NAME = /^\..+\.\d+\.[0-9a-f]{12}\.tmp$/;

/**
 * Deletes the temp files left in `dir` by a process killed between write and rename: only
 * files named as `writeJsonAtomic` names its temps. Never throws.
 * @returns {Promise<number>} how many were deleted
 */
export async function removeOrphanTemps(fsImpl, dir) {
  let names;
  try {
    names = await fsImpl.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string' || !TEMP_NAME.test(name)) continue;
    try {
      // Neither forced nor recursive: a directory of that name is refused and left alone.
      await fsImpl.rm(path.join(dir, name));
      removed += 1;
    } catch {
      /* gone already, or not a file */
    }
  }
  return removed;
}

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
  const temp = path.join(dir, tempName(name));
  try {
    await fsImpl.mkdir(dir, { recursive: true });
    await fsImpl.writeFile(temp, JSON.stringify(value));
    await fsImpl.rename(temp, path.join(dir, name));
    return true;
  } catch (err) {
    console.warn(
      `[sa-elections] cache write ${name} failed: ${err?.message || err}`,
    );
    try {
      await fsImpl.rm?.(temp, { force: true });
    } catch {
      /* nothing to clean */
    }
    return false;
  }
}
