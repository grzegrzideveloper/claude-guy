# claude-gui — plan

Okno desktopowe dla Claude Code na **macOS i Windows (natywnie)**: sesje po lewej, zakładki z terminalem po prawej, panel informacyjny na dole.
Pomysły pochodzą z `my_claude` kolegi (`docs/reference/`), ale kod piszemy od zera pod nasze potrzeby.

## Decyzje

| Temat | Decyzja |
|---|---|
| Platformy | macOS + Windows natywnie (wariant A). WSL nie jest wspierany na start |
| WSL na później | Wariant C: okno natywne na Windows, `claude` uruchamiany przez `wsl.exe`. Dlatego uruchamianie `claude`, lokalizacja transkryptów i odczyt credentials siedzą w jednym module `src/runtime/` |
| Stack | Electron, `@lydell/node-pty`, `@xterm/xterm` + `@xterm/addon-fit`, czysty HTML/CSS/JS (ES modules), bez bundlera i frameworka |
| Tracker | ClickUp, custom ID `DEV-123` (prefiks konfigurowalny w ustawieniach, domyślnie `DEV`) |
| Wielu użytkowników | Apka będzie udostępniana kolegom: zero danych firmy/osoby na sztywno. Każdy podaje własny token ClickUp, user i workspace wykrywane z API |
| Statusy sesji | Lokalne grupy w apce, nazwane jak w ClickUp: backlog, in progress, on hold, review, closed |
| Grupowanie automatyczne | Task `DEV-…` jeśli wykryty, inaczej projekt (folder) |
| Repo / PR / „ready to merge” | Poza zakresem, może wrócić na końcu |
| Tokeny | Sidebar i grupowanie nigdy nie zużywają limitu planu (tylko lokalne parsowanie plików) |
| Sekrety | Token OAuth Claude'a tylko w procesie main. Tokeny ClickUp/Hubstaff szyfrowane przez Electron `safeStorage`, też tylko w main |
| Dane apki | `app.getPath('userData')` (macOS: `~/Library/Application Support/claude-gui`, Windows: `%APPDATA%\claude-gui`) |

## Etapy

### Etap 0 — dokumentacja i szkielet repo
- [x] `PLAN.md`, `CLAUDE.md`, `README.md`; dokumentacja oryginału w `docs/reference/`
- [x] `git init`, `.gitignore` (bez pierwszego commita: commit robi użytkownik albo Claude na prośbę)
- [x] `package.json`: Electron 45, `@lydell/node-pty` 1.2.0-beta.18, `@xterm/xterm` 6, `@xterm/addon-fit` 0.11; skrypty `start`, `check`, `shot`
- [x] `@lydell/node-pty` ma prebuildy darwin-arm64/x64, win32-x64/arm64, linux; test spawn w sandboxie OK

### Etap 1 — okno, sesje, zakładki (MVP)
- [x] `main.js`: okno, single-instance lock, zamykanie (zabija PTY, zapisuje zakładki)
- [x] Menu zależne od systemu: macOS minimalne menu App + Edit (role), bez View/Reload; Windows bez menu
- [x] `src/platform.js`: PATH z powłoki logowania na macOS, odnajdywanie binarki `claude` (`claude` / `claude.exe`), `openExternal` tylko https
- [x] `src/runtime/native.js`: `projectsDir()`, `spawnSpec({ resumeId | sessionId, cwd })`, czyszczenie zmiennych sesji-rodzica
- [x] `src/sessions.js`: skan `~/.claude/projects/*/*.jsonl`, 64 KB z początku (+64 KB z końca dla dużych plików), tytuł, cwd, projekt, mtime, gałąź git
- [x] `src/store.js`: atomowy zapis JSON (tmp + rename) w `userData`
- [x] `src/pty.js`: jeden PTY na zakładkę, `write/resize/kill`, dane do renderera
- [x] `fs.watch` (recursive) na katalogu projektów → `sessions:changed` (debounce 1,5 s)
- [x] Renderer: lista sesji (Recent + wszystkie, sortowane po mtime), filtr, zakładki xterm, „+ New” (folder → nazwa → start), zamykanie zakładki, przywracanie zakładek po restarcie
- [x] Klawiatura i schowek: macOS Cmd+C/Cmd+V przez menu Edit; Windows jak Windows Terminal (Ctrl+C kopiuje przy zaznaczeniu, inaczej przerywa; Ctrl+V; Ctrl+Shift+C/V; prawy klik). Wklejanie obrazka przekazywane do `claude`
- [x] `scripts/screenshot.js`: headless render UI do PNG
- [ ] **Test użytkownika na macOS** (`npm install && npm start`)
- [ ] **Test użytkownika na Windows**
- [ ] Do weryfikacji na Windows: wklejanie obrazka (Ctrl+V przy obrazku w schowku wysyła Alt+V)
- **Gotowe gdy:** na Macu i Windowsie apka startuje z `npm start`, pokazuje sesje, wznawia je w zakładkach, tworzy nowe, a po restarcie przywraca zakładki. Zrobione i sprawdzone na Linuksie headless (lista, zakładki z PTY, dialog, przywracanie, czyszczenie env)

### Etap 2 — grupowanie i organizacja
- [ ] Grupy: statusy, własne kategorie, taski `DEV-…`, projekty
- [ ] Wykrywanie `DEV-…`: własna nazwa → pierwszy prompt (ID lub URL ClickUp) → ostatnia gałąź git (bez rozróżniania wielkości liter, np. `dev-123-login`)
- [ ] Przenoszenie: drag & drop, menu prawego przycisku („Przenieś do”), dialog przy zamykaniu zakładki
- [ ] Zmiana nazwy sesji (tylko w apce, transkrypt nietknięty), kopiowanie ID sesji
- [ ] „+ Kategoria”, zmiana nazwy kategorii, usuwanie
- [ ] Zwijanie grup (zapamiętane), znacznik otwartej i oglądanej sesji
- [ ] Badge `DEV-…` otwiera task w ClickUp (`https://app.clickup.com/t/<workspaceId>/DEV-123`, workspace z ustawień; bez niego badge bez linku)

### Etap 3 — Usage (limity planu)
- [ ] Odczyt tokenu OAuth: macOS z Keychain (`security find-generic-password …`, do weryfikacji nazwa wpisu), Windows z `~/.claude/.credentials.json`
- [ ] `GET /api/oauth/usage` (nieudokumentowany), paski 5 h i tygodniowe, odświeżanie co 5 min + przycisk
- [ ] Zachowanie gdy endpoint nie działa: „niedostępne”, bez crasha

### Etap 4 — ClickUp: „Moje taski”
Apka ma działać u wielu osób, więc **nic nie jest wpisane na sztywno**. Każdy użytkownik podaje tylko swój token, resztę apka ustala sama.
- [ ] Ustawienia → ClickUp: pole na osobisty token API (`pk_…`, ClickUp → Settings → Apps). Zapis przez `safeStorage`, token nie opuszcza procesu main
- [ ] Po zapisaniu tokenu: `GET /v2/user` (kim jestem → `userId`), `GET /v2/team` (workspace'y; przy kilku wybór z listy). Zapis `userId`, `workspaceId` w `settings.json`
- [ ] Pobieranie: `GET /v2/team/{workspaceId}/task?assignees[]={userId}&subtasks=true&include_closed=false`, stronicowanie po 100, cache w `clickup-tasks.json`
- [ ] Zakładka „Moje taski” w dolnym panelu: grupowanie dwupoziomowe **Folder (klient/projekt, np. TimeTax) → Lista (produkt, np. Speedtax, Skytax)**. Space pomijamy, bo u nas wszystko jest w jednym Space `DEV`. W wierszu: ID `DEV-…`, nazwa, status (kolor z ClickUp), priorytet, termin, sprint
- [ ] Grupowanie wg „home list” taska (`task.folder` / `task.list`). Taski dodane też do list sprintów (folder typu „| TimeTax Sprints”) nie mogą się dublować ani lądować w folderze sprintów — zweryfikować na prawdziwych danych
- [ ] Opcja na później: grupowanie wg custom fielda (np. „Projekt”, „Sprint”), wartości są w `task.custom_fields`
- [ ] Filtr statusów (domyślnie bez `closed`), wyszukiwarka, odświeżanie ręczne + co 10 min
- [ ] Akcje na tasku: otwórz w przeglądarce, kopiuj ID/link, „Nowa sesja” (wybór folderu, nazwa sesji `DEV-123 <tytuł taska>`), „Pokaż sesje” (filtruje sidebar po `DEV-…`)
- [ ] Sidebar: tytuł taska przy grupie `DEV-…` i link w badge'u, brane z cache (bez tokenów Claude'a)
- [ ] Brak tokenu lub błąd 401: komunikat z instrukcją, gdzie wygenerować token; reszta apki działa normalnie
- [ ] Opcjonalnie: akcje przez `claude -p` z MCP ClickUp tylko na żądanie (kosztują limit)

### Etap 5 — Hubstaff (opcjonalnie)
- [ ] Sprawdzić plan firmy (API od planu Team) i możliwość utworzenia Personal Access Token
- [ ] Wymiana refresh tokenu na access token (24 h), przypomnienie o wygaśnięciu PAT (90 dni)
- [ ] Widżet tylko do odczytu: dzisiejszy / tygodniowy przepracowany czas

### Później
- [ ] Wariant C: runtime `wsl` (`wsl.exe -e claude`, transkrypty z `\\wsl$\…`, polling zamiast `fs.watch`, konwersja ścieżek `wslpath`)
- [ ] Pakowanie: `electron-builder` (dmg / nsis), ikona, start z Docka / menu Start
- [ ] Ekran ustawień w UI
- [ ] Panel repo / PR

## Ustalone
- macOS: zamknięcie okna kończy apkę (jak na Windows)
- Windows: sesje Claude Code są natywne, więc wariant A je widzi; wariant C nie jest pilny

## Otwarte pytania
- Jaki skrót wkleja obrazek w natywnym Claude Code na Windowsie — do sprawdzenia w etapie 1
- Hubstaff: plan firmy i uprawnienia do API
