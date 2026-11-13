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
Na górze trzy zakładki: **Sesje**, **Taski** (lista tasków z ClickUp, w przygotowaniu) i **Historia**.

**Sesje:**
- Na górze **Ostatnie** (3 ostatnio używane), niżej **W toku**: sesje pogrupowane automatycznie wg taska `DEV-…` (z nazwy sesji, pierwszego promptu albo gałęzi git), a bez taska wg projektu (folderu).
- Każda sesja ma **status**, widoczny jako kolorowa kropka z nazwą: **In progress** (ustawiany sam, gdy otwierasz sesję w nowej zakładce albo tworzysz nową), Twoje własne statusy albo **Completed**.
- Grupa, w której wszystkie sesje są Completed, przechodzi do zwiniętej sekcji **Completed** na dole. Wystarczy otworzyć którąś z jej sesji, żeby wróciła do „W toku”.
- **Zmiana statusu:** prawy klik na sesji → Status, prawy klik na nagłówku grupy → „Oznacz wszystkie jako…” albo przy zamykaniu zakładki.
- **Statusy** (przycisk w nagłówku): dodawanie, zmiana nazwy i koloru, kolejność, usuwanie. In progress i Completed można przemianować, ale nie usunąć.
- **Prawy klik na sesji** (też na zakładce): Otwórz, Zmień nazwę…, Przywróć oryginalną nazwę, Kopiuj ID sesji, Nowa sesja w tym folderze…, Otwórz DEV-… w ClickUp, Status, (na zakładce) Zamknij zakładkę…
- **Prawy klik na nagłówku grupy:** Nowa sesja dla tego taska / projektu…, Otwórz w ClickUp, Oznacz wszystkie jako…
- **Zmiana nazwy** działa tylko w apce, transkrypt Claude'a się nie zmienia. Wpisanie `DEV-123` w nazwę przypisuje sesję do tego taska.
- **Zwijanie:** sekcje i grupy zwijasz kliknięciem w nagłówek, apka to zapamiętuje.
- **Filtr** szuka po tytule, projekcie, tasku, gałęzi i statusie.
- **Badge `DEV-…`** otwiera task w ClickUp, gdy w **Ustawieniach** (ikona suwaków) podasz ID workspace'u, czyli liczbę z adresu `app.clickup.com/<ID>/…`.

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

## Gdzie są dane
Ustawienia, grupy, zapamiętane zakładki i log (`claude-gui.log`):
- macOS: `~/Library/Application Support/claude-gui/`
- Windows: `%APPDATA%\claude-gui\`

Sesje Claude'a zostają w `~/.claude/projects/`. Apka je tylko czyta i nigdy nie zmienia.
