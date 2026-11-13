# my_claude: Electron GUI for Claude Code

A desktop wrapper around the `claude` CLI, running on WSL2/WSLg:
- sidebar of sessions grouped by status, category and EA ticket
- one terminal tab per session, opened with `claude --resume <id>`
- bottom panel with plan usage and the `/ready-to-merge` report

User-facing docs (features, keys, data files, troubleshooting) are in `README.md`. Keep it in sync when behaviour changes.

## Run / stop
- `my_claude` runs `bin/my_claude`, which is symlinked from `~/.local/bin/my_claude`. The launcher:
  - loads nvm's node
  - unsets the parent Claude session vars (see Gotchas)
  - sets the Wayland env and flags
  - starts Electron detached, logging to `~/.local/state/my_claude.log`
- `npm start` is plain `electron .` without the WSLg flags, so it won't open a window here.
- Stop with `pkill -f "dist/[e]lectron --ozone"`:
  - It matches only the main process. Killing the renderer or zygote children first leaves main stuck.
  - The `[e]` stops the pattern matching the shell that runs it.
  - On SIGTERM, main kills the PTYs and calls `app.exit(0)`, because `app.quit` hangs on WSLg.
- Single-instance lock: running `my_claude` again focuses the existing window.
- Restarting kills every running `claude` in the tabs. The tabs come back via `tabs.json`, but in-flight generations are lost, so ask the user before restarting.

## Architecture
| File | Role |
|---|---|
| `main.js` | Main process: window (`Menu.setApplicationMenu(null)`), one PTY per tab (`@lydell/node-pty`, prebuilt N-API, no gcc), IPC handlers, `fs.watch(~/.claude/projects)` → `sessions:changed` (debounced 1.5 s), Windows clipboard and link bridges (`clipboardWrite`/`clipboardRead`/`openExternal`), quit handling |
| `preload.js` | The only bridge, `window.api`. Keep it narrow |
| `sessions.js` | `listSessions(limit=150)`; details below |
| `categories.js` | Load and save `categories.json` |
| `tabsState.js` | Load and save `tabs.json`. `loadTabs()` drops tabs whose transcript doesn't exist |
| `usage.js` | `getUsage()`: plan limits |
| `readyToMerge.js` | Runs and caches the `/ready-to-merge` skill |
| `renderer/` | Plain HTML/CSS/JS, no bundler. xterm.js and the fit addon load as UMD from `../node_modules` |
| `bin/my_claude` | Launcher |
| `scripts/screenshot.js` | Off-screen render of the real UI to a PNG |

IPC channels (main.js):
- sessions and categories: `sessions:list`, `categories:get`, `categories:save`
- sessions: `session:open` (`--resume id`), `session:pickFolder` (folder dialog), `session:new(cwd)` (`--session-id <uuid>`, so the renderer can file the session before its transcript exists)
- bottom panel: `usage:get`, `rtm:get`, `rtm:run`
- browser and clipboard: `open:external` (https only; on WSL via `rundll32.exe`), `clipboard:write`, `clipboard:read`
- tabs: `tabs:get`, `tabs:save`
- terminals: `pty:write`, `pty:resize`, `pty:kill`
- main → renderer: `pty:data`, `pty:exit`, `sessions:changed`

### Sessions (`sessions.js`)
- Scans `~/.claude/projects/*/*.jsonl`, sorts by mtime, and reads the first 64 KB of each file, plus the last 64 KB of larger files (for the branch, see below). It never reads whole transcripts.
- Title: the first real user prompt, falling back to `slug`. `cwd` comes from the JSON lines. Sessions with no title or no cwd are skipped.
- `ticketOf`: the first `EA-\d+` in the first prompt wins, otherwise the latest ticket branch in `gitBranch`. The group hint is the branch slug after the ticket.
  - For files over 64 KB, the last 64 KB are read too (`readTail`), and the last `"gitBranch"` there wins.
  - Many sessions start on the previous ticket's branch and switch to a new one later, so the latest branch is the accurate one.
  - Cost: about 95 ms for 150 sessions, compared with about 50 ms for the head only.
- Returns `{ id, title, cwd, project, mtime, ticket, ticketHint }`.

### Grouping (`renderer.js`)
- `categories.json` holds `{ categories: [name], assignments: { sessionId: groupKey }, titles: { sessionId: name } }`.
- `groupKey` is one of:
  - `status:in_progress`, `status:qa`, `status:fixes`, `status:completed` (built in, `STATUSES`)
  - `cat:<name>`
  - `ticket:EA-123`
  - `other`
- `ticketOfS(s)`: an `EA-\d+` in the custom name wins, then `s.ticket`. Both `autoKey` and the row badge use it.
- `groupKeyOf(s)`: a valid manual assignment wins, otherwise `autoKey(s)` gives the ticket or `other`.
- Row meta is `.s-proj`, an optional `.s-ticket` badge, then `.s-time`. The badge opens `JIRA + ticket` (endohealth.atlassian.net) and is hidden inside ticket groups.
- Token rule: sidebar info must come from local parsing (sessions.js, config files), never from `claude -p` or an API call. Only Ready to merge spends tokens, and only on click.
- `moveSession()` deletes the assignment when the target is the automatic group.
- Order: In progress, QA, Fixes, categories, tickets (by latest mtime), Other, Completed.
  - Status and category groups always show, even when empty, unless a filter is active.
  - Tickets and Completed start collapsed. Collapse state is in localStorage `my_claude.collapsed`.
- `titleOf(s)` returns the custom name from `titles`, or the original title. The name is never written to Claude's transcript. An `EA-…` in it overrides the parsed ticket (`ticketOfS`).
- While an inline rename is open, `editing` makes `renderSessions()` defer, so a file-watch refresh doesn't destroy the input.
- UI entry points:
  - drag and drop (`renderGroup`)
  - right-click menu `showSessionMenu()`
  - close-tab dialog `askCloseTab()`
  - + Category (`newCategory`); double-click renames (`renameCategory`), × deletes (`deleteCategory`)

### Tabs
- `addTab()` creates an xterm Terminal with `lineHeight: 1.15` (see Gotchas) and the fit addon. Resizes go to `pty:resize`.
- `persistTabs()` runs on every open, close and switch. Main ignores saves once `quitting` is set, so PTYs dying at shutdown don't empty the list.
- `restoreTabs()` runs once after the first `loadSessions()`. It doesn't change any status.
- `openSession()` (a user click or the menu's Open) sets `status:in_progress` when it opens a new tab. Focusing an already-open tab doesn't.
- Sidebar rows: `.open` means the session has a tab; `.active` means it's the session in `activeTab`. `activate()` re-renders the sidebar so the marker follows.
- Right-click on a tab calls `showSessionMenu(sessionOfTab(t), null, x, y, tabId)`:
  - Rename goes through `promptName()` (`renameInDialog`), since there's no sidebar row to edit inline.
  - The menu adds Show tab and Close tab….
  - `sessionOfTab()` returns a stub `{ id, title, stub: true }` for a new session with no transcript yet. Stubs get no ticket option, and `moveSession()`/`setSessionTitle()` write their assignment and title directly.
- + New is two IPC steps:
  1. `session:pickFolder` gets the folder.
  2. `promptName({ ok: 'Create', skip: 'Skip', cancel: 'Cancel' })` asks for a name.
  3. Only then does `session:new(cwd)` spawn claude.
  Cancel (null) starts nothing. Skip ('') keeps the default title. `session:new` checks that `cwd` is a directory.
- `promptName()` resolves to a string, `''` (Skip, when a `skip` label is given) or `null` (Cancel, Esc or a click outside). In screenshot tests, end `SHOT_JS` with `; 0`, otherwise `executeJavaScript` waits on the promise and the run hangs.
- × calls `askCloseTab()`:
  - a 2×2 grid of status cards, then categories and the ticket/Other group
  - clicking a card moves the session there and closes the tab; the current group is tagged "current" and only closes
  - Close or Enter just closes; Cancel, Esc or clicking outside keeps the tab
  - for a new session not yet in `sessions`, the assignment is written directly
- Resuming appends bookkeeping lines (cost-state) to the transcript. That bumps the session's mtime, so it jumps to Recent, but no messages are sent.

### Bottom panel
- ↻ refreshes whichever panel tab is open and spins while loading.
- Usage:
  - `usage.js` calls `GET https://api.anthropic.com/api/oauth/usage` with header `anthropic-beta: oauth-2025-04-20` and the Bearer token from `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`).
  - It returns `five_hour`/`seven_day` (+ opus/sonnet) `utilization` and `resets_at`. The endpoint is undocumented and may change.
  - Auto-refreshes every 5 minutes. Under the bars is an "Updated HH:MM" line with a **↻ Refresh** button (`.usage-refresh`).
- Ready to merge:
  - Runs from `~/www/endo-app-backend`: `claude -p "/ready-to-merge" --output-format json --json-schema … --no-session-persistence`.
  - Only WebFetch and Atlassian `getJiraIssue` are allowed.
  - Reads `structured_output.tickets` (`ticket`, `summary`, `featureEnv`, `jira`), sorts numerically, and caches to `ready-to-merge.json`.
  - Takes about 25 s and costs plan usage. A second click while running joins the in-flight run.
  - Clicking the tab, or ↻, starts a run. The list is cleared while it runs.
  - Links open via `open:external`; the copy icons use `clipboard:write`.

## Rules
- The OAuth token must stay in the main process. Never log it, send it over IPC, or write it anywhere (org rule: no secrets in code, repos, tickets or chats).
- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. Add new capabilities as IPC handlers in `main.js` and expose them in `preload.js`.
- Session titles, custom names, category names and Jira summaries are user content. Render them with `textContent`, not `innerHTML`.
- Colours are CSS variables in `renderer/style.css` `:root` (dark theme, accent `#d97757`). Status colours:
  - in progress: `--warn`
  - QA: `#58a6ff`
  - fixes: `#db61a2`
  - completed: `#3fb950`
- Config writes are atomic: write a tmp file, then rename it.

## Gotchas (WSL2 / WSLg)
- `/tmp/.X11-unix` is empty on this machine, so X11 hangs silently with no window and no error. The launcher therefore sets:
  - `WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0`
  - `XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir`
  - flags `--ozone-platform=wayland --enable-features=WaylandWindowDecorations --disable-gpu`
- `libEGL` and `Failed to connect to the bus` errors in the log are harmless (no GPU driver or D-Bus). So are `wl_buffer … still attached` lines from the old process at shutdown.
- System libs (Ubuntu 22.04): libgtk-3-0, libnss3, libgbm1, libasound2, libxss1, libxtst6, libxkbcommon0, libcups2, libatk-bridge2.0-0, libxcomposite1, libxdamage1, libxrandr2. Check with `ldd node_modules/electron/dist/electron | grep "not found"`.
- Parent session vars: launching from inside a Claude session (e.g. Claude's Bash tool) passes on `CLAUDE_CODE_CHILD_SESSION=1` and similar.
  - Claude then shows "Transcript saving is off" and the session can't be resumed.
  - `bin/my_claude` unsets these vars, and `main.js` `cleanEnv()` strips them again for every PTY (`PARENT_SESSION_VARS`). Keep both lists in sync.
- Clipboard: Electron's clipboard doesn't sync with Windows under WSLg.
  - Writes go through `clip.exe` (UTF-16LE, no BOM, otherwise an invisible character gets pasted).
  - Reads use PowerShell `Get-Clipboard -Raw` (~0.3 s).
  - `bindClipboard()` implements Windows Terminal keys: Ctrl+C copies when there's a selection, otherwise it interrupts. Ctrl+V with no text passes `\x16` (image paste) to claude.
  - There's no app menu, so no duplicate paste and no Ctrl+R reload.
- Links: WSL has no Linux browser or `xdg-open`, so `shell.openExternal` fails silently. On WSL, `openExternal()` in main.js passes https URLs to Windows with `rundll32.exe url.dll,FileProtocolHandler <url>` (execFile, no shell), which opens the default Windows browser.
- Terminal `lineHeight` is 1.15. At 1.0, xterm clips the `_` glyph of DejaVu Sans Mono (the fallback, since Cascadia Mono isn't installed), so underscores disappear.
- Glyphs like ⧉ aren't in the installed fonts and render as empty boxes. Use inline SVG (see `COPY_ICON`) or glyphs already in use.

## Verify changes
- Syntax check: `node --check main.js && node --check renderer/renderer.js`. `node --check` only checks its first argument.
- UI: `./node_modules/.bin/electron scripts/screenshot.js out.png 1400 900 --disable-gpu --ozone-platform=headless`, then view the PNG.
  - `SHOT_JS="…"` runs JS in the page 300 ms before capture. Don't wrap it in your own `setTimeout`.
  - Headless runs (`--my-claude-no-window`) don't restore or save tabs, so no real `claude --resume` is spawned.
  - Anything that saves categories writes the real file. Point `XDG_CONFIG_HOME` at a copy of `~/.config/my_claude` when testing.
  - To test tab UI without a PTY, fake an entry: `tabs.set('fake', { sessionId, label, el, tabEl, term: { focus(){}, dispose(){} } })`.
  - Don't open the Ready-to-merge tab there; it starts a real run.
- `node -e "console.log(require('./sessions').listSessions(5))"`
- `node -e "require('./usage').getUsage().then(console.log)"` prints numbers only.
- Real check: ask the user, relaunch with `my_claude`, then `pgrep -af "claude --resume"` and the log.
