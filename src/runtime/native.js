// Native runtime: claude runs directly on this OS (macOS or Windows).
// Everything about *where* claude runs and *where* its transcripts live is in this file,
// so a future `wsl` runtime can implement the same interface.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Vars a parent Claude Code session passes to its children. If they reach claude in a tab,
// it shows "Transcript saving is off" and the session can't be resumed.
const PARENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_PARENT_SESSION_ID',
  'CLAUDE_AGENT_SDK_VERSION',
];

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function projectsDir() {
  return path.join(claudeDir(), 'projects');
}

function cleanEnv(base = process.env) {
  const env = { ...base };
  for (const k of PARENT_SESSION_VARS) delete env[k];
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

// Is there a transcript for this session id?
function transcriptExists(sessionId) {
  const dir = projectsDir();
  let subdirs;
  try { subdirs = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  return subdirs.some(d => d.isDirectory() && fs.existsSync(path.join(dir, d.name, `${sessionId}.jsonl`)));
}

// What to spawn in a PTY. Exactly one of resumeId / sessionId.
function spawnSpec({ claudePath, resumeId, sessionId, cwd }) {
  const args = resumeId ? ['--resume', resumeId] : ['--session-id', sessionId];
  let file = claudePath;
  let fileArgs = args;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath)) {
    // npm-installed shim; ConPTY needs a real executable.
    file = process.env.ComSpec || 'cmd.exe';
    fileArgs = ['/d', '/s', '/c', claudePath, ...args];
  }
  return { file, args: fileArgs, cwd, env: cleanEnv() };
}

module.exports = { name: 'native', claudeDir, projectsDir, cleanEnv, transcriptExists, spawnSpec, PARENT_SESSION_VARS };
