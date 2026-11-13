// ClickUp REST API v2 with the user's personal token. Main process only: the token never leaves it.
// Docs: https://developer.clickup.com/reference

// Test-only override (mock server). Normal runs always use the real API.
const BASE = process.env.CLICKUP_API_BASE || 'https://api.clickup.com/api/v2';

class ClickUpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(token, pathAndQuery) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try {
    res = await fetch(BASE + pathAndQuery, {
      headers: { Authorization: token, Accept: 'application/json' }, // personal tokens go without "Bearer"
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ClickUpError(err.name === 'AbortError' ? 'ClickUp nie odpowiada (timeout).' : `Brak połączenia z ClickUp: ${err.message}`, 0);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new ClickUpError('Token ClickUp jest nieprawidłowy albo wygasł.', 401);
  if (res.status === 429) throw new ClickUpError('ClickUp ogranicza liczbę zapytań — spróbuj za minutę.', 429);
  if (!res.ok) throw new ClickUpError(`ClickUp zwrócił błąd ${res.status}.`, res.status);
  return res.json();
}

async function getUser(token) {
  const { user } = await request(token, '/user');
  return { id: String(user.id), username: user.username || user.email, email: user.email || '', color: user.color || null, initials: user.initials || '' };
}

async function getTeams(token) {
  const { teams } = await request(token, '/team');
  return (teams || []).map(t => ({ id: String(t.id), name: t.name }));
}

function mapTask(t) {
  const folder = t.folder || {};
  return {
    id: t.id,
    customId: t.custom_id || null,
    name: t.name,
    status: t.status ? { name: t.status.status, color: t.status.color || null, type: t.status.type || null } : null,
    priority: t.priority ? { name: t.priority.priority, color: t.priority.color || null } : null,
    due: t.due_date ? Number(t.due_date) : null,
    updated: t.date_updated ? Number(t.date_updated) : null,
    url: t.url || null,
    parent: t.parent || null,
    list: t.list ? { id: String(t.list.id), name: t.list.name } : null,
    // folder.hidden = the list sits directly in the space, without a folder
    folder: folder.id && !folder.hidden ? { id: String(folder.id), name: folder.name } : null,
    spaceId: t.space ? String(t.space.id) : null,
  };
}

// Tasks assigned to the user, open ones only (include_closed=false skips ClickUp's "closed" status type),
// minus any status named in hiddenStatuses (case-insensitive).
async function getMyTasks(token, { teamId, userId, hiddenStatuses = ['closed'] }) {
  const hidden = new Set(hiddenStatuses.map(s => s.toLowerCase()));
  const out = [];
  for (let page = 0; page < 30; page++) {
    const q = new URLSearchParams({ page: String(page), subtasks: 'true', include_closed: 'false', order_by: 'updated' });
    q.append('assignees[]', userId);
    const data = await request(token, `/team/${encodeURIComponent(teamId)}/task?${q}`);
    const tasks = data.tasks || [];
    for (const t of tasks) {
      const m = mapTask(t);
      if (m.status && hidden.has(m.status.name.toLowerCase())) continue;
      out.push(m);
    }
    if (data.last_page === true || tasks.length < 100) break;
  }
  return out;
}

function taskPath(key, teamId, extra = {}) {
  const custom = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key);
  const q = new URLSearchParams(extra);
  if (custom) { q.set('custom_task_ids', 'true'); q.set('team_id', teamId); }
  const qs = q.toString();
  return `/task/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;
}

// Full task for the task view: description (markdown), attachments, checklists, subtasks, comments.
async function getTaskDetail(token, key, teamId) {
  const t = await request(token, taskPath(key, teamId, { include_markdown_description: 'true', include_subtasks: 'true' }));
  let comments = [];
  let commentsError = null;
  try {
    const c = await request(token, `/task/${encodeURIComponent(t.id)}/comment`);
    comments = (c.comments || []).map(x => ({
      id: String(x.id),
      text: x.comment_text || '',
      user: x.user ? { username: x.user.username || x.user.email || '?', color: x.user.color || null, initials: x.user.initials || '' } : null,
      date: x.date ? Number(x.date) : null,
      replies: Number(x.reply_count || 0),
    })).sort((a, b) => (a.date || 0) - (b.date || 0));
  } catch (err) {
    commentsError = err.message;
  }
  const base = mapTask(t);
  const people = u => ({ username: u.username || u.email || '?', color: u.color || null, initials: u.initials || '' });
  return {
    ...base,
    markdown: t.markdown_description || t.text_content || '',
    created: t.date_created ? Number(t.date_created) : null,
    creator: t.creator ? people(t.creator) : null,
    assignees: (t.assignees || []).map(people),
    tags: (t.tags || []).map(x => ({ name: x.name, fg: x.tag_fg || null, bg: x.tag_bg || null })),
    attachments: (t.attachments || []).filter(a => !a.deleted).map(a => ({
      id: String(a.id),
      title: a.title || a.id,
      ext: (a.extension || '').toLowerCase(),
      size: a.size ? Number(a.size) : null,
      url: a.url || a.url_w_host || null,
      thumb: a.thumbnail_large || a.thumbnail_medium || a.thumbnail_small || null,
      date: a.date ? Number(a.date) : null,
    })),
    checklists: (t.checklists || []).map(c => ({
      name: c.name,
      items: (c.items || []).sort((a, b) => (a.orderindex || 0) - (b.orderindex || 0)).map(i => ({ name: i.name, resolved: !!i.resolved })),
    })),
    subtasks: (t.subtasks || []).map(x => ({
      id: x.id, customId: x.custom_id || null, name: x.name,
      status: x.status ? { name: x.status.status, color: x.status.color || null } : null,
    })),
    comments,
    commentsError,
  };
}

// Attachment / image bytes for the renderer (which can't load remote images under its CSP).
// Only ClickUp hosts. Tries without the token first; sends it only to ClickUp's own attachment hosts.
const ATTACH_HOST = /(^|\.)(clickup-attachments\.com|clickup\.com|clickupusercontent\.com)$/i;
async function fetchAttachment(token, url, maxBytes = 15 * 1024 * 1024) {
  let u;
  try { u = new URL(url); } catch { throw new ClickUpError('Nieprawidłowy adres załącznika.', 0); }
  const testHost = !!process.env.CLICKUP_API_BASE && u.hostname === '127.0.0.1'; // mock API in tests only
  if (!testHost && (u.protocol !== 'https:' || !ATTACH_HOST.test(u.hostname))) throw new ClickUpError('Załącznik spoza ClickUp.', 0);
  const get = async withToken => fetch(u, { headers: withToken ? { Authorization: token } : {}, redirect: 'follow' });
  let res = await get(false);
  if (res.status === 401 || res.status === 403) res = await get(true);
  if (!res.ok) throw new ClickUpError(`Nie udało się pobrać załącznika (${res.status}).`, res.status);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new ClickUpError('Załącznik jest za duży do podglądu.', 413);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new ClickUpError('Załącznik jest za duży do podglądu.', 413);
  const type = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  return { type, dataUrl: `data:${type};base64,${buf.toString('base64')}` };
}

// One task by key: a custom id like DEV-123 (needs team_id) or a raw ClickUp id.
async function getTask(token, key, teamId) {
  return mapTask(await request(token, taskPath(key, teamId)));
}

module.exports = { getUser, getTeams, getMyTasks, getTask, getTaskDetail, fetchAttachment, ClickUpError };
