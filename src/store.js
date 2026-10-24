// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/victron-vrm.json:
//
//   - `userId`        the VRM user of the token (users/me), and `tokenHash`, a
//                     short SHA-256 of the token, to read it again when the
//                     token changes (never the token itself);
//   - `sites`         the installations (users/{id}/installations) and when
//                     they were read (`sitesAt`);
//   - `states`        per installation: the energies of today, the forecast,
//                     the alarm log, when each reading ran, what the
//                     triggers know (`seen`);
//   - `accessRefused` why VRM refuses the token, or null (the trigger fires
//                     once per refusal);
//   - `lastError`     the last error of a reading (diagnostic).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'victron-vrm.json';
const EMPTY = () => ({
  userId: null,
  tokenHash: null,
  sites: [],
  sitesAt: 0,
  sitesTriedAt: 0,
  meAt: 0,
  states: {},
  accessRefused: null,
  lastError: null,
});

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a rename).
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const part = (value) => (value && typeof value === 'object' ? value : {});
      store.data.userId = Number.isInteger(raw.userId) ? raw.userId : null;
      store.data.tokenHash = typeof raw.tokenHash === 'string' ? raw.tokenHash : null;
      store.data.sites = Array.isArray(raw.sites)
        ? raw.sites.filter((site) => Number.isInteger(site?.id))
        : [];
      store.data.sitesAt = Number.isFinite(raw.sitesAt) ? raw.sitesAt : 0;
      store.data.sitesTriedAt = Number.isFinite(raw.sitesTriedAt) ? raw.sitesTriedAt : 0;
      store.data.meAt = Number.isFinite(raw.meAt) ? raw.meAt : 0;
      store.data.states = { ...part(raw.states) };
      store.data.accessRefused =
        raw.accessRefused && typeof raw.accessRefused === 'object' ? raw.accessRefused : null;
      store.data.lastError =
        raw.lastError && typeof raw.lastError === 'object' ? raw.lastError : null;
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, createStore };
