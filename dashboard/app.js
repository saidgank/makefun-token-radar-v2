/* DUSTLINE Token Radar v2 — the dashboard's behaviour. Reads window.RADAR
   (written by main.ts beside this page as ../data.js), renders the ranked
   board, the model and blind-test panels, the tracked set, and one detail
   view per protocol with its dated farm plan. No network, no imports. */
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const moneyFull = (n) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
const pctClass = (n) => (n === null || n === undefined || n === 0 ? '' : n > 0 ? 'pos' : 'neg');
const ageText = (d) => (d === null || d === undefined ? '—' : d >= 365 ? `${(d / 365).toFixed(1)}y` : `${d}d`);
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') || '',
  cat: params.get('cat') || '',
  chain: params.get('chain') || '',
  minTvl: Number(params.get('tvl') || 0),
  watch: params.get('watch') === '1',
  sortKey: 'rank',
  sortDir: 1,
};

/* ---------- masthead + model + blind test ---------- */
function renderMasthead() {
  $('mastStats').innerHTML = [
    [R.counts.protocols, 'protocols scanned'],
    [R.counts.board, 'pre-token ranked'],
    [`${R.counts.watchlist}/${R.counts.watchlist}`, 'watchlist covered'],
    [R.as_of, 'snapshot date'],
  ].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
  $('modelVersion').textContent = `· ${R.model_version} · multiples from ${R.counts.tokenised_measured} tokenised protocols`;
  $('footSource').textContent = R.source;
}

function renderMultiples() {
  const rows = R.multiples.by_category.slice(0, 12)
    .map((m) => `<tr><td>${esc(m.category)}</td><td class="num">${m.multiple.toFixed(3)}</td><td class="num">${m.median.toFixed(3)}</td><td class="num">${m.n}</td></tr>`)
    .join('');
  $('multipleTable').innerHTML =
    `<table class="mini-table"><thead><tr><th>Category</th><th class="num">Multiple used</th><th class="num">Raw median</th><th class="num">Tokens</th></tr></thead><tbody>${rows}` +
    `<tr><td><strong>All categories (global)</strong></td><td class="num"><strong>${R.multiples.global.toFixed(3)}</strong></td><td class="num">${R.multiples.global.toFixed(3)}</td><td class="num">${R.counts.tokenised_measured}</td></tr></tbody></table>`;
}

function renderBlind() {
  const b = R.blindtest;
  $('blindStats').innerHTML = [
    [`${b.within_band}/${b.n}`, `launches within ${b.band_factor}x of implied`],
    [`${(b.hit_rate * 100).toFixed(0)}%`, 'blind-test hit rate'],
    [b.spearman.toFixed(2), 'Spearman rank corr.'],
    [`${b.median_ratio.toFixed(2)}x`, 'median outcome / implied'],
  ].map(([v, s]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(s)}</span></div>`).join('');
  $('blindDay30').textContent = `${(b.hit_rate_day30 * 100).toFixed(0)}% in band, Spearman ${b.spearman_day30.toFixed(2)}`;
  $('blindTable').innerHTML =
    `<table class="mini-table"><thead><tr><th>Launch</th><th>Protocol</th><th class="num">Implied then</th><th class="num">Mcap now</th><th class="num">Ratio</th><th class="num">Mcap day-30 est.</th><th>In band</th></tr></thead><tbody>` +
    b.rows.map((r) => `<tr><td>${esc(r.launch_date)}</td><td>${esc(r.name)} <span class="dim">${esc(r.symbol)}</span></td><td class="num">${money(r.implied_usd)}</td><td class="num">${money(r.actual_usd)}</td><td class="num">${r.ratio.toFixed(2)}x</td><td class="num">${money(r.actual_day30_usd)}</td><td class="${r.within_band ? 'hit' : 'miss'}">${r.within_band ? 'yes' : 'no'}</td></tr>`).join('') +
    `</tbody></table>`;
}

/* ---------- the board ---------- */
function fillFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('catFilter').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option ${c === state.cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('chainFilter').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option ${c === state.chain ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('q').value = state.q;
  $('watchOnly').checked = state.watch;
  if (state.minTvl) $('tvlFilter').value = String(state.minTvl);
}

const sortValue = (r, key) => {
  switch (key) {
    case 'name': return r.name.toLowerCase();
    case 'category': return (r.category || '').toLowerCase();
    case 'chains': return r.chains.length;
    case 'capital': return r.plan.capital_usd;
    case 'stop_usd': return r.plan.stop_usd;
    case 'change_7d': return r.change_7d ?? -Infinity;
    case 'age_days': return r.age_days ?? -1;
    default: return r[key];
  }
};

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!state.cat || r.category === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.minTvl &&
    (!state.watch || r.watchlist));
  rows = [...rows].sort((a, b) => {
    const va = sortValue(a, state.sortKey);
    const vb = sortValue(b, state.sortKey);
    return (va < vb ? -1 : va > vb ? 1 : 0) * state.sortDir;
  });
  return rows;
}

function renderBoard() {
  const rows = visibleRows();
  $('rowCount').textContent = `${rows.length} of ${R.rows.length} protocols`;
  $('boardBody').innerHTML = rows.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="rank">${r.rank}</td>
    <td class="name-cell"><b>${esc(r.name)}</b>${r.watchlist ? '<span class="wl">WL</span>' : ''}<span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category || '—')}</td>
    <td><span class="pill">${esc(r.chains[0] || '—')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</span></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num ${pctClass(r.change_7d)}">${pct(r.change_7d)}</td>
    <td class="num">${ageText(r.age_days)}</td>
    <td class="num"><strong>${money(r.implied_value_usd)}</strong></td>
    <td class="num">${moneyFull(r.plan.capital_usd)}</td>
    <td class="num">${money(r.plan.stop_usd)}</td>
  </tr>`).join('');
  document.querySelectorAll('#boardBody tr').forEach((tr) => {
    tr.addEventListener('click', () => showDetail(tr.getAttribute('data-slug')));
  });
  document.querySelectorAll('#board th').forEach((th) => {
    th.classList.toggle('sorted', th.getAttribute('data-key') === state.sortKey);
  });
}

function renderTracked() {
  $('trackedBody').innerHTML = R.tracked.map((t) => `<tr>
    <td class="name-cell"><b>${esc(t.name)}</b><span class="slug">${esc(t.slug)}</span></td>
    <td class="mono">${esc(t.symbol || '—')}</td>
    <td>${esc(t.category || '—')}</td>
    <td class="num">${money(t.tvl_usd)}</td>
    <td class="num">${money(t.mcap_usd)}</td>
    <td class="num">${t.mcap_usd && t.tvl_usd ? (t.mcap_usd / t.tvl_usd).toFixed(3) : '—'}</td>
    <td class="num ${pctClass(t.change_7d)}">${pct(t.change_7d)}</td>
  </tr>`).join('');
}

/* ---------- detail view ---------- */
function showDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  const p = r.plan;
  const m = r.model;
  const planRows = [
    [`${p.window_entry[0]} → ${p.window_entry[1]}`, cap1(p.action), `${moneyFull(p.capital_usd)} capital + ~${moneyFull(p.entry_gas_usd)} gas (est.)`, '25 minutes', ''],
    [`${p.window_build[0]} → ${p.window_build[1]}`, 'Repeat one qualifying action a week — a deposit, borrow, swap, bridge or vote — so the wallet builds a dated history', `~${moneyFull(p.weekly_gas_usd)} gas a week (est.)`, '10 min / week', ''],
    [`until ${p.hold_until}`, `Hold the position (${p.hold_days} days past the entry window); check it and the board's figures weekly`, `${moneyFull(p.capital_usd)} stays in the position`, '5 min / week', ''],
    ['every weekly check', `TVL STOP — exit if TVL falls below ${moneyFull(p.stop_usd)} (30% under the snapshot's ${moneyFull(r.tvl_usd)}), or the 7-day change stays under −25% three checks running`, `~${moneyFull(p.exit_gas_usd)} exit gas (est.)`, '15 minutes', 'stop-row'],
    ['on a token announcement', 'Claim only from the link on the official page, never pay to claim; compare the opening market cap with the implied value before buying', '$0 to check', '10 minutes', ''],
  ];
  $('detailPanel').innerHTML = `
    <button class="back-btn" id="backBtn">← Back to the board</button>
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)}${r.watchlist ? '<span class="wl">WATCHLIST</span>' : ''}</h2>
        <div class="sub">${esc(r.slug)} · ${esc(r.category || 'uncategorised')} · ${esc(r.chains.join(', ') || 'no chain recorded')} · board rank #${r.rank}</div>
      </div>
      <div class="implied-big"><b>${moneyFull(r.implied_value_usd)}</b><span>implied value · model ${esc(R.model_version)}</span></div>
    </div>
    <div class="fig-grid">
      <div class="fig"><b>${moneyFull(r.tvl_usd)}</b><span>TVL (snapshot)</span></div>
      <div class="fig"><b>${pct(r.change_7d)}</b><span>TVL change, 7d</span></div>
      <div class="fig"><b>${r.age_days === null ? 'unknown' : `${r.age_days} days`}</b><span>run with no token</span></div>
      <div class="fig"><b>${moneyFull(p.capital_usd)}</b><span>plan capital</span></div>
      <div class="fig"><b>${moneyFull(p.stop_usd)}</b><span>TVL stop (−30%)</span></div>
    </div>
    <h3>The model's arithmetic</h3>
    <p class="arith">${moneyFull(r.tvl_usd)} <span class="op">TVL ×</span> ${m.multiple.toFixed(3)} <span class="op">(${esc(r.category || 'global')} multiple, n=${m.multiple_n || 'global'}) ×</span> ${m.growth_factor.toFixed(3)} <span class="op">(growth ${pct(m.growth_pct)}) ×</span> ${m.maturity_factor.toFixed(3)} <span class="op">(maturity) =</span> <span class="res">${moneyFull(r.implied_value_usd)}</span></p>
    <h3>The dated farm plan</h3>
    <div class="table-wrap"><table class="plan-table">
      <thead><tr><th>Window</th><th>Action</th><th>Estimated cost</th><th>Estimated time</th></tr></thead>
      <tbody>${planRows.map(([w, a, c, t, cls]) => `<tr class="${cls}"><td class="win">${esc(w)}</td><td>${esc(a)}</td><td>${esc(c)}</td><td>${esc(t)}</td></tr>`).join('')}</tbody>
    </table></div>
    <h3>The plan as the board carries it</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('boardView').hidden = true;
  $('detailView').hidden = false;
  $('backBtn').addEventListener('click', () => {
    $('detailView').hidden = true;
    $('boardView').hidden = false;
    window.scrollTo(0, 0);
  });
  window.scrollTo(0, 0);
}

/* ---------- wiring ---------- */
function init() {
  renderMasthead();
  renderMultiples();
  renderBlind();
  fillFilters();
  renderBoard();
  renderTracked();
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('catFilter').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('chainFilter').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('tvlFilter').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); renderBoard(); });
  $('watchOnly').addEventListener('change', (e) => { state.watch = e.target.checked; renderBoard(); });
  document.querySelectorAll('#board th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-key');
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = key === 'rank' || key === 'name' ? 1 : -1; }
      renderBoard();
    });
  });
  if (params.get('view') === 'detail' && params.get('slug')) showDetail(params.get('slug'));
  if (params.get('focus') === 'table') document.getElementById('board').scrollIntoView();
}

init();
