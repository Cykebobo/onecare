// OneCare interface: shell, routing, identity, and the consumer side (SnapCase, My Cases, My Products).
// Staff views live in staff.js. Every piece of user-entered text is escaped by the html`` helper.
(() => {
'use strict';
const D = OCDomain;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ───────── safe templating ─────────
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const out = v => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(out).join('') : (v === null || v === undefined || v === false) ? '' : esc(v);
const html = (strings, ...vals) => new Safe(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? out(vals[i]) : ''), ''));
const raw = s => new Safe(s);

// ───────── state ─────────
const PEOPLE = [
  { key: 'sarah', role: 'consumer', label: 'Sarah Jenkins, consumer', email: 'sarah.jenkins@example.com', name: 'Sarah Jenkins' },
  { key: 'tom', role: 'advisor', who: 'tom', label: 'Tom Ellis, frontline advisor' },
  { key: 'priya', role: 'advisor', who: 'priya', label: 'Priya Shah, frontline advisor' },
  { key: 'hannah', role: 'warranty', who: 'hannah', label: 'Hannah Brooks, warranty (Oral-B approver)' },
  { key: 'marcus', role: 'warranty', who: 'marcus', label: 'Marcus Reid, warranty (Braun approver)' },
  { key: 'jo', role: 'warranty', who: 'jo', label: 'Jo Patel, technical team' },
  { key: 'leah', role: 'manager', who: 'leah', label: 'Leah Morgan, care operations manager' },
  { key: 'admin', role: 'admin', who: 'admin', label: 'Brand rules admin' },
];
const saved = (() => { try { return JSON.parse(sessionStorage.getItem('oc') || '{}'); } catch { return {}; } })();
const S = { person: saved.person || 'sarah', email: saved.email || 'sarah.jenkins@example.com', name: saved.name || 'Sarah Jenkins', meta: null, now: Date.now(), lastStaff: saved.lastStaff || 'tom', dirty: false };
const me = () => PEOPLE.find(p => p.key === S.person) || PEOPLE[0];
const persist = () => { try { sessionStorage.setItem('oc', JSON.stringify({ person: S.person, email: S.email, name: S.name, lastStaff: S.lastStaff })); } catch { /* private mode */ } };
function become(key) { S.person = key; const p = me(); if (p.role !== 'consumer' && p.role !== 'manager' && p.role !== 'admin') S.lastStaff = key; persist(); }
const identity = () => { const p = me(); return p.role === 'consumer' ? { as: 'consumer', email: S.email } : { as: p.role, who: p.who }; };

// ───────── API: a server if there is one, otherwise the same engine in this browser ─────────
let local = null;
class ApiError extends Error {}
async function api(method, path, body, query) {
  const id = identity();
  if (method === 'GET') query = { ...id, ...(query || {}) }; else body = { ...id, ...(body || {}) };
  if (local) {
    const r = await local.handle(method, path, new URLSearchParams(query || {}), body || {});
    if (r.status !== 200) throw new ApiError(r.body.error || 'That did not work');
    return JSON.parse(JSON.stringify(r.body));
  }
  const r = await fetch(path + (query ? '?' + new URLSearchParams(query) : ''), { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'That did not work');
  return j;
}
let cloudCheck = Promise.resolve(); // settles once the cloud reader has said whether it is there
async function connect() {
  try {
    if (location.protocol === 'file:') throw new Error('no server');
    const r = await fetch('/api/meta', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error('no api');
    const es = new EventSource('/api/events');
    es.onmessage = () => softRefresh();
  } catch {
    let mem = null;
    // No server behind this page (the public site). A hosted model does the reading through the cloud reader
    // when one is configured and answering; otherwise text recognition and the rules do it.
    const cloud = window.OC_CONFIG && OC_CONFIG.ai && window.OCCloud ? OCCloud.create(OC_CONFIG.ai) : null;
    local = OCCore.createCore({
      load: () => { try { return JSON.parse(localStorage.getItem('onecare-db')); } catch { return mem; } },
      save: db => { mem = db; try { localStorage.setItem('onecare-db', JSON.stringify(db)); } catch { /* storage full: keep in memory */ } },
      onChange: () => softRefresh(),
      ai: cloud,
    });
    setInterval(() => local.tick(), 5000);
    if (cloud) cloudCheck = cloud.check().then(async ok => { if (ok) { await loadMeta(); renderBar(); softRefresh(); } });
  }
  await loadMeta();
}
async function loadMeta() { S.meta = await api('GET', '/api/meta'); S.now = S.meta.now; }

// ───────── formatting ─────────
const fmtDT = ms => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtD = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDay = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function rel(ms, now = S.now) {
  const d = ms - now, a = Math.abs(d), m = Math.round(a / 60e3), h = Math.round(a / D.HOUR), days = Math.round(a / D.DAY);
  const t = m < 60 ? `${Math.max(1, m)} min` : h < 48 ? `${h} h` : `${days} days`;
  return d >= 0 ? `in ${t}` : `${t} ago`;
}
const dur = ms => { const h = ms / D.HOUR; return h < 1 ? `${Math.round(ms / 60e3)} min` : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`; };
const pctText = x => x === null || x === undefined ? 'n/a' : Math.round(x * 100) + '%';
const brandOf = key => S.meta.brands[key];
const aiName = () => 'AI'; // drafts and readings are marked as machine-made; which model made them is not the user's concern
const toLocalInput = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', bad ? 5200 : 2800); }
async function attempt(fn, done) { try { const r = await fn(); S.dirty = false; if (done) toast(done); return r; } catch (e) { if (e instanceof ApiError) { toast(e.message, true); return undefined; } console.error(e); toast('Something went wrong', true); return undefined; } }

// ───────── routing ─────────
function route() {
  const [pathPart, queryPart] = (location.hash || '#/').slice(1).split('?');
  const [, name = '', a = '', b = ''] = pathPart.split('/');
  return { name, a: decodeURIComponent(a), b: decodeURIComponent(b), q: new URLSearchParams(queryPart || '') };
}
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
const views = {}, actions = {};

function fitRole(r) {
  const role = me().role;
  const staffMode = r.q.get('staff') === '1';
  if (['support', 'cases', 'case', 'products'].includes(r.name) || (r.name === 'new' && !staffMode)) { if (role !== 'consumer') become('sarah'); }
  else if (r.name === 'desk' || (r.name === 'new' && staffMode)) { if (!['advisor', 'warranty'].includes(role)) become(S.lastStaff); }
  else if (r.name === 'radar') { if (role !== 'manager') become('leah'); }
  else if (r.name === 'rules') { if (role !== 'admin') become('admin'); }
}

function renderBar() {
  const r = route(), p = me();
  const cur = n => (Array.isArray(n) ? n : [n]).includes(r.name) ? 'page' : null;
  $('#bar').innerHTML = html`
    <a class="logo" href="#/">OneCare</a>
    <nav aria-label="Main">
      <a href="#/support/oral-b" aria-current="${cur(['support', 'new'])}">Get help</a>
      <a href="#/cases" aria-current="${cur(['cases', 'case', 'products'])}">My Cases</a>
      <a href="#/desk" aria-current="${cur('desk')}">Case desk</a>
      <a href="#/radar" aria-current="${cur('radar')}">Signal Radar</a>
      <a href="#/rules" aria-current="${cur('rules')}">Brand rules</a>
    </nav>
    <span class="spacer"></span>
    <span class="clock" title="The demo clock. Move time forward to see reminders and escalation. The rest of the team keeps working on their own cases while it moves."><span>${fmtDT(S.now)}</span>
      <button data-action="clock" data-h="4">+4 h</button><button data-action="clock" data-h="24">+1 day</button><button data-action="clock" data-h="168">+1 week</button><button data-action="reset">Reset</button></span>
    <span class="who"><select id="who" data-change="who" aria-label="Viewing as" title="Viewing as">${PEOPLE.map(x => html`<option value="${x.key}" ${x.key === p.key ? raw('selected') : ''}>${x.label}</option>`)}</select></span>`.s;
}

let renderSeq = 0;
async function render() {
  const r = route(), seq = ++renderSeq;
  fitRole(r);
  try { await loadMeta(); } catch { /* keep the last meta */ }
  if (seq !== renderSeq) return;
  renderBar();
  document.body.dataset.view = r.name || 'home'; // the light behind the page is strongest on the consumer pages
  const brand = ['support', 'new'].includes(r.name) && S.meta.brands[r.a] ? S.meta.brands[r.a].accent : null;
  document.documentElement.style.setProperty('--brand', brand || 'var(--ink)');
  const view = views[r.name || 'home'] || views.home;
  let content;
  try { content = await view(r); } catch (e) { content = e instanceof ApiError ? html`<div class="empty"><b>${e.message}</b><a href="#/">Back to the start</a></div>` : (console.error(e), html`<div class="empty"><b>This page could not be shown</b>${String(e.message || e)}</div>`); }
  if (seq !== renderSeq) return;
  const y = window.scrollY, keep = render.last === location.hash;
  $('#app').innerHTML = out(content);
  render.last = location.hash; S.dirty = false;
  if (keep) window.scrollTo(0, y); else window.scrollTo(0, 0);
  document.title = ($('#app h1') ? $('#app h1').textContent + ' · ' : '') + 'OneCare';
}
function softRefresh() {
  const el = document.activeElement;
  if (S.dirty || $('#dlg').open || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.closest('#app'))) return;
  clearTimeout(softRefresh.t); softRefresh.t = setTimeout(render, 250);
}

// ───────── events ─────────
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && actions[el.dataset.change]) actions[el.dataset.change](el, e); });
document.addEventListener('input', e => { if (e.target.closest('#app')) S.dirty = true; const el = e.target.closest('[data-input]'); if (el && actions[el.dataset.input]) actions[el.dataset.input](el, e); });
document.addEventListener('submit', e => { e.preventDefault(); const f = e.target.closest('form[data-submit]'); if (f && actions[f.dataset.submit]) actions[f.dataset.submit](f, e); });
window.addEventListener('hashchange', render);

actions.who = el => { become(el.value); const r = route(), role = me().role;
  if (role === 'consumer') go(['support', 'new', 'cases', 'case', 'products'].includes(r.name) ? location.hash : '#/cases');
  else if (role === 'manager') go('#/radar'); else if (role === 'admin') go('#/rules'); else go(r.name === 'desk' ? location.hash : '#/desk'); };
actions.clock = async el => { await attempt(() => api('POST', '/api/clock', { hours: +el.dataset.h }), `Clock moved forward ${el.textContent.trim().slice(1)}`); render(); };
actions.reset = async () => { if (!confirm('Reset the demo? Every case goes back to the synthetic starting data.')) return; await attempt(() => api('POST', '/api/reset'), 'Demo data restored'); snap = null; go('#/'); };

// ───────── home ─────────
// Beside the headline the product does its one trick on a loop: a label is read and the Case Card fills in.
const heroDemo = () => raw(`<div class="hd" aria-hidden="true">
  <figure class="hd-photo"><img src="assets/demo-label.jpg" alt=""><span class="beam"></span><i class="hit"></i><i class="hit"></i><i class="hit"></i><i class="hit"></i></figure>
  <div class="hd-card"><div class="ch">Case Card<span><i></i></span></div>
    <div class="r"><small>Product</small><b>iO Series toothbrush</b></div><div class="r"><small>Model</small><b>iO8, Type 3758</b></div>
    <div class="r"><small>Serial</small><b>PC5231884</b></div><div class="r"><small>Bought</small><b>12 May 2026, Boots</b></div></div></div>`);
let homeSeen = false;
views.home = () => { const first = !homeSeen; homeSeen = true; return html`
  <section class="home-hero ${first ? 'intro' : ''}"><div>
    <h1>${raw('One case, one owner, every promise kept.'.split(' ').map((w, i) => `<span class="w" style="--w:${i}">${w}</span>`).join(' '))}</h1>
    <div class="thread" aria-hidden="true"><span>Photo in</span><span>One record</span><span>One owner</span><span>Promise tracked</span><span>Closed</span></div>
    <p>OneCare is shared case management for after-sales support. A problem reported by web form, email, phone or ChatBot lands in one record with one named owner, and every promise an advisor makes becomes a task with a deadline. This build runs the whole journey for Oral-B and Braun in the UK, on synthetic cases.</p>
  </div>${heroDemo()}</section>
  <section class="doors">
    <div class="door"><h2>Consumers</h2><p>Report a problem once, with the evidence each brand needs, then follow it without chasing.</p>
      <div class="btns"><a class="btn" href="#/support/oral-b">Oral-B support</a><a class="btn" href="#/support/braun">Braun support</a><a class="btn ghost" href="#/cases">My Cases</a></div></div>
    <div class="door"><h2>Care teams</h2><p>One Case Card with everything already sent. Handovers carry a summary and a named owner. Promises are tracked.</p>
      <div class="btns"><a class="btn" href="#/desk">Open the case desk</a><button class="btn ghost" data-action="asPerson" data-key="hannah">Warranty team view</button></div></div>
    <div class="door"><h2>Managers</h2><p>See overdue promises, repeat contacts and low ratings each week, per brand. Add a brand by changing rules, not code.</p>
      <div class="btns"><a class="btn" href="#/radar">Signal Radar</a><a class="btn ghost" href="#/rules">Brand rules</a></div></div>
  </section>
  <section class="walk">
    <div><h2>Try the whole journey</h2><p class="muted" style="margin-top:8px">About five minutes. The clock buttons at the top move time forward, so you can watch a promise go overdue without waiting two days.</p></div>
    <ol>
      <li><b>Report a fault as Sarah.</b> Open <a href="#/new/oral-b">Oral-B support</a>, hold a toothbrush (or any photo of one) up to the camera. OneCare fills in the case from the photo and asks only for what it could not see. Say you will add the receipt later.</li>
      <li><b>Pick it up as Tom.</b> On the <a href="#/desk">case desk</a>, open her case. Everything she sent is on one card. Hand it to the warranty team: the summary is drafted for you and the next owner is named.</li>
      <li><b>Decide as Hannah.</b> Switch to Hannah Brooks at the top. Only she can approve an Oral-B claim. Approve it, send the suggested reply, and confirm the promise it contains.</li>
      <li><b>Let it slip.</b> Press +1 day three times. The promise goes overdue: Hannah is reminded, Sarah is told without asking, and after a day it reaches the supervisor.</li>
      <li><b>See it as Sarah.</b> Open <a href="#/cases">My Cases</a>. The page says whose turn it is and what was promised. Confirm delivery, then rate the case.</li>
      <li><b>See it as Leah.</b> <a href="#/radar">Signal Radar</a> shows this week’s patterns for each brand, and <a href="#/rules">Brand rules</a> switches on a third brand from configuration alone.</li>
    </ol>
  </section>`; };
actions.asPerson = el => { become(el.dataset.key); go('#/desk'); };

// ───────── brand support page ─────────
views.support = r => {
  const b = brandOf(r.a); if (!b) throw new ApiError('That brand is not set up in OneCare');
  const others = Object.values(S.meta.brands).filter(x => x.key !== b.key);
  return html`
    <div class="brandbar"><div><h1>${b.name} support</h1><p>${b.tagline}</p></div>
      <div class="via">Powered by OneCare. One case number,<br>whichever way you contact us.</div></div>
    <div class="choices">
      <a class="choice" href="#/new/${b.key}"><h3>Report a problem</h3><p class="muted">Just send a photo. We fill in the case from it and ask only for what the photo does not show.</p></a>
      <a class="choice" href="#/cases"><h3>Follow a case</h3><p class="muted">See where your case is, whose turn it is, and what we have promised to do by when.</p></a>
      <a class="choice" href="#/products"><h3>Register a product</h3><p class="muted">Optional. Registered details are filled in for you if you ever need help. You can claim without registering.</p></a>
    </div>
    <p class="muted small" style="margin-top:18px">Scanned the code on your product? <a href="#/new/${b.key}?product=${b.products[0].id}&via=qr">Start with the product already chosen</a>. Other brands on OneCare: ${others.map((x, i) => html`${i ? ', ' : ''}<a href="#/support/${x.key}">${x.name}</a>`)}.</p>`;
};

// ───────── SnapCase: photos in, one short question at a time ─────────
// The consumer only hands over photos. Everything that can be read from them is recorded on the
// Case Card, and OneCare asks for what is still missing one thing at a time, in a sentence.
// It is guided capture, not a chat: each question has one obvious answer and can be skipped.
let snap = null;
function newSnap(b, r) {
  const staff = r.q.get('staff') === '1';
  return { brand: b.key, staff, channel: staff ? 'phone' : r.q.get('via') === 'qr' ? 'qr' : 'web', productId: b.products.some(p => p.id === r.q.get('product')) ? r.q.get('product') : '', issue: '', model: '', serial: '', purchaseDate: '', retailer: '', description: '',
    name: staff ? '' : S.name, email: staff ? '' : S.email, photos: [], filled: {}, from: {}, skipped: {}, fromRegistration: false, registered: null, reading: 0, manual: staff, editing: '', listening: false, readNote: '' };
}
const snapRule = () => { const b = brandOf(snap.brand); return b.issues.find(i => i.key === snap.issue) || null; };
const hasPhoto = kind => snap.photos.some(p => p.kind === kind);
function snapHave(k) {
  return { model: !!snap.model.trim(), serial: !!snap.serial.trim(), purchase_date: !!snap.purchaseDate, proof_of_purchase: hasPhoto('proof_of_purchase'), fault_photo: hasPhoto('fault_photo') }[k];
}
const snapMissing = () => { const rule = snapRule(); return rule ? rule.needs.filter(k => !snapHave(k)) : []; };
const contactOk = () => !!(snap.name.trim() && /.+@.+\..+/.test(snap.email));

// What to ask next. Returns one question, or null when nothing more is needed.
function nextAsk() {
  const b = brandOf(snap.brand), rule = snapRule();
  if (snap.editing) return snap.editing;
  if (!snap.photos.length && !snap.manual) return 'photo';
  if (snap.reading) return 'reading';
  if (!snap.productId) return 'product';
  if (!snap.issue) return 'issue';
  for (const k of rule.needs) {
    if (snapHave(k) || snap.skipped[k]) continue;
    if (k === 'fault_photo' && snap.staff) continue;
    if (k === 'purchase_date' && rule.needs.includes('proof_of_purchase') && !hasPhoto('proof_of_purchase') && !snap.skipped.proof_of_purchase) return 'proof_of_purchase';
    return k;
  }
  if (!contactOk()) return 'contact';
  return null;
}

function snapCard() {
  const b = brandOf(snap.brand), rule = snapRule(), p = b.products.find(x => x.id === snap.productId);
  const needs = rule ? rule.needs : [], miss = needs.filter(k => !snapHave(k));
  const ready = !!(p && rule && contactOk());
  const src = k => snap.from[k] ? html` <span class="src">${snap.from[k]}</span>` : '';
  // Values that were just read (not typed) are marked so they can land on the card one after another.
  snap.shown = snap.shown || {}; let landed = 0;
  const row = (label, value, k, ask) => { const fresh = value && snap.from[k] && snap.shown[k] !== value; snap.shown[k] = value || ''; return html`<dt>${label}</dt><dd class="${fresh ? 'land' : ''}" style="--i:${fresh ? landed++ : 0}">${value ? html`${value}${src(k)} <button class="link small" data-action="snapChange" data-k="${ask}">Change</button>` : raw('<span class="muted">Not known yet</span>')}</dd>`; };
  const known = [p, rule, contactOk()].filter(Boolean).length + (needs.length - miss.length), total = 3 + (rule ? needs.length : 2);
  const pct = Math.round(known / total * 100), was = snap.lastPct === undefined ? 0 : snap.lastPct; snap.lastPct = pct;
  return html`<h3>Case Card <span class="tag ${!rule ? '' : miss.length ? 'warn' : 'ok'}">${!rule ? 'Being filled in' : miss.length ? `${needs.length - miss.length} of ${needs.length} ready` : needs.length ? 'Complete' : 'Ready'}</span></h3>
    <div class="meter" role="img" aria-label="Case ${pct}% complete"><i class="${pct === 100 ? 'full' : ''}" style="--from:${was}%;--to:${pct}%"></i></div>
    <dl><dt>Brand</dt><dd>${b.name}</dd>
      ${row('Product', p ? p.name : '', 'productId', 'product')}
      ${row('Model', snap.model, 'model', 'model')}
      ${snap.serial || needs.includes('serial') ? row('Serial', snap.serial, 'serial', 'serial') : ''}
      ${row('Problem', rule ? rule.label : '', 'issue', 'issue')}
      ${snap.purchaseDate || needs.includes('purchase_date') ? row('Bought', snap.purchaseDate ? fmtD(Date.parse(snap.purchaseDate)) + (snap.retailer ? ', ' + snap.retailer : '') : '', 'purchase_date', 'purchase_date') : ''}</dl>
    ${rule ? html`<div class="check"><b>What ${b.name} needs for this</b>${needs.length ? html`<ul>${needs.map(k => html`<li class="${snapHave(k) ? 'got' : 'miss'}">${snapHave(k) ? '✓' : '•'} ${D.EVIDENCE[k].label}</li>`)}</ul>` : html`<p class="muted" style="margin-top:4px">Nothing else.</p>`}</div>` : ''}
    <div class="foot2">${ready && miss.length ? html`<p class="small miss" style="margin-bottom:10px">Still missing: ${miss.map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ')}. You can submit now and add ${miss.length > 1 ? 'them' : 'it'} later, but the case waits until then.</p>` : ''}
      <button class="btn ${miss.length ? 'ghost' : 'go'}" style="width:100%" data-action="snapSubmit" ${ready && !snap.reading ? '' : raw('disabled')}>${miss.length ? 'Submit and add the rest later' : snap.staff ? 'Open the case' : 'Submit case'}</button></div>`;
}
const canCamera = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const photoButtons = (k, big) => html`<div class="row">${canCamera() ? html`<button class="btn ${big ? 'go' : 'sm'}" data-action="camOpen" data-k="${k}">Use the camera</button>` : ''}
  <label class="btn ghost ${big ? '' : 'sm'} filebtn">${big ? 'Upload photos' : 'Upload a photo'}<input type="file" accept="image/*" ${big ? raw('multiple') : ''} data-change="snapFile" data-k="${k}"></label></div>`;
const pills = (field, list, picked) => html`<div class="pills" role="radiogroup">${list.map(([v, label]) => html`<label class="pill"><input type="radio" name="${field}" value="${v}" data-change="snapPick" data-f="${field}" ${picked === v ? raw('checked') : ''}><span>${label}</span></label>`)}</div>`;

// One question, as short as it can be.
function askPanel(ask, b, p, rule) {
  const left = snapMissing().filter(k => !snap.skipped[k]).length;
  const lead = snap.editing ? 'Change it here' : left > 1 ? 'A few quick things' : 'One more thing';
  const skip = k => html`<button class="link" data-action="snapSkip" data-k="${k}">I will add it later</button>`;
  const done = html`<button class="btn sm" data-action="snapOk">${snap.editing ? 'Done' : 'Continue'}</button>`;
  switch (ask) {
    case 'photo': return html`<div class="ask first"><h2>Show us the product</h2><p>That is all we need to start. Add the receipt too if you have it to hand: we read everything from the photos and only ask for what they do not show.</p>
      ${photoButtons('auto', true)}<p class="small" style="margin-top:14px"><button class="link" data-action="snapManual">I cannot take a photo right now</button></p>${S.meta.ai.on && S.meta.ai.cloud ? html`<p class="small muted" style="margin-top:10px">Photos are read by AI.</p>` : ''}</div>`;
    case 'reading': { const ph = snap.photos.find(x => x.busy) || snap.photos[snap.photos.length - 1];
      return html`<div class="ask reading">${ph ? html`<div class="lens"><div class="lens-pic" data-id="${ph.id}"><img src="${ph.dataUrl}" alt="">${raw('<span class="beam"></span>' + hitsHtml(ph.lines))}</div></div>` : ''}<p class="lead">Reading your photo…</p><p class="muted small">This takes a few seconds.</p></div>`; }
    case 'product': return html`<div class="ask"><p class="lead">${lead}</p><h2>Which product is it?</h2>${snap.photos.length ? html`<p class="muted small">We could not tell from the photo.</p>` : ''}${pills('productId', b.products.map(x => [x.id, x.name]), snap.productId)}</div>`;
    case 'issue': return html`<div class="ask"><p class="lead">${lead}</p><h2>What is wrong with it?</h2>
      <div class="sayrow"><textarea id="desc" rows="2" data-input="snapField" data-f="description" placeholder="One sentence is enough: “It stopped charging and the light stays off.”" aria-label="What is wrong">${snap.description}</textarea>
        ${SR && !snap.staff ? html`<button class="btn ghost mic ${snap.listening ? 'on' : ''}" data-action="snapMic" title="Speak instead of typing. Your browser turns speech into text." aria-pressed="${snap.listening}">${snap.listening ? 'Listening…' : 'Say it'}</button>` : ''}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-action="snapSay">Continue</button><span class="small muted">or pick one:</span></div>
      ${pills('issue', b.issues.map(x => [x.key, x.label]), snap.issue)}</div>`;
    case 'model': return html`<div class="ask"><p class="lead">${lead}</p><h2>Which model is it?</h2><p class="muted small">It is printed on the product${p && p.typeHint ? ' (' + p.typeHint + ')' : ''}. A photo of the label is enough.</p>
      ${snap.staff ? '' : photoButtons('label')}<div class="row" style="margin-top:10px"><input type="text" data-input="snapField" data-f="model" value="${snap.model}" placeholder="${p && p.models[0] ? 'or type it, for example ' + p.models[0] : 'or type it'}" aria-label="Model" style="flex:1;min-width:180px">${done}</div>${snap.editing ? '' : skip('model')}</div>`;
    case 'serial': return html`<div class="ask"><p class="lead">${lead}</p><h2>What is the production code?</h2><p class="muted small">${b.name} needs it for this kind of problem. It is the short code printed next to the type number. A photo of the label is enough.</p>
      ${snap.staff ? '' : photoButtons('label')}<div class="row" style="margin-top:10px"><input type="text" data-input="snapField" data-f="serial" value="${snap.serial}" placeholder="or type it, for example PC4471203" aria-label="Production code" style="flex:1;min-width:180px">${done}</div>${snap.editing ? '' : skip('serial')}</div>`;
    case 'proof_of_purchase': return html`<div class="ask"><p class="lead">${lead}</p><h2>Show us your receipt</h2><p class="muted small">A receipt, invoice or order confirmation. We read the date and the shop from it, and ${b.name} asks for it only once.</p>
      ${snap.staff ? html`<label class="btn ghost sm filebtn">Attach a photo<input type="file" accept="image/*" data-change="snapFile" data-k="proof_of_purchase"></label>` : photoButtons('proof_of_purchase')}<p class="small" style="margin-top:12px">${skip('proof_of_purchase')}</p></div>`;
    case 'fault_photo': return html`<div class="ask"><p class="lead">${lead}</p><h2>Show us the fault</h2><p class="muted small">A photo or a few seconds of video of what is wrong.</p>${photoButtons('fault_photo')}<p class="small" style="margin-top:12px">${skip('fault_photo')}</p></div>`;
    case 'purchase_date': return html`<div class="ask"><p class="lead">${lead}</p><h2>When did you buy it?</h2>${hasPhoto('proof_of_purchase') ? html`<p class="muted small">We could not read the date on the receipt.</p>` : ''}
      <div class="row" style="margin-top:8px"><input type="date" data-input="snapField" data-f="purchaseDate" value="${snap.purchaseDate}" aria-label="Purchase date" style="width:190px"><input type="text" data-input="snapField" data-f="retailer" value="${snap.retailer}" placeholder="Where (optional)" aria-label="Retailer" style="flex:1;min-width:140px">${done}</div>${snap.editing ? '' : skip('purchase_date')}</div>`;
    case 'contact': return html`<div class="ask"><p class="lead">${lead}</p><h2>${snap.staff ? 'Who is calling?' : 'Where do we send updates?'}</h2>
      <div class="grid2" style="margin-top:8px"><input type="text" data-input="snapField" data-f="name" value="${snap.name}" placeholder="Name" autocomplete="name" aria-label="Name"><input type="email" data-input="snapField" data-f="email" value="${snap.email}" placeholder="Email" autocomplete="email" aria-label="Email"></div><div class="row" style="margin-top:10px">${done}</div></div>`;
    default: {
      const miss = snapMissing();
      return html`<div class="ask done"><h2>${miss.length ? 'That will do for now' : 'That is everything'}</h2><p>${miss.length ? `You can submit and add ${miss.map(k => D.EVIDENCE[k].label.toLowerCase()).join(' and ')} later from My Cases.` : 'We have what ' + b.name + ' needs, so you will not be asked for anything again.'} Updates go to <b>${snap.email}</b>. <button class="link" data-action="snapChange" data-k="contact">Change</button></p>
        <button class="btn go" style="margin-top:14px" data-action="snapSubmit">${miss.length ? 'Submit and add the rest later' : snap.staff ? 'Open the case' : 'Submit case'}</button></div>`;
    }
  }
}

views.new = async r => {
  const b = brandOf(r.a); if (!b) throw new ApiError('That brand is not set up in OneCare');
  if (!snap || snap.brand !== b.key || snap.staff !== (r.q.get('staff') === '1')) snap = newSnap(b, r);
  if (snap.registered === null) { snap.registered = snap.staff ? [] : (await api('GET', '/api/products', null, { email: snap.email })).filter(x => x.brand === b.key); }
  useRegistration();
  const p = b.products.find(x => x.id === snap.productId), rule = snapRule(), ask = nextAsk();
  const changed = snap.lastAsk !== ask; snap.lastAsk = ask;
  return html`
    <div class="brandbar"><div><h1>${snap.staff ? `New ${b.name} case from a phone call` : 'Just show us'}</h1><p>${snap.staff ? 'The same record as a web case. OneCare asks only for what this kind of problem needs.' : `${b.name} support. Send a photo and we fill in the case for you. We ask only for what the photo does not show.`}</p></div>
      ${snap.channel === 'qr' ? html`<div class="via">Opened from the code on the product</div>` : ''}</div>
    <div class="snap"><div>
      ${snap.photos.length ? html`<div class="photos">${snap.photos.map(ph => html`<figure class="${ph.busy ? 'busy' : ph.looking ? 'looking' : ''}"><div class="pic"><img src="${ph.dataUrl}" alt="${ph.kind === 'proof_of_purchase' ? 'Receipt' : 'Product photo'}">${ph.busy || ph.looking ? raw('<span class="scan"></span>') : ''}${ph.looking && !ph.busy ? raw('<span class="still" title="The model is still looking at this photo">Still looking</span>') : ''}</div><figcaption><b>${ph.busy ? 'Reading…' : ph.kind === 'proof_of_purchase' ? 'Receipt' : ph.label ? 'Label' : 'Product'}</b><button class="link small" data-action="snapUnfile" data-id="${ph.id}">Remove</button></figcaption></figure>`)}
          ${!['photo', 'reading', 'proof_of_purchase', 'model', 'serial', 'fault_photo'].includes(ask) && !snap.staff ? html`<div class="more">${photoButtons('auto')}</div>` : ''}</div>` : ''}
      ${snap.readNote && ask !== 'reading' ? html`<p class="read" id="readnote">${snap.readNote}</p>` : ''}
      <div class="${changed ? 'ask-in' : ''}">${askPanel(ask, b, p, rule)}</div>
    </div>
    <aside class="card" id="snapcard">${snapCard()}</aside></div>`;
};
// A registered product fills in what it knows, without being asked.
function useRegistration() {
  if (!snap.productId || snap.fromRegistration || !snap.registered) return;
  const x = snap.registered.find(q => q.productId === snap.productId); if (!x) return;
  const took = [];
  if (x.model && !snap.model) { snap.model = x.model; snap.from.model = 'from your registration'; took.push('model'); }
  if (x.serial && !snap.serial) { snap.serial = x.serial; snap.from.serial = 'from your registration'; }
  if (x.purchaseDate && !snap.purchaseDate) { snap.purchaseDate = x.purchaseDate; snap.retailer = snap.retailer || x.retailer || ''; snap.from.purchase_date = 'from your registration'; took.push('purchase date'); }
  snap.fromRegistration = true;
}
function snapTouch() { const c = $('#snapcard'); if (c) c.innerHTML = snapCard().s; }
actions.snapField = el => { snap[el.dataset.f] = el.value; const k = { model: 'model', serial: 'serial', purchaseDate: 'purchase_date', retailer: 'purchase_date' }[el.dataset.f]; if (k) { delete snap.filled[k]; snap.from[k] = ''; } if (el.dataset.f !== 'description') snapTouch(); };
actions.snapPick = el => { snap[el.dataset.f] = el.value; snap.from[el.dataset.f] = ''; if (el.dataset.f === 'productId') snap.fromRegistration = false; snap.editing = ''; render(); };
actions.snapOk = () => { snap.editing = ''; render(); };
actions.snapSkip = el => { snap.skipped[el.dataset.k] = true; if (el.dataset.k === 'proof_of_purchase' && !snap.purchaseDate) snap.skipped.purchase_date = false; render(); };
actions.snapChange = el => { snap.editing = el.dataset.k; snap.skipped[el.dataset.k] = false; render(); };
actions.snapManual = () => { snap.manual = true; render(); };
function applyFacts(facts, source) {
  const got = [], b = brandOf(snap.brand);
  const set = (f, v, k, label) => { if (v && !snap[f]) { snap[f] = v; snap.filled[k] = true; snap.from[k] = source; got.push(label); } };
  if (facts.productId && !snap.productId) { snap.productId = facts.productId; snap.from.productId = source; got.push((b.products.find(p => p.id === facts.productId) || {}).name); }
  set('model', facts.model, 'model', 'model ' + facts.model); set('serial', facts.serial, 'serial', 'production code ' + facts.serial);
  if (facts.issue && !snap.issue) { snap.issue = facts.issue; snap.from.issue = source; got.push('“' + (b.issues.find(i => i.key === facts.issue) || {}).label.toLowerCase() + '”'); }
  set('purchaseDate', facts.purchaseDate, 'purchase_date', facts.purchaseDate ? 'bought ' + fmtD(Date.parse(facts.purchaseDate)) : ''); if (facts.retailer && !snap.retailer) { snap.retailer = facts.retailer; got.push('at ' + facts.retailer); }
  return got;
}
// The sentence the consumer gives: record it, and work out the kind of problem from it.
actions.snapSay = async () => {
  const text = snap.description.trim(); if (text.length < 4) return toast('Tell us in a few words, or pick one below', true);
  const mine = snap; snap.reading++; render();
  const r = await api('POST', '/api/ai/intake', { brand: snap.brand, text }).catch(() => null);
  if (snap !== mine) return;
  snap.reading--;
  if (r && r.facts) applyFacts(r.facts, 'from what you said');
  if (!snap.issue) toast('Thanks. Pick the closest one below so it reaches the right team.');
  snap.editing = snap.issue ? '' : 'issue';
  render();
};
actions.snapMic = () => {
  if (!SR) return;
  if (snap.listening && snap.rec) { snap.rec.stop(); return; }
  const rec = new SR(), mine = snap; rec.lang = 'en-GB'; rec.interimResults = false; rec.maxAlternatives = 1;
  rec.onresult = e => { if (snap !== mine) return; const said = e.results[0][0].transcript.trim(); snap.description = (snap.description ? snap.description.replace(/\s*$/, ' ') : '') + said.charAt(0).toUpperCase() + said.slice(1) + '.'; };
  rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('The microphone is not available. Type it instead.', true); };
  rec.onend = () => { if (snap !== mine) return; snap.listening = false; snap.rec = null; if (snap.description.trim()) actions.snapSay(); else render(); };
  snap.rec = rec; snap.listening = true; render();
  try { rec.start(); } catch { snap.listening = false; snap.rec = null; render(); }
};
async function shrink(file) {
  const url = await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = bad; fr.readAsDataURL(file); });
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
  const k = Math.min(1, 1100 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

// Reading a photo: a model when one is answering (the cloud reader on the public site, a local model behind the
// Node server), and always text recognition in this browser.
let ocrWorker = null, ocrFailed = false;
// Text recognition in this browser: the text, and where each line of it sits (as percentages of the photo).
async function readPhoto(dataUrl) {
  if (ocrFailed) return { text: '', lines: [] };
  try {
    if (!window.Tesseract) await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'vendor/tesseract/tesseract.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    if (!ocrWorker) ocrWorker = await Tesseract.createWorker('eng', 1, { workerPath: new URL('vendor/tesseract/worker.min.js', location.href).href, corePath: new URL('vendor/tesseract/', location.href).href, langPath: new URL('vendor/tesseract/', location.href).href, gzip: true });
    const size = new Promise(ok => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok(null); i.src = dataUrl; });
    const out = await Promise.race([ocrWorker.recognize(dataUrl, {}, { blocks: true }), new Promise((_, bad) => setTimeout(() => bad(new Error('slow')), 45000))]);
    const dim = await size, found = (out.data.blocks || []).flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || []));
    const lines = !dim ? [] : found.filter(l => l.confidence > 55 && l.text.trim().length > 2 && l.bbox).slice(0, 9)
      .map(l => ({ x: +(l.bbox.x0 / dim.w * 100).toFixed(2), y: +(l.bbox.y0 / dim.h * 100).toFixed(2), w: +((l.bbox.x1 - l.bbox.x0) / dim.w * 100).toFixed(2), h: +((l.bbox.y1 - l.bbox.y0) / dim.h * 100).toFixed(2) }))
      .filter(l => l.w > 2 && l.w < 96 && l.h > .8 && l.h < 30);
    return { text: (out.data.text || '').replace(/[ \t]+/g, ' ').trim(), lines };
  } catch (e) { ocrFailed = true; return { text: '', lines: [] }; }
}
const readText = async dataUrl => (await readPhoto(dataUrl)).text;
const hitsHtml = lines => (lines || []).map((l, i) => `<i class="hit" style="left:${l.x - .8}%;top:${l.y - .8}%;width:${l.w + 1.6}%;height:${l.h + 1.6}%;--i:${i}"></i>`).join('');
async function resize(dataUrl, max) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = dataUrl; });
  const k = Math.min(1, max / Math.max(img.width, img.height)); if (k === 1) return dataUrl;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
// Two readers work on every photo. Text recognition in the browser answers in a few seconds and reads
// labels and receipts; the model can also tell what the product is by sight and reads harder text. Whatever each finds goes onto the card as soon as it is found.
async function readByText(dataUrl) {
  const { text, lines } = await readPhoto(dataUrl);
  window.OC.lastText = text; // kept for checking what the text reader saw
  if (!text) return null;
  // The rules run here in the browser, so this answer does not wait on the server or the model.
  const facts = D.extractFacts(text, brandOf(snap.brand));
  const receipt = /(total|subtotal|vat|visa|mastercard|receipt|invoice|order (no|number|confirmation)|proof of purchase)/i.test(text) && /£|gbp|\d{1,2}[\/.]\d{1,2}[\/.]20\d{2}/i.test(text);
  return { facts, lines, note: '', via: 'text', kind: receipt ? 'proof_of_purchase' : '' };
}
async function readByModel(dataUrl, hint) {
  // The local model slows down sharply on large images; a hosted model reads small print better at full size.
  const small = S.meta.ai.cloud ? dataUrl : await resize(dataUrl, 768).catch(() => dataUrl);
  const r = await api('POST', '/api/ai/intake', { brand: snap.brand, image: small, kind: D.EVIDENCE[hint] ? hint : '' }).catch(() => null);
  return r && r.source === 'ai' ? { facts: r.facts || {}, note: r.note || '', kind: r.kind, via: 'ai' } : null;
}
function recordRead(ph, hint, r) {
  if (hint === 'auto' && r.kind === 'proof_of_purchase' && (ph.kind === 'proof_of_purchase' || !hasPhoto('proof_of_purchase'))) ph.kind = 'proof_of_purchase';
  if (r.kind === 'product_label') ph.label = true;
  const facts = { ...r.facts }; if (ph.kind === 'proof_of_purchase') delete facts.issue;
  if (r.note && ph.kind !== 'proof_of_purchase' && !snap.seen) snap.seen = r.note;
  const got = applyFacts(facts, 'read from your photo');
  ph.got = (ph.got || []).concat(got); if (r.note) ph.note = r.note;
  if (hint === 'proof_of_purchase' && r.via === 'ai' && r.kind && !['proof_of_purchase', 'other'].includes(r.kind)) ph.odd = true;
}
function noteFor() {
  const got = [...new Set(snap.photos.flatMap(p => p.got || []))], n = snap.photos.length;
  const looking = snap.photos.some(p => p.looking), odd = snap.photos.some(p => p.odd);
  const what = n > 1 ? 'your photos' : snap.photos[0] && snap.photos[0].kind === 'proof_of_purchase' ? 'your receipt' : 'your photo';
  if (got.length) return `From ${what} we recorded: ${got.join(', ')}.${odd ? ' One photo does not look like a receipt, so please check it.' : ''}${looking ? ' We are still looking for more.' : ' Check the card and change anything that is wrong.'}`;
  if (looking) return `Still looking at ${what}. You can carry on meanwhile.`;
  const seen = snap.photos.map(p => p.note).filter(Boolean)[0];
  if (seen) return `We can see ${seen.replace(/^(the |an? )?(image|photo|picture) (shows|is of) /i, '').replace(/\.$/, '')}, but could not read the details we need from it.`;
  return `We could not read anything we need from ${what}, so we will ask instead.`;
}
// A photo arrives: file it as a receipt or a product photo, read it, and record whatever it shows.
async function takePhoto(hint, file) {
  const mine = snap;
  const ph = { id: 'ph' + Math.random().toString(36).slice(2, 8), name: file.name, dataUrl: file.dataUrl, kind: hint === 'proof_of_purchase' ? 'proof_of_purchase' : 'fault_photo', label: hint === 'label', busy: true, looking: false };
  snap.photos.push(ph); snap.reading++; snap.editing = '';
  render();
  // A photo handed over in the first seconds can arrive before the cloud reader has answered; give it a moment.
  if (!S.meta.ai.on && S.meta.ai.cloud) await Promise.race([cloudCheck, new Promise(ok => setTimeout(ok, 5000))]);
  const useModel = S.meta.ai.on && S.meta.ai.vision;
  const gone = () => snap !== mine || !snap.photos.includes(ph);
  let released = false, holding = false;
  const t0 = performance.now();
  // The reading moment is given time to be seen: at least a beat, and a little longer once the text it found is marked.
  const release = () => {
    if (released || gone()) return;
    const now = performance.now(), hold = Math.max(1300 - (now - t0), ph.linesAt ? 850 - (now - ph.linesAt) : 0);
    if (hold > 20) { if (!holding) { holding = true; setTimeout(() => { holding = false; release(); }, hold); } return; }
    released = true; ph.busy = false; snap.reading--; useRegistration(); snap.readNote = noteFor(); render();
  };
  const mark = lines => { // show where the text was found, on the photo that is up now, without redrawing the page
    if (!lines || !lines.length || ph.lines) return;
    ph.lines = lines; ph.linesAt = performance.now();
    const el = document.querySelector(`.lens-pic[data-id="${ph.id}"]`); if (el) el.insertAdjacentHTML('beforeend', hitsHtml(lines));
  };
  const textJob = readByText(file.dataUrl).then(r => { if (gone()) return; if (r) { mark(r.lines); recordRead(ph, hint, r); } if (!useModel) release(); else if (released) { useRegistration(); snap.readNote = noteFor(); render(); } else if (ph.got && ph.got.length) { ph.looking = true; release(); } });
  if (!useModel) return textJob;
  // Do not make people wait on the model: after a few seconds carry on, and add what it finds when it answers.
  const patience = setTimeout(() => { if (!released && !gone()) { ph.looking = true; release(); } }, 14000);
  const modelJob = readByModel(file.dataUrl, hint).then(r => {
    clearTimeout(patience); if (gone()) return;
    if (r) recordRead(ph, hint, r);
    ph.looking = false;
    if (released) { useRegistration(); snap.readNote = noteFor(); render(); } else release();
  });
  return Promise.race([modelJob, new Promise(ok => setTimeout(ok, 14500))]).then(() => textJob);
}
actions.snapFile = async el => {
  const files = [...el.files].slice(0, 4), k = el.dataset.k; if (!files.length) return;
  for (const file of files) {
    let dataUrl = ''; try { dataUrl = await shrink(file); } catch { toast('That file is not an image we can read', true); continue; }
    await takePhoto(k, { name: file.name, dataUrl });
  }
};
actions.snapUnfile = el => { snap.photos = snap.photos.filter(p => p.id !== el.dataset.id); snap.readNote = snap.photos.length ? noteFor() : ''; render(); };

// The camera. On a laptop this is the front camera; on a phone the same code would ask for the rear one.
let camStream = null;
const onPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function stopCamera() { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } }
$('#dlg').addEventListener('close', stopCamera);
actions.camOpen = async el => {
  const k = el.dataset.k, d = $('#dlg');
  d.innerHTML = html`<div class="dlg-body"><h2>${k === 'proof_of_purchase' ? 'Hold up your receipt' : k === 'label' ? 'Hold up the label' : 'Hold up the product'}</h2>
      <p class="muted small" style="margin:6px 0 12px">${k === 'proof_of_purchase' ? 'Fill the frame with the receipt so the date and shop are readable.' : 'Show the label if you can: the model and type number are printed on it.'} ${onPhone() ? '' : 'The picture looks mirrored here; the photo we keep is the right way round.'}</p>
      <div class="cam ${onPhone() ? 'rear' : ''}"><video id="camv" autoplay playsinline muted></video><span class="finder"></span><p id="camerr" class="small miss" hidden></p></div></div>
    <div class="dlg-foot"><button class="btn ghost" data-action="closeDlg">Cancel</button><button class="btn go" id="camshot" data-action="camShot" data-k="${k}" disabled>Take the photo</button></div>`.s;
  d.showModal();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: onPhone() ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = $('#camv'); v.srcObject = camStream; await v.play().catch(() => {}); $('#camshot').disabled = false;
  } catch (e) {
    const err = $('#camerr'); if (err) { err.hidden = false; err.textContent = e && e.name === 'NotAllowedError' ? 'The browser was not allowed to use the camera. Allow it in the address bar, or cancel and upload a photo instead.' : 'No camera could be started on this device. Cancel and upload a photo instead.'; }
  }
};
actions.closeDlg = () => $('#dlg').close();
actions.camShot = el => {
  const v = $('#camv'); if (!v || !v.videoWidth) return;
  const k = Math.min(1, 1100 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.85), hint = el.dataset.k, cam = v.closest('.cam');
  v.pause(); if (cam) cam.classList.add('flash');
  setTimeout(() => { $('#dlg').close(); takePhoto(hint, { name: 'camera-photo.jpg', dataUrl }); }, 220);
};
actions.snapSubmit = async el => {
  el.disabled = true;
  const body = { brand: snap.brand, productId: snap.productId, issue: snap.issue, model: snap.model, serial: snap.serial, purchaseDate: snap.purchaseDate, retailer: snap.retailer, description: snap.description.trim() || (snap.seen ? 'Seen in the photo: ' + snap.seen : ''), channel: snap.channel,
    consumer: { name: snap.name, email: snap.email }, files: snap.photos.map(p => ({ kind: p.kind, name: p.name, dataUrl: p.dataUrl })), aiAssisted: Object.keys(snap.filled).length > 0, fromRegistration: snap.fromRegistration };
  const r = await attempt(() => api('POST', '/api/cases', body));
  if (!r) { el.disabled = false; return; }
  const staff = snap.staff;
  if (!staff) { S.email = snap.email.trim().toLowerCase(); S.name = snap.name.trim(); persist(); }
  snap = null;
  toast(`Case ${r.id} opened`);
  go(staff ? `#/desk/${r.id}` : `#/case/${r.id}`);
};

// ───────── My Cases ─────────
views.cases = async () => {
  const list = await api('GET', '/api/cases');
  return html`
    <div class="case-head"><div><h1>My Cases</h1><p class="muted" style="margin-top:8px">Every case opened with <b>${S.email}</b>, on any brand and any channel.</p></div>
      <form class="row" data-submit="useEmail"><input type="email" name="email" value="${S.email}" aria-label="Email address" style="width:260px"><button class="btn ghost sm">Use this email</button></form></div>
    ${list.length ? html`<div class="list">${list.map(c => html`<a href="#/case/${c.id}"><span class="mono"><b>${c.id}</b></span>
        <span><b>${c.brandName} ${c.product}</b><br><span class="muted small">${c.issue}, opened ${fmtDay(c.createdAt)}</span></span>
        <span class="row">${c.status === 'closed' ? html`<span class="tag">Closed</span>` : c.turn === 'consumer' ? html`<span class="tag warn">Your turn</span>` : c.turn === 'carrier' ? html`<span class="tag info">On its way</span>` : html`<span class="tag dark">With ${c.owner.team === 'frontline' ? 'an advisor' : 'the ' + D.TEAMS[c.owner.team].label.toLowerCase()}</span>`}${c.overdue ? html`<span class="tag bad">Running late</span>` : ''}</span></a>`)}</div>`
      : html`<div class="empty"><b>No cases for this email yet</b>Report a problem and it will appear here with its case number.</div>`}
    <div class="row" style="margin-top:22px"><a class="btn" href="#/support/oral-b">Report a problem</a><a class="btn ghost" href="#/products">My Products</a></div>`;
};
actions.useEmail = f => { const v = f.email.value.trim().toLowerCase(); if (!/.+@.+\..+/.test(v)) return toast('Enter an email address', true); S.email = v; S.name = v === 'sarah.jenkins@example.com' ? 'Sarah Jenkins' : S.name; persist(); render(); };

const WHO = { pg: 'Our turn', consumer: 'Your turn', carrier: 'On its way to you', done: 'Closed' };
const introduced = new Set();
views.case = async r => {
  const c = await api('GET', `/api/cases/${r.a}`);
  S.now = c.now;
  const intro = !introduced.has(c.id); introduced.add(c.id);
  const order = ['received', 'under_review', 'decision_made', 'replacement_arranged', 'closed'];
  const at = order.indexOf(c.status === 'more_info' ? (c.timeline.some(e => e.kind === 'reply') ? 'under_review' : 'received') : c.status);
  const n = c.next, open = c.promises.filter(p => !p.doneAt), b = brandOf(c.brand);
  const stepLabel = k => k === 'replacement_arranged' && c.decision && c.decision.type !== 'replacement' ? (c.decision.type === 'refund' ? 'Refund processed' : 'Repair arranged') : D.STATUS[k];
  return html`
    <p class="small"><a href="#/cases">My Cases</a></p>
    <div class="case-head ${intro ? 'intro' : ''}" style="margin-top:6px"><div><h1><span class="mono caseid" style="font-size:.62em;font-weight:600;letter-spacing:0">${[...c.id].map((ch, i) => html`<i style="--i:${i}">${ch}</i>`)}</span><br>${c.brandName} ${c.productName}</h1><p class="muted" style="margin-top:8px">${c.issueLabel}${c.model ? ', ' + c.model : ''}. Opened ${fmtDT(c.createdAt)}.</p></div></div>
    <div class="turn ${n.who}"><div><div class="label">${c.status === 'more_info' ? 'More information needed' : D.STATUS[c.status]}</div>
        <h2>${WHO[n.who]}${n.who === 'pg' ? html`: ${c.ownerTeam.toLowerCase()}${c.ownerFirstName ? ', ' + c.ownerFirstName : ''}` : ''}</h2><p>${n.text}</p></div>
      ${n.dueAt ? html`<div class="due ${n.late ? 'late' : ''}">${n.late ? 'Was due' : 'Due'}<b>${fmtDT(n.dueAt)}</b>${n.late ? 'We are late. You do not need to chase.' : rel(n.dueAt)}</div>` : ''}</div>
    <div class="stepper ${intro ? 'intro' : ''}" aria-label="Progress">${order.map((k, i) => html`<div class="${i < at ? 'past' : i === at ? 'now' : ''}">${stepLabel(k)}</div>`)}</div>
    <div class="cols"><div>
      ${c.status === 'more_info' ? html`<section class="panel" style="border-color:#ecd6a8;background:var(--amber-tint)"><h3>What we need from you</h3><p class="small muted" style="margin-top:4px">Only what is listed. Nothing you have already sent is needed again.</p>
        <form data-submit="addEvidence" data-id="${c.id}">${c.missing.map(k => { const e = D.EVIDENCE[k]; return html`<div class="field"><label>${e.label}</label>${e.how === 'file' ? html`<input type="file" accept="image/*" name="${k}">` : e.how === 'date' ? html`<input type="date" name="purchaseDate">` : html`<input type="text" name="${k}">`}<p class="hint">${e.help}</p></div>`; })}
          <button class="btn go" style="margin-top:16px">Send</button></form></section>` : ''}
      ${c.status === 'replacement_arranged' ? html`<section class="panel wash"><h3>Has it arrived?</h3><p class="muted small" style="margin:4px 0 12px">Tell us and we will close the case. If something is wrong with it, send a message instead and the same case continues.</p><button class="btn go" data-action="confirmArrival" data-id="${c.id}">Yes, it has arrived</button></section>` : ''}
      ${c.status === 'closed' && !c.rating ? html`<section class="panel wash"><h3>How did we do?</h3>
        <form data-submit="rate" data-id="${c.id}"><div class="stars" style="margin-top:10px" role="group" aria-label="Rating from 1 to 5">${[1, 2, 3, 4, 5].map(i => html`<button type="button" data-action="star" data-v="${i}" aria-pressed="false">${i}</button>`)}</div><input type="hidden" name="rating">
          <div class="field"><label for="intent">After this, are you more or less likely to buy ${b ? b.name : 'the brand'} again?</label><select class="f" id="intent" name="intent"><option value="">Prefer not to say</option><option value="more">More likely</option><option value="same">No change</option><option value="less">Less likely</option></select></div>
          <div class="field"><label for="cm">Anything you want us to know?</label><textarea id="cm" name="comment"></textarea></div><button class="btn" style="margin-top:14px">Send rating</button></form></section>` : ''}
      ${c.rating ? html`<section class="panel wash"><h3>Your rating: ${c.rating} out of 5</h3>${c.comment ? html`<p style="margin-top:6px">“${c.comment}”</p>` : ''}<p class="muted small" style="margin-top:6px">Thank you. Comments are read every week.</p></section>` : ''}
      <section class="sect"><h3>What has happened</h3>
        <ul class="tl">${c.timeline.slice().reverse().map(e => html`<li class="${e.kind}"><time>${fmtDT(e.at)}</time><div><div class="from">${e.kind === 'contact' ? 'You' : e.kind === 'reply' ? `${e.by || 'Advisor'}, ${b.name} support` : e.kind === 'decision' ? 'Decision' : 'OneCare'}${e.channel && e.kind === 'contact' ? html`<span class="tag">${D.CHANNELS[e.channel]}</span>` : ''}</div><div class="text">${e.text}</div></div></li>`)}</ul></section>
    </div><div>
      <section><h3>What we have promised</h3>
        ${c.promises.length ? c.promises.map(p => html`<div class="promise ${p.doneAt ? 'done' : p.late ? 'late' : ''}"><span class="box"></span><span class="what">${p.text}${p.moved ? html`<br><span class="small muted">Date changed ${p.moved > 1 ? p.moved + ' times' : 'once'}; reasons are in the history.</span>` : ''}</span><span class="when">${p.doneAt ? 'Done ' + fmtDay(p.doneAt) : p.late ? 'Late. Due ' + fmtDay(p.dueAt) : 'By ' + fmtDT(p.dueAt)}</span></div>`) : html`<p class="muted small" style="margin-top:6px">${open.length ? '' : 'No promises yet. When an advisor commits to something with a date, it appears here and is tracked until it is done.'}</p>`}</section>
      <section class="sect"><h3>What is on your case</h3><div class="known"><dl>
        <dt>Product</dt><dd>${c.productName}</dd>${c.model ? html`<dt>Model</dt><dd>${c.model}</dd>` : ''}${c.serial ? html`<dt>Serial</dt><dd>${c.serial}</dd>` : ''}${c.purchaseDate ? html`<dt>Bought</dt><dd>${fmtD(Date.parse(c.purchaseDate))}</dd>` : ''}
        ${Object.entries(c.evidence).map(([k, e]) => html`<dt>${D.EVIDENCE[k].label}</dt><dd>${e.status === 'provided' ? html`<span class="got">✓ We have it</span>` : html`<span class="miss">Still needed</span>`}</dd>`)}</dl></div></section>
      ${c.status !== 'closed' || true ? html`<section class="sect"><h3>${c.status === 'closed' ? 'Problem back? Reopen this case' : 'Send a message'}</h3><p class="small muted">${c.status === 'closed' ? 'It goes back to the advisor who handled it, with the full history.' : 'It is added to this case. You will not be asked to explain from the start.'}</p>
        <form data-submit="sendMessage" data-id="${c.id}"><textarea name="text" style="margin-top:8px" aria-label="Message"></textarea><button class="btn ghost sm" style="margin-top:8px">${c.status === 'closed' ? 'Reopen with this message' : 'Send'}</button></form></section>` : ''}
    </div></div>`;
};
actions.addEvidence = async f => {
  const body = { files: [] };
  for (const el of $$('input', f)) {
    if (el.type === 'file') { if (el.files[0]) { try { body.files.push({ kind: el.name, name: el.files[0].name, dataUrl: await shrink(el.files[0]) }); } catch { return toast('That file is not an image we can read', true); } } }
    else if (el.value.trim()) body[el.name] = el.value.trim();
  }
  if (await attempt(() => api('POST', `/api/cases/${f.dataset.id}/evidence`, body), 'Added to your case')) render();
};
actions.sendMessage = async f => { if (await attempt(() => api('POST', `/api/cases/${f.dataset.id}/contact`, { text: f.text.value, channel: 'web' }), 'Message added to your case')) render(); };
actions.confirmArrival = async el => { if (await attempt(() => api('POST', `/api/cases/${el.dataset.id}/confirm`), 'Thanks. Case closed')) render(); };
actions.star = el => { $$('.stars button').forEach(b => b.setAttribute('aria-pressed', String(b === el))); el.closest('form').rating.value = el.dataset.v; S.dirty = true; };
actions.rate = async f => { if (!f.rating.value) return toast('Choose a rating from 1 to 5', true); if (await attempt(() => api('POST', `/api/cases/${f.dataset.id}/rate`, { rating: +f.rating.value, intent: f.intent.value, comment: f.comment.value }), 'Thank you')) render(); };

// ───────── My Products ─────────
views.products = async () => {
  const list = await api('GET', '/api/products', null, { email: S.email });
  const brands = Object.values(S.meta.brands);
  return html`
    <p class="small"><a href="#/cases">My Cases</a></p>
    <h1 style="margin-top:6px">My Products</h1>
    <p class="muted" style="margin-top:8px;max-width:44em">Registering is optional. If you do, the model and purchase date are filled in when you report a problem. You can always make a claim without registering.</p>
    <div class="cols"><div>
      ${list.length ? html`<div class="known">${list.map(x => { const b = brandOf(x.brand) || {}; const p = (b.products || []).find(q => q.id === x.productId) || {}; return html`<dl><dt>${b.name}</dt><dd><b>${p.name}</b>${x.model ? ', ' + x.model : ''}${x.purchaseDate ? html`<br><span class="muted small">Bought ${fmtD(Date.parse(x.purchaseDate))}${x.retailer ? ' at ' + x.retailer : ''}</span>` : ''}<br><a class="small" href="#/new/${x.brand}">Report a problem with this</a></dd></dl>`; })}</div>` : html`<div class="empty"><b>Nothing registered</b>That is fine. Registration only saves typing later.</div>`}
    </div><div><section class="panel"><h3>Register a product</h3>
      <form data-submit="register">
        <div class="field"><label for="rb">Brand</label><select class="f" id="rb" name="brand" data-change="regBrand">${brands.map(b => html`<option value="${b.key}">${b.name}</option>`)}</select></div>
        <div class="field"><label for="rp">Product</label><select class="f" id="rp" name="productId">${brands[0].products.map(p => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
        <div class="grid2"><div class="field"><label for="rm">Model</label><input id="rm" type="text" name="model"></div><div class="field"><label for="rd">Purchase date</label><input id="rd" type="date" name="purchaseDate"></div></div>
        <div class="field"><label for="rr">Where you bought it</label><input id="rr" type="text" name="retailer"></div>
        <div class="checks" style="margin-top:14px"><label><input type="checkbox" name="consent"> Store these details so my cases can be filled in faster. I can ask for them to be deleted.</label></div>
        <button class="btn" style="margin-top:14px">Register</button></form></section></div></div>`;
};
actions.regBrand = el => { const b = brandOf(el.value); $('#rp').innerHTML = b.products.map(p => html`<option value="${p.id}">${p.name}</option>`.s).join(''); };
actions.register = async f => { if (await attempt(() => api('POST', '/api/products', { brand: f.brand.value, productId: f.productId.value, model: f.model.value, purchaseDate: f.purchaseDate.value, retailer: f.retailer.value, email: S.email, name: S.name, consent: f.consent.checked }), 'Registered')) render(); };

// ───────── tooltip for charts ─────────
const tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
const place = (x, y) => { const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x + 12)) + 'px'; tip.style.top = Math.max(8, y - r.height - 10) + 'px'; };
document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if (!t) return tip.classList.remove('on'); tip.textContent = t.dataset.tip; tip.classList.add('on'); place(e.clientX, e.clientY); });
document.addEventListener('mousemove', e => { if (tip.classList.contains('on')) place(e.clientX, e.clientY); });

document.addEventListener('pointermove', e => { // the panels on the home page pick up light under the pointer
  const d = e.target.closest && e.target.closest('.door'); if (!d) return;
  const r = d.getBoundingClientRect(); d.style.setProperty('--mx', (e.clientX - r.left) + 'px'); d.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, { passive: true });

window.OC = { readText, aiName, D, S, $, $$, html, raw, out, esc, api, attempt, toast, go, render, views, actions, me, become, brandOf, fmtDT, fmtD, fmtDay, rel, dur, pctText, toLocalInput, ApiError, PEOPLE };
window.addEventListener('DOMContentLoaded', async () => { await connect(); render(); });
})();
