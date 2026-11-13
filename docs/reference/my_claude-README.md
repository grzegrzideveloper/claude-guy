# my_claude

A desktop window for Claude Code on WSL2. Your sessions are listed on the left, and each one opens as a terminal tab on the right. Plan usage and the ready-to-merge tickets for endo-app-backend sit at the bottom left.

## Start / stop

```bash
my_claude                              # opens the window; if it's already running, focuses it
pkill -f "dist/[e]lectron --ozone"     # stop it from a shell (or just close the window)
```

The open tabs are saved and come back the next time you start the app. The log is at `~/.local/state/my_claude.log`. It always contains `libEGL` and `Failed to connect to the bus` lines, and after a restart some `wl_buffer … still attached` lines. All of these are harmless.

## Sidebar

**Recent** shows the 3 most recently used sessions. Below it, **Sessions** shows every session, grouped as follows:

| Group | How sessions get there |
|---|---|
| ▶ In progress | Automatic when you start a session with **+ New** or open one from the list |
| ⚑ Passed to QA | Set manually |
| ⚒ Fixes in progress | Set manually |
| ▣ your categories | Created with **+ Category**; rename one by double-clicking it, delete it with × |
| EA-1234 groups | Automatic, from the session's ticket (see below) |
| Other | Automatic: no ticket found |
| ✓ Completed | Set manually (shown at the bottom, collapsed) |

To change a session's group, use any of these:
- **drag and drop** the session onto a group
- **right-click**, then **Move to**
- **close its tab** (see below)

Moving a session back to its ticket or Other group removes the manual assignment.

Clicking a session opens it in a tab. **Right-click on a session** gives these options:
- Open
- Rename… (Enter saves, Esc cancels)
- Reset name
- Copy session ID
- Move to

A new name is used only in this app; Claude's transcript is never changed. If the name contains an `EA-…` number, the session moves to that ticket's group.

Each session row shows its folder, its **EA ticket** (blue badge; click it to open the ticket in Jira in your Windows browser) and when it was last used. Inside an EA group the badge is hidden, because the group header already shows the ticket. The ticket comes from, in this order:
- an `EA-…` in the name you gave the session
- the first prompt
- the most recent git branch used in the session

This is plain file parsing and costs no tokens.

Use the **filter box** to search by title (original or renamed), ticket, branch hint or project.

## Tabs

- Clicking a session resumes it with `claude --resume` and moves it to **In progress**. If it's already open, its tab is focused instead.
- Sessions with an open tab have an orange edge. The one you're currently looking at is highlighted more strongly and marked **● viewing**.
- **+ New** asks for a folder, then for a name:
  - **Create** (Enter) starts the session with that name.
  - **Skip** starts it with the default name, which is the first prompt.
  - **Cancel** (Esc) starts nothing.
- **Right-click a tab** for the same menu as in the sidebar (Rename opens a dialog), plus Show tab and Close tab….
- Clicking **×** on a tab opens a dialog:
  - pick a status, category or ticket group to move the session there and close the tab
  - **Close** (Enter) just closes it
  - **Cancel** (Esc, or click outside the dialog) keeps it open
- A session only becomes resumable after its first prompt. An empty "New" tab therefore isn't reopened after a restart.

### Keys in the terminal (like Windows Terminal)

| Key | Action |
|---|---|
| Ctrl+C | Copy if text is selected, otherwise interrupt Claude |
| Ctrl+Shift+C | Copy |
| Ctrl+V | Paste text; with an image on the clipboard, passes the image paste on to Claude |
| Ctrl+Shift+V | Paste |
| Right-click | Copy the selection, or paste if nothing is selected |

The clipboard is shared with Windows.

## Bottom panel

- **Usage** shows the 5-hour session and weekly limits, the same numbers as `/usage`. It refreshes every 5 minutes, or when you click **↻ Refresh** under the bars (or ↻ in the tab bar).
- **Ready to merge** runs the `/ready-to-merge` skill from `~/www/endo-app-backend` when you open the tab or click ↻.
  - It takes about 30 s and uses plan quota, so every click on the tab starts a real run. The list is empty while it runs.
  - It lists the EA tickets whose feature env is in Jira status "Passed".
  - **Jira ↗** and **Feature env ↗** open in your Windows browser; the copy icon next to each copies its URL.

## Where data is stored

All of it is in `~/.config/my_claude/`:

| File | Content |
|---|---|
| `categories.json` | Your categories, the group of each session, and custom session names |
| `tabs.json` | Open tabs and which one is active |
| `ready-to-merge.json` | The last ready-to-merge result |

Claude's own sessions stay in `~/.claude/projects/` and are only read, never edited.

## Troubleshooting

- **No window appears.** Check the log. WSLg must be running (`ls /mnt/wslg/runtime-dir/wayland-0`). Try `wsl --shutdown` from Windows, then start the app again.
- **"Transcript saving is off" in a tab.** The app was started from inside another Claude session with an old launcher. Start it from a normal shell with `my_claude`.
- **Links don't open.** On WSL, links go to Windows' default browser through `rundll32.exe`. The log shows `open link failed: …` if that call fails.
- **Usage shows "unavailable".** Most likely the Claude login has expired; run `claude` once in a terminal to refresh it. The usage endpoint is also undocumented, so a change on Anthropic's side can break it.
