// Plan usage at the bottom of the sidebar: one bar per limit window, % and time to reset.
const Usage = {
  data: null,
  loading: false,

  async load(force = false) {
    this.loading = true;
    this.render();
    this.data = await api.usage({ force });
    this.loading = false;
    this.render();
  },

  start() {
    this.load();
    setInterval(() => this.load(), 5 * 60 * 1000);
    // back to the window after a while → refresh (main caches, so this is cheap)
    window.addEventListener('focus', () => { if (this.data && this.data.fetchedAt && Date.now() - this.data.fetchedAt > 5 * 60 * 1000) this.load(); });
    setInterval(() => this.render(), 60 * 1000); // keep "reset in" fresh
  },

  resetText(ms) {
    if (!ms) return '';
    const d = ms - Date.now();
    if (d <= 0) return 'reset teraz';
    const min = Math.round(d / 60000);
    if (min < 60) return `reset za ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `reset za ${h} h ${min % 60} min`;
    return `reset ${new Date(ms).toLocaleString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
  },

  color(p) { return p >= 90 ? 'var(--danger)' : p >= 70 ? 'var(--warn)' : '#3fb950'; },

  render() {
    const box = $('#usage');
    if (!box) return;
    box.replaceChildren();
    const head = el('div', 'us-head');
    head.append(el('span', 'us-title', 'Zużycie planu'));
    const d = this.data;
    head.append(el('span', 'us-time', this.loading ? 'odświeżanie…' : d && d.fetchedAt ? `odśw. ${new Date(d.fetchedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''));
    const ref = el('button', 'icon-btn us-refresh', '↻');
    ref.title = 'Odśwież (tak jak /usage w Claude Code)';
    ref.classList.toggle('spin', this.loading);
    ref.onclick = () => this.load(true);
    head.append(ref);
    box.append(head);

    if (!d) return;
    if (!d.ok) {
      const n = el('div', 'us-na', 'Niedostępne');
      n.title = d.reason;
      box.append(n, el('div', 'us-reason', d.reason));
      return;
    }
    for (const w of d.windows) {
      const row = el('div', 'us-row');
      const top = el('div', 'us-top');
      top.append(el('span', 'us-label', w.label), el('span', 'us-pct', `${Math.round(w.pct)}%`));
      const bar = el('div', 'us-bar');
      const fill = el('div', 'us-fill');
      fill.style.width = `${w.pct}%`;
      fill.style.background = this.color(w.pct);
      bar.append(fill);
      row.append(top, bar, el('div', 'us-reset', this.resetText(w.resetsAt)));
      box.append(row);
    }
  },
};
