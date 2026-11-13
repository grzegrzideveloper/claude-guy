// Sidebar with three tabs: Sesje (grouped by task / project), Taski (ClickUp, stage 4), Historia (flat list).
const ICON_EXT = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5"/></svg>';

const PLACEHOLDERS = {
  sessions: 'Szukaj: tytuł, projekt, DEV-…, gałąź, status',
  tasks: 'Szukaj tasków',
  history: 'Szukaj w historii',
};

const Sidebar = {
  get tab() { return (App.groups && App.groups.ui.tab) || 'sessions'; },

  setTab(tab) {
    App.groups.ui.tab = tab;
    App.saveGroups();
    this.render();
  },

  render() {
    for (const b of document.querySelectorAll('.sb-tab')) b.classList.toggle('active', b.dataset.tab === this.tab);
    $('#filter').placeholder = PLACEHOLDERS[this.tab];

    const list = $('#session-list');
    const scroll = list.scrollTop;
    list.replaceChildren();
    if (!App.loaded) { list.append(el('div', 'sb-empty', 'Wczytywanie…')); return; }

    const f = App.filter.trim().toLowerCase();
    if (this.tab === 'tasks') this.renderTasks(list, f);
    else if (this.tab === 'history') this.renderHistory(list, f);
    else this.renderSessions(list, f);
    list.scrollTop = scroll;
  },

  matches(s, f) {
    const st = Groups.statusOf(s);
    return [App.titleOf(s), s.title, s.project, Groups.taskOf(s), s.branch, s.cwd, st && st.name]
      .some(v => v && v.toLowerCase().includes(f));
  },

  // --- Sesje ---
  renderSessions(list, f) {
    if (f) {
      const items = App.sessions.filter(s => this.matches(s, f));
      list.append(this.sectionHead(null, `Wyniki (${items.length})`));
      for (const s of items) list.append(this.row(s));
      if (!items.length) list.append(el('div', 'sb-empty', 'Nic nie pasuje do filtra.'));
      return;
    }
    if (!App.sessions.length) { list.append(el('div', 'sb-empty', 'Brak sesji Claude Code. Utwórz pierwszą przyciskiem + Nowa.')); return; }

    list.append(this.sectionHead('sec:recent', 'Ostatnie'));
    if (!Groups.isCollapsed('sec:recent')) for (const s of App.sessions.slice(0, 3)) list.append(this.row(s));

    // Bucket by group (sessions are already sorted newest first, so items[0] is the newest).
    const buckets = new Map();
    for (const s of App.sessions) {
      const k = Groups.keyOf(s);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(s);
    }
    const byNewest = (a, b) => buckets.get(b)[0].mtime - buckets.get(a)[0].mtime;
    const keys = [...buckets.keys()].sort(byNewest);
    const active = keys.filter(k => !Groups.isDone(buckets.get(k)));
    const done = keys.filter(k => Groups.isDone(buckets.get(k)));

    list.append(el('div', 'sb-section static', 'W toku'));
    for (const k of active) list.append(this.group(k, buckets.get(k), false));
    if (!active.length) list.append(el('div', 'sb-empty small', 'Wszystkie sesje są ukończone.'));

    const head = this.sectionHead('sec:completed', `Completed (${done.length})`);
    const doneSt = Groups.status('completed');
    const dot = el('span', 'dot');
    dot.style.background = doneSt.color;
    head.insertBefore(dot, head.lastChild);
    list.append(head);
    if (!Groups.isCollapsed('sec:completed')) for (const k of done) list.append(this.group(k, buckets.get(k), true));
  },

  sectionHead(key, title) {
    const head = el('div', 'sb-section');
    if (key) {
      head.append(el('span', 'chev', '▾'));
      head.classList.toggle('collapsed', Groups.isCollapsed(key));
      head.onclick = () => Groups.toggleCollapsed(key);
    }
    head.append(el('span', null, title));
    return head;
  },

  group(key, items, inDone) {
    const ckey = inDone ? `done|${key}` : key;
    const isTask = key.startsWith('task:');
    const label = Groups.label(key);
    const g = el('div', 'group');
    const collapsed = Groups.isCollapsed(ckey);

    const head = el('div', 'g-head');
    head.classList.toggle('collapsed', collapsed);
    head.append(el('span', 'chev', '▾'));
    head.append(el('span', `g-name${isTask ? ' task' : ''}`, label));
    // Until ClickUp titles arrive (stage 4), a task group shows its newest session's title.
    const cuTask = isTask ? App.cuTask(label) : null;
    if (isTask) head.append(el('span', 'g-sub', cuTask ? cuTask.name : this.stripTask(App.titleOf(items[0]), label)));
    else head.append(el('span', 'g-sub', ''));

    // status summary: one dot per distinct status, e.g. ● ● 3
    const summary = el('span', 'g-summary');
    const seen = new Map();
    for (const s of items) {
      const st = Groups.statusOf(s);
      const id = st ? st.id : '_none';
      if (!seen.has(id)) seen.set(id, st);
    }
    for (const st of seen.values()) {
      const d = el('span', 'dot sm');
      d.style.background = st ? st.color : 'var(--muted)';
      d.title = st ? st.name : 'Bez statusu';
      summary.append(d);
    }
    summary.append(el('span', 'g-count', String(items.length)));
    head.append(summary);

    if (isTask) {
      const url = Groups.taskUrl(label);
      if (url) {
        const a = el('button', 'icon-btn g-link');
        a.innerHTML = ICON_EXT; // static icon, no user content
        a.title = 'Otwórz w ClickUp';
        a.onclick = e => { e.stopPropagation(); api.openExternal(url); };
        head.append(a);
      }
    }
    head.onclick = () => Groups.toggleCollapsed(ckey);
    head.oncontextmenu = e => { e.preventDefault(); this.groupMenu(key, items, e.clientX, e.clientY); };
    g.append(head);

    if (!collapsed) for (const s of items) g.append(this.row(s, { hideTask: isTask, hideProject: !isTask, nested: true }));
    return g;
  },

  // "DEV-123 formularz" → "formularz" when shown next to the task id anyway.
  stripTask(title, task) {
    const t = title.replace(new RegExp(`^\\s*${task}\\b[\\s:.,–—-]*`, 'i'), '');
    return t || title;
  },

  groupMenu(key, items, x, y) {
    const isTask = key.startsWith('task:');
    const label = Groups.label(key);
    const cuTask = isTask ? App.cuTask(label) : null;
    const url = isTask ? Groups.taskUrl(label) : null;
    CtxMenu.show(x, y, [
      { header: isTask ? `${label} · ${cuTask ? cuTask.name : this.stripTask(App.titleOf(items[0]), label)}` : label },
      { label: isTask ? 'Nowa sesja dla tego taska…' : 'Nowa sesja w tym projekcie…',
        onClick: () => (cuTask ? App.newSessionFromTask(cuTask) : Tabs.newSession({ cwd: items[0].cwd, name: isTask ? `${label} ` : '' })) },
      ...(isTask && App.clickup.status.configured ? [{ label: 'Podgląd taska', onClick: () => Tabs.openTaskPreview(label) }] : []),
      ...(isTask ? [{ label: 'Otwórz w ClickUp', disabled: !url, hint: url ? '' : 'brak ID workspace’u', onClick: () => api.openExternal(url) }] : []),
      '-',
      { header: `Oznacz wszystkie (${items.length}) jako` },
      ...Groups.allStatuses().map(st => ({ label: st.name, color: st.color, onClick: () => Groups.setStatusMany(items, st.id) })),
    ]);
  },

  row(s, { hideTask = false, hideProject = false, nested = false, absTime = false } = {}) {
    const r = el('div', 'session');
    if (nested) r.classList.add('nested');
    if (Tabs.has(s.id)) r.classList.add('open');
    if (Tabs.active === s.id) r.classList.add('active');
    r.title = s.cwd;

    const top = el('div', 's-top');
    top.append(el('div', 's-title', App.titleOf(s)));
    if (Tabs.active === s.id) top.append(el('span', 's-viewing', '● teraz'));
    r.append(top);

    const meta = el('div', 's-meta');
    const st = Groups.statusOf(s);
    const stEl = el('span', 's-status');
    const d = el('span', 'dot sm');
    d.style.background = st ? st.color : 'var(--muted)';
    stEl.append(d, el('span', null, st ? st.name : 'bez statusu'));
    meta.append(stEl);
    if (!hideProject) meta.append(el('span', 's-proj', s.project));
    const task = Groups.taskOf(s);
    if (task && !hideTask) {
      const b = el('span', 's-task', task);
      const url = Groups.taskUrl(task);
      if (url) {
        b.classList.add('link');
        b.title = `Otwórz ${task} w ClickUp`;
        b.onclick = e => { e.stopPropagation(); api.openExternal(url); };
      } else {
        b.title = 'Ustaw ID workspace’u ClickUp w ustawieniach, żeby otwierać taski';
      }
      meta.append(b);
    }
    meta.append(el('span', 's-time', absTime ? fullTime(s.mtime) : relTime(s.mtime)));
    r.append(meta);

    r.onclick = () => Tabs.open(s);
    r.oncontextmenu = e => { e.preventDefault(); App.sessionMenu(s, e.clientX, e.clientY); };
    return r;
  },

  // --- Historia ---
  renderHistory(list, f) {
    const items = f ? App.sessions.filter(s => this.matches(s, f)) : App.sessions;
    list.append(this.sectionHead(null, f ? `Wyniki (${items.length})` : `Wszystkie sesje (${items.length})`));
    for (const s of items) list.append(this.row(s, { absTime: true }));
    if (!items.length) list.append(el('div', 'sb-empty', f ? 'Nic nie pasuje do filtra.' : 'Brak sesji.'));
  },

  // --- Taski (ClickUp) ---
  expandedTask: null,

  renderTasks(list, f) {
    const cu = App.clickup;
    if (!cu.status.configured) {
      const box = el('div', 'sb-placeholder');
      box.append(el('div', 'sb-placeholder-title', 'Taski z ClickUp'));
      box.append(el('div', null, 'Połącz apkę z ClickUp, a zobaczysz tu taski przypisane do Ciebie (bez statusu Closed), pogrupowane wg projektu. Z każdego taska otworzysz sesję Claude’a.'));
      const b = el('button', 'btn accent', 'Skonfiguruj ClickUp…');
      b.onclick = () => App.setupClickup();
      box.append(b);
      list.append(box);
      return;
    }

    // toolbar
    const bar = el('div', 'cu-bar');
    const tasks = f ? cu.tasks.filter(t => this.taskMatches(t, f)) : cu.tasks;
    bar.append(el('span', 'cu-bar-title', f ? `Wyniki (${tasks.length})` : `Moje taski (${cu.tasks.length})`));
    bar.append(el('span', 'cu-bar-time', cu.loading ? 'odświeżanie…' : cu.fetchedAt ? `odśw. ${new Date(cu.fetchedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''));
    const ref = el('button', 'icon-btn cu-refresh', '↻');
    ref.title = 'Odśwież z ClickUp';
    ref.classList.toggle('spin', cu.loading);
    ref.onclick = () => App.loadClickup({ force: true });
    bar.append(ref);
    list.append(bar);
    if (cu.error) list.append(el('div', 'cu-error', cu.error));
    if (!cu.fetchedAt && cu.loading) { list.append(el('div', 'sb-empty', 'Pobieranie tasków…')); return; }
    if (!tasks.length) { list.append(el('div', 'sb-empty', f ? 'Nic nie pasuje do filtra.' : 'Brak otwartych tasków przypisanych do Ciebie.')); return; }

    // sessions per task key
    const sessCount = new Map();
    for (const s of App.sessions) {
      const k = Groups.taskOf(s);
      if (k) sessCount.set(k.toUpperCase(), (sessCount.get(k.toUpperCase()) || 0) + 1);
    }

    // Folder → List tree. Lists without a folder become top-level groups.
    const tops = new Map(); // key -> { name, updated, lists: Map(listId -> { name, updated, tasks }) }
    for (const t of tasks) {
      const topKey = t.folder ? `f:${t.folder.id}` : `l:${t.list ? t.list.id : '?'}`;
      const topName = t.folder ? t.folder.name : (t.list ? t.list.name : 'Bez listy');
      if (!tops.has(topKey)) tops.set(topKey, { name: topName, updated: 0, lists: new Map(), flat: !t.folder });
      const top = tops.get(topKey);
      const lid = t.list ? t.list.id : '?';
      if (!top.lists.has(lid)) top.lists.set(lid, { name: t.list ? t.list.name : 'Bez listy', updated: 0, tasks: [] });
      const l = top.lists.get(lid);
      l.tasks.push(t);
      l.updated = Math.max(l.updated, t.updated || 0);
      top.updated = Math.max(top.updated, t.updated || 0);
    }
    const byUpd = (a, b) => b[1].updated - a[1].updated;
    for (const [topKey, top] of [...tops].sort(byUpd)) {
      const tkey = `cu:${topKey}`;
      const count = [...top.lists.values()].reduce((n, l) => n + l.tasks.length, 0);
      list.append(this.cuHead(tkey, top.name, count, 0));
      if (Groups.isCollapsed(tkey) && !f) continue;
      for (const [lid, l] of [...top.lists].sort(byUpd)) {
        let indent = 1;
        if (!top.flat) {
          const lkey = `cu:l:${lid}`;
          list.append(this.cuHead(lkey, l.name, l.tasks.length, 1));
          if (Groups.isCollapsed(lkey) && !f) continue;
          indent = 2;
        }
        for (const t of l.tasks.sort((a, b) => (b.updated || 0) - (a.updated || 0))) {
          list.append(this.taskRow(t, sessCount.get(App.cuKey(t).toUpperCase()) || 0, indent));
        }
      }
    }
  },

  taskMatches(t, f) {
    return [t.customId, t.id, t.name, t.status && t.status.name, t.list && t.list.name, t.folder && t.folder.name]
      .some(v => v && v.toLowerCase().includes(f));
  },

  cuHead(key, name, count, level) {
    const h = el('div', `g-head cu-head lvl${level}`);
    h.classList.toggle('collapsed', Groups.isCollapsed(key));
    h.append(el('span', 'chev', '▾'), el('span', 'g-name', name), el('span', 'g-count', String(count)));
    h.onclick = () => Groups.toggleCollapsed(key);
    return h;
  },

  taskRow(t, nSessions, indent) {
    const key = App.cuKey(t);
    const wrap = el('div', `cu-task ind${indent}`);
    const open = this.expandedTask === t.id;
    wrap.classList.toggle('expanded', open);

    const top = el('div', 's-top');
    top.append(el('span', 'cu-id', key), el('div', 's-title', t.name));
    wrap.append(top);

    const meta = el('div', 's-meta');
    if (t.status) {
      const st = el('span', 'cu-status', t.status.name);
      const c = t.status.color || '#8b949e';
      st.style.color = c;
      st.style.background = `${c}22`;
      st.style.borderColor = `${c}55`;
      meta.append(st);
    }
    if (t.priority) {
      const p = el('span', 'cu-prio', `⚑ ${t.priority.name}`);
      if (t.priority.color) p.style.color = t.priority.color;
      meta.append(p);
    }
    if (nSessions) meta.append(el('span', 'cu-sessions', `${nSessions} ${nSessions === 1 ? 'sesja' : nSessions < 5 ? 'sesje' : 'sesji'}`));
    if (t.due) {
      const overdue = t.due < Date.now();
      const d = el('span', `s-time${overdue ? ' overdue' : ''}`, new Date(t.due).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }));
      d.title = overdue ? 'Termin minął' : 'Termin';
      meta.append(d);
    }
    wrap.append(meta);

    if (open) {
      const actions = el('div', 'cu-actions');
      const bNew = el('button', 'btn sm accent', '+ Nowa sesja');
      bNew.onclick = e => { e.stopPropagation(); App.newSessionFromTask(t); };
      const bView = el('button', 'btn sm', 'Podgląd');
      bView.onclick = e => { e.stopPropagation(); Tabs.openTaskPreview(key); };
      const bOpen = el('button', 'btn sm', 'ClickUp ↗');
      bOpen.title = 'Otwórz w przeglądarce';
      bOpen.onclick = e => { e.stopPropagation(); api.openExternal(t.url || Groups.taskUrl(key)); };
      actions.append(bNew, bView, bOpen);
      wrap.append(actions);
      const sess = App.sessions.filter(s => (Groups.taskOf(s) || '').toUpperCase() === key.toUpperCase());
      if (sess.length) {
        const box = el('div', 'cu-sesslist');
        for (const s of sess) box.append(this.row(s, { hideTask: true }));
        wrap.append(box);
      }
    }

    wrap.onclick = () => { this.expandedTask = open ? null : t.id; this.render(); };
    wrap.oncontextmenu = e => {
      e.preventDefault();
      CtxMenu.show(e.clientX, e.clientY, [
        { header: `${key} · ${t.name}` },
        { label: 'Nowa sesja dla tego taska…', onClick: () => App.newSessionFromTask(t) },
        { label: 'Podgląd taska', onClick: () => Tabs.openTaskPreview(key) },
        { label: 'Otwórz w ClickUp', onClick: () => api.openExternal(t.url || Groups.taskUrl(key)) },
        { label: 'Pokaż sesje tego taska', disabled: !nSessions, onClick: () => App.showTaskSessions(key) },
        '-',
        { label: 'Kopiuj ID', onClick: () => api.clipboardWrite(key) },
        { label: 'Kopiuj link', disabled: !t.url, onClick: () => api.clipboardWrite(t.url) },
      ]);
    };
    return wrap;
  },
};
