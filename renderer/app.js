// App state and startup.
const App = {
  info: null,
  sessions: [],
  groups: null,
  settings: { taskPrefix: 'DEV', clickupWorkspaceId: null },
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
    const v = await Dialogs.settings(this.settings);
    if (!v) return;
    const prefixChanged = v.taskPrefix !== this.settings.taskPrefix;
    this.settings = v;
    await api.storeSave('settings', v);
    if (prefixChanged) await this.loadSessions(); // main re-parses tasks with the new prefix
    else Sidebar.render();
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

App.init().catch(err => {
  document.body.append(el('pre', 'fatal', `Błąd startu: ${err && err.stack || err}`));
});
