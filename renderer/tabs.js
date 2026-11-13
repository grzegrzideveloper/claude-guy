// Terminal tabs: one xterm + one PTY (claude) per session. tabId === sessionId.
const Tabs = {
  tabs: new Map(), // id -> { id, cwd, isNew, exited, term, fit, el, tabEl }
  order: [],
  active: null,

  has(id) { return this.tabs.has(id); },

  label(t) {
    const s = App.sessionById(t.id);
    return App.groups.titles[t.id] || (s ? s.title : t.isNew ? 'Nowa sesja' : t.id.slice(0, 8));
  },

  create({ id, cwd, isNew }) {
    const isMac = App.info.platform === 'darwin';
    const term = new Terminal({
      fontFamily: App.info.terminalFont,
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: false,
      macOptionIsMeta: isMac,
      theme: {
        background: '#1a1a1a', foreground: '#e6e6e6', cursor: '#d97757',
        selectionBackground: '#d9775766',
      },
      linkHandler: { activate: (_e, uri) => api.openExternal(uri) },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);

    const box = el('div', 'term');
    box.hidden = true;
    $('#terminals').append(box);
    term.open(box);

    const tabEl = el('div', 'tab');
    const lab = el('span', 'tab-label');
    const close = el('button', 'tab-close', '×');
    close.title = 'Zamknij zakładkę';
    tabEl.append(lab, close);
    tabEl.onclick = () => this.activate(id);
    tabEl.onauxclick = e => { if (e.button === 1) this.requestClose(id); };
    tabEl.oncontextmenu = e => { e.preventDefault(); App.sessionMenu(this.sessionOf(id), e.clientX, e.clientY, { tabId: id }); };
    close.onclick = e => { e.stopPropagation(); this.requestClose(id); };
    $('#tabbar').append(tabEl);

    const t = { id, cwd, isNew: !!isNew, exited: false, term, fit, el: box, tabEl };
    this.tabs.set(id, t);
    this.order.push(id);
    lab.textContent = this.label(t);
    tabEl.title = cwd;

    term.onData(d => {
      if (t.exited) { if (d === '\r') this.start(t); return; }
      api.ptyWrite(id, d);
    });
    term.onResize(({ cols, rows }) => api.ptyResize(id, cols, rows));
    this.bindKeys(t, isMac);
    return t;
  },

  // macOS: Cmd+C / Cmd+V come from the Edit menu (xterm handles the copy/paste events),
  // Ctrl+C interrupts and Ctrl+V reaches claude, which pastes an image from the clipboard.
  // Windows: keys like Windows Terminal.
  bindKeys(t, isMac) {
    const { term } = t;
    term.attachCustomKeyEventHandler(e => {
      if (isMac || e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && (e.shiftKey || term.hasSelection())) {
        e.preventDefault();
        this.copySelection(t);
        return false;
      }
      if (k === 'v') {
        e.preventDefault(); // stop the native paste event, otherwise text is pasted twice
        this.paste(t);
        return false;
      }
      return true;
    });
    t.el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (term.hasSelection()) this.copySelection(t);
      else this.paste(t);
    });
  },

  copySelection(t) {
    if (!t.term.hasSelection()) return;
    api.clipboardWrite(t.term.getSelection());
    t.term.clearSelection();
  },

  async paste(t) {
    if (t.exited) return;
    const { text, hasImage } = await api.clipboardRead();
    if (text) t.term.paste(text);
    // Claude Code on Windows pastes images with Alt+V (ESC v). To verify on a real machine.
    else if (hasImage) api.ptyWrite(t.id, App.info.platform === 'win32' ? '\x1bv' : '\x16');
    t.term.focus();
  },

  async start(t) {
    t.exited = false;
    this.fitTab(t);
    const { cols, rows } = t.term;
    const r = await api.startSession({ tabId: t.id, sessionId: t.id, cwd: t.cwd, isNew: t.isNew, cols, rows });
    if (!r.ok) {
      t.exited = true;
      t.term.writeln(`\r\n\x1b[31m${r.error}\x1b[0m`);
      return;
    }
    t.isNew = false; // after the first start, a restart is always a resume
  },

  onExit(id, code) {
    const t = this.tabs.get(id);
    if (!t) return;
    t.exited = true;
    t.term.writeln(`\r\n\x1b[2m[Sesja zakończona (kod ${code}). Naciśnij Enter, aby wznowić.]\x1b[0m`);
  },

  fitTab(t) {
    if (t.el.hidden) return;
    try { t.fit.fit(); } catch { /* not measurable yet */ }
  },

  open(s) {
    if (this.tabs.has(s.id)) { this.activate(s.id); return; }
    Groups.setStatus(s, 'in_progress', { render: false }); // opening in a new tab = working on it now
    const t = this.create({ id: s.id, cwd: s.cwd, isNew: false });
    this.activate(s.id);
    this.start(t);
  },

  // opts: { cwd, name } suggestions (from a group or, later, a ClickUp task). The user always confirms the folder.
  // Resolves to { id, cwd } or null.
  async newSession(opts = {}) {
    const r = await Dialogs.newSession(opts);
    if (!r) return null;
    const id = await api.newSessionId();
    if (r.name) App.groups.titles[id] = r.name;
    App.groups.assignments[id] = 'status:in_progress';
    App.saveGroups();
    const t = this.create({ id, cwd: r.cwd, isNew: true });
    this.activate(id);
    this.start(t);
    return { id, cwd: r.cwd };
  },

  activate(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    for (const x of this.tabs.values()) {
      x.el.hidden = x !== t;
      x.tabEl.classList.toggle('active', x === t);
    }
    this.active = id;
    $('#empty').hidden = true;
    requestAnimationFrame(() => { this.fitTab(t); t.term.focus(); });
    t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.persist();
    Sidebar.render();
  },

  // Session for a tab; a stub for a new session whose transcript doesn't exist yet.
  sessionOf(id) {
    const s = App.sessionById(id);
    if (s) return s;
    const t = this.tabs.get(id);
    const cwd = t ? t.cwd : '';
    return { id, title: t ? this.label(t) : id, cwd, project: cwd.split(/[\\/]+/).filter(Boolean).pop() || '?', task: null, mtime: Date.now(), stub: true };
  },

  // × / middle click: ask where the session goes, then close.
  async requestClose(id) {
    if (!this.tabs.has(id)) return;
    const s = this.sessionOf(id);
    const r = await Dialogs.askCloseTab(s);
    if (r === null) { const t = this.tabs.get(id); if (t) t.term.focus(); return; }
    if (r !== 'close') Groups.setStatus(s, r, { render: false });
    this.close(id);
  },

  close(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    api.ptyKill(id);
    t.term.dispose();
    t.el.remove();
    t.tabEl.remove();
    this.tabs.delete(id);
    const i = this.order.indexOf(id);
    this.order.splice(i, 1);
    if (this.active === id) {
      this.active = null;
      const next = this.order[Math.min(i, this.order.length - 1)];
      if (next) this.activate(next);
      else $('#empty').hidden = false;
    }
    this.persist();
    Sidebar.render();
  },

  refreshLabels() {
    for (const t of this.tabs.values()) t.tabEl.querySelector('.tab-label').textContent = this.label(t);
  },

  persist() {
    if (App.info.headless || this.restoring) return;
    api.storeSave('tabs', { tabs: this.order.map(id => ({ sessionId: id, cwd: this.tabs.get(id).cwd })), active: this.active });
  },

  async restore() {
    const st = await api.storeGet('tabs');
    if (!st.tabs || !st.tabs.length) return;
    this.restoring = true;
    const created = st.tabs.map(x => this.create({ id: x.sessionId, cwd: x.cwd, isNew: false }));
    this.activate(this.tabs.has(st.active) ? st.active : created[0].id);
    this.restoring = false;
    for (const t of created) this.start(t); // hidden tabs start at default size and get resized when shown
  },

  fitActive() {
    const t = this.tabs.get(this.active);
    if (t) this.fitTab(t);
  },
};
