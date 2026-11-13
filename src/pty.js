// One PTY per tab. Output is coalesced briefly so a busy claude doesn't flood IPC.
const pty = require('@lydell/node-pty');

const ptys = new Map(); // tabId -> { proc, buf, timer }

function start(tabId, spec, { cols, rows }, onData, onExit) {
  kill(tabId);
  const proc = pty.spawn(spec.file, spec.args, {
    name: 'xterm-256color',
    cols: Math.max(2, cols | 0) || 120,
    rows: Math.max(2, rows | 0) || 30,
    cwd: spec.cwd,
    env: spec.env,
  });
  const entry = { proc, buf: '', timer: null };
  const flush = () => { entry.timer = null; if (entry.buf) { onData(entry.buf); entry.buf = ''; } };
  proc.onData(d => {
    entry.buf += d;
    if (!entry.timer) entry.timer = setTimeout(flush, 4);
  });
  proc.onExit(({ exitCode }) => {
    flush();
    if (ptys.get(tabId) === entry) ptys.delete(tabId);
    onExit(exitCode);
  });
  ptys.set(tabId, entry);
  return proc.pid;
}

function write(tabId, data) {
  const e = ptys.get(tabId);
  if (e) e.proc.write(data);
}

function resize(tabId, cols, rows) {
  const e = ptys.get(tabId);
  if (e && cols > 1 && rows > 1) { try { e.proc.resize(cols, rows); } catch { /* exited */ } }
}

function kill(tabId) {
  const e = ptys.get(tabId);
  if (!e) return;
  ptys.delete(tabId);
  try { e.proc.kill(); } catch { /* already gone */ }
}

function killAll() {
  for (const id of [...ptys.keys()]) kill(id);
}

module.exports = { start, write, resize, kill, killAll, count: () => ptys.size };
