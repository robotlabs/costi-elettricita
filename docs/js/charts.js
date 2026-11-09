// Grafici SVG leggeri, senza dipendenze: colonne impilate e linee, con fasce di offerta e tooltip.

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- tooltip ----------
const tip = () => document.getElementById('tip');
export function showTip(html, x, y) {
  const el = tip();
  el.innerHTML = html;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  let left = x + 16;
  let top = y + 12;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
  if (left < 8) left = 8;
  if (top + r.height > window.innerHeight - 8) top = window.innerHeight - r.height - 8;
  el.style.left = left + 'px';
  el.style.top = Math.max(8, top) + 'px';
}
export function hideTip() { tip().hidden = true; }

// ---------- scale ----------
function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
function ticks(min, max, count = 5) {
  if (max === min) max = min + 1;
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function frame(el, { height, bands }) {
  const W = Math.max(300, Math.round(el.clientWidth || 600));
  const narrow = W < 560;
  const m = { l: narrow ? 38 : 46, r: narrow ? 8 : 16, t: bands?.length ? 30 : 10, b: 38 };
  const H = narrow ? Math.round(height * 0.85) : height;
  return { W, H, m, pw: W - m.l - m.r, ph: H - m.t - m.b, narrow };
}

const colorOf = (sr, mo) => (typeof sr.color === 'function' ? sr.color(mo) : sr.color);

/** Linee di riferimento (es. media per periodo) con etichetta su alone del colore di fondo. */
function refLayer(refs, x0, bw, y) {
  let s = '';
  for (const r of refs) {
    const xa = x0 + r.from * bw + 2, xb = x0 + (r.to + 1) * bw - 2, yy = y(r.value);
    s += `<line x1="${xa}" x2="${xb}" y1="${yy}" y2="${yy}" stroke="var(--text)" stroke-width="1.5" stroke-linecap="round" opacity=".75"/>`;
    if (r.label) s += `<text class="val ref" x="${xb}" y="${yy - 6}" text-anchor="end">${esc(r.label)}</text>`;
  }
  return s;
}

function colPath(x, y, w, h, rt, rb) {
  rt = Math.min(rt, w / 2, h);
  rb = Math.min(rb, w / 2, Math.max(0, h - rt));
  return `M${x},${y + h - rb}V${y + rt}Q${x},${y} ${x + rt},${y}H${x + w - rt}Q${x + w},${y} ${x + w},${y + rt}` +
    `V${y + h - rb}Q${x + w},${y + h} ${x + w - rb},${y + h}H${x + rb}Q${x},${y + h} ${x},${y + h - rb}Z`;
}

/** Etichette dei mesi sotto ogni barra nel formato MM/AA; ruotate se lo spazio è poco. */
function xAxis(months, x0, bw, yBase) {
  const LABEL_W = 32; // larghezza di "10/25" a 11px
  const rotate = bw < LABEL_W;
  const every = rotate ? Math.max(1, Math.ceil(13 / bw)) : 1;
  let s = '';
  months.forEach((mo, i) => {
    if (i % every !== (months.length - 1) % every) return; // l'ultimo mese è sempre etichettato
    const [yy, mm] = mo.key.split('-');
    const label = `${mm}/${yy.slice(2)}`;
    const cx = x0 + i * bw + bw / 2;
    const ty = yBase + 15;
    s += rotate
      ? `<text x="${cx + 3}" y="${ty - 4}" text-anchor="end" transform="rotate(-45 ${cx + 3} ${ty - 4})">${label}</text>`
      : `<text x="${cx}" y="${ty}" text-anchor="middle">${label}</text>`;
  });
  return s;
}

function yGrid(tk, y, m, W, fmt) {
  return tk.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1" shape-rendering="crispEdges"/>` +
    `<text x="${m.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`).join('');
}

/** Fasce di offerta: sfondo per i periodi a prezzo variabile + etichetta con nome offerta sopra il grafico. */
function bandsLayer(bands, x0, bw, m, ph) {
  let s = '';
  for (const b of bands) {
    const xa = x0 + b.from * bw + 1;
    const xb = x0 + (b.to + 1) * bw - 1;
    const w = xb - xa;
    if (b.type === 'variabile') s += `<rect x="${xa}" y="${m.t}" width="${w}" height="${ph}" style="fill:var(--var-bg)"/>`;
    s += `<line x1="${xa + 1}" x2="${xb - 1}" y1="${m.t - 6}" y2="${m.t - 6}" stroke="var(--axis)" stroke-width="2" stroke-linecap="round"/>`;
    const full = `${b.label} · ${b.type === 'variabile' ? 'variabile' : b.type === 'fisso' ? 'fisso' : '?'}`;
    const short = b.type === 'variabile' ? 'Variabile' : b.type === 'fisso' ? 'Fisso' : '?';
    const fit = (t) => t.length * 6.2 + 8 <= w;
    const text = fit(full) ? full : fit(short) ? short : fit(short[0]) ? short[0] : '';
    if (text) s += `<text class="band-label" x="${xa + 2}" y="${m.t - 12}"><title>${esc(full)}</title>${esc(text)}</text>`;
  }
  return s;
}

function attachHover(svg, months, tipHtml, onIndex) {
  const hits = svg.querySelectorAll('.hit');
  const set = (i, ev, el) => {
    hits.forEach((h) => h.classList.toggle('on', +h.dataset.i === i));
    onIndex?.(i);
    if (i == null) return hideTip();
    let x, y;
    if (ev && 'clientX' in ev) { x = ev.clientX; y = ev.clientY; }
    else { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + 40; }
    showTip(tipHtml(months[i]), x, y);
  };
  hits.forEach((h) => {
    const i = +h.dataset.i;
    h.addEventListener('pointermove', (e) => set(i, e, h));
    h.addEventListener('focus', () => set(i, null, h));
    h.addEventListener('pointerleave', () => set(null));
    h.addEventListener('blur', () => set(null));
  });
}

/**
 * Colonne impilate.
 * months: [{key:'2025-01', data?: {...}}]; series: [{id,label,color}];
 * value(month, id) -> number|null; total(month) -> number|null
 */
export function stackedColumns(el, { months, series, value, total, bands = [], fmt, height = 300, tipHtml, labelIdx = [], label, refs = [] }) {
  const { W, H, m, pw, ph, narrow } = frame(el, { height, bands });
  const n = months.length;
  const bw = pw / Math.max(1, n);
  const barW = Math.min(24, Math.max(4, bw * 0.62));

  let maxPos = 0, minNeg = 0;
  for (const mo of months) {
    let p = 0, q = 0;
    for (const s of series) { const v = value(mo, s.id) || 0; if (v > 0) p += v; else q += v; }
    maxPos = Math.max(maxPos, p); minNeg = Math.min(minNeg, q);
  }
  for (const r of refs) maxPos = Math.max(maxPos, r.value);
  // piccole voci negative (bonus, ricalcoli) scendono sotto la linea di base senza aggiungere un tick negativo
  const tk = ticks(minNeg < -0.06 * maxPos ? minNeg : 0, maxPos * 1.08 || 1, narrow ? 4 : 5);
  const lo = tk[0], hi = tk[tk.length - 1];
  const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;

  let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label || '')}">`;
  s += bandsLayer(bands, m.l, bw, m, ph);
  s += yGrid(tk, y, m, W, fmt);
  months.forEach((mo, i) => {
    s += `<rect class="hit" data-i="${i}" tabindex="0" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${ph}" aria-label="${esc(mo.aria || mo.key)}"/>`;
  });
  s += '<g style="pointer-events:none">';
  const GAP = 2;
  months.forEach((mo, i) => {
    const x = m.l + i * bw + (bw - barW) / 2;
    const pos = series.map((sr) => ({ sr, v: value(mo, sr.id) || 0 })).filter((d) => d.v > 0.004);
    const neg = series.map((sr) => ({ sr, v: value(mo, sr.id) || 0 })).filter((d) => d.v < -0.004);
    let acc = 0;
    pos.forEach((d, k) => {
      const yTop = y(acc + d.v);
      const yBot = y(acc) - (k > 0 ? GAP : 0);
      const h = yBot - yTop;
      if (h > 0.3) s += `<path d="${colPath(x, yTop, barW, h, k === pos.length - 1 ? 4 : 0, 0)}" style="fill:${colorOf(d.sr, mo)}"/>`;
      acc += d.v;
    });
    acc = 0;
    neg.forEach((d, k) => {
      const yTop = y(acc) + GAP;
      const yBot = y(acc + d.v);
      const h = yBot - yTop;
      if (h > 0.3) s += `<path d="${colPath(x, yTop, barW, h, 0, k === neg.length - 1 ? 4 : 0)}" style="fill:${colorOf(d.sr, mo)}"/>`;
      acc += d.v;
    });
    if (labelIdx.includes(i)) {
      const t = total(mo);
      if (t != null) s += `<text class="val" x="${m.l + i * bw + bw / 2}" y="${y(Math.max(0, pos.reduce((a, d) => a + d.v, 0))) - 6}" text-anchor="middle">${fmt(t, true)}</text>`;
    }
  });
  s += refLayer(refs, m.l, bw, y);
  s += '</g>';
  s += xAxis(months, m.l, bw, m.t + ph);
  s += '</svg>';
  el.innerHTML = s;
  attachHover(el.querySelector('svg'), months, tipHtml);
}

/** Grafico a linee (stessa unità per tutte le serie), con crosshair. */
export function lineChart(el, { months, series, value, bands = [], fmt, height = 260, tipHtml, label, zero = false }) {
  const { W, H, m, pw, ph, narrow } = frame(el, { height, bands });
  const n = months.length;
  const bw = pw / Math.max(1, n);
  let min = Infinity, max = -Infinity;
  for (const mo of months) for (const sr of series) {
    const v = value(mo, sr.id);
    if (v != null) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (zero) min = Math.min(0, min);
  const pad = (max - min) * 0.1 || max * 0.1 || 0.01;
  const tk = ticks(zero ? min : Math.max(0, min - pad), max + pad, narrow ? 4 : 5);
  const lo = tk[0], hi = tk[tk.length - 1];
  const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
  const cx = (i) => m.l + i * bw + bw / 2;

  let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label || '')}">`;
  s += bandsLayer(bands, m.l, bw, m, ph);
  s += yGrid(tk, y, m, W, fmt);
  months.forEach((mo, i) => {
    s += `<rect class="hit" data-i="${i}" tabindex="0" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${ph}" aria-label="${esc(mo.aria || mo.key)}"/>`;
  });
  s += '<g style="pointer-events:none">';
  s += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>`;
  const ends = [];
  for (const sr of series) {
    let last = null, prev = null;
    const segs = [];
    months.forEach((mo, i) => {
      const v = value(mo, sr.id);
      if (v == null) { prev = null; return; }
      const pt = `${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
      const c = colorOf(sr, mo);
      const seg = segs[segs.length - 1];
      if (prev && seg && seg.c === c) seg.d += `L${pt}`;
      else segs.push({ c, d: prev ? `M${prev}L${pt}` : `M${pt}` });
      prev = pt; last = { i, v };
    });
    for (const g of segs) s += `<path d="${g.d}" fill="none" stroke="${g.c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    // punti isolati (mese senza vicini) altrimenti invisibili
    months.forEach((mo, i) => {
      const v = value(mo, sr.id);
      if (v == null) return;
      const prev = i > 0 ? value(months[i - 1], sr.id) : null;
      const next = i < n - 1 ? value(months[i + 1], sr.id) : null;
      if (prev == null && next == null) s += `<circle cx="${cx(i)}" cy="${y(v)}" r="3" fill="${colorOf(sr, mo)}"/>`;
    });
    if (last) {
      s += `<circle cx="${cx(last.i)}" cy="${y(last.v)}" r="4" fill="${colorOf(sr, months[last.i])}" stroke="var(--surface)" stroke-width="2"/>`;
      ends.push({ x: cx(last.i), y: y(last.v), v: last.v });
    }
    s += `<circle class="dot" data-s="${sr.id}" r="4" fill="${typeof sr.color === 'function' ? 'var(--text)' : sr.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
  }
  // etichette di fine linea solo se non si sovrappongono
  ends.sort((a, b) => a.y - b.y);
  const clear = ends.every((e, k) => k === 0 || e.y - ends[k - 1].y >= 14);
  if (clear) for (const e of ends) s += `<text class="val" x="${e.x - 8}" y="${e.y - 9}" text-anchor="end">${fmt(e.v, true)}</text>`;
  s += '</g>';
  s += xAxis(months, m.l, bw, m.t + ph);
  s += '</svg>';
  el.innerHTML = s;
  const svg = el.querySelector('svg');
  const xh = svg.querySelector('.xhair');
  attachHover(svg, months, tipHtml, (i) => {
    if (i == null) { xh.setAttribute('visibility', 'hidden'); svg.querySelectorAll('.dot').forEach((d) => d.setAttribute('visibility', 'hidden')); return; }
    xh.setAttribute('x1', cx(i)); xh.setAttribute('x2', cx(i)); xh.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.dot').forEach((d) => {
      const v = value(months[i], d.dataset.s);
      if (v == null) return d.setAttribute('visibility', 'hidden');
      const sr = series.find((x) => x.id === d.dataset.s);
      d.setAttribute('fill', colorOf(sr, months[i]));
      d.setAttribute('cx', cx(i)); d.setAttribute('cy', y(v)); d.setAttribute('visibility', 'visible');
    });
  });
}

/**
 * Pannelli di colonne sovrapposti che condividono l'asse dei mesi (es. kWh sopra, euro sotto).
 * Ogni pannello ha la sua scala: niente doppio asse sullo stesso grafico. Il tooltip è unico.
 * panels: [{ value(mo), fmt(v, isLabel), title, height }]; color(mo) -> colore della colonna.
 */
export function columnPanels(el, { months, panels, color, bands = [], tipHtml, label }) {
  const W = Math.max(300, Math.round(el.clientWidth || 600));
  const narrow = W < 560;
  const m = { l: narrow ? 38 : 46, r: narrow ? 8 : 16 };
  const pw = W - m.l - m.r;
  const n = months.length;
  const bw = pw / Math.max(1, n);
  const barW = Math.min(24, Math.max(4, bw * 0.62));
  const TITLE = 22, BETWEEN = 44; // spazio per le etichette dei mesi sotto ogni pannello
  let cursor = bands.length ? 30 : 6;
  const lay = panels.map((p) => {
    const ph = Math.round((narrow ? 0.8 : 1) * p.height);
    const o = { ...p, top: cursor + TITLE, ph };
    cursor = o.top + ph + BETWEEN;
    return o;
  });
  const plotTop = lay[0].top - TITLE + 4;
  const plotBottom = lay[lay.length - 1].top + lay[lay.length - 1].ph;
  const H = plotBottom + 38;

  let s = `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label || '')}">`;
  s += bandsLayer(bands, m.l, bw, { t: bands.length ? 30 : plotTop }, plotBottom - (bands.length ? 30 : plotTop));
  months.forEach((mo, i) => {
    s += `<rect class="hit" data-i="${i}" tabindex="0" x="${m.l + i * bw}" y="${plotTop}" width="${bw}" height="${plotBottom - plotTop}" aria-label="${esc(mo.aria || mo.key)}"/>`;
  });
  for (const p of lay) {
    const max = Math.max(0, ...months.map((mo) => p.value(mo) || 0));
    const tk = ticks(0, max * 1.12 || 1, narrow ? 3 : 4);
    const hi = tk[tk.length - 1];
    const y = (v) => p.top + p.ph - (v / hi) * p.ph;
    s += `<text x="${m.l}" y="${p.top - 10}" class="panel-title">${esc(p.title)}</text>`;
    s += yGrid(tk, y, { l: m.l, r: m.r }, W, p.fmt);
    s += '<g style="pointer-events:none">';
    let lastI = -1, maxI = -1;
    months.forEach((mo, i) => {
      const v = p.value(mo);
      if (v == null || v <= 0) return;
      const yt = y(v);
      s += `<path d="${colPath(m.l + i * bw + (bw - barW) / 2, yt, barW, p.top + p.ph - yt, 4, 0)}" style="fill:${color(mo)}"/>`;
      lastI = i;
      if (maxI < 0 || v > p.value(months[maxI])) maxI = i;
    });
    for (const i of new Set([lastI, maxI])) {
      if (i < 0 || (i === maxI && i !== lastI && Math.abs(i - lastI) <= 1)) continue;
      const v = p.value(months[i]);
      s += `<text class="val" x="${m.l + i * bw + bw / 2}" y="${y(v) - 6}" text-anchor="middle">${p.fmt(v, true)}</text>`;
    }
    s += '</g>';
    s += xAxis(months, m.l, bw, p.top + p.ph); // mesi sotto ogni pannello
  }
  s += '</svg>';
  el.innerHTML = s;
  attachHover(el.querySelector('svg'), months, tipHtml);
}
