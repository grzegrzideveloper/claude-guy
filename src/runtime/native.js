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
// appendSystemPrompt: extra system instructions (task context); initialPrompt: first message (new sessions).
function spawnSpec({ claudePath, resumeId, sessionId, cwd, appendSystemPrompt = null, initialPrompt = null }) {
  const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath);
  // cmd.exe re-parses the command line, so text passed through an npm .cmd shim loses characters that
  // cmd treats specially. claude.exe (native installer) gets the text unchanged.
  const safe = t => (isShim ? t.replace(/["%^&|<>!\r\n]/g, ' ') : t);
  const args = resumeId ? ['--resume', resumeId] : ['--session-id', sessionId];
  if (appendSystemPrompt) args.push('--append-system-prompt', safe(appendSystemPrompt));
  if (initialPrompt && !resumeId) args.push(safe(initialPrompt));
  let file = claudePath;
  let fileArgs = args;
  if (isShim) {
    // npm-installed shim; ConPTY needs a real executable.
    file = process.env.ComSpec || 'cmd.exe';
    fileArgs = ['/d', '/s', '/c', claudePath, ...args];
  }
  return { file, args: fileArgs, cwd, env: cleanEnv() };
}

// Does this claude accept --append-system-prompt in interactive mode? Checked once via `claude --help`.
function detectCaps(claudePath) {
  const { execFile } = require('child_process');
  return new Promise(resolve => {
    const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath);
    const file = isShim ? (process.env.ComSpec || 'cmd.exe') : claudePath;
    const args = isShim ? ['/d', '/s', '/c', claudePath, '--help'] : ['--help'];
    execFile(file, args, { timeout: 15000, env: cleanEnv(), windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      resolve({ appendSystemPrompt: out.includes('--append-system-prompt'), checked: !err || !!out });
    });
  });
}

module.exports = { name: 'native', claudeDir, projectsDir, cleanEnv, transcriptExists, spawnSpec, detectCaps, PARENT_SESSION_VARS };
