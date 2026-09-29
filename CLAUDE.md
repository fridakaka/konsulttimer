# Konsulttimer – principer för arbete i repot

Svensk, lokal PWA för en ensam konsult (v0.1). Statisk webbapp i vanlig JavaScript (ES-moduler), inga körningsberoenden.

## Måste alltid gälla
- **Tid är helig.** Stoppa sparar passets tid beständigt *innan* anteckningsformuläret öppnas. Ett avbrutet formulär får aldrig ta bort tid. Inget stoppas/kortas automatiskt (glömda pass föreslår bara granskning).
- **Tid räknas från sparade tidsstämplar/arbetssegment**, aldrig från en löpande räknare. Uppdateringsloopen är bara visning.
- **Alla ändringar är IndexedDB-transaktioner** som läser aktuellt tillstånd (skydd mot dubbelklick och flera flikar). Endast ett aktivt pass (`meta.activeId`). Åtgärder ska vara idempotenta.
- **Full precision.** Runda aldrig lagrad/summerad tid; avrunda bara i presentationen (`format.js`).
- **Kalenderdatum = Europe/Stockholm.** Rapporter delar segment vid Stockholms midnätter (`time.splitByDay`).
- **Privata anteckningar får aldrig nå kundunderlag** (visning, utskrift, CSV). Rapportrader (`report.js`) innehåller inte fältet – håll det så. De finns bara i säkerhetskopian.
- **Egna namn:** DB `konsulttimer-v1`, cache-prefix `konsulttimer-cache-`, SW-scope = appens mapp. Rensa aldrig cacher/lagring utan eget prefix (samma origin som andra appar). Rör aldrig ensamträningsappen.
- **Inga externa anrop, analys eller molnsynk.** Sökvägar ska vara relativa (`./`) för GitHub Pages under `/konsulttimer/`.
- Ingen `innerHTML` med användartext; bygg DOM med `h()` (`ui/dom.js`).
- Säkerhetskopia: validera hela filen (`backup.js`) före ändring, ersätt atomärt, avvisa vid aktiv timer.
- Visa aldrig ”Sparat” om lagringen misslyckats; behåll osparade fält.
- Ingen fakturering/moms/fakturapåståenden. Svensk enkel text.

## Struktur
`src/js/{time,timer,report,csv,format,backup,db}.js` är rena/testbara; `src/js/ui/*` är gränssnittet; `src/sw.js` service worker; `scripts/` bygg/serve/kontroll.

## Kommandon
`npm run verify` = check + enhetstester + Playwright. Ändrar du logik: lägg till enhetstest i `tests/unit`. Ändrar du flöden: uppdatera `tests/e2e`. Testdata får bara finnas i tester, aldrig i appen.
