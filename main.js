// Main process: window, menu, PTYs, IPC, transcript watching, shutdown.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const platform = require('./src/platform');
const store = require('./src/store');
const sessions = require('./src/sessions');
const pty = require('./src/pty');
const { getRuntime } = require('./src/runtime');

const HEADLESS = process.env.CLAUDE_GUI_HEADLESS === '1' || process.argv.includes('--claude-gui-headless');
const SHOT = process.env.CLAUDE_GUI_SHOT ? JSON.parse(process.env.CLAUDE_GUI_SHOT) : null; // { out, width, height }
// Test-only: let a headless screenshot run spawn PTYs (point PATH at a fake `claude`).
const SHOT_SPAWN = !!SHOT && process.env.CLAUDE_GUI_SHOT_SPAWN === '1';

app.setName('claude-gui');
app.setPath('userData', process.env.CLAUDE_GUI_DATA_DIR || path.join(app.getPath('appData'), 'claude-gui'));
store.init(app.getPath('userData'));

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
    win.webContents.on('will-navigate', e => e.preventDefault());
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
    store.save(name, data);
    return true;
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
