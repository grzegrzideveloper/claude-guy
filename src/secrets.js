// Secrets (ClickUp token, later Hubstaff) encrypted with Electron safeStorage (Keychain on macOS, DPAPI on Windows).
// Main process only. Values never go to the renderer, logs or plain JSON files.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

let file = null;
let cache = null;

function init(dataDir) {
  file = path.join(dataDir, 'secrets.bin');
}

// Test-only escape hatch for headless Linux without a keyring. Never set this in normal use.
const insecure = () => process.env.CLAUDE_GUI_INSECURE_SECRETS === '1';

function available() {
  return insecure() || safeStorage.isEncryptionAvailable();
}

function loadAll() {
  if (cache) return cache;
  cache = {};
  let raw;
  try { raw = fs.readFileSync(file); } catch { return cache; }
  try {
    const json = insecure() ? raw.toString('utf8') : safeStorage.decryptString(raw);
    cache = JSON.parse(json) || {};
  } catch {
    cache = {}; // unreadable (other machine / user): treat as empty
  }
  return cache;
}

function saveAll() {
  if (!available()) throw new Error('Brak bezpiecznego magazynu haseł w systemie.');
  const json = JSON.stringify(cache || {});
  const data = insecure() ? Buffer.from(json, 'utf8') : safeStorage.encryptString(json);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function get(key) { return loadAll()[key] || null; }

function set(key, value) {
  loadAll();
  if (value) cache[key] = value; else delete cache[key];
  saveAll();
}

module.exports = { init, available, get, set };
