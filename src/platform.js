// OS differences: login-shell env on macOS, locating the `claude` binary, safe link opening.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// Apps started from Finder/Dock get a minimal PATH, without what .zshrc/.zprofile add.
// Ask the user's login shell for its environment once at startup and merge PATH.
function loadLoginShellEnv(log = () => {}) {
  if (isWin) return;
  const shell = process.env.SHELL || (isMac ? '/bin/zsh' : '/bin/bash');
  const mark = '__CLAUDE_GUI_ENV__';
  try {
    const r = spawnSync(shell, ['-ilc', `printf '${mark}'; env -0; printf '${mark}'`], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const out = r.stdout || '';
    const a = out.indexOf(mark), b = out.lastIndexOf(mark);
    if (a < 0 || b <= a) { log(`login shell env: no output (${r.error ? r.error.message : 'status ' + r.status})`); return; }
    const env = {};
    for (const kv of out.slice(a + mark.length, b).split('\0')) {
      const i = kv.indexOf('=');
      if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
    }
    if (env.PATH) {
      // Keep the current PATH first (a terminal launch already has the right one), append what's missing.
      const merged = [...(process.env.PATH || '').split(':'), ...env.PATH.split(':')].filter(Boolean);
      process.env.PATH = [...new Set(merged)].join(':');
    }
    for (const k of ['LANG', 'LC_ALL', 'LC_CTYPE']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  } catch (err) {
    log(`login shell env failed: ${err.message}`);
  }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// Returns the absolute path of the claude executable, or null.
function findClaude() {
  const home = os.homedir();
  if (isWin) {
    const r = spawnSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true });
    const hits = (r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const pick = hits.find(h => /\.exe$/i.test(h)) || hits.find(h => /\.(cmd|bat)$/i.test(h));
    if (pick) return pick;
    const fallback = path.join(home, '.local', 'bin', 'claude.exe');
    return isFile(fallback) ? fallback : null;
  }
  const dirs = [
    ...(process.env.PATH || '').split(':'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, 'claude');
    try { fs.accessSync(p, fs.constants.X_OK); if (isFile(p)) return p; } catch { /* next */ }
  }
  return null;
}

function isHttpsUrl(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

const terminalFont = isMac
  ? '"SF Mono", Menlo, Monaco, monospace'
  : isWin ? '"Cascadia Mono", "Cascadia Code", Consolas, monospace'
  : '"DejaVu Sans Mono", "Liberation Mono", monospace';

module.exports = { isMac, isWin, loadLoginShellEnv, findClaude, isHttpsUrl, terminalFont };
