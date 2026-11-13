// Modal dialogs.
const Dialogs = {
  // Resolves to a trimmed string, '' (Skip, only when opts.skip is set) or null (Cancel / Esc / click outside).
  promptName({ title, value = '', placeholder = '', ok = 'OK', skip = null, cancel = 'Anuluj', hint = '' } = {}) {
    return new Promise(resolve => {
      const overlay = $('#overlay');
      const box = el('div', 'dialog');
      box.append(el('div', 'dialog-title', title));
      if (hint) box.append(el('div', 'dialog-hint', hint));
      const input = el('input', 'dialog-input');
      input.value = value;
      input.placeholder = placeholder;
      input.spellcheck = false;
      box.append(input);

      const buttons = el('div', 'dialog-buttons');
      const bCancel = el('button', 'btn', cancel);
      const bSkip = skip ? el('button', 'btn', skip) : null;
      const bOk = el('button', 'btn accent', ok);
      buttons.append(bCancel, ...(bSkip ? [bSkip] : []), bOk);
      box.append(buttons);

      const done = v => {
        overlay.hidden = true;
        overlay.replaceChildren();
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const submit = () => {
        const v = input.value.trim();
        if (!v && skip) return done('');
        if (!v) return input.focus();
        done(v);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
      };
      bCancel.onclick = () => done(null);
      if (bSkip) bSkip.onclick = () => done('');
      bOk.onclick = submit;
      overlay.onmousedown = e => { if (e.target === overlay) done(null); };
      document.addEventListener('keydown', onKey, true);

      overlay.replaceChildren(box);
      overlay.hidden = false;
      input.focus();
      input.select();
    });
  },
};
