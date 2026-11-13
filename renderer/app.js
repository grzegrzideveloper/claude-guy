// App state and startup.
const App = {
  info: null,
  sessions: [],
  groups: { categories: [], assignments: {}, titles: {}, collapsed: [] },
  filter: '',
  loaded: false,

  titleOf(s) { return this.groups.titles[s.id] || s.title; },
  sessionById(id) { return this.sessions.find(s => s.id === id); },
  saveGroups() { return api.storeSave('groups', this.groups); },

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
    this.groups = { ...this.groups, ...(await api.storeGet('groups')) };
    if (!Array.isArray(this.groups.collapsed)) this.groups.collapsed = [];

    Sidebar.render();
    await this.loadSessions();
    await Tabs.restore();

    api.onPtyData((id, data) => { const t = Tabs.tabs.get(id); if (t) t.term.write(data); });
    api.onPtyExit((id, code) => Tabs.onExit(id, code));
    api.onSessionsChanged(() => this.loadSessions());

    const filter = $('#filter');
    filter.addEventListener('input', debounce(() => { App.filter = filter.value; Sidebar.render(); }, 120));
    filter.addEventListener('keydown', e => { if (e.key === 'Escape') { filter.value = ''; App.filter = ''; Sidebar.render(); } });
    $('#btn-new').onclick = () => Tabs.newSession();

    new ResizeObserver(debounce(() => Tabs.fitActive(), 50)).observe($('#terminals'));
    setInterval(() => Sidebar.render(), 60000); // keep relative times fresh
  },
};

App.init().catch(err => {
  document.body.append(el('pre', 'fatal', `Błąd startu: ${err && err.stack || err}`));
});
