// Test del parser: node tools/parse-all.mjs <cartella-pdf> [--json] [--text file.pdf]
// Usa lo stesso parser della pagina web, con pdfjs-dist in Node.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToText, parseBill, billKey } from './parser.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || 'data';
const textOnly = args.includes('--text');

const files = textOnly ? [dir] : (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort().map((f) => path.join(dir, f));
const seen = new Map();
const rows = [];
for (const file of files) {
  const buf = await readFile(file);
  const hash = createHash('sha256').update(buf).digest('hex');
  const text = await pdfToText(pdfjsLib, new Uint8Array(buf));
  if (textOnly) { console.log(text); process.exit(0); }
  const b = parseBill(text);
  const key = billKey(b);
  const dup = seen.has(key) ? seen.get(key) : null;
  if (!dup) seen.set(key, path.basename(file));
  rows.push({ file: path.basename(file), dup, hash: hash.slice(0, 8), ...b });
}

if (args.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const f = (v) => (v == null ? '  —  ' : typeof v === 'number' ? v.toFixed(2).padStart(6) : v);
  for (const r of rows.sort((a, b) => (a.periodStart || '').localeCompare(b.periodStart || ''))) {
    const c = r.costs;
    console.log(
      [r.periodStart, r.periodEnd, (r.invoiceNo || '?').padEnd(18), (r.priceType || '?').padEnd(9), (r.offer || '?').padEnd(22),
        String(r.kwh).padStart(4) + 'kWh', r.bands ? `F ${r.bands.f1}/${r.bands.f2}/${r.bands.f3}`.padEnd(14) : 'F —'.padEnd(14),
        'en', f(c.energia), 'fx', f(c.energiaFissa), 'tr', f(c.trasporto), 'on', f(c.oneri), 'ac', f(c.accise), 'iva', f(c.iva), 'rai', f(c.canone),
        'altre', f(c.altrePartite), 'alt', f(c.altro), 'TOT', f(r.totaleBolletta), f(r.totaleDaPagare),
        r.dup ? `DUP(${r.dup})` : '', r.ok ? 'OK' : 'WARN: ' + r.warnings.join('; ')].join(' '),
    );
  }
  const uniq = rows.filter((r) => !r.dup);
  console.log(`\n${rows.length} file, ${uniq.length} bollette uniche, ${rows.length - uniq.length} duplicati, ${uniq.filter((r) => !r.ok).length} con avvisi`);
}
