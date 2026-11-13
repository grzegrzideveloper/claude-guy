// Notifications in the bottom-right corner. show({ text, action: { label, onClick }, timeout })
const Toasts = {
  show({ text, action = null, timeout = 15000 }) {
    const t = el('div', 'toast');
    t.append(el('div', 'toast-text', text));
    let timer = null;
    const close = () => { clearTimeout(timer); t.remove(); };
    if (action) {
      const b = el('button', 'btn sm', action.label);
      b.onclick = () => { close(); action.onClick(); };
      t.append(b);
    }
    const x = el('button', 'icon-btn toast-x', '×');
    x.title = 'Zamknij';
    x.onclick = close;
    t.append(x);
    t.onmouseenter = () => clearTimeout(timer);
    t.onmouseleave = () => { timer = setTimeout(close, 4000); };
    $('#toasts').append(t);
    if (timeout) timer = setTimeout(close, timeout);
    return close;
  },
};
