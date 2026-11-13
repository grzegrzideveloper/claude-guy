// Atomic JSON storage in the app's data directory.
const fs = require('fs');
const path = require('path');

let dataDir = null;

function init(dir) {
  dataDir = dir;
  fs.mkdirSync(dataDir, { recursive: true });
}

function file(name) {
  if (!dataDir) throw new Error('store not initialised');
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`bad store name: ${name}`);
  return path.join(dataDir, `${name}.json`);
}

function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function save(name, data) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  // On Windows a rename can briefly fail while another process (e.g. antivirus) holds the file.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, target); return; }
    catch (err) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) { try { fs.unlinkSync(tmp); } catch {} throw err; }
      const until = Date.now() + 50 * (i + 1);
      while (Date.now() < until) { /* short sync wait */ }
    }
  }
}

module.exports = { init, load, save, get dir() { return dataDir; } };
