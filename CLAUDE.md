# claude-gui: Electron GUI dla Claude Code (macOS + Windows)

Desktopowa nakładka na CLI `claude`, działająca natywnie na macOS i Windows:
- sidebar z sesjami, grupowanymi wg statusu, kategorii, taska ClickUp (`DEV-123`) i projektu
- jedna zakładka z terminalem na sesję (`claude --resume <id>`)
- dolny panel: limity planu, później taski ClickUp i czas z Hubstaff

Plan i stan prac: `PLAN.md` (aktualizuj checkboxy po każdym kroku). Dokumentacja dla użytkownika: `README.md` (trzymaj w zgodzie z zachowaniem apki).
`docs/reference/` to dokumentacja projektu-wzorca `my_claude` (WSL2 + Jira). Traktuj ją jako źródło sprawdzonych rozwiązań, nie jako specyfikację: wszystko związane z WSLg, Jirą i `/ready-to-merge` u nas nie obowiązuje.

## Uruchamianie
- `npm install` na docelowej maszynie (patrz Gotchas: `node_modules` jest per-platforma).
- `npm start` uruchamia `electron .`.
- `npm run check` — `node --check` na wszystkich plikach JS.
- `npm run shot -- out.png 1400 900` — headless zrzut UI (`scripts/screenshot.js`).
- Restart apki zabija wszystkie `claude` w zakładkach (zakładki wracają z `tabs.json`, ale trwające generowanie przepada). Zanim poprosisz użytkownika o restart, uprzedź go.

## Architektura

| Plik | Rola |
|---|---|
| `main.js` | Proces main: okno (zamknięcie okna = koniec apki także na macOS), menu zależne od systemu, single-instance lock, rejestracja IPC, `fs.watch` → `sessions:changed` (debounce 1,5 s), zamykanie (kill PTY, `app.exit(0)`) |
| `preload.js` | Jedyny most: `window.api`. Trzymaj go wąskim |
| `src/platform.js` | Różnice OS: PATH z powłoki logowania (macOS), odnajdywanie binarki `claude`, `openExternal` (tylko https), modyfikator skrótów |
| `src/runtime/index.js` | Wybór runtime'u. Na razie tylko `native` |
| `src/runtime/native.js` | `projectsDir()`, `spawnSpec({ resumeId \| sessionId, cwd })`, `cleanEnv()`. Tu i tylko tu wiadomo, jak i gdzie działa `claude` (pod przyszły runtime `wsl`) |
| `src/sessions.js` | `listSessions(limit=200)` — szczegóły niżej |
| `src/store.js` | Atomowy odczyt/zapis JSON w `app.getPath('userData')` |
| `src/pty.js` | Jeden PTY na zakładkę (`@lydell/node-pty`) |
| `src/usage.js` | (etap 3) limity planu |
| `src/clickup.js` | (etap 4) REST ClickUp |
| `src/hubstaff.js` | (etap 5) czas pracy |
| `renderer/` | `index.html`, `style.css` i zwykłe skrypty (bez ES modules, kolejność w `index.html`): `util.js` (`$`, `el`, `relTime`), `dialogs.js` (`Dialogs.promptName`), `sidebar.js` (`Sidebar`), `tabs.js` (`Tabs`), `app.js` (`App`, start). xterm i fit addon jako UMD z `../node_modules` (globalne `Terminal`, `FitAddon.FitAddon`) |
| `scripts/screenshot.js` | Off-screen render prawdziwego UI do PNG |

### Kanały IPC
- sesje: `sessions:list`, `session:pickFolder`, `session:newId` (uuid z main), `session:start({ tabId, sessionId, cwd, isNew, cols, rows })` — `isNew` → `--session-id <uuid>` (renderer zna ID zanim powstanie transkrypt), inaczej `--resume <id>`. `tabId === sessionId`
- stan: `store:get(name)`, `store:save(name, data)` dla `groups`, `tabs`, `settings`
- terminale: `pty:write`, `pty:resize`, `pty:kill`
- system: `open:external`, `clipboard:read`, `clipboard:write`, `app:info` (platforma, wersja)
- main → renderer: `pty:data`, `pty:exit`, `sessions:changed`
- (etap 3+) `usage:get`, `clickup:*`, `hubstaff:*`

### Pliki danych (`userData`)
| Plik | Zawartość |
|---|---|
| `groups.json` | `{ categories: [name], assignments: { sessionId: groupKey }, titles: { sessionId: name }, collapsed: [groupKey] }` |
| `tabs.json` | `{ tabs: [{ sessionId, cwd }], active }` |
| `settings.json` | `{ runtime: 'native', taskPrefix: 'DEV', clickup: { userId, workspaceId, groupBy: 'folder>list' } }` (bez sekretów) |
| `secrets.bin` | Tokeny ClickUp/Hubstaff zaszyfrowane `safeStorage`. Czyta tylko main |
| `clickup-tasks.json` | Cache „Moich tasków” (bez tokenu) |

Transkrypty Claude'a (`~/.claude/projects/`) są **tylko czytane**, nigdy edytowane.

### Sesje (`src/sessions.js`)
- Skanuje `<projectsDir>/*/*.jsonl`, sortuje po mtime, czyta pierwsze 64 KB, a dla większych plików także ostatnie 64 KB (najświeższa gałąź git). Nigdy nie czyta całych transkryptów.
- Tytuł: pierwszy prawdziwy prompt użytkownika, fallback `slug`. `cwd` z linii JSON. Sesje bez tytułu lub cwd są pomijane.
- `project`: nazwa ostatniego segmentu `cwd` (działa dla ścieżek `/` i `\`).
- `task`: pierwsze `<taskPrefix>-\d+` (domyślnie `DEV-\d+`) w pierwszym prompcie (także wewnątrz URL ClickUp), inaczej z ostatniej gałęzi `gitBranch` (bez rozróżniania wielkości liter, normalizowane do `DEV-123`).
- Zwraca `{ id, title, cwd, project, mtime, task, branch }`.
- Wznowienie sesji dopisuje do transkryptu linie techniczne, więc mtime rośnie i sesja wskakuje do Recent. To normalne.

### Zakładki (`renderer/tabs.js`)
- `Tabs.create()` tworzy xterm (`lineHeight: 1.15`, font z `app:info`) + fit addon. Ukryte zakładki startują z domyślnym rozmiarem, `activate()` robi fit i wysyła `pty:resize`.
- `persist()` przy otwarciu, zamknięciu i przełączeniu. Main ignoruje zapis `tabs` w trybie headless i po rozpoczęciu zamykania.
- `restore()` raz po pierwszym `loadSessions()`; main (`store:get('tabs')`) odrzuca zakładki bez transkryptu (nowa sesja bez pierwszego promptu nie jest wznawialna).
- Wyjście z `claude` (np. `/exit`) zostawia zakładkę z komunikatem; Enter wznawia (`--resume`).
- „+ Nowa”: `pickFolder` → `Dialogs.promptName({ ok, skip, cancel })` → `newId` → zakładka → `start`. Anuluj (`null`) nic nie startuje, Pomiń (`''`) zostawia domyślny tytuł (pierwszy prompt). Własna nazwa trafia do `groups.json` `titles`.
- Klawisze: macOS — Cmd+C/V z menu Edit (xterm obsługuje zdarzenia copy/paste), Ctrl+C przerywa, Ctrl+V idzie do `claude` (wklejanie obrazka). Windows — `attachCustomKeyEventHandler`: Ctrl+C kopiuje przy zaznaczeniu, Ctrl+Shift+C kopiuje, Ctrl+V/Ctrl+Shift+V wkleja przez `clipboard:read` (z `preventDefault`, inaczej podwójne wklejenie), obrazek → `ESC v` (Alt+V, do weryfikacji). Prawy klik: kopiuj zaznaczenie albo wklej.

### Grupowanie (etap 2)
- `groupKey`: `status:backlog | status:in_progress | status:on_hold | status:review | status:closed`, `cat:<nazwa>`, `task:DEV-123`, `project:<nazwa>`.
- `groupKeyOf(s)`: ważne ręczne przypisanie wygrywa, inaczej `autoKey(s)` = task, a bez taska projekt.
- `taskOf(s)`: `DEV-…` we własnej nazwie wygrywa nad wykrytym.
- Przeniesienie do grupy automatycznej usuwa ręczne przypisanie.
- Otwarcie sesji kliknięciem ustawia `status:in_progress` (tylko gdy powstaje nowa zakładka). Przywracanie zakładek po starcie niczego nie zmienia.
- Sekcje „Ostatnie” i „Wszystkie” (klucze `sec:recent`, `sec:all`) zwija się kliknięciem w nagłówek; stan w `groups.json` `collapsed`, ten sam mechanizm co dla grup. Przy aktywnym filtrze jest jedna niezwijana sekcja „Wyniki”.
- Kolejność: in progress, review, on hold, backlog, kategorie, taski (wg mtime), projekty (wg mtime), closed. Taski, projekty i closed domyślnie zwinięte.
- Podczas edycji nazwy w sidebarze odświeżenie z `fs.watch` jest odkładane, żeby nie zniszczyć inputa.

## Zasady
- **Apka jest dla wielu osób.** Żadnych nazw firmy, ID workspace'ów, userów, ścieżek ani prefiksów na sztywno w kodzie. Wszystko z ustawień albo wykrywane (np. user i workspace z API ClickUp).
- **Zero tokenów w sidebarze.** Wszystko z lokalnego parsowania. Żadnego `claude -p` ani API Anthropic do budowania listy. Wywołania zużywające limit tylko na wyraźne kliknięcie.
- **Sekrety tylko w main.** Token OAuth Claude'a, tokeny ClickUp i Hubstaff: nigdy w logach, IPC, plikach JSON ani w kodzie. Tokeny ClickUp/Hubstaff zapisujemy przez `safeStorage` (Keychain / DPAPI).
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Nowe możliwości = handler IPC w `main.js` + metoda w `preload.js`.
- Tytuły sesji, własne nazwy, nazwy kategorii i dane z ClickUp to treść użytkownika: tylko `textContent`, nigdy `innerHTML`.
- `open:external` przyjmuje tylko `https:`.
- Zapisy configu atomowe (tmp + rename).
- Ścieżki zawsze przez `path` i `os.homedir()`. Żadnych `~` ani `/` na sztywno.
- Kolory jako zmienne CSS w `renderer/style.css` `:root` (ciemny motyw, akcent `#d97757`). Statusy: in progress `--warn`, review `#58a6ff`, on hold `#db61a2`, backlog `--muted`, closed `#3fb950`.

## Gotchas (macOS / Windows)
- **PATH na macOS:** apka uruchomiona z Findera/Docka nie ma PATH z `.zshrc`, więc `claude` nie zostanie znaleziony. `platform.js` przy starcie pobiera środowisko z `$SHELL -ilc` (z timeoutem) i dopisuje brakujące katalogi na końcu PATH (aktualny PATH ma pierwszeństwo).
- **Menu i skróty na macOS:** bez menu nie działają Cmd+C/V/Q. Ustawiamy minimalne menu App + Edit z rolami. Nie dodajemy własnej obsługi Cmd+C/V w terminalu, bo paste wykonałby się dwa razy. Brak menu View, więc nie ma Cmd+R reload.
- **Windows:** `Menu.setApplicationMenu(null)`, skróty jak w Windows Terminal obsługuje `attachCustomKeyEventHandler` w xterm. Ctrl+C bez zaznaczenia musi trafić do `claude` jako przerwanie.
- **Uruchamianie `claude` na Windows:** spawn `claude.exe` (zwykle `%USERPROFILE%\.local\bin`) przez ConPTY, nie skryptu shellowego. Ścieżkę rozwiązuje `platform.js` (`where claude`).
- **Zmienne sesji-rodzica:** uruchomienie apki z wnętrza sesji Claude'a przekazuje zmienne typu `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_CHILD_SESSION`. Wtedy `claude` w zakładce pokazuje „Transcript saving is off” i sesji nie da się wznowić. `cleanEnv()` usuwa je z env każdego PTY (lista jawna, w `runtime/native.js`).
- **Testy po stronie Claude'a:** shell na komputerze użytkownika (`device_bash`, linuksowa VM) nie pobierze binarki Electrona — tam tylko moduły Node w kopii poza projektem (`$HOME/build`). Kontener chmurowy (`Bash`) pobiera Electrona przez proxy: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=~/.ccr/ca-bundle.crt node node_modules/electron/install.js`, potem zrzuty przez `xvfb-run -s "-screen 0 1600x1000x24" ./node_modules/.bin/electron scripts/screenshot.js out.png 1400 860 --no-sandbox --disable-gpu`. Pliki przenosi się `device_stage_files`, a poprawki wracają do folderu użytkownika przez `device_bash`.
- **`node_modules` jest per-platforma** (binarka Electrona, prebuildy node-pty). Nie kopiuj go między Makiem a Windowsem. Shell Claude'a (`device_bash`) działa w linuksowej VM: tam nie rób `npm install` w folderze projektu, tylko w kopii poza nim (do testów headless).
- **Fonty terminala:** macOS `Menlo`/`SF Mono`, Windows `Cascadia Mono`/`Consolas`, fallback `monospace`. Przy `lineHeight: 1.0` xterm potrafi ucinać `_`, więc używamy `1.15`.
- **Układ:** `#app` to grid z `grid-template-rows: minmax(0, 1fr)`, a `#sidebar`/`#main` mają `min-height: 0`. Bez tego długa lista sesji rozpycha wiersz ponad okno: sidebar przestaje się przewijać, a terminal dopasowuje się do zawyżonej wysokości i ucina dół. Każdy nowy kontener flex/grid z przewijaną zawartością potrzebuje `min-height: 0`.
- **Padding terminala** ustawiamy na `.xterm`, nie na `.term`: FitAddon odejmuje padding elementu terminala, ale nie rodzica, więc padding na rodzicu daje o jeden wiersz za dużo i prompt wystaje poza okno.
- **Paski przewijania** są stylowane `::-webkit-scrollbar`, więc widać je zawsze (macOS domyślnie ukrywa nakładkowe paski).
- **Glify** spoza fontów systemowych (np. ⧉) renderują się jako puste prostokąty. Ikony robimy inline SVG.
- **`fs.watch` recursive** działa natywnie na macOS i Windows. Pod runtime `wsl` (`\\wsl$`) będzie potrzebny polling.

## Weryfikacja zmian
- `npm run check`.
- UI: `npm run shot -- out.png 1400 900`, potem obejrzyj PNG.
  - `SHOT_JS="…"` wykonuje JS na stronie 300 ms przed zrzutem. Jeśli wyrażenie zwraca Promise (np. dialog), zakończ je `; 0`.
  - Tryb headless (`--claude-gui-headless`) nie przywraca ani nie zapisuje zakładek i nie spawnuje `claude`.
  - Testy zapisujące stan: ustaw `CLAUDE_GUI_DATA_DIR` na kopię danych, żeby nie nadpisać prawdziwych.
  - Sztuczne sesje: `CLAUDE_CONFIG_DIR=/tmp/fk` z plikami `/tmp/fk/projects/<dir>/<uuid>.jsonl`.
  - Terminal w zrzucie: `CLAUDE_GUI_SHOT_SPAWN=1` + `PATH` z atrapą `claude` (skrypt wypisujący argumenty i `exec bash`), np. `SHOT_JS="Tabs.open(App.sessions[0]); new Promise(r=>setTimeout(r,1500)).then(()=>0)"`.
- `node -e "console.log(require('./src/sessions').listSessions(5))"`.
- Prawdziwy test robi użytkownik: `npm start` na Macu i na Windowsie.
