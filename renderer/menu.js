// Context menu. items: { label, onClick, color?, hint?, danger?, disabled? } | '-' | { header }
const CtxMenu = {
  el: null,

  show(x, y, items) {
    this.hide();
    const m = el('div', 'ctx');
    for (const it of items) {
      if (it === '-') { m.append(el('div', 'ctx-sep')); continue; }
      if (it.header) { m.append(el('div', 'ctx-head', it.header)); continue; }
      const row = el('div', 'ctx-item');
      if (it.danger) row.classList.add('danger');
      if (it.disabled) row.classList.add('disabled');
      if (it.color) { const d = el('span', 'dot'); d.style.background = it.color; row.append(d); }
      row.append(el('span', 'ctx-label', it.label));
      if (it.hint) row.append(el('span', 'ctx-hint', it.hint));
      if (!it.disabled) row.onclick = () => { this.hide(); it.onClick(); };
      m.append(row);
    }
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    this.el = m;
    this._out = e => { if (!m.contains(e.target)) this.hide(); };
    this._key = e => { if (e.key === 'Escape') { e.preventDefault(); this.hide(); } };
    setTimeout(() => {
      document.addEventListener('mousedown', this._out, true);
      document.addEventListener('keydown', this._key, true);
      window.addEventListener('blur', this._blur = () => this.hide());
    }, 0);
  },

  hide() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    document.removeEventListener('mousedown', this._out, true);
    document.removeEventListener('keydown', this._key, true);
    window.removeEventListener('blur', this._blur);
  },
};
