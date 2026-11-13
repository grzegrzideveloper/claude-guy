# claude-gui

Okno desktopowe dla Claude Code na macOS i Windows. Sesje są po lewej, każda otwiera się jako zakładka z terminalem po prawej. Na dole panel z limitami planu, a docelowo także taskami z ClickUp i czasem z Hubstaff.

> **Status:** w budowie. Postęp i plan w [`PLAN.md`](PLAN.md).

## Wymagania
- macOS 13+ albo Windows 10 1809+ / 11 (natywnie, bez WSL)
- Node.js LTS
- Zainstalowany i zalogowany Claude Code (`claude` działa w terminalu)

## Uruchomienie
```bash
npm install
npm start
```

## Gdzie są dane
Ustawienia, grupy i zapamiętane zakładki:
- macOS: `~/Library/Application Support/claude-gui/`
- Windows: `%APPDATA%\claude-gui\`

Sesje Claude'a zostają w `~/.claude/projects/`. Apka je tylko czyta i nigdy nie zmienia.
