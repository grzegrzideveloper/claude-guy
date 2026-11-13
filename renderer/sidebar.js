// Session list. Grouping by status/category/task/project comes in stage 2.
const Sidebar = {
  render() {
    const list = $('#session-list');
    const scroll = list.scrollTop;
    list.replaceChildren();

    const f = App.filter.trim().toLowerCase();
    const match = s => !f || [App.titleOf(s), s.title, s.project, s.task, s.branch, s.cwd]
      .some(v => v && v.toLowerCase().includes(f));
    const items = App.sessions.filter(match);

    if (!App.loaded) {
      list.append(el('div', 'sb-empty', 'Wczytywanie…'));
      return;
    }
    if (!items.length) {
      list.append(el('div', 'sb-empty', f ? 'Nic nie pasuje do filtra.' : 'Brak sesji Claude Code.'));
      return;
    }
    if (f) {
      this.section(list, null, `Wyniki (${items.length})`, items); // a filter always shows its results
    } else {
      this.section(list, 'sec:recent', 'Ostatnie', items.slice(0, 3));
      this.section(list, 'sec:all', `Wszystkie (${items.length})`, items);
    }
    list.scrollTop = scroll;
  },

  // key: collapse-state key stored in groups.json `collapsed`, or null for a non-collapsible section.
  section(parent, key, title, items) {
    const collapsed = !!key && App.groups.collapsed.includes(key);
    const head = el('div', 'sb-section');
    if (key) {
      head.append(el('span', 'sb-chevron', '▾'));
      head.classList.toggle('collapsed', collapsed);
      head.onclick = () => this.toggle(key);
    }
    head.append(el('span', null, title));
    parent.append(head);
    if (collapsed) return;
    for (const s of items) parent.append(this.row(s));
  },

  toggle(key) {
    const c = App.groups.collapsed;
    const i = c.indexOf(key);
    if (i >= 0) c.splice(i, 1); else c.push(key);
    App.saveGroups();
    this.render();
  },

  row(s) {
    const r = el('div', 'session');
    if (Tabs.has(s.id)) r.classList.add('open');
    if (Tabs.active === s.id) r.classList.add('active');
    r.title = s.cwd;

    const top = el('div', 's-top');
    top.append(el('div', 's-title', App.titleOf(s)));
    if (Tabs.active === s.id) top.append(el('span', 's-viewing', '● teraz'));
    r.append(top);

    const meta = el('div', 's-meta');
    meta.append(el('span', 's-proj', s.project));
    if (s.task) meta.append(el('span', 's-task', s.task));
    meta.append(el('span', 's-time', relTime(s.mtime)));
    r.append(meta);

    r.onclick = () => Tabs.open(s);
    return r;
  },
};
