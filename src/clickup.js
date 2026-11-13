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

module.exports = { getUser, getTeams, getMyTasks, ClickUpError };
