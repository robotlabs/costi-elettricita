// Legge tutti i PDF in data/ e scrive docs/bollette.json, che la pagina carica all'avvio in qualsiasi browser.
// Uso: node tools/build-data.mjs [cartella-pdf]   (lo esegue anche GitHub Actions a ogni push)
// Nel JSON finiscono solo i numeri della bolletta: niente nome, codice fiscale, indirizzo, POD o numero fattura.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToText, parseBill, billKey } from './parser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(root, process.argv[2] || 'data');
const out = path.join(root, 'docs', 'bollette.json');

const files = (await readdir(dir).catch(() => [])).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
if (!files.length) {
  console.log(`Nessun PDF in ${dir}: lascio ${path.relative(root, out)} com'è.`);
  process.exit(0);
}

const byKey = new Map();
const failed = [];
for (const f of files) {
  const buf = await readFile(path.join(dir, f));
  const hash = createHash('sha256').update(buf).digest('hex');
  let bill;
  try { bill = parseBill(await pdfToText(pdfjsLib, new Uint8Array(buf))); } catch (e) { failed.push(`${f}: ${e.message}`); continue; }
  if (!bill.periodStart && bill.totaleDaPagare == null) { failed.push(`${f}: non riconosciuta`); continue; }
  const key = billKey(bill);
  if (byKey.has(key)) { byKey.get(key).hashes.push(hash); continue; }
  const { invoiceNo, ...safe } = bill; // il numero fattura contiene il codice fornitura: non lo pubblichiamo
  byKey.set(key, { ...safe, key, hashes: [hash] });
}

const bills = [...byKey.values()].sort((a, b) => (a.periodStart || '').localeCompare(b.periodStart || ''));
const prev = JSON.parse(await readFile(out, 'utf8').catch(() => 'null'));
if (prev && JSON.stringify(prev.bills) === JSON.stringify(bills)) {
  console.log(`${files.length} PDF → ${bills.length} bollette: nessuna novità, ${path.relative(root, out)} invariato.`);
  process.exit(0);
}
await writeFile(out, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), bills }, null, 1) + '\n');
console.log(`${files.length} PDF → ${bills.length} bollette uniche (${files.length - bills.length - failed.length} duplicati) → ${path.relative(root, out)}`);
for (const w of bills.filter((b) => !b.ok)) console.log(`  ⚠ ${w.periodStart}: ${w.warnings.join('; ')}`);
for (const f of failed) console.log(`  ✗ ${f}`);
