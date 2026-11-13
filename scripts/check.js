// Syntax check for every project JS file (node --check checks only its first argument).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'dist', 'out', '.git', 'docs']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(c?js|mjs)$/.test(e.name)) files.push(p);
  }
})(root);

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (err) { failed++; process.stderr.write(err.stderr.toString()); }
}
console.log(`${files.length - failed}/${files.length} OK`);
process.exit(failed ? 1 : 0);
