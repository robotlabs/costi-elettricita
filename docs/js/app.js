// Dashboard di sola lettura: i dati arrivano da bollette.json, generato dai PDF con `npm run deploy`.
import { stackedColumns, lineChart, columnPanels, hideTip } from './charts.js?v=202611100836';

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
let locations = []; // una scheda per ogni cartella in data/ (pisa, manfredonia, ...)
let loc = null;     // scheda attiva
let bills = [];     // bollette della scheda attiva
let range = 'all';  // periodo predefinito: tutti i mesi

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
  if (!has) { $('supplyInfo').textContent = 'Nessuna bolletta ancora.'; return; }

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
    latest.clientType ? esc(latest.clientType.replace(/^Domestico /, 'domestico ').replace('Residente', 'residente')) : '',
  ].filter(Boolean).join(' · ');

  const list = filtered();
  const months = aggregate(list);
  const withData = months.filter((m) => m.bills.length);
  renderMain(months);
  renderLed();
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

// Esempio lampadina: quanto costa un kWh in più = quota a consumo (energia + rete + oneri) + accise se si pagano, IVA inclusa.
// Si sommano le bollette più recenti dello stesso tipo di prezzo fino ad almeno 30 kWh:
// con consumi minimi (es. 2 kWh in un mese) una bolletta sola darebbe un prezzo falsato dagli arrotondamenti.
const metered = (b) => (b.bands ? b.bands.f1 + b.bands.f2 + b.bands.f3 : b.kwh);
function marginalPrice(list, type) {
  const bs = list.filter((b) => b.quotaConsumi && metered(b) && (!type || b.priceType === type))
    .sort((a, b) => (b.periodStart || '').localeCompare(a.periodStart || ''));
  if (!bs.length) return null;
  const t = bs[0].priceType;
  let quota = 0, kwh = 0, accise = 0;
  const used = [];
  for (const b of bs) {
    if (b.priceType !== t) break;
    quota += b.quotaConsumi; kwh += metered(b); accise += (b.acciseRate || 0) * metered(b);
    used.push(b);
    if (kwh >= 30) break;
  }
  const iva = used[0].ivaRate ?? 10;
  const from = monthOf(used[used.length - 1]), to = monthOf(used[0]);
  return { price: ((quota + accise) / kwh) * (1 + iva / 100), type: t, iva, accise: accise > 0, kwh,
    when: from === to ? mLong(to) : `${mShort(from)} – ${mShort(to)}` };
}
function renderLed() {
  const ref = marginalPrice(bills);
  const fixedRef = ref && ref.type !== 'fisso' ? marginalPrice(bills, 'fisso') : null;
  const out = $('ledOut');
  if (!ref) { out.innerHTML = '<p class="muted">Servono bollette nel formato con lo "scontrino dell\'energia" per calcolare il prezzo.</p>'; return; }
  const f = new FormData($('ledForm'));
  const v = (k, d) => { const x = parseFloat(String(f.get(k)).replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : d; };
  const w = v('w', 9), br = Math.min(100, v('b', 50)), h = Math.min(24, v('h', 12)), n = Math.max(1, Math.round(v('n', 1))), sb = v('s', 0.3);
  const kwhDay = ((w * br / 100) * h + sb * (24 - h)) * n / 1000;
  const price = ref.price;
  const periods = [['Al giorno', 1], ['Al mese', 365 / 12], ["All'anno", 365]];
  const eur3 = (x) => (x < 1 ? x.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3, maximumFractionDigits: 3 }) : eur.format(x));
  const kwhFmt = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: x < 10 ? 2 : 1 }) + ' kWh';
  let html = `<div class="big">${eur.format(kwhDay * 365 / 12 * price)} <span class="muted" style="font-size:16px;font-weight:500">al mese</span></div>
    <div class="muted small">${eur.format(kwhDay * 365 * price)} all'anno · ${n > 1 ? n + ' lampadine, ' : ''}${(w * br / 100).toLocaleString('it-IT')} W da accesa</div>
    <table class="tbl"><thead><tr><th></th><th>Consumo</th><th>Costo</th></tr></thead><tbody>` +
    periods.map(([l, d]) => `<tr><td>${l}</td><td>${kwhFmt(kwhDay * d)}</td><td class="strong">${eur3(kwhDay * d * price)}</td></tr>`).join('') +
    `</tbody></table>
    <p class="muted small note">Prezzo usato: <strong>${fP(price)}</strong>, cioè quanto ti costa un kWh in più
    (${ref.when}, prezzo ${ref.type || 'n.d.'}): energia, rete e oneri a consumo${ref.accise ? ', accise' : ''}, IVA ${ref.iva}% inclusa.
    Le quote fisse no, perché le paghi comunque. A metà luminosità si stima metà della potenza.</p>`;
  if (fixedRef) {
    const pf = fixedRef.price;
    html += `<p class="small note">Col prezzo fisso di prima (${fP(pf)}, ${fixedRef.when}) la stessa lampadina costava
      <strong>${eur.format(kwhDay * 365 * pf)}</strong> all'anno invece di <strong>${eur.format(kwhDay * 365 * price)}</strong>.</p>`;
  }
  out.innerHTML = html;
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
      <td class="l">${esc(b.offer || '—')}</td><td class="l">${badge(b.priceType)}</td>
      <td>${b.kwh ?? '—'}</td><td class="muted">${bands}</td>
      <td>${fE(c.energia)}</td><td>${fE(c.trasporto)}</td><td>${fE(c.oneri)}</td><td>${fE(c.accise)}</td><td>${fE(c.iva)}</td>
      <td>${fE(c.canone)}</td><td>${Math.abs(altre(b)) > 0.004 ? fE(altre(b)) : '—'}</td>
      <td class="strong">${fE(b.totaleDaPagare)}</td><td>${fP(b.kwh ? b.totaleBolletta / b.kwh : null)}</td>
      <td>${check}</td>
    </tr>`;
  }).join('');
  $('billTable').innerHTML = `<thead><tr><th>Periodo</th><th class="l">Offerta</th><th class="l">Tipo</th><th>kWh</th><th>F1/F2/F3</th>
    <th>Energia</th><th>Trasporto</th><th>Oneri</th><th>Accise</th><th>IVA</th><th>Canone</th><th>Altre</th><th>Totale</th><th>€/kWh</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">Totale</td><td>${int.format(sum(list, (b) => b.kwh))}</td><td></td>
      ${['energia', 'trasporto', 'oneri', 'accise', 'iva', 'canone'].map((k) => `<td>${fE(sum(list, (b) => b.costs[k]))}</td>`).join('')}
      <td>${fE(sum(list, altre))}</td><td>${fE(sum(list, (b) => b.totaleDaPagare))}</td><td colspan="2"></td></tr></tfoot>`;
}

// ---------- eventi ----------
$('ledForm').addEventListener('input', () => { if (bills.length) renderLed(); });
$('rangeSeg').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (v) { range = v; render(); }
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

// ---------- schede (una per casa) ----------
function renderTabs() {
  const el = $('locTabs');
  el.hidden = locations.length < 2;
  el.innerHTML = locations.map((l) =>
    `<button type="button" role="tab" data-id="${esc(l.id)}" aria-selected="${l === loc}">${esc(l.name)}<span class="count">${l.bills.length}</span></button>`).join('');
}
function selectLocation(id, push = true) {
  loc = locations.find((l) => l.id === id) || locations[0] || null;
  bills = loc ? loc.bills : [];
  range = 'all';
  document.title = loc && locations.length > 1 ? `Bollette luce · ${loc.name}` : 'Bollette luce';
  if (push && loc) history.replaceState(null, '', '#' + loc.id);
  renderTabs();
  render();
}
$('locTabs').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.dataset.id;
  if (id && id !== loc?.id) { selectLocation(id); window.scrollTo({ top: 0 }); }
});
window.addEventListener('hashchange', () => selectLocation(location.hash.slice(1), false));

// ---------- avvio ----------
fetch('bollette.json', { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((data) => {
    const clean = (list) => (list || []).filter((b) => b && b.costs);
    // formato attuale: { locations: [...] }; formato vecchio: { bills: [...] } con una sola casa
    locations = data.locations
      ? data.locations.map((l) => ({ ...l, bills: clean(l.bills) }))
      : [{ id: 'casa', name: 'Casa', bills: clean(Array.isArray(data) ? data : data.bills) }];
    if (data.generatedAt) $('updated').textContent = `Dati aggiornati il ${new Date(data.generatedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
    selectLocation(location.hash.slice(1), false);
  })
  .catch((e) => {
    render();
    status(`<strong>Impossibile leggere bollette.json.</strong> ${esc(e.message)}`);
  });

// per debug dalla console
window.__bollette = { get bills() { return bills; }, get locations() { return locations; }, selectLocation };
