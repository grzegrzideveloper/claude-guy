// Main process: window, menu, PTYs, IPC, transcript watching, shutdown.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const platform = require('./src/platform');
const store = require('./src/store');
const sessions = require('./src/sessions');
const pty = require('./src/pty');
const secrets = require('./src/secrets');
const clickup = require('./src/clickup');
const { getRuntime } = require('./src/runtime');

const HEADLESS = process.env.CLAUDE_GUI_HEADLESS === '1' || process.argv.includes('--claude-gui-headless');
const SHOT = process.env.CLAUDE_GUI_SHOT ? JSON.parse(process.env.CLAUDE_GUI_SHOT) : null; // { out, width, height }
// Test-only: let a headless screenshot run spawn PTYs (point PATH at a fake `claude`).
const SHOT_SPAWN = !!SHOT && process.env.CLAUDE_GUI_SHOT_SPAWN === '1';

app.setName('claude-gui');
app.setPath('userData', process.env.CLAUDE_GUI_DATA_DIR || path.join(app.getPath('appData'), 'claude-gui'));
store.init(app.getPath('userData'));
secrets.init(store.dir);

const logFile = path.join(store.dir, 'claude-gui.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  if (!app.isPackaged) process.stdout.write(line);
}

if (!HEADLESS && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  let win = null;
  let quitting = false;
  let claudePath = null;

  const settings = () => {
    const s = { runtime: 'native', taskPrefix: 'DEV', ...store.load('settings', {}) };
    if (!/^[A-Za-z][A-Za-z0-9]{0,9}$/.test(s.taskPrefix)) s.taskPrefix = 'DEV';
    return s;
  };
  const runtime = () => getRuntime(settings().runtime);

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  function buildMenu() {
    if (!platform.isMac) { Menu.setApplicationMenu(null); return; }
    // macOS needs a menu for Cmd+C/V/A/Q. No View menu, so no Cmd+R reload.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    ]));
  }

  function createWindow() {
    win = new BrowserWindow({
      width: SHOT ? SHOT.width : 1400,
      height: SHOT ? SHOT.height : 900,
      minWidth: 800,
      minHeight: 500,
      show: !HEADLESS,
      backgroundColor: '#1a1a1a',
      title: 'Claude GUI',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: !!SHOT,
      },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (platform.isHttpsUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => { log(`blocked navigation: ${url}`); e.preventDefault(); });

    // Diagnostics: renderer warnings/errors and crashes go to the log.
    // Single-argument listener: Electron passes an event object with level/message/lineNumber/sourceId
    // (declaring the old positional arguments prints a deprecation warning).
    win.webContents.on('console-message', d => {
      if (d.level === 'warning' || d.level === 'error') log(`renderer ${d.level}: ${d.message} (${path.basename(String(d.sourceId || ''))}:${d.lineNumber})`);
    });
    win.webContents.on('render-process-gone', (_e, details) => log(`renderer gone: ${details.reason} (${details.exitCode})`));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => log(`load failed: ${code} ${desc} ${url}`));

    // Cmd+Option+I / Ctrl+Shift+I / F12: DevTools. Cmd/Ctrl+Shift+R: reload the UI (terminals keep running in main;
    // restored tabs re-attach by restarting claude --resume).
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      // input.code (physical key), not input.key: on macOS Option changes the character (Option+I gives "ˆ").
      const k = input.code;
      const mod = platform.isMac ? input.meta : input.control;
      if (k === 'F12' || (k === 'KeyI' && ((platform.isMac && input.meta && input.alt) || (!platform.isMac && input.control && input.shift)))) {
        e.preventDefault();
        win.webContents.toggleDevTools();
      } else if (k === 'KeyR' && mod && input.shift) {
        e.preventDefault();
        log('ui reload (shortcut)');
        pty.killAll();
        win.webContents.reload();
      }
    });
    win.on('closed', () => { win = null; });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    if (SHOT) win.webContents.once('did-finish-load', takeScreenshot);
  }

  async function takeScreenshot() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    try {
      await wait(1500);
      if (process.env.SHOT_JS) {
        await win.webContents.executeJavaScript(process.env.SHOT_JS);
        await wait(300);
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SHOT.out, img.toPNG());
      console.log(`screenshot: ${SHOT.out}`);
    } catch (err) {
      console.error(`screenshot failed: ${err.message}`);
    }
    app.exit(0);
  }

  const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

  // --- transcript watching ---
  function watchProjects() {
    const dir = runtime().projectsDir();
    let timer = null;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => send('sessions:changed'), 1500); };
    try {
      fs.watch(dir, { recursive: true }, changed).on('error', err => log(`watch error: ${err.message}`));
    } catch (err) {
      // Directory missing (no sessions yet) or watch unsupported: poll instead.
      log(`watch ${dir} failed (${err.message}), polling`);
      let last = 0;
      setInterval(() => {
        let m = 0;
        try { m = fs.statSync(dir).mtimeMs; } catch { /* still missing */ }
        if (m !== last) { last = m; send('sessions:changed'); }
      }, 10000);
    }
  }

  // --- IPC ---
  const STORE_NAMES = new Set(['groups', 'tabs', 'settings']);

  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    headless: HEADLESS,
    terminalFont: platform.terminalFont,
    claudeFound: !!claudePath,
    taskPrefix: settings().taskPrefix,
  }));

  ipcMain.handle('sessions:list', () =>
    sessions.listSessions({ projectsDir: runtime().projectsDir(), taskPrefix: settings().taskPrefix, limit: 500 }));

  ipcMain.handle('store:get', (_e, name) => {
    if (!STORE_NAMES.has(name)) throw new Error('unknown store');
    if (name === 'tabs') {
      if (HEADLESS) return { tabs: [], active: null };
      const t = store.load('tabs', { tabs: [], active: null });
      // A session becomes resumable only after its first prompt; drop tabs without a transcript.
      t.tabs = (t.tabs || []).filter(x => x && x.sessionId && runtime().transcriptExists(x.sessionId));
      return t;
    }
    return store.load(name, name === 'groups' ? { categories: [], assignments: {}, titles: {}, collapsed: [] } : {});
  });

  ipcMain.handle('store:save', (_e, name, data) => {
    if (!STORE_NAMES.has(name)) throw new Error('unknown store');
    if (name === 'tabs' && (HEADLESS || quitting)) return false; // PTYs dying at shutdown must not empty the list
    if (name === 'settings') {
      // `clickup` (user, workspace) is owned by main; the renderer can't overwrite it.
      const cur = store.load('settings', {});
      data = { ...data, clickup: cur.clickup || null };
    }
    store.save(name, data);
    return true;
  });

  // --- ClickUp (token stays in main) ---
  let pendingToken = null; // verified by clickup:connect, written by clickup:save
  let pendingTeams = [];
  let cuInflight = null;
  const cuSettings = () => store.load('settings', {}).clickup || null;
  const cuToken = () => secrets.get('clickupToken');
  const errOut = err => ({ ok: false, error: err.message || String(err), status: err.status || 0 });

  ipcMain.handle('clickup:status', () => {
    const c = cuSettings();
    return {
      secureStorage: secrets.available(),
      configured: !!(cuToken() && c && c.teamId && c.userId),
      user: c ? { username: c.username, email: c.email } : null,
      teamId: c ? c.teamId : null,
      teamName: c ? c.teamName : null,
    };
  });

  ipcMain.handle('clickup:connect', async (_e, token) => {
    token = String(token || '').trim();
    if (!token) return { ok: false, error: 'Wklej token API.' };
    if (!secrets.available()) return { ok: false, error: 'System nie udostępnia bezpiecznego magazynu haseł, więc token nie może zostać zapisany.' };
    try {
      const user = await clickup.getUser(token);
      const teams = await clickup.getTeams(token);
      if (!teams.length) return { ok: false, error: 'To konto nie ma dostępu do żadnego workspace\u2019u.' };
      pendingToken = token;
      pendingTeams = teams;
      log(`clickup: connected as user ${user.id}, ${teams.length} workspace(s)`);
      return { ok: true, user: { username: user.username, email: user.email }, teams, userId: user.id };
    } catch (err) {
      log(`clickup connect failed: ${err.message}`);
      return errOut(err);
    }
  });

  ipcMain.handle('clickup:save', async (_e, { teamId }) => {
    if (!pendingToken) return { ok: false, error: 'Najpierw połącz się z ClickUp.' };
    const team = pendingTeams.find(t => t.id === String(teamId));
    if (!team) return { ok: false, error: 'Wybierz workspace.' };
    try {
      const user = await clickup.getUser(pendingToken);
      secrets.set('clickupToken', pendingToken);
      const st = store.load('settings', {});
      const prev = st.clickup || {};
      st.clickup = {
        userId: user.id, username: user.username, email: user.email,
        teamId: team.id, teamName: team.name,
        hiddenStatuses: prev.hiddenStatuses || ['closed'],
      };
      st.clickupWorkspaceId = team.id;
      store.save('settings', st);
      store.save('clickup-tasks', { tasks: [], fetchedAt: null });
      pendingToken = null;
      pendingTeams = [];
      return { ok: true };
    } catch (err) {
      return errOut(err);
    }
  });

  ipcMain.handle('clickup:disconnect', () => {
    secrets.set('clickupToken', null);
    const st = store.load('settings', {});
    st.clickup = null; // keep clickupWorkspaceId: links to tasks still work
    store.save('settings', st);
    store.save('clickup-tasks', { tasks: [], fetchedAt: null });
    return { ok: true };
  });

  // Cached for 2 minutes unless force. A second call while fetching joins the running one.
  ipcMain.handle('clickup:tasks', async (_e, { force = false } = {}) => {
    const c = cuSettings();
    const token = cuToken();
    const cache = store.load('clickup-tasks', { tasks: [], fetchedAt: null });
    if (!token || !c || !c.teamId) return { configured: false, tasks: [], fetchedAt: null };
    if (!force && cache.fetchedAt && Date.now() - cache.fetchedAt < 2 * 60 * 1000) return { configured: true, ...cache };
    if (!cuInflight) {
      cuInflight = clickup.getMyTasks(token, { teamId: c.teamId, userId: c.userId, hiddenStatuses: c.hiddenStatuses || ['closed'] })
        .then(tasks => {
          const data = { tasks, fetchedAt: Date.now() };
          store.save('clickup-tasks', data);
          return { configured: true, ...data };
        })
        .catch(err => {
          log(`clickup tasks failed: ${err.message}`);
          return { configured: true, ...cache, error: err.message, errorStatus: err.status || 0 };
        })
        .finally(() => { cuInflight = null; });
    }
    return cuInflight;
  });

  ipcMain.handle('session:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Folder dla nowej sesji' });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('session:newId', () => crypto.randomUUID());

  // Start claude in a PTY for a tab. isNew → --session-id, otherwise --resume.
  ipcMain.handle('session:start', (_e, { tabId, sessionId, cwd, isNew, cols, rows }) => {
    if (HEADLESS && !SHOT_SPAWN) return { ok: false, error: 'headless' };
    if (!/^[0-9a-f-]{36}$/i.test(sessionId || '')) return { ok: false, error: 'Nieprawidłowe ID sesji' };
    if (!claudePath) claudePath = platform.findClaude();
    if (!claudePath) return { ok: false, error: 'Nie znaleziono programu `claude`. Zainstaluj Claude Code i uruchom apkę ponownie.' };
    try {
      if (!fs.statSync(cwd).isDirectory()) throw new Error();
    } catch {
      return { ok: false, error: `Folder nie istnieje: ${cwd}` };
    }
    const spec = runtime().spawnSpec(isNew ? { claudePath, sessionId, cwd } : { claudePath, resumeId: sessionId, cwd });
    try {
      const pid = pty.start(tabId, spec, { cols, rows },
        data => send('pty:data', tabId, data),
        code => send('pty:exit', tabId, code));
      log(`start ${isNew ? 'new' : 'resume'} ${sessionId} pid=${pid} cwd=${cwd}`);
      return { ok: true };
    } catch (err) {
      log(`spawn failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('pty:write', (_e, tabId, data) => pty.write(tabId, data));
  ipcMain.on('pty:resize', (_e, tabId, cols, rows) => pty.resize(tabId, cols, rows));
  ipcMain.on('pty:kill', (_e, tabId) => pty.kill(tabId));

  ipcMain.handle('open:external', (_e, url) => {
    if (!platform.isHttpsUrl(url)) return false;
    shell.openExternal(url);
    return true;
  });
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
  ipcMain.handle('clipboard:read', () => ({ text: clipboard.readText(), hasImage: !clipboard.readImage().isEmpty() }));

  // --- lifecycle ---
  function shutdown() {
    if (quitting) return;
    quitting = true;
    pty.killAll();
  }
  app.on('before-quit', shutdown);
  app.on('window-all-closed', () => { shutdown(); app.quit(); }); // also on macOS: closing the window ends the app
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { shutdown(); app.exit(0); });

  app.whenReady().then(() => {
    platform.loadLoginShellEnv(log);
    claudePath = platform.findClaude();
    log(`start: platform=${process.platform} claude=${claudePath || 'NOT FOUND'} data=${store.dir} headless=${HEADLESS}`);
    buildMenu();
    createWindow();
    watchProjects();
  });
}
