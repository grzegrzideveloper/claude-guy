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
- [x] **Test użytkownika na macOS** (`npm install && npm start`)
- [ ] **Test użytkownika na Windows**
- [ ] Do weryfikacji na Windows: wklejanie obrazka (Ctrl+V przy obrazku w schowku wysyła Alt+V)
- **Gotowe gdy:** na Macu i Windowsie apka startuje z `npm start`, pokazuje sesje, wznawia je w zakładkach, tworzy nowe, a po restarcie przywraca zakładki. Zrobione i sprawdzone na Linuksie headless (lista, zakładki z PTY, dialog, przywracanie, czyszczenie env)

### Etap 2 — grupowanie i organizacja
- [x] **Statusy definiowane przez użytkownika** (zastępują też kategorie z oryginału; ewentualny podział na statusy i kategorie po testach):
  - wbudowane: **In progress** (na górze; sesja trafia tu automatycznie po otwarciu w nowej zakładce) i **Completed** (na dole, domyślnie zwinięty); można zmienić nazwę i kolor, nie można usunąć
  - własne: „+ Status” (nazwa + kolor z palety), prawy klik na nagłówku: zmień nazwę, kolor, wyżej/niżej, usuń (sesje wracają do grup automatycznych)
  - stałe wewnętrzne ID statusu, więc zmiana nazwy nie gubi przypisań
- [x] Grupy automatyczne: task `DEV-…`, a bez taska projekt (folder). Kolejność: Ostatnie, In progress, własne statusy, taski (wg mtime), projekty (wg mtime), Completed
- [x] Wykrywanie `DEV-…`: własna nazwa → pierwszy prompt (ID lub URL ClickUp) → ostatnia gałąź git
- [x] Przenoszenie: drag & drop, menu prawego przycisku („Przenieś do”), dialog przy zamykaniu zakładki (karty statusów + „Automatycznie”; Enter = tylko zamknij, Esc = anuluj)
- [x] Menu sesji (sidebar i zakładka): Otwórz, Zmień nazwę, Przywróć nazwę, Kopiuj ID sesji, Otwórz w ClickUp, Przenieś do, (zakładka) Zamknij
- [x] Zmiana nazwy tylko w apce; `DEV-…` w nazwie przypisuje task
- [x] Zwijanie grup (zapamiętane), znacznik otwartej i oglądanej sesji
- [x] Ustawienia (okno): prefiks tasków, ID workspace'u ClickUp. Badge `DEV-…` otwiera `https://app.clickup.com/t/<workspaceId>/DEV-123`

- [x] Test użytkownika — pominięty, model zastąpiony w etapie 3
- Dodatkowo: nagłówek grupy taska pokazuje tytuł najnowszej sesji (do czasu tytułów z ClickUp w etapie 4)

### Etap 3 — przebudowa sidebaru: task jako grupa, status jako cecha sesji
Zmiana modelu z etapu 2: status nie jest już grupą, do której sesja „wyjeżdża”. Grupą jest task (albo projekt), a status to etykieta sesji wewnątrz grupy.
- [x] Trzy zakładki na górze sidebaru: **Sesje**, **Taski** (zawartość w etapie 4; do tego czasu informacja), **Historia** (płaska lista wszystkich sesji od najnowszej, bez grup, z filtrem i pełną datą)
- [x] Limit wczytywanych sesji 200 → 500 (dla Historii)
- [x] Zakładka Sesje:
  - Ostatnie (3), potem grupy **task `DEV-…`** i **projekt** (sesje bez taska), sortowane wg ostatniej aktywności
  - w grupie: sesje z kropką i nazwą statusu (In progress, własne, Completed albo „bez statusu”)
  - **Completed** na dole, zwinięte: grupy, w których *wszystkie* sesje mają status Completed
  - wznowienie sesji z grupy w Completed ustawia ją na In progress, więc grupa wraca na listę
- [x] Statusy sesji: wbudowane In progress i Completed + własne (jak w etapie 2: + Status, edycja, kolejność, usuwanie)
- [x] Zmiana statusu sesji: menu prawego przycisku, dialog przy zamykaniu zakładki (już jest), przeciągnięcie nie zmienia już statusu (grupy to taski)
- [x] Menu nagłówka grupy: „Oznacz wszystkie sesje jako…”, otwórz w ClickUp, nowa sesja dla tego taska / projektu
- [x] Migracja przypisań z etapu 2 (statusy zostają, zmienia się tylko sposób wyświetlania)
- [x] **Jednorazowe porządkowanie** przy pierwszym uruchomieniu etapu 3: sesje bez statusu otwarte w zakładkach albo używane w ostatnich 2 dniach → In progress, pozostałe → Completed; statusy nadane wcześniej zostają. Powiadomienie z liczbą sesji i przyciskiem **Cofnij**
- [x] Okno **Statusy** (zamiast „+ Status”): lista statusów, dodawanie, zmiana nazwy i koloru, kolejność, usuwanie
- [x] Okno **Nowa sesja**: folder (z podpowiedzią, zawsze do zatwierdzenia) + nazwa w jednym oknie; z menu grupy podpowiada folder ostatniej sesji i `DEV-…` w nazwie
- [x] Powiadomienia (toast) w rogu okna — używane też w etapie 5
- [ ] **Test użytkownika** (macOS)

### Etap 4 — ClickUp: zakładka Taski
Apka ma działać u wielu osób: nic nie jest wpisane na sztywno, każdy podaje własny token.
- [x] **Pierwsze uruchomienie:** okienko „Skonfigurować ClickUp?” (Tak / Nie teraz), potem kreator: token z instrukcją → Połącz (weryfikacja) → wybór workspace'u → Zapisz
- [x] Ustawienia → ClickUp: osobisty token API (`pk_…`, ClickUp → Settings → Apps), zapisany przez `safeStorage`, nie opuszcza procesu main
- [x] Po zapisaniu tokenu: `GET /v2/user` (`userId`), `GET /v2/team` (workspace; przy kilku wybór). Uzupełnia `clickupWorkspaceId`
- [x] Pobieranie: `GET /v2/team/{workspaceId}/task?assignees[]={userId}&subtasks=true&include_closed=true`, stronicowanie po 100. Ukrywane statusy: domyślnie dokładnie `Closed` (bez rozróżniania wielkości liter), lista w ustawieniach. Do sprawdzenia na prawdziwych danych, czy `include_closed=false` + filtr nazwy nie jest szybsze (mniej stron)
- [x] Cache w `clickup-tasks.json`, odświeżanie ręczne (↻) + co 10 min
- [x] Widok: grupy **Folder → Lista** (np. TimeTax → Speedtax). W wierszu: `DEV-…`, nazwa, status (kolor z ClickUp), priorytet, termin, liczba sesji tego taska
- [x] Wyszukiwarka; kliknięcie taska rozwija akcje: **+ Sesja**, Otwórz w ClickUp, Pokaż sesje (przełącza na zakładkę Sesje z filtrem)
- [x] **Nowa sesja z taska:** dialog z nazwą `DEV-123 <tytuł taska>` (do edycji) i folderem **podpowiedzianym** na podstawie ostatniego folderu użytego dla tej samej listy ClickUp (fallback: ten sam folder ClickUp). Użytkownik zawsze zatwierdza albo zmienia folder, apka nie wybiera sama. Sesja startuje ze statusem In progress
- [x] Nagłówki grup taska w zakładce Sesje pokazują tytuł z ClickUp (zamiast tytułu najnowszej sesji)
- [x] Brak tokenu / 401: komunikat z instrukcją; reszta apki działa
- [x] **Test użytkownika** z prawdziwym ClickUp (macOS) — po poprawce okna Nowa sesja (kolizja klasy `.empty`)

### Etap 5 — automatyczna zmiana statusu z ClickUp
- [x] Przy każdym odświeżeniu tasków: dla grup z sesjami, które nie są Completed, sprawdź status taska (taski spoza listy otwartych: `GET /v2/task/{id}?custom_task_ids=true&team_id=…`, max 40 na odświeżenie)
- [x] Task w statusie `Closed` → wszystkie jego sesje dostają Completed (także otwarte w zakładkach — zakładki zostają otwarte), grupa przechodzi do sekcji Completed
- [x] **Powiadomienie** (toast w rogu okna): „DEV-123 zamknięty w ClickUp — 2 sesje oznaczone jako Completed” z przyciskiem **Cofnij**; zostaje do zamknięcia albo ~15 s
- [x] Cofnięcie zapamiętuje wyjątek, żeby ta sama zmiana nie wracała przy kolejnym odświeżeniu (do czasu następnej zmiany statusu taska)
- [ ] **Test użytkownika** z prawdziwym ClickUp (task zamknięty w ClickUp)

### Etap 6 — treść taska w apce i kontekst taska w sesji
- [x] **Widok taska** (bez przeglądarki): nagłówek (ID, tytuł, status, priorytet, termin, lista/folder, osoby, tagi, ↗ ClickUp, ↻), opis (Markdown → HTML przez `marked` + `DOMPurify`), załączniki (obrazki jako miniatury z powiększeniem, reszta jako lista otwierana w przeglądarce), checklisty, subtaski, komentarze (tylko odczyt)
- [x] Obrazy i załączniki pobiera main (`clickup:attachment`, tylko domeny ClickUp, limit rozmiaru) i oddaje jako `data:` URL — CSP rendera bez zmian
- [x] Linki w opisie i komentarzach otwierają się w przeglądarce (tylko https)
- [x] **Przełącznik w zakładce sesji** z taskiem: [Terminal] [Task DEV-123] nad terminalem; terminal działa dalej w tle
- [x] **Podgląd z zakładki Taski** (przycisk „Podgląd” i menu): osobna zakładka bez terminala, nie zapamiętywana po restarcie
- [x] **Kontekst taska w sesji** (tylko sesje utworzone z taska, `groups.fromTask`): przy każdym starcie i wznowieniu `claude … --append-system-prompt "<ID, tytuł, link, instrukcja: szczegóły przez MCP ClickUp, gdy potrzebne>"`. Wsparcie flagi wykrywane raz z `claude --help`; bez niej — awaryjnie wpisanie `DEV-123 ` w pole promptu nowej sesji (bez wysyłania)
- [x] **„Zacznij od pobrania taska”** (checkbox w oknie Nowa sesja z taska, domyślnie wyłączony): pierwszy prompt „Pobierz przez MCP ClickUp task DEV-123 … i streść, co jest do zrobienia” (zużywa limit)
- [ ] **Test użytkownika** (macOS): `npm install` (nowe zależności `marked`, `dompurify`), podgląd prawdziwego taska z załącznikami, sesja z taska z kontekstem i z pierwszym promptem

### Etap 7 — Usage (limity planu)
- [ ] Odczyt tokenu OAuth: macOS z Keychain (`security find-generic-password …`, do weryfikacji nazwa wpisu), Windows z `~/.claude/.credentials.json`
- [ ] `GET /api/oauth/usage` (nieudokumentowany), paski 5 h i tygodniowe, odświeżanie co 5 min + przycisk, miejsce: dół sidebaru
- [ ] Zachowanie gdy endpoint nie działa: „niedostępne”, bez crasha

### Etap 8 — Hubstaff (opcjonalnie)
- [ ] Sprawdzić plan firmy (API od planu Team) i możliwość utworzenia Personal Access Token
- [ ] Wymiana refresh tokenu na access token (24 h), przypomnienie o wygaśnięciu PAT (90 dni)
- [ ] Widżet tylko do odczytu: dzisiejszy / tygodniowy przepracowany czas

### Później
- [ ] Wariant C: runtime `wsl` (`wsl.exe -e claude`, transkrypty z `\\wsl$\…`, polling zamiast `fs.watch`, konwersja ścieżek `wslpath`)
- [ ] Pakowanie: `electron-builder` (dmg / nsis), ikona, start z Docka / menu Start
- [ ] Ekran ustawień w UI
- [ ] `safeStorage`: przejście na API async (`isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync`) — obecne wywołania sync dają ostrzeżenia o deprecjacji w Electron 45
- [ ] Panel repo / PR

## Ustalone
- macOS: zamknięcie okna kończy apkę (jak na Windows)
- Windows: sesje Claude Code są natywne, więc wariant A je widzi; wariant C nie jest pilny
- Sidebar: zakładki Sesje / Taski; w Sesjach grupą jest task lub projekt, a status (In progress, własne, Completed) jest cechą sesji. Grupa z samymi Completed trafia do zwiniętej sekcji Completed
- Status zmienia się ręcznie (menu, dialog przy zamykaniu) i automatycznie, gdy task w ClickUp ma status `Closed` (z powiadomieniem i Cofnij); dotyczy też sesji otwartych w zakładkach, bez zamykania zakładek
- Ukrywany status tasków w ClickUp: dokładnie `Closed`
- Folder nowej sesji z taska: apka podpowiada, użytkownik zatwierdza
- Stare sesje bez statusu: jednorazowe porządkowanie (otwarte i z ostatnich 2 dni → In progress, reszta → Completed) z Cofnij
- Zakładka Historia: płaska lista wszystkich sesji

## Otwarte pytania
- Jaki skrót wkleja obrazek w natywnym Claude Code na Windowsie — do sprawdzenia w etapie 1
- Hubstaff: plan firmy i uprawnienia do API
