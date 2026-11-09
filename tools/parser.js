// Estrazione testo da PDF (pdf.js) + parser bollette luce.
// Usato da tools/build-data.mjs (npm run deploy) e tools/parse-all.mjs (npm test).

/** Ricostruisce le righe di testo di un PDF raggruppando i frammenti per coordinata Y. */
export async function pdfToText(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({
        s: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        h: Math.abs(it.transform[3]) || it.height || 8,
      }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * 0.45));
      if (line) line.items.push(it);
      else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    const text = lines
      .map((l) => {
        l.items.sort((a, b) => a.x - b.x);
        let out = '';
        let end = null;
        for (const it of l.items) {
          if (end !== null) {
            const gap = it.x - end;
            if (gap > it.h * 1.2) out += '    ';
            else if (gap > it.h * 0.15 && !out.endsWith(' ') && !it.s.startsWith(' ')) out += ' ';
          }
          out += it.s;
          end = it.x + it.w;
        }
        return out.replace(/\s+$/, '');
      })
      .join('\n');
    pages.push(text);
    page.cleanup();
  }
  await doc.destroy();
  return pages.join('\n\f\n');
}

// ---------- helper ----------
const D = String.raw`(\d{2}\/\d{2}\/\d{4})`;
const AMT = /(?<![\d,.])(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})(?!\d)\s*€(?!\s*\/)/g;

export function num(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function isoDate(d) {
  if (!d) return null;
  const [dd, mm, yy] = d.split('/');
  return `${yy}-${mm}-${dd}`;
}
function first(text, re, group = 1) {
  const m = text.match(re);
  return m ? m[group] : null;
}
/** Ultimo importo in € presente nella riga (ignora i prezzi unitari €/kWh, €/mese...). */
function lastAmount(line) {
  const all = [...line.matchAll(AMT)];
  return all.length ? num(all[all.length - 1][1]) : null;
}
/** Importo che segue un'etichetta, sulla stessa riga: "Etichetta .... € 12,34" o "12,34 €". */
function amountAfter(text, label) {
  const re = new RegExp(label + String.raw`[^\n]*?(?:€\s*(-?[\d.]+,\d{2})|(-?[\d.]+,\d{2})\s*€(?!\s*\/))`, 'i');
  const m = text.match(re);
  return m ? num(m[1] ?? m[2]) : null;
}
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- parser ----------
export function parseBill(text) {
  const t = text.replace(/ /g, ' ').replace(/[’`]/g, "'");
  const lines = t.split('\n');
  const warnings = [];

  const isOld = /Quadro Sintetico/i.test(t);
  const isNew = /Scontrino dell'energia/i.test(t);
  const format = isNew ? 'scontrino' : isOld ? 'quadro-sintetico' : 'generico';

  // Identificativi e date
  const invoiceNo =
    first(t, /fattura n[°.]?\s*:?\s*([A-Z]{2}[\w-]{6,})/i) ||
    first(t, /AI FINI FISCALI:?\s*(?:[^\n]*\n){0,2}?[^\n]*?\b(KE[\w-]{6,})/) ||
    first(t, /\b(KE-?\d{2}[\w-]{6,})/) ||
    first(t, /(?:fattura|bolletta)\s*(?:n\.?|nr\.?|numero)\s*:?\s*([A-Z0-9][\w\/-]{4,})/i);
  const invoiceDate = isoDate(first(t, new RegExp(String.raw`Data fattura:?\s*` + D, 'i')) || first(t, new RegExp(String.raw`Bolletta \S+ del ` + D, 'i')));
  const period = t.match(new RegExp(String.raw`Periodo di riferimento:?\s*dal\s*` + D + String.raw`\s*al\s*` + D, 'i'));
  const periodStart = isoDate(period?.[1]);
  const periodEnd = isoDate(period?.[2]);
  const dueDate = isoDate(first(t, new RegExp(String.raw`Entro il\s*` + D, 'i')) || first(t, new RegExp(String.raw`Scadenza:?\s*` + D, 'i')));
  const supplier = /octopus/i.test(t) ? 'Octopus Energy' : first(t, /\b(Enel|A2A|Hera|Iren|Edison|Sorgenia|Eni Plenitude|Plenitude|Acea|Engie|Illumia|Wekiwi|Pulsee|NeN|Iberdrola|E\.ON|Dolomiti)\b/i);

  // Offerta e tipo di prezzo
  let offer =
    first(t, /NOME OFFERTA(?: COMMERCIALE)?:[ \t]*([^\n]+?)(?:\s{2,}|$)/im) ||
    first(t, /(?<![\w'])Offerta:[ \t]*([^\n]+?)(?:\s{2,}|$)/im);
  if (offer && /^[A-Z ]+:$/.test(offer)) offer = null;
  let priceType = null;
  const tp = first(t, /TIPOLOGIA PREZZO:?[\s\S]{0,300}?\b(Fisso|Variabile|Indicizzato)\b/i);
  if (tp) priceType = /fiss/i.test(tp) ? 'fisso' : 'variabile';
  else if (offer && /fiss|fixed|bloccat/i.test(offer)) priceType = 'fisso';
  else if (offer && /flex|variab|indicizz|pun|dinamic/i.test(offer)) priceType = 'variabile';
  else if (/PREZZO FISSO/i.test(t)) priceType = 'fisso';
  else if (/\bPUN\b/.test(t)) priceType = 'variabile';
  if (!priceType) warnings.push('tipo di prezzo non trovato');

  const kwh = num(first(t, /Consumo fatturato:?\s*([\d.]+)\s*kWh/i));
  const potenza = num(first(t, /Potenza impegnata:?[^\n]*?([\d]+[.,]\d+|\d+)\s*kW/i));
  const annualKwh = num(first(t, /([\d.]+)\s*kWh\/anno/i)) ?? num(first(t, /Consumo annuo:?\s*([\d.]+)\s*kWh/i));

  // Letture F1/F2/F3 → consumo per fascia (differenza tra le ultime due letture)
  let bands = null;
  const readRe = new RegExp(D + String.raw`\s+(\d{1,7})\s+(\d{1,7})\s+(\d{1,7})\s+(Rilevata|Stimata|Autolettura|Effettiva|Reale|Ricostruita|Stimato|Rilevato)`, 'gi');
  const reads = [...t.matchAll(readRe)].map((m) => ({ date: isoDate(m[1]), f: [+m[2], +m[3], +m[4]], kind: m[5] }));
  if (reads.length >= 2) {
    const [a, b] = reads[0].date >= reads[1].date ? [reads[0], reads[1]] : [reads[1], reads[0]];
    const d = a.f.map((v, i) => v - b.f[i]);
    const sum = d[0] + d[1] + d[2];
    // le letture valgono solo se coerenti col consumo fatturato (es. cambio offerta a metà mese)
    if (d.every((v) => v >= 0) && (kwh == null || Math.abs(sum - kwh) <= Math.max(3, kwh * 0.15)))
      bands = { f1: d[0], f2: d[1], f3: d[2], from: b.date, to: a.date, estimated: /stim/i.test(a.kind + b.kind) };
  }

  // Importi
  let energia = null, energiaFissa = null, trasporto = null, oneri = null, rete = null, bonus = 0;
  let accise = num(first(t, /le accise ammontano a\s*(-?[\d.]+,\d{2})/i));
  let iva = num(first(t, /l.IVA ammonta a\s*(-?[\d.]+,\d{2})/i));
  let totaleBolletta = null, totaleDaPagare = null, canone = null, quotaConsumi = null;

  if (isNew) {
    let section = null, vendita = 0, venditaFissa = 0, reteSum = 0, seen = false;
    for (const line of lines) {
      if (/^\s*Quota per consumi/i.test(line)) section = 'consumi';
      else if (/^\s*Quota fissa/i.test(line)) section = 'fissa';
      else if (/^\s*Quota potenza/i.test(line)) section = 'potenza';
      else if (/Accise e IVA|TOTALE BOLLETTA/i.test(line)) { if (seen) section = null; }
      if (!section) continue;
      // riga riassuntiva "166 kWh x 0,33 €/kWh 54,87 €": costo di tutto ciò che dipende dai kWh (energia + rete + oneri), IVA esclusa
      if (section === 'consumi' && quotaConsumi == null && /kWh\s*x/i.test(line)) {
        const a = lastAmount(line);
        if (a != null) quotaConsumi = a;
      }
      if (/di cui spesa per vendita/i.test(line)) {
        const a = lastAmount(line); seen = true;
        if (a != null) { vendita += a; if (section === 'fissa') venditaFissa += a; }
      } else if (/di cui spesa per la rete/i.test(line)) {
        const a = lastAmount(line); seen = true;
        if (a != null) reteSum += a;
      }
    }
    energia = seen ? r2(vendita) : null;
    energiaFissa = seen ? r2(venditaFissa) : null;
    rete = seen ? r2(reteSum) : null;
    oneri = num(first(t, /totale degli oneri di sistema è\s*(-?[\d.]+,\d{2})/i));
    if (rete != null && oneri != null) trasporto = r2(rete - oneri);
    else if (rete != null) { trasporto = rete; oneri = 0; warnings.push('oneri di sistema non separati dal trasporto'); }
    bonus = amountAfter(t, String.raw`Bonus applicati`) ?? 0;
    // voci dopo TOTALE BOLLETTA e prima di TOTALE DA PAGARE (bonus, ricalcoli, altre partite), canone escluso
    const i0 = lines.findIndex((l) => /TOTALE BOLLETTA/i.test(l));
    const i1 = lines.findIndex((l, i) => i > i0 && /TOTALE DA PAGARE/i.test(l));
    if (i0 >= 0 && i1 > i0) for (const l of lines.slice(i0 + 1, i1)) {
      if (/canone/i.test(l)) continue;
      const a = lastAmount(l);
      if (a != null) bonus += a;
    }
    const accIva = amountAfter(t, String.raw`Accise e IVA`);
    if (accIva != null && (accise == null || iva == null)) {
      if (iva != null) accise = r2(accIva - iva);
      else if (accise != null) iva = r2(accIva - accise);
      else { iva = accIva; accise = 0; warnings.push('accise e IVA non separate'); }
    }
    totaleBolletta = amountAfter(t, String.raw`TOTALE BOLLETTA`);
    totaleDaPagare = amountAfter(t, String.raw`TOTALE DA PAGARE`);
  } else {
    energia = amountAfter(t, String.raw`Spesa per la materia energia`);
    trasporto = amountAfter(t, String.raw`Spesa per (?:il )?trasporto`);
    oneri = amountAfter(t, String.raw`Spesa per (?:gli )?oneri di sistema`);
    if (accise == null) accise = amountAfter(t, String.raw`^\s*Imposte\b`);
    if (iva == null) iva = amountAfter(t, String.raw`IVA[^\n]*?su €\s*[\d.]+,\d{2}`);
    totaleBolletta = amountAfter(t, String.raw`Totale Fattura`) ?? amountAfter(t, String.raw`Totale bolletta`);
    totaleDaPagare = amountAfter(t, String.raw`Totale importo da pagare`) ?? amountAfter(t, String.raw`Totale da pagare`) ?? num(first(t, /Totale:\s*([\d.]+,\d{2})\s*€/i));
    // quota fissa di vendita = commercializzazione + DISPbt (dagli elementi di dettaglio)
    const comm = lines.filter((l) => /Corrispettivo di commercializzazione|Componente DISPbt/i.test(l)).map(lastAmount).filter((v) => v != null);
    energiaFissa = comm.length ? r2(comm.reduce((s, v) => s + v, 0)) : null;
    // ricalcoli, bonus e altre partite nel Quadro Sintetico
    const q0 = lines.findIndex((l) => /Quadro Sintetico/i.test(l));
    const q1 = lines.findIndex((l, i) => i > q0 && /Totale importo da pagare/i.test(l));
    if (q0 >= 0 && q1 > q0) for (const l of lines.slice(q0, q1)) {
      if (/ricalcol|bonus|sconto|altre partite|rimbors|conguagl|interessi|deposito|storno/i.test(l)) {
        const a = amountAfter(l, '');
        if (a != null) bonus += a;
      }
    }
  }

  // Canone RAI: esplicito, altrimenti differenza tra totale da pagare e totale bolletta
  canone = amountAfter(t, String.raw`Canone di abbonamento alla televisione per uso privato(?! incluso)(?!\))`);
  if (canone != null && canone > 30) canone = null;
  if (canone == null && totaleDaPagare != null && totaleBolletta != null) canone = r2(totaleDaPagare - totaleBolletta);
  if (totaleDaPagare == null && totaleBolletta != null) totaleDaPagare = r2(totaleBolletta + (canone || 0));
  if (totaleBolletta == null && totaleDaPagare != null) totaleBolletta = r2(totaleDaPagare - (canone || 0));

  const parts = { energia, trasporto, oneri, accise, iva, canone };
  for (const [k, v] of Object.entries(parts)) if (v == null) warnings.push(`voce "${k}" non trovata`);
  const known = Object.values(parts).reduce((s, v) => s + (v || 0), 0) + (bonus || 0);
  const altro = totaleDaPagare != null ? r2(totaleDaPagare - known) : null;
  if (altro != null && Math.abs(altro) > 0.05) warnings.push(`le voci non tornano col totale (differenza ${altro.toFixed(2)} €)`);
  if (!periodStart) warnings.push('periodo non trovato');
  if (totaleDaPagare == null) warnings.push('totale non trovato');
  if (kwh == null) warnings.push('consumo kWh non trovato');

  return {
    invoiceNo, invoiceDate, dueDate, periodStart, periodEnd, supplier: supplier || null, format,
    offer: offer ? offer.trim() : null, priceType, kwh, potenza, annualKwh, bands,
    costs: {
      energia, energiaFissa, trasporto, oneri,
      accise, iva, canone: canone || 0, altrePartite: r2(bonus || 0),
      altro: altro != null && Math.abs(altro) > 0.005 ? altro : 0,
    },
    totaleBolletta, totaleDaPagare, quotaConsumi,
    ivaRate: num(first(t, /IVA vendite\s*(\d+)\s*%/i)) ?? null,
    ok: warnings.length === 0,
    warnings,
  };
}

/** Chiave per riconoscere i duplicati: numero fattura, altrimenti periodo + totale. */
export function billKey(b) {
  if (b.invoiceNo) return 'n:' + fnv1a(b.invoiceNo.replace(/[-\s]/g, '').toUpperCase());
  return `p:${b.periodStart}_${b.periodEnd}_${b.totaleDaPagare}`;
}
// hash del numero fattura: così bollette.json non deve contenere il numero (che include il codice fornitura)
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
