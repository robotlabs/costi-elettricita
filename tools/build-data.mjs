// Legge i PDF in data/<luogo>/ (una cartella per casa: data/pisa, data/manfredonia, ...) e scrive
// docs/bollette.json, che la pagina carica all'avvio: una scheda per ogni cartella.
// Uso: node tools/build-data.mjs [cartella]   (default: data)
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
const rel = (p) => path.relative(root, p);
const isPdf = (f) => f.toLowerCase().endsWith('.pdf');
const title = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
const loose = entries.filter((e) => e.isFile() && isPdf(e.name));
if (loose.length) console.log(`⚠ ${loose.length} PDF direttamente in ${rel(dir)}/ ignorati: mettili nella cartella della casa (es. ${rel(dir)}/pisa/).`);

const locations = [];
let totalFiles = 0;
for (const d of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const folder = path.join(dir, d.name);
  const files = (await readdir(folder)).filter(isPdf).sort();
  if (!files.length) continue;
  totalFiles += files.length;
  const byKey = new Map();
  const failed = [];
  for (const f of files) {
    const buf = await readFile(path.join(folder, f));
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
  locations.push({ id: d.name.toLowerCase(), name: title(d.name), bills });
  console.log(`${title(d.name)}: ${files.length} PDF → ${bills.length} bollette (${files.length - bills.length - failed.length} duplicati)`);
  for (const w of bills.filter((b) => !b.ok)) console.log(`  ⚠ ${w.periodStart}: ${w.warnings.join('; ')}`);
  for (const f of failed) console.log(`  ✗ ${f}`);
}

if (!locations.length) {
  console.log(`Nessun PDF nelle cartelle di ${rel(dir)}/: lascio ${rel(out)} com'è.`);
  process.exit(0);
}
// prima la casa con più bollette
locations.sort((a, b) => b.bills.length - a.bills.length || a.name.localeCompare(b.name));

const prev = JSON.parse(await readFile(out, 'utf8').catch(() => 'null'));
if (prev?.locations && JSON.stringify(prev.locations) === JSON.stringify(locations)) {
  console.log(`Nessuna novità: ${rel(out)} invariato.`);
  process.exit(0);
}
await writeFile(out, JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), locations }, null, 1) + '\n');
console.log(`→ ${rel(out)} aggiornato (${locations.length} case, ${totalFiles} PDF).`);
