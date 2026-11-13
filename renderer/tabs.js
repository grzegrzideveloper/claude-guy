// Tabs. Session tabs: one xterm + one PTY (claude) per session, tabId === sessionId; a session with a task
// gets a [Terminal] [Task DEV-123] switch above the terminal. Task preview tabs (`task:<KEY>`): only the
// task view, no terminal, not persisted.
const Tabs = {
  tabs: new Map(), // id -> { id, kind: 'session'|'task', cwd, isNew, exited, term, fit, el, termHost, taskHost, bar, view, tabEl }
  order: [],
  active: null,

  // Session tabs only (task previews have ids prefixed with "task:").
  has(id) { const t = this.tabs.get(id); return !!t && t.kind === 'session'; },

  label(t) {
    if (t.kind === 'task') {
      const cu = App.cuTask(t.taskKey);
      return `${t.taskKey}${cu ? ` · ${cu.name}` : ''}`;
    }
    const s = App.sessionById(t.id);
    return App.groups.titles[t.id] || (s ? s.title : t.isNew ? 'Nowa sesja' : t.id.slice(0, 8));
  },

  // Task key of a session tab (from the custom name, prompt or branch), or null.
  taskKeyOf(t) {
    if (t.kind === 'task') return t.taskKey;
    return Groups.taskOf(this.sessionOf(t.id));
  },

  makeTabEl(t) {
    const tabEl = el('div', `tab${t.kind === 'task' ? ' tab-task' : ''}`);
    const lab = el('span', 'tab-label');
    const close = el('button', 'tab-close', '×');
    close.title = 'Zamknij zakładkę';
    tabEl.append(lab, close);
    tabEl.onclick = () => this.activate(t.id);
    tabEl.onauxclick = e => { if (e.button === 1) this.requestClose(t.id); };
    tabEl.oncontextmenu = e => {
      e.preventDefault();
      if (t.kind === 'task') {
        CtxMenu.show(e.clientX, e.clientY, [
          { header: t.taskKey },
          { label: 'Otwórz w ClickUp', onClick: () => api.openExternal(Groups.taskUrl(t.taskKey)) },
          { label: 'Zamknij podgląd', onClick: () => this.close(t.id) },
        ]);
      } else {
        App.sessionMenu(this.sessionOf(t.id), e.clientX, e.clientY, { tabId: t.id });
      }
    };
    close.onclick = e => { e.stopPropagation(); this.requestClose(t.id); };
    $('#tabbar').append(tabEl);
    t.tabEl = tabEl;
    lab.textContent = this.label(t);
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

    const box = el('div', 'pane');
    box.hidden = true;
    const bar = el('div', 'pane-bar');
    bar.hidden = true;
    const termHost = el('div', 'term');
    const taskHost = el('div', 'taskhost');
    taskHost.hidden = true;
    box.append(bar, termHost, taskHost);
    $('#terminals').append(box);
    term.open(termHost);

    const t = { id, kind: 'session', cwd, isNew: !!isNew, exited: false, term, fit, el: box, termHost, taskHost, bar, view: 'term' };
    this.tabs.set(id, t);
    this.order.push(id);
    this.makeTabEl(t);
    t.tabEl.title = cwd;
    this.updateBar(t);

    term.onData(d => {
      if (t.exited) { if (d === '\r') this.start(t); return; }
      api.ptyWrite(id, d);
    });
    term.onResize(({ cols, rows }) => api.ptyResize(id, cols, rows));
    this.bindKeys(t, isMac);
    return t;
  },

  // Task preview tab (no terminal).
  openTaskPreview(key) {
    const id = `task:${key}`;
    if (!this.tabs.has(id)) {
      const box = el('div', 'pane');
      box.hidden = true;
      const taskHost = el('div', 'taskhost');
      box.append(taskHost);
      $('#terminals').append(box);
      const t = { id, kind: 'task', taskKey: key, el: box, taskHost, view: 'task' };
      this.tabs.set(id, t);
      this.order.push(id);
      this.makeTabEl(t);
      t.tabEl.title = `Podgląd taska ${key}`;
      TaskView.show(taskHost, key);
    }
    this.activate(id);
  },

  // [Terminal] [Task DEV-123] switch, shown when the session has a task.
  updateBar(t) {
    if (t.kind !== 'session') return;
    const key = this.taskKeyOf(t);
    if (!key || !App.clickup.status.configured) {
      t.bar.hidden = true;
      if (t.view !== 'term') this.setView(t, 'term');
      return;
    }
    t.bar.hidden = false;
    t.bar.replaceChildren();
    const mk = (view, label) => {
      const b = el('button', `pane-btn${t.view === view ? ' active' : ''}`, label);
      b.onclick = () => this.setView(t, view);
      t.bar.append(b);
    };
    mk('term', 'Terminal');
    mk('task', `Task ${key}`);
    const cu = App.cuTask(key);
    if (cu) t.bar.append(el('span', 'pane-sub', cu.name));
  },

  setView(t, view) {
    t.view = view;
    t.termHost.hidden = view !== 'term';
    t.taskHost.hidden = view !== 'task';
    if (view === 'task') {
      const key = this.taskKeyOf(t);
      if (key && t.taskHost.dataset.key !== key) TaskView.show(t.taskHost, key);
    } else {
      requestAnimationFrame(() => { this.fitTab(t); t.term.focus(); });
    }
    this.updateBar(t);
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
    t.termHost.addEventListener('contextmenu', e => {
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

  // Task context (sessions created from a task) goes to claude as --append-system-prompt on every start.
  taskContextOf(t) {
    const key = App.groups.fromTask[t.id];
    if (!key) return null;
    const cu = App.cuTask(key);
    return { key, title: cu ? cu.name : '', url: (cu && cu.url) || Groups.taskUrl(key) || '' };
  },

  async start(t) {
    t.exited = false;
    this.fitTab(t);
    const { cols, rows } = t.term;
    const r = await api.startSession({
      tabId: t.id, sessionId: t.id, cwd: t.cwd, isNew: t.isNew, cols, rows,
      taskContext: this.taskContextOf(t),
      initialPrompt: t.isNew ? t.initialPrompt || null : null,
    });
    if (!r.ok) {
      t.exited = true;
      t.term.writeln(`\r\n\x1b[31m${r.error}\x1b[0m`);
      return;
    }
    t.isNew = false; // after the first start, a restart is always a resume
    t.initialPrompt = null;
  },

  onExit(id, code) {
    const t = this.tabs.get(id);
    if (!t || t.kind !== 'session') return;
    t.exited = true;
    t.term.writeln(`\r\n\x1b[2m[Sesja zakończona (kod ${code}). Naciśnij Enter, aby wznowić.]\x1b[0m`);
  },

  fitTab(t) {
    if (t.kind !== 'session' || t.el.hidden || t.view !== 'term') return;
    try { t.fit.fit(); } catch { /* not measurable yet */ }
  },

  open(s) {
    if (this.has(s.id)) { this.activate(s.id); return; }
    Groups.setStatus(s, 'in_progress', { render: false }); // opening in a new tab = working on it now
    const t = this.create({ id: s.id, cwd: s.cwd, isNew: false });
    this.activate(s.id);
    this.start(t);
  },

  // opts: { cwd, name, suggested, task } — task: ClickUp task the session is created from.
  // The user always confirms the folder. Resolves to { id, cwd } or null.
  async newSession(opts = {}) {
    const key = opts.task ? App.cuKey(opts.task) : null;
    const r = await Dialogs.newSession({ ...opts, taskKey: key });
    if (!r) return null;
    const id = await api.newSessionId();
    if (r.name) App.groups.titles[id] = r.name;
    App.groups.assignments[id] = 'status:in_progress';
    if (key) App.groups.fromTask[id] = key;
    App.saveGroups();
    const t = this.create({ id, cwd: r.cwd, isNew: true });
    if (key && r.startPrompt) {
      const url = opts.task.url || Groups.taskUrl(key) || '';
      t.initialPrompt = `Pobierz przez MCP ClickUp task ${key}${url ? ` (${url})` : ''} i streść, co jest do zrobienia. Na razie niczego nie zmieniaj.`;
    }
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
    if (t.kind === 'session' && t.view === 'term') requestAnimationFrame(() => { this.fitTab(t); t.term.focus(); });
    t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.persist();
    Sidebar.render();
  },

  // Session for a tab; a stub for a new session whose transcript doesn't exist yet.
  sessionOf(id) {
    const s = App.sessionById(id);
    if (s) return s;
    const t = this.tabs.get(id);
    const cwd = t && t.cwd ? t.cwd : '';
    return { id, title: t ? this.label(t) : id, cwd, project: cwd.split(/[\\/]+/).filter(Boolean).pop() || '?', task: null, mtime: Date.now(), stub: true };
  },

  // × / middle click: session tabs ask for the status, task previews just close.
  async requestClose(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    if (t.kind === 'task') { this.close(id); return; }
    const s = this.sessionOf(id);
    const r = await Dialogs.askCloseTab(s);
    if (r === null) { if (this.tabs.has(id) && t.view === 'term') t.term.focus(); return; }
    if (r !== 'close') Groups.setStatus(s, r, { render: false });
    this.close(id);
  },

  close(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    if (t.kind === 'session') {
      api.ptyKill(id);
      t.term.dispose();
    }
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

  // After sessions or ClickUp tasks reload: labels and task switches may change.
  refreshLabels() {
    for (const t of this.tabs.values()) {
      t.tabEl.querySelector('.tab-label').textContent = this.label(t);
      this.updateBar(t);
    }
  },

  persist() {
    if (App.info.headless || this.restoring) return;
    const sessions = this.order.filter(id => this.has(id));
    api.storeSave('tabs', {
      tabs: sessions.map(id => ({ sessionId: id, cwd: this.tabs.get(id).cwd })),
      active: this.has(this.active) ? this.active : sessions[0] || null,
    });
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
