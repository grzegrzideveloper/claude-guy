// Plan usage (5-hour session and weekly limits) — the same numbers as `/usage` in Claude Code.
// Uses Claude Code's OAuth token. Main process only: the token is never logged, stored or sent to the renderer.
// The endpoint is undocumented and may change; every failure ends as { ok: false, reason }.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test-only override (mock server). Normal runs always use the real endpoint.
const URL_USAGE = process.env.CLAUDE_GUI_USAGE_URL || 'https://api.anthropic.com/api/oauth/usage';

const LABELS = {
  five_hour: 'Sesja (5 h)',
  seven_day: 'Tydzień',
  seven_day_opus: 'Tydzień · Opus',
  seven_day_sonnet: 'Tydzień · Sonnet',
};
const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

function fromJson(text) {
  const j = JSON.parse(text);
  const o = j && j.claudeAiOauth;
  return o && o.accessToken ? { token: o.accessToken, expiresAt: o.expiresAt ? Number(o.expiresAt) : null } : null;
}

// macOS: Keychain item "Claude Code-credentials" (the first read may show a system prompt; it waits for the
// user, hence the long timeout). Everywhere: <claude dir>/.credentials.json as a fallback.
async function readToken(claudeDir) {
  if (process.platform === 'darwin') {
    try {
      const out = await run('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], 90000);
      const t = fromJson(out.trim());
      if (t) return t;
    } catch { /* not in the keychain, denied or timed out: try the file */ }
  }
  try {
    return fromJson(fs.readFileSync(path.join(claudeDir, '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function getUsage(claudeDir) {
  const cred = await readToken(claudeDir);
  if (!cred) return { ok: false, reason: 'Nie znaleziono logowania Claude Code. Uruchom `claude` i zaloguj się.' };
  if (cred.expiresAt && cred.expiresAt < Date.now()) {
    return { ok: false, reason: 'Token Claude Code wygasł. Odświeży się sam, gdy użyjesz Claude’a w dowolnej sesji.' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(URL_USAGE, {
      headers: { Authorization: `Bearer ${cred.token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'Serwer nie odpowiada.' : 'Brak połączenia z serwerem Anthropic.' };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Logowanie Claude Code wygasło. Uruchom `claude`, żeby je odświeżyć.' };
  if (!res.ok) return { ok: false, reason: `Serwer zwrócił błąd ${res.status} (endpoint jest nieoficjalny i mógł się zmienić).` };
  let data;
  try { data = await res.json(); } catch { return { ok: false, reason: 'Nieczytelna odpowiedź serwera.' }; }

  const windows = [];
  for (const [key, v] of Object.entries(data || {})) {
    if (!v || typeof v !== 'object' || typeof v.utilization !== 'number') continue;
    windows.push({
      key,
      label: LABELS[key] || key.replace(/_/g, ' '),
      pct: Math.max(0, Math.min(100, v.utilization)),
      resetsAt: v.resets_at ? Date.parse(v.resets_at) || null : null,
    });
  }
  windows.sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));
  if (!windows.length) return { ok: false, reason: 'Odpowiedź bez danych o limitach (endpoint mógł się zmienić).' };
  return { ok: true, windows, fetchedAt: Date.now() };
}

module.exports = { getUsage };
