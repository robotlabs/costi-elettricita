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

## Privacy

- I PDF non vengono caricati su nessun server: li legge [pdf.js](https://mozilla.github.io/pdf.js/) nel tuo browser.
- Vengono salvati solo i numeri estratti, nel `localStorage` di quel browser. Nome, codice fiscale e indirizzo non vengono salvati.
- Pubblicare la pagina **non** pubblica le tue bollette: chi la apre vede una dashboard vuota finché non carica i propri PDF.
- `.gitignore` esclude `data/` e tutti i `*.pdf`, così le bollette non finiscono nel repository.

Per avere i dati su un altro dispositivo: **Esporta dati** → sull'altro dispositivo **Importa dati**.
In alternativa puoi mettere il file esportato in `docs/bollette.json`: la pagina lo carica da sola all'avvio
(ma a quel punto chiunque abbia il link vede importi e consumi; nessun dato anagrafico).

## Pubblicarla gratis

La pagina è tutta in `docs/` (HTML + CSS + JS, nessuna build).

**GitHub Pages**
1. Crea un repository su GitHub e fai push (i PDF sono già esclusi).
2. Settings → Pages → *Deploy from a branch* → branch `main`, cartella `/docs` → Save.
3. Dopo un minuto è online su `https://<utente>.github.io/<repo>/`.

**Netlify Drop** (senza git): apri <https://app.netlify.com/drop> e trascina la cartella `docs`.

**Cloudflare Pages**: Workers & Pages → Create → Pages → *Upload assets* → carica la cartella `docs`.

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
