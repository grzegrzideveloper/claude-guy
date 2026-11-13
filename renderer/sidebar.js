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
    if (this.tab === 'tasks') this.renderTasks(list);
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
    if (isTask) head.append(el('span', 'g-sub', this.stripTask(App.titleOf(items[0]), label)));
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
    const url = isTask ? Groups.taskUrl(label) : null;
    CtxMenu.show(x, y, [
      { header: isTask ? `${label} · ${this.stripTask(App.titleOf(items[0]), label)}` : label },
      { label: isTask ? 'Nowa sesja dla tego taska…' : 'Nowa sesja w tym projekcie…',
        onClick: () => Tabs.newSession({ cwd: items[0].cwd, name: isTask ? `${label} ` : '' }) },
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

  // --- Taski (stage 4) ---
  renderTasks(list) {
    const box = el('div', 'sb-placeholder');
    box.append(el('div', 'sb-placeholder-title', 'Taski z ClickUp'));
    box.append(el('div', null, 'Tu pojawi się lista Twoich tasków z ClickUp (bez statusu Closed), pogrupowana wg projektu. Z każdego taska otworzysz nową sesję Claude’a.'));
    box.append(el('div', 'muted', 'Będzie potrzebny Twój osobisty token API ClickUp — dodasz go w Ustawieniach.'));
    list.append(box);
  },
};
