// ClickUp task view (description, attachments, checklists, subtasks, comments) rendered inside the app.
// The description is markdown from ClickUp, i.e. external content: marked → DOMPurify, never raw innerHTML.
// Images are loaded through main (clickup:attachment → data: URL), so the renderer CSP stays strict.
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

if (window.DOMPurify) {
  // Remote images must not load directly: keep the address in data-src, TaskView loads it via main.
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'IMG') {
      node.setAttribute('data-src', node.getAttribute('src') || '');
      node.removeAttribute('src');
      node.removeAttribute('srcset');
    }
  });
}

const TaskView = {
  cache: new Map(), // key -> task detail

  // Shows the task in host. Uses the cache unless force.
  async show(host, key, { force = false } = {}) {
    host.dataset.key = key;
    if (!force && this.cache.has(key)) { this.render(host, this.cache.get(key), key); return; }
    host.replaceChildren(el('div', 'tv-msg', `Wczytywanie ${key}…`));
    const r = await api.clickupTaskDetail(key);
    if (host.dataset.key !== key) return; // switched meanwhile
    if (!r.ok) {
      const box = el('div', 'tv-msg error');
      box.append(el('div', null, `Nie udało się pobrać ${key}: ${r.error}`));
      const retry = el('button', 'btn sm', 'Spróbuj ponownie');
      retry.onclick = () => this.show(host, key, { force: true });
      box.append(retry);
      host.replaceChildren(box);
      return;
    }
    this.cache.set(key, r.task);
    this.render(host, r.task, key);
  },

  render(host, t, key) {
    const root = el('div', 'tv');

    // header
    const head = el('div', 'tv-head');
    const top = el('div', 'tv-top');
    top.append(el('span', 'cu-id', key));
    const actions = el('div', 'tv-actions');
    const reload = el('button', 'icon-btn', '↻');
    reload.title = 'Odśwież z ClickUp';
    reload.onclick = () => this.show(host, key, { force: true });
    const open = el('button', 'btn sm', 'Otwórz w ClickUp ↗');
    open.onclick = () => api.openExternal(t.url || Groups.taskUrl(key));
    actions.append(reload, open);
    top.append(actions);
    head.append(top, el('h1', 'tv-title', t.name));

    const meta = el('div', 'tv-meta');
    if (t.status) meta.append(this.pill(t.status.name, t.status.color));
    if (t.priority) {
      const p = el('span', 'cu-prio', `⚑ ${t.priority.name}`);
      if (t.priority.color) p.style.color = t.priority.color;
      meta.append(p);
    }
    if (t.due) {
      const overdue = t.due < Date.now();
      meta.append(el('span', `tv-due${overdue ? ' overdue' : ''}`, `termin ${new Date(t.due).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}`));
    }
    const where = [t.folder && t.folder.name, t.list && t.list.name].filter(Boolean).join(' › ');
    if (where) meta.append(el('span', 'muted', where));
    head.append(meta);

    const people = el('div', 'tv-meta');
    if (t.assignees.length) {
      people.append(el('span', 'muted', 'Przypisani:'));
      for (const a of t.assignees) people.append(this.person(a));
    }
    for (const tag of t.tags) {
      const g = el('span', 'tv-tag', tag.name);
      if (tag.bg) { g.style.background = tag.bg; g.style.color = tag.fg || '#fff'; }
      people.append(g);
    }
    if (people.children.length) head.append(people);
    root.append(head);

    // description
    root.append(this.section('Opis'));
    const md = el('div', 'tv-md');
    if (t.markdown && t.markdown.trim()) {
      md.innerHTML = this.toSafeHtml(t.markdown); // sanitized by DOMPurify
      this.wireContent(md, t.attachments);
    } else {
      md.append(el('div', 'muted', 'Brak opisu.'));
    }
    root.append(md);

    // attachments
    if (t.attachments.length) {
      root.append(this.section(`Załączniki (${t.attachments.length})`));
      const grid = el('div', 'tv-files');
      for (const a of t.attachments) grid.append(this.attachment(a));
      root.append(grid);
    }

    // checklists
    for (const c of t.checklists) {
      const done = c.items.filter(i => i.resolved).length;
      root.append(this.section(`${c.name} (${done}/${c.items.length})`));
      const ul = el('ul', 'tv-check');
      for (const i of c.items) {
        const li = el('li', i.resolved ? 'done' : '');
        li.append(el('span', 'tv-box', i.resolved ? '☑' : '☐'), el('span', null, i.name));
        ul.append(li);
      }
      root.append(ul);
    }

    // subtasks
    if (t.subtasks.length) {
      root.append(this.section(`Subtaski (${t.subtasks.length})`));
      const list = el('div', 'tv-subs');
      for (const s of t.subtasks) {
        const k = s.customId || s.id;
        const row = el('div', 'tv-sub');
        row.append(el('span', 'cu-id', k), el('span', 'tv-sub-name', s.name));
        if (s.status) row.append(this.pill(s.status.name, s.status.color));
        row.title = 'Pokaż podgląd';
        row.onclick = () => Tabs.openTaskPreview(k);
        list.append(row);
      }
      root.append(list);
    }

    // comments
    root.append(this.section(`Komentarze (${t.comments.length})`));
    if (t.commentsError) root.append(el('div', 'tv-msg error small', `Nie udało się pobrać komentarzy: ${t.commentsError}`));
    else if (!t.comments.length) root.append(el('div', 'muted tv-pad', 'Brak komentarzy.'));
    for (const c of t.comments) {
      const box = el('div', 'tv-comment');
      const h = el('div', 'tv-comment-head');
      if (c.user) h.append(this.person(c.user));
      if (c.date) h.append(el('span', 'muted', fullTime(c.date)));
      if (c.replies) h.append(el('span', 'muted', `${c.replies} odp. (w ClickUp)`));
      box.append(h, el('div', 'tv-comment-text', c.text));
      root.append(box);
    }

    if (t.updated) root.append(el('div', 'muted tv-foot', `Ostatnia zmiana w ClickUp: ${fullTime(t.updated)}`));
    host.replaceChildren(root);
  },

  toSafeHtml(markdown) {
    const html = marked.parse(markdown, { gfm: true, breaks: true, async: false });
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['style'],
      ALLOW_DATA_ATTR: false,
    });
  },

  // Fallbacks for an image URL: originals may need a ClickUp sign-in, thumbnails don't. Match the inline image
  // to a task attachment by a long path segment (the attachment's uuid) and use that attachment's thumbnail.
  thumbsFor(url, attachments = []) {
    let segs = [];
    try { segs = new URL(url).pathname.split('/').filter(x => x.length >= 16); } catch { return []; }
    const hits = attachments.filter(a => segs.some(sg => `${a.url || ''} ${a.thumb || ''} ${a.id}`.includes(sg) || sg.includes(a.id)));
    return hits.map(a => a.thumb).filter(Boolean);
  },

  // Links → system browser (https only). Images → loaded via main.
  wireContent(root, attachments = []) {
    for (const a of root.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      a.removeAttribute('target');
      a.title = href;
      a.onclick = e => { e.preventDefault(); if (/^https:\/\//i.test(href)) api.openExternal(href); };
    }
    for (const img of root.querySelectorAll('img[data-src]')) {
      const src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
      img.classList.add('tv-img', 'loading');
      img.alt = img.alt || 'obraz';
      this.loadImage(src, img, null, this.thumbsFor(src, attachments));
    }
  },

  // First image data: URL among the candidates, or null.
  async fetchImage(urls) {
    for (const u of urls) {
      // main decides what may be fetched (https + ClickUp hosts only); here just skip obvious junk
      if (!/^https?:\/\//i.test(u || '')) continue;
      const r = await api.clickupAttachment(u);
      if (r.ok && r.type.startsWith('image/') && r.type !== 'image/svg+xml') return r.dataUrl;
    }
    return null;
  },

  async loadImage(url, img, onFail, fallbacks = []) {
    if (!/^https?:\/\//i.test(url || '')) { img.replaceWith(el('span', 'muted', '[obraz]')); return; }
    const data = await this.fetchImage([url, ...fallbacks]);
    if (data) {
      img.src = data;
      img.classList.remove('loading');
      img.onclick = () => this.lightbox(data);
      return;
    }
    const r = {};
    if (onFail) { onFail(r); return; }
    const a = el('a', 'tv-link', '[obraz — otwórz w przeglądarce]');
    a.href = '#';
    a.onclick = e => { e.preventDefault(); api.openExternal(url); };
    img.replaceWith(a);
  },

  attachment(a) {
    const isImg = IMG_EXT.has(a.ext);
    const card = el('div', `tv-file${isImg ? ' img' : ''}`);
    if (isImg && (a.thumb || a.url)) {
      const img = el('img', 'tv-thumb loading');
      img.alt = a.title;
      card.append(img);
      this.loadImage(a.thumb || a.url, img, () => img.replaceWith(el('div', 'tv-ext', a.ext || 'img')));
      card.onclick = async () => {
        // full size if ClickUp gives it to us, otherwise the large thumbnail, otherwise the browser
        const data = await this.fetchImage([a.url, a.thumb]);
        if (data) this.lightbox(data, a.title);
        else if (a.url) api.openExternal(a.url);
      };
    } else {
      card.append(el('div', 'tv-ext', a.ext || 'plik'));
      card.onclick = () => { if (a.url) api.openExternal(a.url); };
    }
    const info = el('div', 'tv-file-info');
    info.append(el('div', 'tv-file-name', a.title));
    if (a.size) info.append(el('div', 'muted', this.size(a.size)));
    card.append(info);
    card.title = isImg ? 'Kliknij, żeby powiększyć' : 'Otwórz w przeglądarce';
    return card;
  },

  lightbox(src, title = '') {
    const lb = el('div', 'lightbox');
    const img = el('img');
    img.src = src;
    lb.append(img);
    if (title) lb.append(el('div', 'lightbox-title', title));
    const close = () => { lb.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    lb.onclick = close;
    document.addEventListener('keydown', onKey, true);
    document.body.append(lb);
  },

  section(title) { return el('div', 'tv-section', title); },

  pill(name, color) {
    const p = el('span', 'cu-status', name);
    const c = color || '#8b949e';
    p.style.color = c;
    p.style.background = `${c}22`;
    p.style.borderColor = `${c}55`;
    return p;
  },

  person(u) {
    const p = el('span', 'tv-person');
    const av = el('span', 'tv-avatar', (u.initials || u.username || '?').slice(0, 2).toUpperCase());
    if (u.color) av.style.background = u.color;
    p.append(av, el('span', null, u.username));
    return p;
  },

  size(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  },
};
