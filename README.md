# Bollette luce

Pagina statica che legge i PDF delle bollette della luce **direttamente nel browser** e mostra:

1. **Consumi e costo mese per mese**: kWh consumati e totale pagato, in due pannelli allineati sugli stessi mesi (un solo tooltip con entrambi i valori)
2. **Costo e tipo di contratto**: costo per kWh di ogni mese colorato per **fisso / variabile**, con la media di ciascun tipo, e il confronto (prezzo energia, quota fissa, spesa media, quanto avresti speso col fisso)
3. **Prezzo della sola energia per kWh** nel tempo
- poi: riepilogo (totale, media mensile, consumo, €/kWh, ultima bolletta vs anno prima), voci di costo mese per mese
  (energia, trasporto, oneri, accise, IVA, canone RAI, ricalcoli/bonus), composizione della spesa
- consumi per fascia F1 / F2 / F3 (dalle letture del contatore)
- riepilogo anno per anno e tabella di tutte le bollette, con controllo che le voci tornino col totale

I duplicati vengono scartati (stesso file oppure stesso numero di fattura), quindi puoi ricaricare
tutta la cartella ogni volta che arriva una bolletta nuova.

## Dove stanno i dati

I PDF vanno nella cartella `data/`. Da lì `node tools/build-data.mjs` (oppure `npm run dati`) genera
`docs/bollette.json`, che la pagina carica all'avvio **in qualsiasi browser e su qualsiasi dispositivo**.
Nel JSON ci sono solo i numeri della bolletta: niente nome, codice fiscale, indirizzo, POD o numero fattura.

Su GitHub il workflow `.github/workflows/pages.yml` fa la stessa cosa a ogni push: legge i PDF in `data/`,
rigenera `bollette.json` e ripubblica la pagina. Se in `data/` non ci sono PDF usa il `bollette.json` già presente.

Puoi anche caricare un PDF direttamente nella pagina: viene letto nel browser e aggiunto, ma resta solo
in quel browser. Per renderlo visibile ovunque va messo in `data/`.

**Attenzione:** i PDF contengono nome, codice fiscale, indirizzo e POD. Se il repository è pubblico,
i PDF in `data/` sono scaricabili da chiunque. Per questo `.gitignore` li esclude finché non decidi diversamente.

## Pubblicazione

**GitHub Pages** (repository pubblico, gratis)
```bash
gh repo create <utente>/costi-elettricita --public --source . --remote origin --push
gh api -X POST repos/<utente>/costi-elettricita/pages -f build_type=workflow
```
Nuova bolletta: mettila in `data/`, poi `npm run dati` e commit + push di `docs/bollette.json`.

**Cloudflare Pages** (repository privato con i PDF dentro, gratis): collega il repository da
Workers & Pages → Create → Pages → *Connect to Git*, con build command `npm ci && node tools/build-data.mjs data`
e output directory `docs`. Viene pubblicata solo `docs/`, non i PDF.

## Sviluppo locale

```bash
npm install          # solo per i test del parser (pdfjs-dist)
npm run dev          # server su http://127.0.0.1:5173 (se occupata usa la porta libera successiva)
npm test             # legge tutti i PDF in data/ e stampa cosa estrae il parser
```

## Formati supportati

Il parser è tarato sulle bollette **Octopus Energy** (luce), in tutti e tre i formati usati dal 2024:
quello con "Quadro sintetico", il nuovo con "Scontrino dell'energia" a prezzo fisso e quello a prezzo variabile (PUN).
Per altri fornitori prova comunque: periodo, totale e kWh vengono cercati con regole generiche, e la tabella
segnala con ⚠ le bollette in cui le voci non tornano col totale.

Il codice del parser è in `docs/js/parser.js`; `npm test` serve a verificarlo sui tuoi PDF dopo una modifica.
