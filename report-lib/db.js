"use strict";
/**
 * Tiny JSON-file data store. Zero dependencies.
 * Loads the whole database into memory and persists atomically on change.
 * Volume is small (a couple of schools, a dozen reports a year) so this is
 * more than adequate and avoids any native database dependency.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const EMPTY = { schools: [], users: [], reports: [], meta: { version: 1 } };

let cache = null;
let writeQueue = Promise.resolve();

function load() {
  if (cache) return cache;
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      for (const k of Object.keys(EMPTY)) if (!(k in cache)) cache[k] = EMPTY[k];
    } catch (e) {
      // Corrupt file: back it up and start fresh rather than crash.
      try { fs.renameSync(DB_FILE, DB_FILE + ".corrupt-" + Date.now()); } catch (_) {}
      cache = JSON.parse(JSON.stringify(EMPTY));
    }
  } else {
    cache = JSON.parse(JSON.stringify(EMPTY));
  }
  return cache;
}

/** Persist current cache atomically (write temp then rename). Serialized. */
function save() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve) => {
        ensureDir();
        const tmp = DB_FILE + ".tmp-" + process.pid;
        fs.writeFile(tmp, snapshot, (err) => {
          if (err) return resolve();
          fs.rename(tmp, DB_FILE, () => resolve());
        });
      })
  );
  return writeQueue;
}

function id() {
  return crypto.randomUUID();
}

module.exports = { load, save, id, DATA_DIR, DB_FILE };
