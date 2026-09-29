# Konsulttimer

Tidregistrering per projekt för en ensam konsult: starta timer, skriv en kort arbetsanteckning, och sammanställ ett tydligt **kundunderlag** (utskrift/PDF och CSV). Installerbar webbapp (PWA) på svenska som fungerar offline. Version 0.1.

- Ingen server, inget konto, ingen synkning, inga externa anrop eller analysverktyg.
- Ingen fakturering, moms eller betaltjänst – underlaget är ett *tidsunderlag*.

## Användning

1. **Projekt** – skapa projekt med projektnamn och kundnamn. Använd exakt samma kundnamn för alla projekt hos samma kund. Arkivera projekt du inte längre använder (historik och rapporter finns kvar).
2. **Timer** – välj projekt (inget väljs automatiskt; senast använda visas som genvägar), *Starta*, *Pausa/Fortsätt*, *Stoppa*. Tiden sparas först vid Stoppa; därefter öppnas arbetsanteckningen. Du kan välja *Fyll i senare* – tiden är redan säker.
3. **Historik** – filtrera på projekt och datum, komplettera pass som *Saknar arbetsbeskrivning*, ändra projekt/debiterbar status, rätta datum och tid, lägg till manuella pass eller ta bort pass (med bekräftelse).
4. **Underlag** – välj kund (alla projekt eller ett), period (start- och slutdatum ingår), debiterbar tid som standard. *Skriv ut / spara som PDF* öppnar webbläsarens utskrift (A4), *Ladda ner CSV* ger en fil.
5. **Inställningar** – säkerhetskopiera och återställ.

Ett pass som verkar glömts igång (pågående segment ≥ 10 h eller paus ≥ 12 h) får en banner där du själv anger rätt sluttid. Inget stoppas eller kortas automatiskt.

### Hur tid beräknas
- Tid lagras som verkliga tidsstämplar (UTC-millisekunder) i arbetssegment; pauser ligger mellan segmenten. Visningen räknar alltid från stämplarna, aldrig från en löpande räknare.
- Kalenderdatum i historik och rapporter följer **Europe/Stockholm**. Pass över midnatt, månadsgräns eller sommartidsskifte delas vid Stockholms midnätter, så varje dag får sin egen tid utan dubbelräkning.
- **Full precision:** inget avrundas per pass. Summan räknas på exakta millisekunder; endast visningen avrundas (hela minuter, decimaltimmar med två decimaler: 1 h 30 min = 1,50 h). Summan kan därför skilja någon minut från summan av de avrundade raderna; rapporten säger det när det inträffar.
- **Tidskorrigering:** ändrar du datum/starttid/längd på ett timerpass ersätts arbetssegmenten av ett segment med den korrigerade tiden. Den ursprungligen uppmätta tiden sparas (visas i redigeringen, märkt *Tidskorrigerad* i historiken). **Kundunderlaget använder alltid den korrigerade tiden.** Oförändrade tidsfält lämnas orörda vid sparande.
- Manuella pass märks *Manuellt*. Tid kan inte ligga i framtiden och ett pass är högst 24 h.

### CSV-format
UTF-8 med BOM (svenska tecken fungerar i Excel), semikolon som avgränsare, CRLF mellan rader. Kolumner: `Datum;Kund;Projekt;Arbetsbeskrivning;Debiterbar;Tid (h:mm);Timmar (decimal)` och en sista rad `Summa`. `Tid (h:mm)` är avrundad till minut; `Timmar (decimal)` har två decimaler med **decimalkomma** (för svenskt kalkylblad). Fält med semikolon, citattecken eller radbrytningar citeras. Text som börjar med `= + - @` (eller tab/CR) får ett inledande `'` så att den inte tolkas som formel. Pass utan beskrivning får texten ”Arbetsbeskrivning saknas”. **Privata anteckningar ingår aldrig** i visning, utskrift eller CSV.

## Lokal lagring
Uppgifterna lagras i **IndexedDB i den aktuella webbläsaren på den aktuella enheten** (databas `konsulttimer-v1`). GitHub innehåller bara appens kod. Byter du enhet, webbläsare eller rensar webbplatsdata försvinner uppgifterna om du inte har en säkerhetskopia. Appen begär beständig lagring (`navigator.storage.persist`), men webbläsaren kan neka. Appens databas, cache (`konsulttimer-cache-*`) och service worker-scope (`/konsulttimer/`) är egna och delas inte med andra appar på `fridakaka.github.io`.

## Säkerhetskopiering
*Inställningar → Exportera säkerhetskopia* ger en versionsmärkt JSON-fil (`formatVersion: 1`) med projekt, pass, **privata anteckningar** och textutkast. Den är **inte** ett kundunderlag – dela den inte med kunder. *Återställ* validerar hela filen först (ogiltig fil ändrar inget), visar innehållet, kräver uttrycklig bekräftelse, erbjuder export av nuvarande data, avvisas medan en timer är aktiv och sker i en enda transaktion (allt eller inget). Återställning **ersätter** alla data. Gör gärna en säkerhetskopia regelbundet.

## Utveckling
Kräver Node 22. Inga körningsberoenden; `@playwright/test` och `fake-indexeddb` används bara för tester.

```
npm ci
npm start            # bygger och serverar på http://localhost:4173/konsulttimer/
npm run check        # statiska kontroller (syntax, inga externa länkar, Pages-sökvägar)
npm test             # enhetstester (node:test)
npm run test:e2e     # bygger + Playwright (Chromium, mobilstorlek, offline, huvudflöde)
npm run verify       # allt ovan
```
Struktur: `src/js/` – `time.js` (Stockholm-kalender), `timer.js` (ren timerlogik), `db.js` (IndexedDB), `report.js` + `csv.js` (rapportberäkning/export), `backup.js` (validering), `ui/` (vyer). `scripts/build.mjs` kopierar `src/` till `dist/`, stämplar en innehållshash i service worker och skriver precache-listan.

## Publicering (GitHub Pages)
Arbetsflödet `.github/workflows/ci.yml` kör kontroller och tester på varje push/PR och publicerar `dist/` till GitHub Pages när `main` uppdateras. Alla sökvägar är relativa, så appen fungerar under `https://fridakaka.github.io/konsulttimer/`.
1. Slå ihop till `main`.
2. Repo → *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. Kör arbetsflödet (eller pusha till `main`); adressen visas i jobbet *deploy*.
