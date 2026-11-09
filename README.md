# Bollette luce

Pagina statica che legge i PDF delle bollette della luce **direttamente nel browser** e mostra:

1. **Consumi e costo mese per mese**: kWh consumati e totale pagato, in due pannelli allineati sugli stessi mesi (un solo tooltip con entrambi i valori)
2. **Costo e tipo di contratto**: costo per kWh di ogni mese colorato per **fisso / variabile**, con la media di ciascun tipo, e il confronto (prezzo energia, quota fissa, spesa media, quanto avresti speso col fisso)
3. **Prezzo della sola energia per kWh** nel tempo
- poi: riepilogo (totale, media mensile, consumo, €/kWh, ultima bolletta vs anno prima), voci di costo mese per mese
  (energia, trasporto, oneri, accise, IVA, canone RAI, ricalcoli/bonus), composizione della spesa
- consumi per fascia F1 / F2 / F3 (dalle letture del contatore)
- riepilogo anno per anno e tabella di tutte le bollette, con controllo che le voci tornino col totale

Online: https://robotlabs.github.io/costi-elettricita/

## Aggiungere una bolletta

1. Metti il PDF nella cartella `data/` (anche se ricopi tutta la cartella, i duplicati vengono scartati).
2. Lancia:
   ```bash
   npm run deploy
   ```
   Legge tutti i PDF, aggiorna `docs/bollette.json`, fa commit e push di tutte le modifiche (dati e pagina).
   Si ferma se sta per pubblicare un PDF.
3. GitHub Pages ripubblica la cartella `docs/` in circa un minuto.

## Dove stanno i dati

- I **PDF restano solo sul tuo computer**: `data/` e `*.pdf` sono in `.gitignore`, perché contengono nome,
  codice fiscale, indirizzo e POD e il repository è pubblico.
- Su GitHub va solo `docs/bollette.json`: importi, kWh, periodi, offerta e tipo di contratto.
  Niente dati anagrafici, POD o numero fattura.
- La pagina è di sola lettura e legge quel file: si vede uguale da qualsiasi browser e dispositivo.

## Sviluppo locale

```bash
npm install          # una volta sola (serve pdfjs-dist per leggere i PDF)
npm run dev          # anteprima su http://127.0.0.1:5173 (se occupata usa la porta libera successiva)
npm test             # stampa cosa estrae il parser da ogni PDF in data/
npm run dati         # aggiorna docs/bollette.json senza pubblicare
npm run deploy       # aggiorna i dati e pubblica tutto (commit + push)
```

## Formati supportati

Il parser è tarato sulle bollette **Octopus Energy** (luce), in tutti e tre i formati usati dal 2024:
quello con "Quadro sintetico", il nuovo con "Scontrino dell'energia" a prezzo fisso e quello a prezzo variabile (PUN).
Per altri fornitori prova comunque: periodo, totale e kWh vengono cercati con regole generiche, e la tabella
segnala con ⚠ le bollette in cui le voci non tornano col totale.

Il codice del parser è in `tools/parser.js`; `npm test` serve a verificarlo sui tuoi PDF dopo una modifica.
