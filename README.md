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

## Co już działa (etap 1)
- Lista sesji Claude Code: **Ostatnie** (3) i **Wszystkie**, z projektem, taskiem `DEV-…` i czasem ostatniego użycia. Filtr szuka po tytule, projekcie, tasku i gałęzi. Sekcje zwijasz kliknięciem w nagłówek, apka to zapamiętuje.
- Kliknięcie sesji otwiera ją w zakładce (`claude --resume`). Jeśli już jest otwarta, przełącza na nią.
- **+ Nowa**: wybierasz folder, potem nazwę (**Utwórz**), **Pomiń** (nazwą będzie pierwszy prompt) albo **Anuluj**.
- Otwarte zakładki wracają po ponownym uruchomieniu apki. Nowa sesja wraca tylko, jeśli wysłałeś w niej choć jeden prompt.
- Po wyjściu z Claude'a (`/exit`) zakładka zostaje; **Enter** wznawia sesję.

### Klawisze w terminalu
| | macOS | Windows |
|---|---|---|
| Kopiuj | Cmd+C | Ctrl+C (gdy jest zaznaczenie), Ctrl+Shift+C |
| Wklej | Cmd+V | Ctrl+V, Ctrl+Shift+V |
| Przerwij Claude'a | Ctrl+C | Ctrl+C (bez zaznaczenia) |
| Wklej obrazek | Ctrl+V | Ctrl+V (gdy w schowku jest obrazek) |
| Prawy klik | kopiuje zaznaczenie albo wkleja | jak obok |

## Gdzie są dane
Ustawienia, grupy, zapamiętane zakładki i log (`claude-gui.log`):
- macOS: `~/Library/Application Support/claude-gui/`
- Windows: `%APPDATA%\claude-gui\`

Sesje Claude'a zostają w `~/.claude/projects/`. Apka je tylko czyta i nigdy nie zmienia.
