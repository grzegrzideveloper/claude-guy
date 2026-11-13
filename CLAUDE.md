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
| `src/runtime/native.js` | `projectsDir()`, `spawnSpec({ resumeId \| sessionId, cwd, appendSystemPrompt, initialPrompt })`, `detectCaps()` (`claude --help` → czy jest `--append-system-prompt`), `cleanEnv()`. Tu i tylko tu wiadomo, jak i gdzie działa `claude` (pod przyszły runtime `wsl`) |
| `src/sessions.js` | `listSessions(limit=200)` — szczegóły niżej |
| `src/store.js` | Atomowy odczyt/zapis JSON w `app.getPath('userData')` |
| `src/pty.js` | Jeden PTY na zakładkę (`@lydell/node-pty`) |
| `src/usage.js` | Limity planu: token OAuth Claude Code (macOS: Keychain `security find-generic-password -s "Claude Code-credentials" -w`, fallback/Windows: `<claudeDir>/.credentials.json` → `claudeAiOauth.accessToken`) → `GET https://api.anthropic.com/api/oauth/usage` z `anthropic-beta: oauth-2025-04-20`. Nieudokumentowany endpoint; każdy błąd → `{ ok: false, reason }` |
| `src/clickup.js` | REST ClickUp v2 z osobistym tokenem (nagłówek `Authorization: <token>` bez „Bearer”): `getUser`, `getTeams`, `getMyTasks` (`/team/{id}/task?assignees[]=…&include_closed=false&subtasks=true`, strony po 100, odfiltrowane `hiddenStatuses`, domyślnie `closed`), `getTask` (custom ID → `?custom_task_ids=true&team_id=…`), `getTaskDetail` (opis Markdown, załączniki, checklisty, subtaski, komentarze), `fetchAttachment` (tylko https i hosty ClickUp → `data:` URL, limit 15 MB; typ obrazka rozpoznawany po sygnaturze bajtów, bo oryginały przychodzą jako `application/octet-stream`; odpowiedź 401/403 albo 200 z HTML (strona logowania przy workspace'ach wymagających logowania do załączników) → ponowienie z tokenem; nieudane pobrania logowane z hostem i statusem, bez URL i tokenu) |
| `src/secrets.js` | Sekrety (token ClickUp) zaszyfrowane `safeStorage` w `secrets.bin`. Tylko main |
| `src/hubstaff.js` | (etap 5) czas pracy |
| `renderer/` | `index.html`, `style.css` i zwykłe skrypty (bez ES modules, kolejność w `index.html`): `util.js` (`$`, `el`, `relTime`, `fullTime`), `taskview.js` (`TaskView`: widok taska), `usage.js` (`Usage`: limity planu na dole sidebaru), `menu.js` (`CtxMenu`), `toast.js` (`Toasts`), `groups.js` (`Groups`, `PALETTE` — model grup), `dialogs.js` (`Dialogs`: `promptName`, `statusEditor`, `manageStatuses`, `newSession`, `askCloseTab`, `settings`; jedno okno naraz — otwarcie nowego porzuca poprzednie), `sidebar.js` (`Sidebar`), `tabs.js` (`Tabs`), `app.js` (`App`, start). xterm i fit addon, `marked` i `DOMPurify` jako UMD z `../node_modules` (globalne `Terminal`, `FitAddon.FitAddon`, `marked`, `DOMPurify`) |
| `scripts/screenshot.js` | Off-screen render prawdziwego UI do PNG |

### Kanały IPC
- sesje: `sessions:list`, `session:pickFolder`, `session:newId` (uuid z main), `session:start({ tabId, sessionId, cwd, isNew, cols, rows, taskContext?, initialPrompt? })` — `isNew` → `--session-id <uuid>` (renderer zna ID zanim powstanie transkrypt), inaczej `--resume <id>`. `tabId === sessionId`
- stan: `store:get(name)`, `store:save(name, data)` dla `groups`, `tabs`, `settings`
- terminale: `pty:write`, `pty:resize`, `pty:kill`
- system: `open:external`, `clipboard:read`, `clipboard:write`, `app:info` (platforma, wersja)
- main → renderer: `pty:data`, `pty:exit`, `sessions:changed`
- ClickUp: `clickup:status` (bez tokenu: `configured`, user, workspace), `clickup:connect(token)` (weryfikuje, trzyma token w pamięci main), `clickup:save({ teamId })` (zapisuje token do `secrets`, user/workspace do `settings.clickup`), `clickup:disconnect`, `clickup:tasks({ force })` (cache 2 min w `clickup-tasks.json`, równoległe wywołania dołączają do trwającego), `clickup:taskStatuses(keys)` (status pojedynczych tasków, max 40 na wywołanie, 4 równolegle), `clickup:taskDetail(key)`, `clickup:attachment(url)`
- `usage:get({ force })` → `{ ok, windows: [{ key, label, pct, resetsAt }], fetchedAt }` albo `{ ok: false, reason }`; cache min. 60 s (także z force), bez force ~4,5 min
- (później) `hubstaff:*`

### Pliki danych (`userData`)
| Plik | Zawartość |
|---|---|
| `groups.json` | `{ statuses: [{ id, name, color, builtin? }], assignments: { sessionId: 'status:<id>' }, titles: { sessionId: name }, collapsed: { key: bool }, ui: { tab }, v3?: true, autoCloseSkip: { 'DEV-123': true }, fromTask: { sessionId: 'DEV-123' } }`. `Groups.normalize()` uzupełnia wbudowane statusy i migruje starsze formaty; `v3` = jednorazowe porządkowanie już zrobione |
| `tabs.json` | `{ tabs: [{ sessionId, cwd }], active }` |
| `settings.json` | `{ runtime, taskPrefix, clickupWorkspaceId, onboarding: { clickupAsked }, folders: { list: { listId: cwd }, folder: { folderId: cwd } }, clickup: { userId, username, email, teamId, teamName, hiddenStatuses } }`. Bez sekretów. `clickup` zapisuje wyłącznie main (przy `store:save('settings')` z renderera main nadpisuje go wartością z dysku) |
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
- Dwa rodzaje: **sesja** (`kind: 'session'`, id = sessionId, xterm + PTY) i **podgląd taska** (`kind: 'task'`, id `task:<KEY>`, tylko `TaskView`, nie zapamiętywany). `Tabs.has(id)` dotyczy tylko sesji.
- Zakładka sesji to `.pane`: `.pane-bar` (przełącznik [Terminal] [Task DEV-123], widoczny gdy sesja ma task i ClickUp jest skonfigurowany), `.term` (xterm), `.taskhost` (`TaskView`). Fit tylko gdy widać terminal (`view === 'term'`).
- `Tabs.create()` tworzy xterm (`lineHeight: 1.15`, font z `app:info`) + fit addon. Ukryte zakładki startują z domyślnym rozmiarem, `activate()` robi fit i wysyła `pty:resize`.
- `persist()` przy otwarciu, zamknięciu i przełączeniu. Main ignoruje zapis `tabs` w trybie headless i po rozpoczęciu zamykania.
- `restore()` raz po pierwszym `loadSessions()`; main (`store:get('tabs')`) odrzuca zakładki bez transkryptu (nowa sesja bez pierwszego promptu nie jest wznawialna).
- Wyjście z `claude` (np. `/exit`) zostawia zakładkę z komunikatem; Enter wznawia (`--resume`).
- „+ Nowa”: `pickFolder` → `Dialogs.promptName({ ok, skip, cancel })` → `newId` → zakładka → `start`. Anuluj (`null`) nic nie startuje, Pomiń (`''`) zostawia domyślny tytuł (pierwszy prompt). Własna nazwa trafia do `groups.json` `titles`.
- Klawisze: macOS — Cmd+C/V z menu Edit (xterm obsługuje zdarzenia copy/paste), Ctrl+C przerywa, Ctrl+V idzie do `claude` (wklejanie obrazka). Windows — `attachCustomKeyEventHandler`: Ctrl+C kopiuje przy zaznaczeniu, Ctrl+Shift+C kopiuje, Ctrl+V/Ctrl+Shift+V wkleja przez `clipboard:read` (z `preventDefault`, inaczej podwójne wklejenie), obrazek → `ESC v` (Alt+V, do weryfikacji). Prawy klik: kopiuj zaznaczenie albo wklej.

### Sidebar i grupowanie (`renderer/sidebar.js`, `groups.js`)
- Trzy zakładki (`App.groups.ui.tab`): **Sesje** (`renderSessions`), **Taski** (`renderTasks`, niżej), **Historia** (`renderHistory`: płaska lista wszystkich wczytanych sesji, pełna data). Filtr jest wspólny, placeholder zależy od zakładki.
- **Grupy są automatyczne:** `Groups.keyOf(s)` = `task:DEV-123` (z własnej nazwy, pierwszego promptu albo gałęzi) albo `project:<nazwa>`. Ręcznie nie przenosi się sesji między grupami.
- **Status to cecha sesji:** `assignments[sessionId] = 'status:<id>'`, `Groups.statusOf(s)` zwraca status albo `null` („bez statusu”). Wbudowane `in_progress` i `completed` (nie do usunięcia), reszta własna (`s_<losowe>`), zarządzana w oknie Statusy (`Dialogs.manageStatuses`).
- **Completed:** grupa, w której *wszystkie* sesje mają `completed` (`Groups.isDone`), idzie do zwiniętej sekcji `sec:completed` na dole. Wznowienie sesji ustawia `in_progress`, więc grupa wraca do „W toku”.
- Kolejność w Sesjach: Ostatnie (`sec:recent`), „W toku” (grupy wg najnowszej sesji), Completed. Nagłówek grupy: nazwa, (task) tytuł najnowszej sesji bez prefiksu taska (`stripTask`; w etapie 4 tytuł z ClickUp), kropki obecnych statusów, liczba sesji, ikona podglądu taska w apce (`Tabs.openTaskPreview`, gdy ClickUp skonfigurowany) i link do ClickUp w przeglądarce.
- Zwinięcie: `collapsed[key]`. Grupy wewnątrz Completed mają osobny klucz `done|<key>` i są domyślnie zwinięte; `sec:completed` też.
- `Tabs.open()` ustawia `in_progress` tylko przy tworzeniu nowej zakładki; „+ Nowa” też. Przywracanie zakładek niczego nie zmienia.
- Zmiana statusu: menu sesji (`App.sessionMenu`, sekcja Status), menu grupy (`Sidebar.groupMenu`: „Oznacz wszystkie jako…”, nowa sesja dla taska/projektu, ClickUp), dialog zamykania zakładki (`Dialogs.askCloseTab` → id statusu, `'close'` albo `null`).
- **Nowa sesja:** `Tabs.newSession({ cwd, name })` → `Dialogs.newSession` (folder z podpowiedzią, zawsze zatwierdzany przez użytkownika, + nazwa). Z menu grupy/sesji podpowiada folder najnowszej sesji i `DEV-…` w nazwie.
- **Jednorazowe porządkowanie** (`App.migrateV3`, flaga `v3`): sesje bez statusu otwarte w zakładkach albo z ostatnich 2 dni → `in_progress`, reszta → `completed`; toast z Cofnij (usuwa tylko te przypisania).
- Zmiana nazwy przez `Dialogs.promptName`, `App.setTitle(s, null)` przywraca oryginał; `DEV-…` w nazwie przypisuje task. Nazwa nigdy nie trafia do transkryptu.
- Badge `DEV-…` i ikona przy grupie otwierają `https://app.clickup.com/t/<clickupWorkspaceId>/DEV-123`; bez ID workspace'u nie są linkiem.
- Sesja z zakładki bez transkryptu: `Tabs.sessionOf()` zwraca stub; status i nazwa działają po ID.
- `sessions:list` wczytuje do 500 sesji (Historia).

### ClickUp (`renderer/app.js`, `sidebar.js`, `dialogs.js`)
- Pierwsze uruchomienie: `App.onboarding()` raz pyta „Skonfigurować ClickUp?” (`settings.onboarding.clickupAsked`); potem tylko z Ustawień.
- `Dialogs.clickupSetup()`: token (pole `password`) → `clickup:connect` → „Połączono jako …” + wybór workspace'u → `clickup:save`. Pole tokenu jest czyszczone po weryfikacji; renderer nigdy nie dostaje tokenu z main.
- `App.clickup = { status, tasks, fetchedAt, error, loading }`; `App.loadClickup({ force })` przy starcie (cache), co 10 min i przyciskiem ↻.
- Zakładka Taski: drzewo Folder → Lista (lista bez folderu = grupa najwyższego poziomu), sortowane wg ostatniej zmiany; klucze zwinięcia `cu:f:<id>`, `cu:l:<id>`. Wiersz: `DEV-…`, nazwa, status (kolor z ClickUp), priorytet, liczba sesji, termin (czerwony po terminie). Kliknięcie rozwija (`Sidebar.expandedTask`): + Nowa sesja, Otwórz w ClickUp, sesje tego taska. Prawy klik: menu z tymi akcjami + kopiowanie ID/linku.
- `App.newSessionFromTask(t)`: nazwa `DEV-123 <tytuł>`, folder z `App.suggestFolder(t)` (lista → sesja tego taska → folder ClickUp), po utworzeniu `App.rememberFolder`. Użytkownik zawsze zatwierdza folder.
- **Auto-Completed** (`App.syncClosedTasks`, po każdym udanym `loadClickup`): kandydaci to taski z co najmniej jedną sesją nie-Completed, których nie ma na liście otwartych tasków. Ich status jest sprawdzany przez `clickup:taskStatuses`; status z `hiddenStatuses` (`closed`) → wszystkie sesje taska dostają `completed`, także otwarte w zakładkach (zakładki zostają). Toast z Cofnij przywraca poprzednie statusy i wpisuje task do `groups.autoCloseSkip`; wpis znika, gdy task wróci na listę otwartych. Błędy/404 (np. cudze lub usunięte taski) są ignorowane.
- **Widok taska** (`renderer/taskview.js`): `TaskView.show(host, key)` → `clickup:taskDetail` (cache w pamięci, ↻ wymusza). Opis: `marked.parse` → `DOMPurify.sanitize` (bez style/form/iframe/atrybutów style); hook DOMPurify przenosi `src` obrazków do `data-src`, a `wireContent` ładuje je przez `clickup:attachment` (CSP rendera bez zdalnych obrazów). Gdy oryginał nie jest dostępny (u użytkownika: HTML zamiast obrazka nawet z tokenem), `thumbsFor` dopasowuje obrazek do załącznika taska po uuid w ścieżce i pokazuje jego `thumbnail_large`; tak samo lightbox załącznika. Linki → `openExternal` (https). Załączniki: obrazki jako miniatury z lightboxem, reszta otwierana w przeglądarce. Treść tekstowa (komentarze, nazwy) przez `textContent`.
- **Kontekst taska w sesji:** sesje utworzone z taska są w `groups.fromTask[sessionId] = 'DEV-123'`. `Tabs.start` przekazuje `taskContext { key, title, url }`; main buduje z niego tekst i dodaje `--append-system-prompt` przy każdym starcie i wznowieniu (gdy `detectCaps` potwierdzi flagę; inaczej dla nowej sesji wpisuje `DEV-123 ` w prompt bez wysyłania). Checkbox „Zacznij od pobrania taska” w `Dialogs.newSession` → `initialPrompt` (pozycyjny argument `claude`, tylko przy pierwszym starcie). Na Windows przez shim `.cmd` znaki specjalne cmd są usuwane z tych tekstów.
- `App.cuTask(key)` łączy grupę sesji z taskiem: nagłówek grupy pokazuje nazwę z ClickUp, menu grupy otwiera nową sesję przez `newSessionFromTask`.

## Zasady
- **Apka jest dla wielu osób.** Żadnych nazw firmy, ID workspace'ów, userów, ścieżek ani prefiksów na sztywno w kodzie. Wszystko z ustawień albo wykrywane (np. user i workspace z API ClickUp).
- **Zero tokenów w sidebarze.** Wszystko z lokalnego parsowania. Żadnego `claude -p` ani API Anthropic do budowania listy. Wywołania zużywające limit tylko na wyraźne kliknięcie (np. pierwszy prompt „Zacznij od pobrania taska”). Panel Usage odpytuje tylko endpoint z liczbami limitów — nie zużywa limitu.
- **Sekrety tylko w main.** Token OAuth Claude'a, tokeny ClickUp i Hubstaff: nigdy w logach, plikach JSON, kodzie ani w kierunku main → renderer. Jedyny wyjątek: token ClickUp wpisany przez użytkownika idzie raz renderer → main (`clickup:connect`). Zapis przez `safeStorage` (`src/secrets.js`). Nie proś użytkownika o wklejanie tokenów w czacie.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Nowe możliwości = handler IPC w `main.js` + metoda w `preload.js`.
- Tytuły sesji, własne nazwy, nazwy kategorii i dane z ClickUp to treść użytkownika: tylko `textContent`, nigdy `innerHTML`. Jedyny wyjątek: opis taska (Markdown) w `TaskView.toSafeHtml` — zawsze przez `DOMPurify`. Statyczne ikony SVG z kodu mogą iść przez `innerHTML`.
- `open:external` przyjmuje tylko `https:`.
- Zapisy configu atomowe (tmp + rename).
- Ścieżki zawsze przez `path` i `os.homedir()`. Żadnych `~` ani `/` na sztywno.
- Kolory jako zmienne CSS w `renderer/style.css` `:root` (ciemny motyw, akcent `#d97757`). Kolory statusów są w danych (`statuses[].color`), paleta w `PALETTE` (`groups.js`).

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
- **Kolizje nazw klas CSS:** style są globalne. Klasa `.empty` (pełnoekranowy stan „Brak otwartej sesji”) dodana do pola ścieżki w oknie Nowa sesja rozciągnęła je na całe okno i zasłoniła UI. Ogólnych nazw (`empty`, `active`, `open`, `hidden`) używaj tylko z prefiksem komponentu albo selektorem zawężonym (`#empty.empty`). Testy zrzutami muszą obejmować też stany puste (np. dialog bez podpowiedzi folderu).
- **Diagnostyka na żywo:** Cmd+Option+I / Ctrl+Shift+I / F12 otwiera DevTools, Cmd/Ctrl+Shift+R przeładowuje UI (zabija PTY, zakładki wracają przez `--resume`). Skróty sprawdzają `input.code` (`KeyI`), bo na macOS Option zmienia znak. Ostrzeżenia i błędy renderera trafiają do logu (`console-message`).
- **Keychain na macOS:** pierwszy odczyt tokenu Claude Code przez `security` może pokazać systemowe pytanie o dostęp do „Claude Code-credentials” (Zezwól / Zawsze zezwalaj). `execFile` czeka do 90 s; odmowa → fallback na plik, a gdy go nie ma → panel „Niedostępne”.
- **Glify** spoza fontów systemowych (np. ⧉) renderują się jako puste prostokąty. Ikony robimy inline SVG.
- **`fs.watch` recursive** działa natywnie na macOS i Windows. Pod runtime `wsl` (`\\wsl$`) będzie potrzebny polling.

## Weryfikacja zmian
- `npm run check`.
- UI: `npm run shot -- out.png 1400 900`, potem obejrzyj PNG.
  - `SHOT_JS="…"` wykonuje JS na stronie 300 ms przed zrzutem. Jeśli wyrażenie zwraca Promise (np. dialog), zakończ je `; 0`.
  - Tryb headless (`--claude-gui-headless`) nie przywraca ani nie zapisuje zakładek i nie spawnuje `claude`.
  - Testy zapisujące stan: ustaw `CLAUDE_GUI_DATA_DIR` na kopię danych, żeby nie nadpisać prawdziwych.
  - Sztuczne sesje: `CLAUDE_CONFIG_DIR=/tmp/fk` z plikami `/tmp/fk/projects/<dir>/<uuid>.jsonl`.
  - Usage bez prawdziwego API: `CLAUDE_GUI_USAGE_URL=http://127.0.0.1:<port>/…` + `<CLAUDE_CONFIG_DIR>/.credentials.json` z testowym tokenem (na Linuksie nie ma Keychain).
  - ClickUp bez prawdziwego API: lokalna atrapa (node http) i `CLICKUP_API_BASE=http://127.0.0.1:<port>/api/v2`; na Linuksie bez keyringa `CLAUDE_GUI_INSECURE_SECRETS=1`. Obie zmienne tylko do testów.
  - Terminal w zrzucie: `CLAUDE_GUI_SHOT_SPAWN=1` + `PATH` z atrapą `claude` (skrypt wypisujący argumenty i `exec bash`), np. `SHOT_JS="Tabs.open(App.sessions[0]); new Promise(r=>setTimeout(r,1500)).then(()=>0)"`.
- `node -e "console.log(require('./src/sessions').listSessions(5))"`.
- Prawdziwy test robi użytkownik: `npm start` na Macu i na Windowsie.
