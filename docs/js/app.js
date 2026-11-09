import { pdfToText, parseBill, billKey } from './parser.js';
import { stackedColumns, lineChart, columnPanels, hideTip } from './charts.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const STORE = 'bollette-luce.v1';

const COST_SERIES = [
  { id: 'energia', label: 'Energia (vendita)', color: 'var(--c1)', ink: '#fff', hint: 'materia prima + quota fissa del fornitore' },
  { id: 'trasporto', label: 'Trasporto e contatore', color: 'var(--c2)', ink: '#fff', hint: 'rete di distribuzione e misura (tariffe ARERA)' },
  { id: 'oneri', label: 'Oneri di sistema', color: 'var(--c3)', ink: '#fff', hint: 'ASOS (rinnovabili) e ARIM' },
  { id: 'accise', label: 'Accise', color: 'var(--c4)', ink: '#0b0b0b', hint: 'imposta erariale sui consumi' },
  { id: 'iva', label: 'IVA', color: 'var(--c5)', ink: '#fff', hint: '10% uso domestico' },
  { id: 'canone', label: 'Canone RAI', color: 'var(--c6)', ink: '#fff', hint: 'non è energia: addebitato in bolletta' },
  { id: 'altre', label: 'Ricalcoli e bonus', color: 'var(--other)', ink: '#0b0b0b', hint: 'conguagli, bonus, arrotondamenti' },
];
const KWH_SERIES = [
  { id: 'f1', label: 'F1 · ore di punta', color: 'var(--f1)' },
  { id: 'f2', label: 'F2 · intermedia', color: 'var(--f2)' },
  { id: 'f3', label: 'F3 · notte e festivi', color: 'var(--f3)' },
  { id: 'nr', label: 'Non ripartito', color: 'var(--other)' },
];
const TYPE_COLOR = { fisso: 'var(--t-fisso)', variabile: 'var(--t-var)' };
const typeColor = (t) => TYPE_COLOR[t] || 'var(--other)';
const TYPE_SERIES = [
  { id: 'fisso', label: 'Prezzo fisso', color: TYPE_COLOR.fisso },
  { id: 'variabile', label: 'Prezzo variabile', color: TYPE_COLOR.variabile },
];

// ---------- formattazione ----------
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const p3 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 0 });
const fE = (v) => (v == null ? '—' : eur.format(v));
const fK = (v) => (v == null ? '—' : int.format(v) + ' kWh');
const fP = (v) => (v == null || !Number.isFinite(v) ? '—' : p3.format(v) + ' €/kWh');
const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const mLong = (k) => { const [y, m] = k.split('-'); return `${MONTHS_LONG[+m - 1]} ${y}`; };
const mShort = (k) => { const [y, m] = k.split('-'); return `${MONTHS_SHORT[+m - 1]} ${y}`; };
const dShort = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const $ = (id) => document.getElementById(id);
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const badge = (t) => `<span class="badge ${t || 'unknown'}">${t === 'fisso' ? 'Fisso' : t === 'variabile' ? 'Variabile' : 'n.d.'}</span>`;
const days = (b) => (b.periodStart && b.periodEnd ? (new Date(b.periodEnd) - new Date(b.periodStart)) / 864e5 + 1 : 30);

// ---------- stato ----------
let bills = [];
let hidden = new Set();
let range = 'all'; // periodo predefinito: tutti i mesi

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw) { bills = raw.bills || []; hidden = new Set(raw.hidden || []); }
  } catch { /* storage non disponibile */ }
  // ricalcola le chiavi (formato cambiato) e rimuovi eventuali doppioni
  const seen = new Set();
  bills = bills.filter((b) => {
    if (b.invoiceNo) b.key = billKey(b);
    if (seen.has(b.key)) return false;
    seen.add(b.key);
    return true;
  });
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ version: 1, bills, hidden: [...hidden] })); } catch { /* ignora */ }
}
function merge(list, source) {
  let added = 0, dup = 0;
  for (const b of list) {
    if (!b || !b.costs) continue;
    const key = b.key || billKey(b);
    if (hidden.has(key) && source === 'file') continue;
    if (bills.some((x) => x.key === key)) { dup++; continue; }
    bills.push({ ...b, key, source: b.source || source });
    added++;
  }
  return { added, dup };
}

// ---------- caricamento PDF ----------
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ||= import(PDFJS).then((lib) => { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return lib; });
  return pdfjsPromise;
}
async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) return status('<strong>Nessun PDF</strong> tra i file selezionati.');
  status(`Lettura di ${files.length} PDF…`);
  let lib;
  try { lib = await loadPdfjs(); } catch (e) {
    return status(`<strong>Impossibile caricare il lettore PDF.</strong> Serve una connessione a internet la prima volta. (${esc(e.message)})`);
  }
  const added = [], dups = [], failed = [], warned = [];
  for (const [i, f] of files.entries()) {
    status(`Lettura ${i + 1} di ${files.length}: ${esc(f.name)}`);
    try {
      const buf = await f.arrayBuffer();
      const hash = await sha256(buf);
      if (bills.some((b) => b.hashes?.includes(hash))) { dups.push(f.name); continue; }
      const text = await pdfToText(lib, new Uint8Array(buf));
      const bill = parseBill(text);
      if (!bill.periodStart && bill.totaleDaPagare == null) { failed.push(f.name); continue; }
      const key = billKey(bill);
      const existing = bills.find((b) => b.key === key);
      if (existing) { existing.hashes = [...new Set([...(existing.hashes || []), hash])]; dups.push(f.name); continue; }
      hidden.delete(key);
      bills.push({ ...bill, key, hashes: [hash], fileName: f.name, addedAt: new Date().toISOString(), source: 'pdf' });
      added.push(f.name);
      if (!bill.ok) warned.push(`${f.name}: ${bill.warnings.join(', ')}`);
    } catch (e) {
      console.error(f.name, e);
      failed.push(f.name);
    }
  }
  save();
  render();
  let msg = `<strong>${added.length} ${added.length === 1 ? 'bolletta aggiunta' : 'bollette aggiunte'}</strong>`;
  if (dups.length) msg += ` · ${dups.length} ${dups.length === 1 ? 'duplicato scartato' : 'duplicati scartati'}`;
  if (failed.length) msg += ` · ${failed.length} non ${failed.length === 1 ? 'riconosciuta' : 'riconosciute'}<ul>${failed.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  if (warned.length) msg += `<br>Da controllare:<ul>${warned.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  status(msg);
}

function status(html) {
  const el = $('status');
  el.hidden = !html;
  el.innerHTML = html || '';
}

// ---------- aggregazione ----------
const monthOf = (b) => (b.periodStart || b.invoiceDate || '').slice(0, 7);
const altre = (b) => (b.costs.altrePartite || 0) + (b.costs.altro || 0);
const energyVar = (b) => (b.costs.energia || 0) - (b.costs.energiaFissa || 0);

function monthRange(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function aggregate(list) {
  const by = new Map();
  for (const b of list) {
    const k = monthOf(b);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(b);
  }
  const keys = [...by.keys()].sort();
  if (!keys.length) return [];
  return monthRange(keys[0], keys[keys.length - 1]).map((key) => {
    const bs = (by.get(key) || []).sort((a, b) => (a.periodStart || '').localeCompare(b.periodStart || ''));
    if (!bs.length) return { key, bills: [], aria: `${mLong(key)}: nessuna bolletta` };
    const main = bs.reduce((a, b) => (days(b) > days(a) ? b : a));
    const costs = {};
    for (const s of COST_SERIES) costs[s.id] = s.id === 'altre' ? sum(bs, altre) : sum(bs, (b) => b.costs[s.id]);
    const kwh = sum(bs, (b) => b.kwh);
    const withBands = bs.filter((b) => b.bands);
    const mo = {
      key, bills: bs, costs, kwh,
      totale: sum(bs, (b) => b.totaleDaPagare),
      totaleBolletta: sum(bs, (b) => b.totaleBolletta),
      energyVar: sum(bs, energyVar),
      f1: sum(withBands, (b) => b.bands.f1), f2: sum(withBands, (b) => b.bands.f2), f3: sum(withBands, (b) => b.bands.f3),
      nr: sum(bs.filter((b) => !b.bands), (b) => b.kwh),
      type: main.priceType, offer: main.offer,
      types: [...new Set(bs.map((b) => b.priceType))],
    };
    mo.allin = kwh ? mo.totaleBolletta / kwh : null;
    mo.energy = kwh ? mo.energyVar / kwh : null;
    mo.aria = `${mLong(key)}: ${fE(mo.totale)}, ${fK(kwh)}`;
    return mo;
  });
}

function offerBands(months) {
  const bands = [];
  months.forEach((mo, i) => {
    if (!mo.bills.length) return;
    const last = bands[bands.length - 1];
    if (last && last.label === (mo.offer || '?') && last.to === i - 1) last.to = i;
    else bands.push({ from: i, to: i, label: mo.offer || '?', type: mo.type });
  });
  return bands;
}

function filtered() {
  const all = bills.filter((b) => monthOf(b));
  if (range === 'all') return all;
  if (range === 'last12') {
    const last = all.map(monthOf).sort().pop();
    if (!last) return all;
    const [y, m] = last.split('-').map(Number);
    const from = `${m === 12 ? y : y - 1}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
    return all.filter((b) => monthOf(b) >= from);
  }
  return all.filter((b) => monthOf(b).startsWith(range));
}

// ---------- render ----------
function render() {
  hideTip();
  const has = bills.length > 0;
  $('empty').hidden = has;
  $('dash').hidden = !has;
  if (!has) { $('supplyInfo').textContent = 'Carica i PDF delle bollette per iniziare.'; return; }

  const years = [...new Set(bills.map((b) => monthOf(b).slice(0, 4)).filter(Boolean))].sort();
  if (range !== 'all' && range !== 'last12' && !years.includes(range)) range = 'all';
  const opts = [['all', 'Tutto'], ['last12', 'Ultimi 12 mesi'], ...years.map((y) => [y, y])];
  $('rangeSeg').innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === range}">${l}</button>`).join('');

  const sorted = [...bills].sort((a, b) => (a.periodStart || '').localeCompare(b.periodStart || ''));
  const latest = sorted[sorted.length - 1];
  const since = [...sorted].reverse().find((b, i, arr) => i === arr.length - 1 || arr[i + 1].offer !== latest.offer);
  $('supplyInfo').innerHTML = [
    esc(latest.supplier || 'Fornitore n.d.'),
    `offerta attuale <strong>${esc(latest.offer || 'n.d.')}</strong> ${badge(latest.priceType)}${since?.periodStart ? ` dal ${dShort(since.periodStart)}` : ''}`,
    latest.potenza ? `${String(latest.potenza).replace('.', ',')} kW` : '',
  ].filter(Boolean).join(' · ');

  const list = filtered();
  const months = aggregate(list);
  const withData = months.filter((m) => m.bills.length);
  renderMain(months);
  renderContract(months, list);
  renderCompare(list);
  renderEnergyPrice(months);
  renderKpis(list, months, withData);
  renderCost(months, withData);
  renderCompo(list);
  renderKwh(months, withData);
  renderYears();
  renderBills(list, months);
}

function renderKpis(list, months, withData) {
  const tot = sum(list, (b) => b.totaleDaPagare);
  const can = sum(list, (b) => b.costs.canone);
  const kwh = sum(list, (b) => b.kwh);
  const totB = sum(list, (b) => b.totaleBolletta);
  const nM = withData.length || 1;
  const first = withData[0]?.key, last = withData[withData.length - 1]?.key;

  // ultima bolletta vs stesso mese dell'anno prima (su tutti i dati)
  const allMonths = aggregate(bills.filter((b) => monthOf(b)));
  const lastM = [...allMonths].reverse().find((m) => m.bills.length);
  let delta = '';
  if (lastM) {
    const [y, m] = lastM.key.split('-');
    const prev = allMonths.find((x) => x.key === `${+y - 1}-${m}` && x.bills.length);
    if (prev && prev.totale) {
      const d = lastM.totale / prev.totale - 1;
      const cls = d > 0.005 ? 'delta-up' : d < -0.005 ? 'delta-down' : '';
      delta = `<span class="${cls}">${d > 0 ? '▲ +' : d < 0 ? '▼ ' : ''}${pct.format(d)}</span> rispetto a ${mShort(prev.key)} (${fE(prev.totale)})`;
    }
  }
  const tile = (label, value, note, cls = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
  $('kpis').innerHTML =
    tile('Totale pagato', fE(tot), `${list.length} bollette · ${first ? mShort(first) : ''}${last && last !== first ? ' – ' + mShort(last) : ''}${can ? ` · di cui canone RAI ${fE(can)}` : ''}`, 'hero') +
    tile('Spesa media al mese', fE(tot / nM), `${fE((tot - can) / nM)} senza canone RAI`) +
    tile('Consumo', fK(kwh), `media ${int.format(kwh / nM)} kWh al mese`) +
    tile('Costo medio per kWh', fP(kwh ? totB / kwh : null), 'tutto compreso, canone escluso') +
    tile('Ultima bolletta', lastM ? fE(lastM.totale) : '—', lastM ? `${mLong(lastM.key)}${delta ? '<br>' + delta : ''}` : '');
}

function legend(el, series, line = false) {
  el.innerHTML = series.map((s) => `<span><i class="sw${line ? ' line' : ''}" style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
}

function tipHead(mo) {
  if (!mo.bills.length) return `<div class="t-head">${mLong(mo.key)}</div><div class="t-sub">Nessuna bolletta caricata per questo mese</div>`;
  const offers = [...new Set(mo.bills.map((b) => `${esc(b.offer || 'n.d.')} ${badge(b.priceType)}`))].join('<br>');
  return `<div class="t-head">${mLong(mo.key)}</div><div class="t-sub">${offers}${mo.bills.length > 1 ? `<br>${mo.bills.length} bollette nel mese` : ''}</div>`;
}
const row = (color, label, value, cls = '') => `<div class="row ${cls}"><span class="k">${color ? `<i class="sw" style="background:${color}"></i>` : ''}${label}</span><span>${value}</span></div>`;

function labelIdx(months, getTotal) {
  const idx = [];
  let lastI = -1, maxI = -1;
  months.forEach((m, i) => {
    if (!m.bills.length) return;
    lastI = i;
    if (maxI < 0 || getTotal(m) > getTotal(months[maxI])) maxI = i;
  });
  if (lastI >= 0) idx.push(lastI);
  if (maxI >= 0 && Math.abs(maxI - lastI) > 1) idx.push(maxI);
  return idx;
}

function renderCost(months) {
  const active = COST_SERIES.filter((s) => months.some((m) => m.bills.length && Math.abs(m.costs[s.id] || 0) > 0.004));
  legend($('costLegend'), active);
  stackedColumns($('costChart'), {
    months, series: active, height: 320,
    value: (m, id) => (m.bills.length ? m.costs[id] : null),
    total: (m) => (m.bills.length ? m.totale : null),
    bands: offerBands(months),
    labelIdx: labelIdx(months, (m) => m.totale),
    fmt: (v, label) => (label ? eur.format(v) : eur0.format(v)),
    label: 'Spesa mensile per voce di costo',
    tipHtml: (m) => tipHead(m) + (m.bills.length
      ? active.filter((s) => Math.abs(m.costs[s.id]) > 0.004).map((s) => row(s.color, s.label, fE(m.costs[s.id]))).join('') +
        row('', 'Totale da pagare', fE(m.totale), 'tot') + row('', 'Consumo', fK(m.kwh)) + row('', 'Costo per kWh', fP(m.allin))
      : ''),
  });
}

function renderCompo(list) {
  const totals = COST_SERIES.map((s) => ({ ...s, v: s.id === 'altre' ? sum(list, altre) : sum(list, (b) => b.costs[s.id]) }));
  const tot = sum(list, (b) => b.totaleDaPagare);
  const pos = totals.filter((t) => t.v > 0.004);
  const posSum = sum(pos, (t) => t.v);
  $('compoSub').textContent = `Su ${eur.format(tot)} pagati nel periodo selezionato.`;
  const bar = pos.map((t) => {
    const share = t.v / posSum;
    const label = share >= 0.07 ? pct.format(share) : '';
    return `<div style="flex:${t.v} 1 0;background:${t.color}" class="${t.ink === '#0b0b0b' ? 'dark-ink' : ''}" title="${esc(t.label)}: ${fE(t.v)} (${pct.format(share)})">${label}</div>`;
  }).join('');
  const rows = totals.filter((t) => Math.abs(t.v) > 0.004).map((t) =>
    `<span class="k"><i class="sw" style="background:${t.color}"></i>${esc(t.label)}</span><span class="v">${fE(t.v)}</span><span class="p">${t.v > 0 ? pct.format(t.v / posSum) : ''}</span>` +
    `<span class="hint">${esc(t.hint)}</span>`).join('');
  const energyShare = (totals[0].v) / posSum;
  $('compo').innerHTML = `<div class="segbar" role="img" aria-label="Composizione della spesa">${bar}</div><div class="compo-list">${rows}</div>` +
    `<p class="muted small" style="margin-top:12px">Solo il ${pct.format(energyShare)} della spesa è energia vera e propria: il resto (rete, oneri, tasse, canone) non dipende dal fornitore che scegli.</p>`;
}

function renderCompare(list) {
  const groups = ['fisso', 'variabile'].map((t) => {
    const bs = list.filter((b) => b.priceType === t);
    const kwh = sum(bs, (b) => b.kwh);
    const nMonths = new Set(bs.map(monthOf)).size;
    return {
      t, bs, kwh, nMonths,
      energy: kwh ? sum(bs, energyVar) / kwh : null,
      allin: kwh ? sum(bs, (b) => b.totaleBolletta) / kwh : null,
      fixedFee: bs.length ? sum(bs, (b) => b.costs.energiaFissa) / Math.max(1, sum(bs, days) / 30.4) : null,
      offers: [...new Set(bs.map((b) => b.offer).filter(Boolean))],
      avgMonth: nMonths ? sum(bs, (b) => b.totaleDaPagare) / nMonths : null,
    };
  });
  const col = (g) => g.bs.length ? `<div class="col">
      ${badge(g.t)} <span class="muted small">${g.nMonths} mesi</span>
      <div class="big">${fP(g.energy)}</div>
      <div class="muted small">prezzo medio energia</div>
      <div class="line"><span>Costo totale per kWh</span><span>${fP(g.allin)}</span></div>
      <div class="line"><span>Quota fissa fornitore</span><span>${fE(g.fixedFee)}/mese</span></div>
      <div class="line"><span>Spesa media mensile</span><span>${fE(g.avgMonth)}</span></div>
      <div class="line"><span>Consumo</span><span>${fK(g.kwh)}</span></div>
      <div class="muted small" style="margin-top:6px">${g.offers.map(esc).join(', ')}</div>
    </div>` : `<div class="col">${badge(g.t)}<p class="muted small" style="margin-top:8px">Nessuna bolletta a prezzo ${g.t} nel periodo selezionato.</p></div>`;
  const [fx, vr] = groups;
  let note = '';
  if (fx.bs.length && vr.bs.length && fx.energy && vr.energy) {
    // what-if: i kWh del periodo variabile pagati al prezzo medio del periodo fisso
    const actual = sum(vr.bs, energyVar);
    const atFixed = vr.kwh * fx.energy;
    const diff = actual - atFixed;
    note = `<p class="small cmp-note">Con il prezzo medio del fisso (${fP(fx.energy)}), l'energia dei mesi a variabile sarebbe costata
      <strong>${fE(atFixed)}</strong> invece di <strong>${fE(actual)}</strong>:
      <strong class="${diff > 0 ? 'delta-up' : 'delta-down'}">${diff > 0 ? fE(diff) + ' in più' : fE(-diff) + ' in meno'}</strong> col variabile (IVA esclusa).
      <span class="muted">Il confronto dipende dai mesi: il variabile segue il PUN del mese.</span></p>`;
  }
  $('compare').innerHTML = `<div class="cmp">${col(fx)}${col(vr)}</div>${note}`;
}

function typeLegend(el, months) {
  const present = new Set(months.filter((m) => m.bills.length).map((m) => m.type));
  legend(el, TYPE_SERIES.filter((t) => present.has(t.id)));
}

// 1. kWh e costo totale, mese per mese (due pannelli allineati, stessa scala dei mesi)
function renderMain(months) {
  typeLegend($('mainLegend'), months);
  columnPanels($('mainChart'), {
    months,
    color: (m) => typeColor(m.type),
    bands: offerBands(months),
    label: 'Consumo in kWh e totale pagato per mese',
    panels: [
      { title: 'Consumo (kWh)', height: 190, value: (m) => (m.bills.length ? m.kwh : null), fmt: (v, l) => int.format(v) + (l ? ' kWh' : '') },
      { title: 'Totale pagato (€)', height: 190, value: (m) => (m.bills.length ? m.totale : null), fmt: (v, l) => (l ? eur.format(v) : eur0.format(v)) },
    ],
    tipHtml: (m) => tipHead(m) + (m.bills.length
      ? row(typeColor(m.type), 'Consumo', fK(m.kwh)) + row(typeColor(m.type), 'Totale pagato', fE(m.totale)) +
        (m.costs.canone ? row('', 'di cui canone RAI', fE(m.costs.canone)) : '') +
        row('', 'Costo per kWh', fP(m.allin), 'tot') + row('', 'Prezzo sola energia', fP(m.energy))
      : ''),
  });
}

// 2. costo per kWh mese per mese, colorato per tipo di contratto, con la media di ogni periodo
function renderContract(months, list) {
  typeLegend($('contractLegend'), months);
  const refs = [];
  months.forEach((m, i) => {
    if (!m.bills.length) return;
    const r = refs[refs.length - 1];
    if (r && r.type === m.type) { r.to = i; r.kwh += m.kwh; r.eur += m.totaleBolletta; }
    else refs.push({ from: i, to: i, type: m.type, kwh: m.kwh, eur: m.totaleBolletta });
  });
  for (const r of refs) {
    // media per bolletta (come nei riquadri sotto), così i mesi misti non spostano i numeri
    const bs = list.filter((b) => b.priceType === r.type);
    const kwh = sum(bs, (b) => b.kwh);
    r.value = kwh ? sum(bs, (b) => b.totaleBolletta) / kwh : r.kwh ? r.eur / r.kwh : 0;
    r.label = `media ${r.type || ''} ${p3.format(r.value)} €/kWh`;
  }
  stackedColumns($('contractChart'), {
    months, height: 260,
    series: [{ id: 'allin', label: 'Costo per kWh', color: (m) => typeColor(m.type) }],
    value: (m) => (m.bills.length && m.kwh ? m.allin : null),
    total: () => null,
    refs,
    fmt: (v) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €',
    label: 'Costo per kWh per tipo di contratto',
    tipHtml: (m) => tipHead(m) + (m.bills.length
      ? row(typeColor(m.type), 'Costo per kWh', fP(m.allin), 'tot') + row('', 'Totale bolletta (senza canone)', fE(m.totaleBolletta)) + row('', 'Consumo', fK(m.kwh))
      : ''),
  });
}

// 3. prezzo della sola energia per kWh
function renderEnergyPrice(months) {
  typeLegend($('priceLegend'), months);
  lineChart($('priceChart'), {
    months, height: 260,
    series: [{ id: 'energy', label: 'Prezzo sola energia', color: (m) => typeColor(m.type) }],
    value: (m) => (m.bills.length && m.kwh ? m.energy : null),
    bands: offerBands(months),
    zero: true,
    fmt: (v, label) => (label ? p3.format(v) + ' €' : v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'),
    label: 'Prezzo della sola energia per kWh',
    tipHtml: (m) => tipHead(m) + (m.bills.length
      ? row(typeColor(m.type), 'Prezzo sola energia', fP(m.energy), 'tot') + row('', 'Spesa energia (quota consumi)', fE(m.energyVar)) + row('', 'Consumo fatturato', fK(m.kwh))
      : ''),
  });
}

function renderKwh(months) {
  const active = KWH_SERIES.filter((s) => months.some((m) => m.bills.length && (m[s.id] || 0) > 0));
  legend($('kwhLegend'), active);
  const tot = (m) => (m.f1 || 0) + (m.f2 || 0) + (m.f3 || 0) + (m.nr || 0);
  stackedColumns($('kwhChart'), {
    months, series: active, height: 260,
    value: (m, id) => (m.bills.length ? m[id] : null),
    total: (m) => (m.bills.length ? tot(m) : null),
    labelIdx: labelIdx(months, tot),
    fmt: (v, label) => int.format(v) + (label ? ' kWh' : ''),
    label: 'Consumi mensili per fascia oraria',
    tipHtml: (m) => {
      if (!m.bills.length) return tipHead(m);
      const t = tot(m);
      return tipHead(m) + active.filter((s) => m[s.id] > 0).map((s) => row(s.color, s.label, `${int.format(m[s.id])} kWh <span class="muted">${t ? pct.format(m[s.id] / t) : ''}</span>`)).join('') +
        row('', 'Totale', fK(t), 'tot') + (Math.abs(t - m.kwh) > 0.5 ? row('', 'Fatturati (con perdite di rete)', fK(m.kwh)) : '');
    },
  });
}

function renderYears() {
  const years = [...new Set(bills.map((b) => monthOf(b).slice(0, 4)).filter(Boolean))].sort();
  const rows = years.map((y) => {
    const bs = bills.filter((b) => monthOf(b).startsWith(y));
    const kwh = sum(bs, (b) => b.kwh);
    const nM = new Set(bs.map(monthOf)).size;
    const tot = sum(bs, (b) => b.totaleDaPagare);
    const types = [...new Set(bs.map((b) => b.priceType))];
    return `<tr><td class="strong">${y}</td><td class="l">${types.map(badge).join(' ')}</td><td>${nM}</td><td>${int.format(kwh)}</td>
      <td>${fE(sum(bs, (b) => b.costs.energia))}</td><td>${fE(sum(bs, (b) => (b.costs.trasporto || 0) + (b.costs.oneri || 0)))}</td>
      <td>${fE(sum(bs, (b) => (b.costs.accise || 0) + (b.costs.iva || 0)))}</td><td>${fE(sum(bs, (b) => b.costs.canone))}</td>
      <td class="strong">${fE(tot)}</td><td>${fE(tot / (nM || 1))}</td><td>${fP(kwh ? sum(bs, (b) => b.totaleBolletta) / kwh : null)}</td></tr>`;
  }).join('');
  $('yearTable').innerHTML = `<thead><tr><th>Anno</th><th class="l">Tariffa</th><th>Mesi</th><th>kWh</th><th>Energia</th><th>Rete e oneri</th><th>Accise e IVA</th><th>Canone</th><th>Totale</th><th>Media/mese</th><th>€/kWh</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderBills(list, months) {
  const missing = months.filter((m) => !m.bills.length).map((m) => mShort(m.key));
  $('billsSub').innerHTML = `${list.length} nel periodo selezionato, ${bills.length} in tutto.` +
    (missing.length ? ` <strong>Mesi senza bolletta:</strong> ${missing.join(', ')}.` : '');
  const rows = [...list].sort((a, b) => (b.periodStart || '').localeCompare(a.periodStart || '')).map((b) => {
    const c = b.costs;
    const check = b.ok ? '<span class="ok" title="Le voci tornano col totale">✓</span>' : `<span class="warn" title="${esc(b.warnings.join('; '))}">⚠</span>`;
    const bands = b.bands ? `${b.bands.f1}/${b.bands.f2}/${b.bands.f3}` : '—';
    return `<tr>
      <td>${dShort(b.periodStart)} – ${dShort(b.periodEnd)}</td>
      <td class="l muted">${esc(b.invoiceNo || '—')}</td>
      <td class="l">${esc(b.offer || '—')}</td><td class="l">${badge(b.priceType)}</td>
      <td>${b.kwh ?? '—'}</td><td class="muted">${bands}</td>
      <td>${fE(c.energia)}</td><td>${fE(c.trasporto)}</td><td>${fE(c.oneri)}</td><td>${fE(c.accise)}</td><td>${fE(c.iva)}</td>
      <td>${fE(c.canone)}</td><td>${Math.abs(altre(b)) > 0.004 ? fE(altre(b)) : '—'}</td>
      <td class="strong">${fE(b.totaleDaPagare)}</td><td>${fP(b.kwh ? b.totaleBolletta / b.kwh : null)}</td>
      <td>${check}</td>
      <td><button class="del" type="button" data-key="${esc(b.key)}" title="Rimuovi questa bolletta" aria-label="Rimuovi bolletta ${esc(b.invoiceNo || '')}">×</button></td>
    </tr>`;
  }).join('');
  $('billTable').innerHTML = `<thead><tr><th>Periodo</th><th class="l">Fattura</th><th class="l">Offerta</th><th class="l">Tipo</th><th>kWh</th><th>F1/F2/F3</th>
    <th>Energia</th><th>Trasporto</th><th>Oneri</th><th>Accise</th><th>IVA</th><th>Canone</th><th>Altre</th><th>Totale</th><th>€/kWh</th><th></th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Totale</td><td>${int.format(sum(list, (b) => b.kwh))}</td><td></td>
      ${['energia', 'trasporto', 'oneri', 'accise', 'iva', 'canone'].map((k) => `<td>${fE(sum(list, (b) => b.costs[k]))}</td>`).join('')}
      <td>${fE(sum(list, altre))}</td><td>${fE(sum(list, (b) => b.totaleDaPagare))}</td><td colspan="3"></td></tr></tfoot>`;
}

// ---------- eventi ----------
$('fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
$('rangeSeg').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) { range = v; render(); }
});
$('billTable').addEventListener('click', (e) => {
  const key = e.target.closest('.del')?.dataset.key;
  if (!key) return;
  const b = bills.find((x) => x.key === key);
  if (!b || !confirm(`Rimuovere la bolletta ${b.invoiceNo || ''} (${dShort(b.periodStart)} – ${dShort(b.periodEnd)})?`)) return;
  bills = bills.filter((x) => x.key !== key);
  hidden.add(key);
  save(); render();
});
$('exportBtn').addEventListener('click', () => {
  const data = { version: 1, exportedAt: new Date().toISOString(), bills: bills.map(({ source, ...b }) => b) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `bollette-luce-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('importInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.bills || [];
    for (const b of list) hidden.delete(b.key || billKey(b));
    const { added, dup } = merge(list, 'import');
    save(); render();
    status(`<strong>${added} bollette importate</strong>${dup ? ` · ${dup} già presenti` : ''}`);
  } catch (err) {
    status(`<strong>File non valido.</strong> ${esc(err.message)}`);
  }
});
$('clearBtn').addEventListener('click', () => {
  if (!bills.length || !confirm('Cancellare tutte le bollette salvate in questo browser? Conviene prima fare "Esporta dati".')) return;
  for (const b of bills) hidden.add(b.key);
  bills = [];
  save(); render(); status('');
});

// trascina e rilascia ovunque nella pagina
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('dropOverlay').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; $('dropOverlay').hidden = true;
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});
window.addEventListener('scroll', hideTip, { passive: true });

let rT, lastW = 0;
new ResizeObserver(([e]) => {
  const w = Math.round(e.contentRect.width);
  if (w === lastW) return;
  lastW = w;
  clearTimeout(rT);
  rT = setTimeout(() => { if (bills.length) render(); }, 120);
}).observe(document.querySelector('.page'));

// ---------- avvio ----------
load();
render();
// Facoltativo: un file bollette.json accanto alla pagina (esportato con "Esporta dati") viene caricato all'avvio.
fetch('bollette.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data) return;
    const { added } = merge(Array.isArray(data) ? data : data.bills || [], 'file');
    if (added) { save(); render(); }
  })
  .catch(() => {});

// per test/debug dalla console
window.__bollette = { get bills() { return bills; }, handleFiles };
