// Lists Claude Code sessions by parsing transcripts locally. Never reads whole files, never spends tokens.
const fs = require('fs');
const path = require('path');

const HEAD = 64 * 1024;
const TAIL = 64 * 1024;

function readRange(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n).toString('utf8');
}

// Parse JSONL text; partial lines at the cut edges simply fail to parse and are skipped.
function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* cut line */ }
  }
  return out;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // tool results are not prompts
    if (content.some(c => c && c.type === 'tool_result')) return '';
    return content.filter(c => c && c.type === 'text').map(c => c.text).join('\n');
  }
  return '';
}

const NOT_A_PROMPT = /^\s*(<command-name>|<command-message>|<local-command-|<system-reminder>|Caveat:|\[Request interrupted)/;

function firstPrompt(entries) {
  for (const e of entries) {
    if (e.type !== 'user' || e.isMeta || e.isSidechain || !e.message) continue;
    const t = textOf(e.message.content).trim();
    if (t && !NOT_A_PROMPT.test(t)) return t;
  }
  return '';
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function taskRegex(prefix) {
  return new RegExp(`(?:^|[^A-Za-z0-9])(${escapeRe(prefix)})-(\\d+)`, 'i');
}

function findTask(text, prefix) {
  if (!text) return null;
  const m = taskRegex(prefix).exec(text);
  return m ? `${prefix.toUpperCase()}-${m[2]}` : null;
}

function projectOf(cwd) {
  return cwd.split(/[\\/]+/).filter(Boolean).pop() || cwd;
}

function oneLine(s, max = 200) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function parseSession(file, stat, taskPrefix) {
  const fd = fs.openSync(file, 'r');
  let head, tail = [];
  try {
    head = parseLines(readRange(fd, 0, HEAD));
    if (stat.size > HEAD) tail = parseLines(readRange(fd, Math.max(HEAD, stat.size - TAIL), TAIL));
  } finally {
    fs.closeSync(fd);
  }

  const prompt = firstPrompt(head);
  let cwd = '', slug = '', branch = '', branchTask = null;
  for (const e of [...head, ...tail]) {
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (!slug && typeof e.slug === 'string') slug = e.slug;
    if (typeof e.gitBranch === 'string' && e.gitBranch && e.gitBranch !== 'HEAD') {
      branch = e.gitBranch; // the last one wins: sessions often switch to the task branch later
      branchTask = findTask(e.gitBranch, taskPrefix) || branchTask;
    }
  }
  const title = prompt ? oneLine(prompt) : slug;
  if (!title || !cwd) return null;

  return {
    id: path.basename(file, '.jsonl'),
    title,
    cwd,
    project: projectOf(cwd),
    mtime: stat.mtimeMs,
    task: findTask(prompt, taskPrefix) || branchTask,
    branch,
  };
}

function listSessions({ projectsDir, limit = 200, taskPrefix = 'DEV' } = {}) {
  let dirs;
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { return []; }

  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(projectsDir, d.name);
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl') || n.startsWith('agent-')) continue;
      const f = path.join(dir, n);
      try {
        const st = fs.statSync(f);
        if (st.isFile() && st.size > 0) files.push({ f, st });
      } catch { /* vanished */ }
    }
  }
  files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);

  const out = [];
  for (const { f, st } of files) {
    if (out.length >= limit) break;
    try {
      const s = parseSession(f, st, taskPrefix);
      if (s) out.push(s);
    } catch { /* unreadable transcript, skip */ }
  }
  return out;
}

module.exports = { listSessions, findTask, projectOf };
