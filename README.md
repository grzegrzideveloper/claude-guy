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

## Co już działa

### Sidebar
Na górze trzy zakładki: **Sesje**, **Taski** (Twoje taski z ClickUp) i **Historia**.

**Sesje:**
- Na górze **Ostatnie** (3 ostatnio używane), niżej **W toku**: sesje pogrupowane automatycznie wg taska `DEV-…` (z nazwy sesji, pierwszego promptu albo gałęzi git), a bez taska wg projektu (folderu).
- Każda sesja ma **status**, widoczny jako kolorowa kropka z nazwą: **In progress** (ustawiany sam, gdy otwierasz sesję w nowej zakładce albo tworzysz nową), Twoje własne statusy albo **Completed**.
- Grupa, w której wszystkie sesje są Completed, przechodzi do zwiniętej sekcji **Completed** na dole. Wystarczy otworzyć którąś z jej sesji, żeby wróciła do „W toku”.
- **Automatycznie:** gdy task dostanie w ClickUp status **Closed**, przy najbliższym odświeżeniu (co 10 min albo ↻ w zakładce Taski) jego sesje dostają Completed — także te otwarte w zakładkach (zakładki zostają otwarte). W rogu pojawia się powiadomienie z **Cofnij**; po cofnięciu apka nie zmieni ich ponownie, dopóki task nie wróci do otwartych.
- **Zmiana statusu:** prawy klik na sesji → Status, prawy klik na nagłówku grupy → „Oznacz wszystkie jako…” albo przy zamykaniu zakładki.
- **Statusy** (przycisk w nagłówku): dodawanie, zmiana nazwy i koloru, kolejność, usuwanie. In progress i Completed można przemianować, ale nie usunąć.
- **Prawy klik na sesji** (też na zakładce): Otwórz, Zmień nazwę…, Przywróć oryginalną nazwę, Kopiuj ID sesji, Nowa sesja w tym folderze…, Otwórz DEV-… w ClickUp, Status, (na zakładce) Zamknij zakładkę…
- **Prawy klik na nagłówku grupy:** Nowa sesja dla tego taska / projektu…, Otwórz w ClickUp, Oznacz wszystkie jako…
- **Zmiana nazwy** działa tylko w apce, transkrypt Claude'a się nie zmienia. Wpisanie `DEV-123` w nazwę przypisuje sesję do tego taska.
- **Zwijanie:** sekcje i grupy zwijasz kliknięciem w nagłówek, apka to zapamiętuje.
- **Filtr** szuka po tytule, projekcie, tasku, gałęzi i statusie.
- **Badge `DEV-…`** otwiera task w ClickUp, gdy w **Ustawieniach** (ikona suwaków) podasz ID workspace'u, czyli liczbę z adresu `app.clickup.com/<ID>/…`.

**Podgląd taska:** w zakładce sesji utworzonej z taska (albo z wykrytym `DEV-…`) nad terminalem jest przełącznik **[Terminal] [Task DEV-123]** — widok taska pokazuje opis, załączniki (obrazki z powiększeniem, inne pliki otwierane w przeglądarce), checklisty, subtaski i komentarze. Terminal działa dalej w tle. Podgląd otworzysz też bez sesji: ikona dokumentu w nagłówku grupy taska w Sesjach (obok ikony ↗ do przeglądarki), zakładka Taski → **Podgląd** albo prawy klik na tasku lub grupie → **Podgląd taska** (otwiera się jako osobna zakładka ◆).

**Sesja z taska zna swój task:** apka przekazuje Claude'owi przy każdym starcie i wznowieniu ID, tytuł i link taska z instrukcją, żeby szczegóły pobierał przez MCP ClickUp, kiedy będą potrzebne (nic nie jest wysyłane, dopóki nie napiszesz promptu). W oknie Nowa sesja możesz zaznaczyć **Zacznij od pobrania taska** — Claude od razu pobierze task i streści, co jest do zrobienia (to zużywa limit).

**Taski:** taski z ClickUp przypisane do Ciebie, bez statusu Closed, pogrupowane wg folderu i listy (np. TimeTax → Speedtax). Przy tasku jest status, priorytet, termin i liczba Twoich sesji. Kliknięcie rozwija **+ Nowa sesja**, **Podgląd** (nazwa `DEV-123 <tytuł>`, folder podpowiedziany na podstawie poprzednich sesji z tej listy — zawsze go zatwierdzasz), **Otwórz w ClickUp** i listę sesji tego taska. Lista odświeża się co 10 minut albo przyciskiem ↻.

**Historia:** wszystkie sesje (do 500 ostatnich) w jednej liście od najnowszej, z datą i godziną, bez grupowania.

Przy pierwszym uruchomieniu tej wersji apka jednorazowo porządkuje sesje bez statusu: otwarte i używane w ostatnich 2 dniach dostają In progress, starsze Completed. Powiadomienie w rogu ma przycisk **Cofnij**.

### Zakładki
- Kliknięcie sesji otwiera ją w zakładce (`claude --resume`). Jeśli już jest otwarta, przełącza na nią.
- **+ Nowa** otwiera okno z folderem (**Wybierz…** / **Zmień…**) i opcjonalną nazwą; pusta nazwa = pierwszy prompt. Z menu grupy lub sesji folder i `DEV-…` są podpowiedziane, ale zawsze je zatwierdzasz.
- **×** na zakładce (albo środkowy przycisk myszy) pyta o status sesji. Kliknięcie karty ustawia status i zamyka, **Zamknij bez zmiany** (Enter) tylko zamyka, **Anuluj** (Esc) zostawia zakładkę.
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

## Zużycie planu
Na dole sidebaru są limity planu Claude'a — te same liczby co `/usage` w Claude Code: **Sesja (5 h)**, **Tydzień** (i osobne tygodniowe limity Opus / Sonnet, jeśli Twój plan je ma), z procentem i czasem do resetu. Odświeżają się co 5 minut, po powrocie do okna albo przyciskiem ↻. Sprawdzanie nie zużywa limitu.

Na macOS przy pierwszym odczycie system może zapytać o dostęp do pęku kluczy („Claude Code-credentials”) — wybierz **Zezwól** albo **Zawsze zezwalaj**. Gdy panel pokazuje **Niedostępne**, pod spodem jest powód (najczęściej wygasłe logowanie — wystarczy użyć Claude'a w dowolnej sesji albo uruchomić `claude`). Dane pochodzą z nieoficjalnego endpointu Anthropic, więc mogą przestać działać po zmianie po ich stronie.

## ClickUp
Przy pierwszym uruchomieniu apka pyta, czy skonfigurować ClickUp (można też później: **Ustawienia → ClickUp → Skonfiguruj…**).
1. W ClickUp kliknij awatar → **Settings → Apps**, w sekcji **API Token** kliknij **Generate** albo **Copy**.
2. Wklej token w apce i kliknij **Połącz**. Apka sprawdzi go i pokaże, jako kto jesteś połączony.
3. Wybierz workspace i **Zapisz**.

Każdy używa własnego tokenu, więc każdy widzi swoje taski. Token jest szyfrowany przez system (Keychain na macOS, mechanizm Windows) i nie opuszcza aplikacji. **Odłącz** w Ustawieniach usuwa go z komputera.

## Gdzie są dane
Ustawienia, grupy, zapamiętane zakładki i log (`claude-gui.log`):
- macOS: `~/Library/Application Support/claude-gui/`
- Windows: `%APPDATA%\claude-gui\`

Sesje Claude'a zostają w `~/.claude/projects/`. Apka je tylko czyta i nigdy nie zmienia.
