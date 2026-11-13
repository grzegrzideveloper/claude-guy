// App state and startup.
const App = {
  info: null,
  sessions: [],
  groups: null,
  settings: { taskPrefix: 'DEV', clickupWorkspaceId: null },
  // ClickUp state (no token here, ever): status from main + cached tasks.
  clickup: { status: { configured: false }, tasks: [], fetchedAt: null, error: null, loading: false },
  filter: '',
  loaded: false,

  titleOf(s) { return this.groups.titles[s.id] || s.title; },
  sessionById(id) { return this.sessions.find(s => s.id === id); },
  saveGroups() { return api.storeSave('groups', this.groups); },

  // Stage 3, once: give every session without a status one. Open or recently used → In progress,
  // the rest → Completed. Statuses set earlier stay. Can be undone from the notification.
  migrateV3() {
    if (this.groups.v3) return;
    const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
    const changed = [];
    for (const s of this.sessions) {
      if (this.groups.assignments[s.id]) continue;
      const st = Tabs.has(s.id) || s.mtime >= cutoff ? 'in_progress' : 'completed';
      this.groups.assignments[s.id] = `status:${st}`;
      changed.push(s.id);
    }
    this.groups.v3 = true;
    this.saveGroups();
    Sidebar.render();
    if (!changed.length) return;
    const done = changed.filter(id => this.groups.assignments[id] === 'status:completed').length;
    Toasts.show({
      text: `Uporządkowano sesje bez statusu: ${done} starszych → Completed, ${changed.length - done} ostatnich lub otwartych → In progress.`,
      action: { label: 'Cofnij', onClick: () => {
        for (const id of changed) delete this.groups.assignments[id];
        this.saveGroups();
        Sidebar.render();
      } },
      timeout: 30000,
    });
  },

  async openSettings() {
    const v = await Dialogs.settings(this.settings, this.clickup.status);
    if (!v) return;
    if (v.action === 'clickup-setup') return this.setupClickup();
    if (v.action === 'clickup-disconnect') {
      const ok = await Dialogs.ask({ title: 'Odłączyć ClickUp?', text: 'Token zostanie usunięty z tego komputera, a zakładka Taski będzie pusta. Linki do tasków zostaną.', ok: 'Odłącz' });
      if (!ok) return;
      await api.clickupDisconnect();
      await this.reloadSettings();
      this.clickup = { ...this.clickup, status: await api.clickupStatus(), tasks: [], fetchedAt: null, error: null };
      Sidebar.render();
      return;
    }
    const prefixChanged = v.settings.taskPrefix !== this.settings.taskPrefix;
    this.settings = v.settings;
    await api.storeSave('settings', v.settings);
    if (prefixChanged) await this.loadSessions(); // main re-parses tasks with the new prefix
    else Sidebar.render();
  },

  async reloadSettings() {
    this.settings = { ...this.settings, ...(await api.storeGet('settings')) };
  },

  async saveSettings() { await api.storeSave('settings', this.settings); },

  // --- ClickUp ---
  async setupClickup() {
    const ok = await Dialogs.clickupSetup();
    if (!ok) return;
    await this.reloadSettings();
    this.clickup.status = await api.clickupStatus();
    Toasts.show({ text: `Połączono z ClickUp: ${this.clickup.status.teamName}. Twoje taski są w zakładce Taski.`, timeout: 8000 });
    Sidebar.setTab('tasks');
    await this.loadClickup({ force: true });
  },

  // First start: ask once whether to set up ClickUp.
  async onboarding() {
    const ob = this.settings.onboarding || {};
    if (ob.clickupAsked || this.clickup.status.configured || this.info.headless) return;
    this.settings.onboarding = { ...ob, clickupAsked: true };
    await this.saveSettings();
    const yes = await Dialogs.ask({
      title: 'Skonfigurować ClickUp?',
      text: ['Po połączeniu zakładka Taski pokaże taski przypisane do Ciebie (bez statusu Closed), pogrupowane wg projektu. Z każdego taska otworzysz sesję Claude\u2019a.',
        'Potrzebny będzie Twój osobisty token API ClickUp. Możesz to też zrobić później w Ustawieniach.'],
      ok: 'Tak, skonfiguruj', cancel: 'Nie teraz',
    });
    if (yes) await this.setupClickup();
  },

  async loadClickup({ force = false } = {}) {
    if (!this.clickup.status.configured) return;
    this.clickup.loading = true;
    Sidebar.render();
    const r = await api.clickupTasks({ force });
    this.clickup.loading = false;
    if (r.configured === false) {
      this.clickup.status = await api.clickupStatus();
    } else {
      this.clickup.tasks = r.tasks || [];
      this.clickup.fetchedAt = r.fetchedAt;
      this.clickup.error = r.error || null;
    }
    Sidebar.render();
  },

  // ClickUp task by our task key (custom id like DEV-123, or the raw id).
  cuTask(key) {
    if (!key) return null;
    const k = key.toUpperCase();
    return this.clickup.tasks.find(t => (t.customId && t.customId.toUpperCase() === k) || t.id.toUpperCase() === k) || null;
  },

  cuKey(t) { return t.customId || t.id; },

  // Folder suggestion for a new session from a task: last folder used for the same ClickUp list,
  // then the newest session of this task, then the last folder used in the same ClickUp folder
  // (lists in one folder are often different repos, so that one comes last). Never chosen silently.
  suggestFolder(t) {
    const f = this.settings.folders || {};
    if (t.list && f.list && f.list[t.list.id]) return f.list[t.list.id];
    const own = this.sessions.find(s => (Groups.taskOf(s) || '').toUpperCase() === this.cuKey(t).toUpperCase());
    if (own) return own.cwd;
    if (t.folder && f.folder && f.folder[t.folder.id]) return f.folder[t.folder.id];
    return null;
  },

  async rememberFolder(t, cwd) {
    const f = this.settings.folders || { list: {}, folder: {} };
    f.list = f.list || {};
    f.folder = f.folder || {};
    if (t.list) f.list[t.list.id] = cwd;
    if (t.folder) f.folder[t.folder.id] = cwd;
    this.settings.folders = f;
    await this.saveSettings();
  },

  showTaskSessions(key) {
    const f = $('#filter');
    f.value = key;
    this.filter = key;
    Sidebar.setTab('sessions');
  },

  async newSessionFromTask(t) {
    const key = this.cuKey(t);
    const r = await Tabs.newSession({ cwd: this.suggestFolder(t), name: `${key} ${t.name}`.slice(0, 200), suggested: true });
    if (r) await this.rememberFolder(t, r.cwd);
  },

  // Right-click menu for a session (sidebar row or tab). opts.tabId when opened from a tab.
  sessionMenu(s, x, y, { tabId } = {}) {
    const task = Groups.taskOf(s);
    const url = Groups.taskUrl(task);
    const cur = Groups.statusOf(s);
    const items = [
      { label: Tabs.has(s.id) ? 'Pokaż zakładkę' : 'Otwórz', onClick: () => Tabs.open(s) },
      { label: 'Zmień nazwę…', onClick: () => this.renameSession(s) },
    ];
    if (this.groups.titles[s.id]) items.push({ label: 'Przywróć oryginalną nazwę', onClick: () => this.setTitle(s, null) });
    items.push({ label: 'Kopiuj ID sesji', onClick: () => api.clipboardWrite(s.id) });
    items.push({ label: 'Nowa sesja w tym folderze…', onClick: () => Tabs.newSession({ cwd: s.cwd, name: task ? `${task} ` : '' }) });
    if (task) items.push({ label: `Otwórz ${task} w ClickUp`, disabled: !url, hint: url ? '' : 'brak ID workspace\u2019u', onClick: () => api.openExternal(url) });
    items.push('-', { header: 'Status' });
    for (const st of Groups.allStatuses()) {
      items.push({ label: st.name, color: st.color, hint: cur && cur.id === st.id ? '✓' : '', onClick: () => Groups.setStatus(s, st.id) });
    }
    if (tabId) items.push('-', { label: 'Zamknij zakładkę…', onClick: () => Tabs.requestClose(tabId) });
    CtxMenu.show(x, y, items);
  },

  async renameSession(s) {
    const v = await Dialogs.promptName({
      title: 'Zmień nazwę sesji',
      value: this.titleOf(s),
      hint: `Nazwa tylko w tej apce, transkrypt Claude'a się nie zmienia. Wpisz np. ${this.settings.taskPrefix}-123, żeby przypisać task.`,
      ok: 'Zapisz',
    });
    if (v) this.setTitle(s, v === s.title ? null : v);
  },

  setTitle(s, name) {
    if (name) this.groups.titles[s.id] = name.slice(0, 200);
    else delete this.groups.titles[s.id];
    this.saveGroups();
    Sidebar.render();
    Tabs.refreshLabels();
  },

  async loadSessions() {
    this.sessions = await api.listSessions();
    this.loaded = true;
    Sidebar.render();
    Tabs.refreshLabels();
  },

  async init() {
    this.info = await api.info();
    document.body.classList.add(`os-${this.info.platform}`);
    $('#claude-missing').hidden = this.info.claudeFound || this.info.headless;
    this.groups = Groups.normalize(await api.storeGet('groups'));
    this.settings = { ...this.settings, ...(await api.storeGet('settings')) };

    Sidebar.render();
    await this.loadSessions();
    await Tabs.restore();
    this.migrateV3();

    this.clickup.status = await api.clickupStatus();
    this.loadClickup(); // cached (2 min) unless stale
    setInterval(() => this.loadClickup({ force: true }), 10 * 60 * 1000);
    this.onboarding();

    api.onPtyData((id, data) => { const t = Tabs.tabs.get(id); if (t) t.term.write(data); });
    api.onPtyExit((id, code) => Tabs.onExit(id, code));
    api.onSessionsChanged(() => this.loadSessions());

    const filter = $('#filter');
    filter.addEventListener('input', debounce(() => { App.filter = filter.value; Sidebar.render(); }, 120));
    filter.addEventListener('keydown', e => { if (e.key === 'Escape') { filter.value = ''; App.filter = ''; Sidebar.render(); } });
    $('#btn-new').onclick = () => Tabs.newSession();
    $('#btn-status').onclick = () => Dialogs.manageStatuses();
    for (const b of document.querySelectorAll('.sb-tab')) b.onclick = () => Sidebar.setTab(b.dataset.tab);
    $('#btn-settings').onclick = () => this.openSettings();

    new ResizeObserver(debounce(() => Tabs.fitActive(), 50)).observe($('#terminals'));
    setInterval(() => Sidebar.render(), 60000); // keep relative times fresh
  },
};

// Unhandled errors end up in the app log via main's console-message handler.
window.addEventListener('error', e => console.error(`Uncaught: ${e.message} @ ${e.filename}:${e.lineno}`, e.error && e.error.stack));
window.addEventListener('unhandledrejection', e => console.error(`Unhandled rejection: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));

App.init().catch(err => {
  document.body.append(el('pre', 'fatal', `Błąd startu: ${err && err.stack || err}`));
});
