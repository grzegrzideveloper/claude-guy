// Modal dialogs. Each resolves a Promise; Esc / click outside resolve to null.
const Dialogs = {
  // build(box, done) fills the dialog box; onEnter() returns the value for Enter (undefined = ignore).
  // Only one dialog at a time: opening a dialog from another one (e.g. edit from the status list)
  // resolves the previous one with null and drops its key handler.
  current: null,

  open(build, { onEnter, width } = {}) {
    if (this.current) this.current.abandon();
    return new Promise(resolve => {
      const overlay = $('#overlay');
      const box = el('div', 'dialog');
      if (width) box.style.width = `${width}px`;
      let closed = false;
      const finish = (v, hide) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        if (this.current && this.current.box === box) this.current = null;
        if (hide) { overlay.hidden = true; overlay.replaceChildren(); }
        resolve(v);
      };
      const done = v => finish(v, true);
      this.current = { box, abandon: () => finish(null, false) };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && onEnter) {
          e.preventDefault(); e.stopPropagation();
          const v = onEnter();
          if (v !== undefined) done(v);
        }
      };
      CtxMenu.hide();
      build(box, done);
      overlay.onmousedown = e => { if (e.target === overlay) done(null); };
      document.addEventListener('keydown', onKey, true);
      overlay.replaceChildren(box);
      overlay.hidden = false;
      const first = box.querySelector('input');
      if (first) { first.focus(); first.select(); }
    });
  },

  buttons(box, specs) {
    const row = el('div', 'dialog-buttons');
    for (const s of specs) {
      const b = el('button', `btn${s.accent ? ' accent' : ''}`, s.label);
      b.onclick = s.onClick;
      row.append(b);
    }
    box.append(row);
  },

  input(value = '', placeholder = '') {
    const i = el('input', 'dialog-input');
    i.value = value;
    i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  },

  // Resolves to a trimmed string, '' (Skip, only when `skip` is set) or null (Cancel).
  promptName({ title, value = '', placeholder = '', ok = 'OK', skip = null, cancel = 'Anuluj', hint = '' } = {}) {
    let input;
    const submit = () => {
      const v = input.value.trim();
      if (!v && skip) return '';
      if (!v) { input.focus(); return undefined; }
      return v;
    };
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', title));
      if (hint) box.append(el('div', 'dialog-hint', hint));
      input = this.input(value, placeholder);
      box.append(input);
      this.buttons(box, [
        { label: cancel, onClick: () => done(null) },
        ...(skip ? [{ label: skip, onClick: () => done('') }] : []),
        { label: ok, accent: true, onClick: () => { const v = submit(); if (v !== undefined) done(v); } },
      ]);
    }, { onEnter: submit });
  },

  // Name + colour. Resolves to { name, color } or null.
  statusEditor({ title, name = '', color = PALETTE[4], ok = 'Zapisz' }) {
    let input;
    let picked = color;
    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return undefined; }
      return { name: v.slice(0, 40), color: picked };
    };
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', title));
      input = this.input(name, 'np. Czeka na review');
      box.append(input);
      box.append(el('div', 'dialog-label', 'Kolor'));
      const sw = el('div', 'swatches');
      for (const c of PALETTE) {
        const s = el('button', 'swatch');
        s.style.background = c;
        s.title = c;
        s.classList.toggle('picked', c === picked);
        s.onclick = () => { picked = c; for (const x of sw.children) x.classList.toggle('picked', x === s); };
        sw.append(s);
      }
      box.append(sw);
      this.buttons(box, [
        { label: 'Anuluj', onClick: () => done(null) },
        { label: ok, accent: true, onClick: () => { const v = submit(); if (v !== undefined) done(v); } },
      ]);
    }, { onEnter: submit });
  },

  // Close-tab dialog. Resolves to a status id (set it + close), 'close' (just close) or null (keep the tab).
  askCloseTab(s) {
    const cur = Groups.statusOf(s);
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', 'Zamknij zakładkę'));
      box.append(el('div', 'dialog-hint', App.titleOf(s)));
      box.append(el('div', 'dialog-label', 'Ustaw status sesji i zamknij:'));
      const grid = el('div', 'cards');
      for (const st of Groups.allStatuses()) {
        const c = el('button', 'card');
        const d = el('span', 'dot');
        d.style.background = st.color;
        c.append(d, el('span', 'card-name', st.name));
        const isCur = cur && cur.id === st.id;
        if (isCur) { c.classList.add('current'); c.append(el('span', 'card-tag', 'obecny')); }
        c.onclick = () => done(isCur ? 'close' : st.id);
        grid.append(c);
      }
      box.append(grid);
      this.buttons(box, [
        { label: 'Anuluj', onClick: () => done(null) },
        { label: 'Zamknij bez zmiany', accent: true, onClick: () => done('close') },
      ]);
    }, { onEnter: () => 'close', width: 480 });
  },

  // New session: folder (suggested, always confirmed by the user) + optional name.
  // Resolves to { cwd, name } or null.
  newSession({ cwd = null, name = '', suggested = false } = {}) {
    let folder = cwd;
    let input, pathEl, pickBtn, err;
    const submit = () => {
      if (!folder) { err.textContent = 'Wybierz folder, w którym ma pracować Claude.'; return undefined; }
      return { cwd: folder, name: input.value.trim() };
    };
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', 'Nowa sesja'));
      box.append(el('div', 'dialog-label', 'Folder'));
      const row = el('div', 'folder-row');
      pathEl = el('div', 'folder-path');
      pickBtn = el('button', 'btn');
      const show = () => {
        // rtl container keeps the end of a long path visible; the inner ltr span keeps slashes in place
        pathEl.replaceChildren(el('span', null, folder || 'nie wybrano'));
        pathEl.classList.toggle('unset', !folder); // not 'empty': that class is the full-screen empty state
        pickBtn.textContent = folder ? 'Zmień…' : 'Wybierz…';
      };
      pickBtn.onclick = async () => {
        const p = await api.pickFolder();
        if (p) { folder = p; err.textContent = ''; show(); }
        input.focus();
      };
      show();
      row.append(pathEl, pickBtn);
      box.append(row);
      if (cwd) box.append(el('div', 'dialog-hint', suggested ? 'Podpowiedź: folder używany ostatnio dla tej listy lub tego taska — zatwierdź albo zmień.' : 'Podpowiedź na podstawie ostatniej sesji — zatwierdź albo zmień.'));
      box.append(el('div', 'dialog-label', 'Nazwa (opcjonalnie)'));
      input = this.input(name, `np. ${App.settings.taskPrefix}-123 formularz B2C — puste: nazwą będzie pierwszy prompt`);
      box.append(input);
      err = el('div', 'dialog-error');
      box.append(err);
      this.buttons(box, [
        { label: 'Anuluj', onClick: () => done(null) },
        { label: 'Utwórz', accent: true, onClick: () => { const v = submit(); if (v !== undefined) done(v); } },
      ]);
      setTimeout(() => { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); }, 0);
    }, { onEnter: submit, width: 500 });
  },

  // Manage statuses: list with edit / reorder / delete, plus add. Resolves when closed.
  manageStatuses() {
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', 'Statusy sesji'));
      box.append(el('div', 'dialog-hint', 'In progress i Completed są wbudowane: możesz zmienić ich nazwę i kolor, ale nie usunąć. Usunięcie własnego statusu zostawia jego sesje bez statusu.'));
      const listEl = el('div', 'st-list');
      box.append(listEl);
      const counts = () => {
        const c = {};
        for (const k of Object.values(App.groups.assignments)) c[k] = (c[k] || 0) + 1;
        return c;
      };
      const draw = () => {
        listEl.replaceChildren();
        const c = counts();
        const custom = Groups.custom();
        for (const st of Groups.allStatuses()) {
          const row = el('div', 'st-row');
          const d = el('span', 'dot');
          d.style.background = st.color;
          row.append(d, el('span', 'st-name', st.name), el('span', 'st-count', `${c[`status:${st.id}`] || 0} sesji`));
          const btn = (label, title, fn, disabled = false, cls = '') => {
            const b = el('button', `icon-btn st-btn ${cls}`, label);
            b.title = title;
            b.disabled = disabled;
            b.onclick = fn;
            row.append(b);
            return b;
          };
          btn('✎', 'Zmień nazwę i kolor', async () => {
            const v = await Dialogs.statusEditor({ title: 'Edytuj status', name: st.name, color: st.color });
            if (v) Groups.editStatus(st.id, v);
            Dialogs.manageStatuses();
          });
          if (!st.builtin) {
            const i = custom.findIndex(x => x.id === st.id);
            btn('↑', 'Wyżej', () => { Groups.shiftStatus(st.id, -1); draw(); }, i <= 0);
            btn('↓', 'Niżej', () => { Groups.shiftStatus(st.id, 1); draw(); }, i >= custom.length - 1);
            const del = btn('✕', 'Usuń status', () => {
              if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.textContent = 'Usuń?'; return; }
              Groups.deleteStatus(st.id);
              draw();
            }, false, 'danger');
          }
          listEl.append(row);
        }
      };
      draw();
      this.buttons(box, [
        { label: '+ Dodaj status', onClick: async () => {
          const v = await Dialogs.statusEditor({ title: 'Nowy status', ok: 'Dodaj' });
          if (v) Groups.addStatus(v.name, v.color);
          Dialogs.manageStatuses();
        } },
        { label: 'Gotowe', accent: true, onClick: () => done(true) },
      ]);
      box.lastChild.classList.add('split');
    }, { onEnter: () => true, width: 460 });
  },

  // Yes / no question. Resolves to true (ok), false (cancel button) or null (Esc / outside).
  ask({ title, text, ok = 'OK', cancel = 'Anuluj' }) {
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', title));
      for (const line of [].concat(text)) box.append(el('div', 'dialog-text', line));
      this.buttons(box, [
        { label: cancel, onClick: () => done(false) },
        { label: ok, accent: true, onClick: () => done(true) },
      ]);
    }, { onEnter: () => true, width: 460 });
  },

  // ClickUp setup: token → verify (main) → pick workspace → save (main). The token is sent to main once
  // and never comes back. Resolves to true when saved, otherwise null/false.
  clickupSetup() {
    let input, status, teamBox, teamSel, btnConnect, btnSave;
    let connected = null; // { user, teams }
    const connect = async () => {
      const token = input.value.trim();
      if (!token) { input.focus(); return; }
      btnConnect.disabled = true;
      status.className = 'dialog-status';
      status.textContent = 'Łączenie z ClickUp…';
      const r = await api.clickupConnect(token);
      btnConnect.disabled = false;
      if (!r.ok) {
        status.className = 'dialog-status error';
        status.textContent = r.error;
        connected = null;
        teamBox.hidden = true;
        btnSave.disabled = true;
        return;
      }
      input.value = ''; // the renderer doesn't keep the token
      input.placeholder = 'token zweryfikowany ✓';
      connected = r;
      status.className = 'dialog-status ok';
      status.textContent = `Połączono jako ${r.user.username}${r.user.email ? ` (${r.user.email})` : ''}.`;
      teamSel.replaceChildren(...r.teams.map(t => { const o = el('option', null, t.name); o.value = t.id; return o; }));
      teamBox.hidden = false;
      btnSave.disabled = false;
      btnSave.focus();
    };
    const save = async done => {
      if (!connected) return;
      btnSave.disabled = true;
      const r = await api.clickupSave({ teamId: teamSel.value });
      if (!r.ok) {
        btnSave.disabled = false;
        status.className = 'dialog-status error';
        status.textContent = r.error;
        return;
      }
      done(true);
    };
    let doneRef;
    return this.open((box, done) => {
      doneRef = done;
      box.append(el('div', 'dialog-title', 'Połącz z ClickUp'));
      box.append(el('div', 'dialog-text', 'Apka pokaże w zakładce Taski Twoje taski przypisane do Ciebie. Potrzebny jest Twój osobisty token API — każdy używa własnego.'));
      const steps = el('ol', 'dialog-steps');
      for (const t of ['W ClickUp kliknij swój awatar → Settings → Apps.', 'W sekcji API Token kliknij Generate (albo Copy, jeśli token już istnieje).', 'Wklej token poniżej i kliknij Połącz.']) steps.append(el('li', null, t));
      box.append(steps);
      const open = el('button', 'btn sm', 'Otwórz ustawienia ClickUp ↗');
      open.onclick = () => api.openExternal('https://app.clickup.com/settings/apps');
      box.append(open);
      box.append(el('div', 'dialog-label', 'Token API'));
      const row = el('div', 'folder-row');
      input = this.input('', 'pk_…');
      input.type = 'password';
      input.autocomplete = 'off';
      btnConnect = el('button', 'btn', 'Połącz');
      btnConnect.onclick = connect;
      row.append(input, btnConnect);
      box.append(row);
      box.append(el('div', 'dialog-hint', 'Token zostanie zaszyfrowany przez system (Keychain / Windows) i nie opuści aplikacji.'));
      status = el('div', 'dialog-status');
      box.append(status);
      teamBox = el('div');
      teamBox.hidden = true;
      teamBox.append(el('div', 'dialog-label', 'Workspace'));
      teamSel = el('select', 'dialog-input');
      teamBox.append(teamSel);
      box.append(teamBox);
      this.buttons(box, [
        { label: 'Anuluj', onClick: () => done(null) },
        { label: 'Zapisz', accent: true, onClick: () => save(done) },
      ]);
      btnSave = box.querySelector('.dialog-buttons .btn.accent');
      btnSave.disabled = true;
    }, { onEnter: () => { if (connected) save(doneRef); else connect(); return undefined; }, width: 500 });
  },

  // Settings. Resolves to { settings } (save), { action: 'clickup-setup' | 'clickup-disconnect' } or null.
  settings(cur, cu) {
    let prefix, ws, err;
    const submit = () => {
      const p = prefix.value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{0,9}$/.test(p)) { err.textContent = 'Prefiks: litery i cyfry, zaczyna się od litery (np. DEV).'; return undefined; }
      let w = cur.clickupWorkspaceId || null;
      if (ws) {
        w = ws.value.trim() || null;
        if (w && !/^\d{1,20}$/.test(w)) { err.textContent = 'ID workspace’u to sama liczba, np. 4774246.'; return undefined; }
      }
      return { settings: { ...cur, taskPrefix: p, clickupWorkspaceId: w } };
    };
    return this.open((box, done) => {
      box.append(el('div', 'dialog-title', 'Ustawienia'));

      box.append(el('div', 'dialog-section', 'ClickUp'));
      const cuRow = el('div', 'cu-row');
      if (cu.configured) {
        const info = el('div', 'cu-info');
        info.append(el('div', null, `Połączono jako ${cu.user.username}`), el('div', 'muted', `Workspace: ${cu.teamName} (${cu.teamId})`));
        const change = el('button', 'btn sm', 'Zmień…');
        change.onclick = () => done({ action: 'clickup-setup' });
        const disc = el('button', 'btn sm danger', 'Odłącz');
        disc.onclick = () => done({ action: 'clickup-disconnect' });
        cuRow.append(info, change, disc);
      } else {
        cuRow.append(el('div', 'cu-info muted', 'Nie skonfigurowano — zakładka Taski jest pusta.'));
        const setup = el('button', 'btn sm accent', 'Skonfiguruj…');
        setup.onclick = () => done({ action: 'clickup-setup' });
        cuRow.append(setup);
      }
      box.append(cuRow);
      if (!cu.configured) {
        box.append(el('div', 'dialog-label', 'ID workspace’u ClickUp (bez tokenu, tylko do linków)'));
        ws = this.input(cur.clickupWorkspaceId || '', 'np. 4774246');
        box.append(ws);
        box.append(el('div', 'dialog-hint', 'Liczba z adresu ClickUpa: app.clickup.com/<ID>/… Po połączeniu z ClickUp ustawia się sama.'));
      }

      box.append(el('div', 'dialog-section', 'Sesje'));
      box.append(el('div', 'dialog-label', 'Prefiks tasków'));
      prefix = this.input(cur.taskPrefix || 'DEV', 'DEV');
      box.append(prefix);
      box.append(el('div', 'dialog-hint', 'Sesje z np. DEV-123 w nazwie, pierwszym prompcie lub gałęzi git trafiają do grupy tego taska.'));
      err = el('div', 'dialog-error');
      box.append(err);
      this.buttons(box, [
        { label: 'Anuluj', onClick: () => done(null) },
        { label: 'Zapisz', accent: true, onClick: () => { const v = submit(); if (v !== undefined) done(v); } },
      ]);
    }, { onEnter: submit, width: 480 });
  },
};
