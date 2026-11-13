// Group model. Groups are automatic (task `DEV-…`, otherwise project); a status is a label on a session.
// groups.json: { statuses: [{ id, name, color, builtin? }], assignments: { sessionId: 'status:<id>' },
//                titles: { sessionId: name }, collapsed: { key: bool }, ui: { tab }, v3?: true,
//                autoCloseSkip: { 'DEV-123': true },  (undone auto-Completed, until the task is open again)
//                fromTask: { sessionId: 'DEV-123' } }  (sessions created from a ClickUp task → task context in claude)
const PALETTE = ['#e3b341', '#f0883e', '#db61a2', '#a371f7', '#58a6ff', '#39c5cf', '#3fb950', '#8b949e'];

const Groups = {
  BUILTIN: [
    { id: 'in_progress', name: 'In progress', color: '#e3b341', builtin: true },
    { id: 'completed', name: 'Completed', color: '#3fb950', builtin: true },
  ],

  // Fill in defaults and migrate older shapes. Returns a new object.
  normalize(g) {
    g = g && typeof g === 'object' ? g : {};
    const statuses = (Array.isArray(g.statuses) ? g.statuses : [])
      .filter(s => s && typeof s.id === 'string' && typeof s.name === 'string')
      .map(s => ({ id: s.id, name: s.name, color: s.color || PALETTE[7], ...(s.builtin ? { builtin: true } : {}) }));
    for (const b of this.BUILTIN) {
      const ex = statuses.find(s => s.id === b.id);
      if (ex) ex.builtin = true; else statuses.push({ ...b });
    }
    let collapsed = g.collapsed;
    if (Array.isArray(collapsed)) collapsed = Object.fromEntries(collapsed.map(k => [k, true])); // stage-1 format
    if (!collapsed || typeof collapsed !== 'object') collapsed = {};
    const assignments = {};
    for (const [sid, key] of Object.entries(g.assignments || {})) {
      if (typeof key === 'string' && key.startsWith('status:')) assignments[sid] = key;
    }
    const ui = g.ui && typeof g.ui === 'object' ? g.ui : {};
    return {
      statuses, assignments, collapsed, ui,
      titles: g.titles && typeof g.titles === 'object' ? g.titles : {},
      ...(g.v3 ? { v3: true } : {}),
      autoCloseSkip: g.autoCloseSkip && typeof g.autoCloseSkip === 'object' ? g.autoCloseSkip : {},
      fromTask: g.fromTask && typeof g.fromTask === 'object' ? g.fromTask : {},
    };
  },

  get g() { return App.groups; },

  status(id) { return this.g.statuses.find(s => s.id === id); },
  custom() { return this.g.statuses.filter(s => !s.builtin); },
  // Display order: In progress, custom statuses, (automatic groups), Completed.
  topStatuses() { return [this.status('in_progress'), ...this.custom()]; },
  allStatuses() { return [...this.topStatuses(), this.status('completed')]; },

  findTask(text) {
    if (!text) return null;
    const p = App.settings.taskPrefix;
    const m = new RegExp(`(?:^|[^A-Za-z0-9])(${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})-(\\d+)`, 'i').exec(text);
    return m ? `${p.toUpperCase()}-${m[2]}` : null;
  },

  // A task in the custom name wins over the parsed one.
  taskOf(s) { return this.findTask(this.g.titles[s.id]) || s.task || null; },

  autoKey(s) {
    const t = this.taskOf(s);
    return t ? `task:${t}` : `project:${s.project || '?'}`;
  },

  keyOf(s) { return this.autoKey(s); },

  // Status object of a session, or null ("bez statusu").
  statusOf(s) {
    const a = this.g.assignments[s.id];
    return a ? this.status(a.slice(7)) || null : null;
  },

  isDone(items) { return items.length > 0 && items.every(s => { const st = this.statusOf(s); return st && st.id === 'completed'; }); },

  label(key) { return key.slice(key.indexOf(':') + 1); },

  // id = status id, or null to clear.
  setStatus(s, id, { render = true } = {}) {
    if (id && this.status(id)) this.g.assignments[s.id] = `status:${id}`;
    else delete this.g.assignments[s.id];
    App.saveGroups();
    if (render) Sidebar.render();
  },

  setStatusMany(list, id) {
    for (const s of list) this.setStatus(s, id, { render: false });
    Sidebar.render();
  },

  // Keys: 'sec:recent', 'sec:completed', group keys, and 'done|<group key>' for groups inside Completed.
  isCollapsed(key) {
    const c = this.g.collapsed;
    if (Object.prototype.hasOwnProperty.call(c, key)) return !!c[key];
    return key === 'sec:completed' || key.startsWith('done|');
  },

  toggleCollapsed(key) {
    this.g.collapsed[key] = !this.isCollapsed(key);
    App.saveGroups();
    Sidebar.render();
  },

  addStatus(name, color) {
    const id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const i = this.g.statuses.findIndex(s => s.id === 'completed');
    this.g.statuses.splice(i, 0, { id, name, color });
    App.saveGroups();
    Sidebar.render();
  },

  editStatus(id, { name, color }) {
    const st = this.status(id);
    if (!st) return;
    if (name) st.name = name;
    if (color) st.color = color;
    App.saveGroups();
    Sidebar.render();
  },

  // Move a custom status up (-1) or down (+1) among custom statuses.
  shiftStatus(id, dir) {
    const list = this.g.statuses;
    const customIdx = list.map((s, i) => (s.builtin ? -1 : i)).filter(i => i >= 0);
    const pos = customIdx.findIndex(i => list[i].id === id);
    const target = customIdx[pos + dir];
    if (pos < 0 || target === undefined) return;
    const a = customIdx[pos];
    [list[a], list[target]] = [list[target], list[a]];
    App.saveGroups();
    Sidebar.render();
  },

  deleteStatus(id) {
    const st = this.status(id);
    if (!st || st.builtin) return;
    this.g.statuses = this.g.statuses.filter(s => s.id !== id);
    for (const [sid, key] of Object.entries(this.g.assignments)) if (key === `status:${id}`) delete this.g.assignments[sid];
    App.saveGroups();
    Sidebar.render();
  },

  taskUrl(task) {
    const ws = App.settings.clickupWorkspaceId;
    return task && ws ? `https://app.clickup.com/t/${encodeURIComponent(ws)}/${encodeURIComponent(task)}` : null;
  },
};
