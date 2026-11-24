// OneCare interface, staff side: the case desk (Case Card, handover, PromiseTrack, decisions),
// Signal Radar and the brand rules page.
(() => {
'use strict';
const { D, S, $, $$, html, raw, api, attempt, toast, go, render, views, actions, me, brandOf, aiName, fmtDT, fmtD, fmtDay, rel, dur, pctText, toLocalInput } = OC;
const staffName = id => (D.staff(id) || {}).name || id;

// ───────── case desk ─────────
const desk = { scope: 'mine', brand: '', q: '', pane: '', draft: '', suggest: null, summary: null, moving: '', caseId: '' };
const TURN = { pg: 'P&G', consumer: 'Consumer', carrier: 'Courier', done: 'Closed' };

function queueItem(c, current) {
  return html`<a class="qi ${c.overdue ? 'over' : ''}" href="#/desk/${c.id}" aria-current="${c.id === current ? 'true' : null}">
    <div class="top"><span>${c.consumer}</span><span class="mono small">${c.id}</span></div>
    <div class="sub">${c.product}: ${c.issue}</div>
    <div class="tags">${c.overdue ? html`<span class="tag bad">${c.overdue} overdue</span>` : ''}${c.status === 'closed' ? html`<span class="tag">Closed${c.rating ? ', rated ' + c.rating : ''}</span>` : c.turn === 'consumer' ? html`<span class="tag warn">Waiting on consumer</span>` : c.turn === 'carrier' ? html`<span class="tag info">With courier</span>` : html`<span class="tag">${D.STATUS[c.status]}</span>`}
      ${!c.overdue && c.nextDue && c.status !== 'closed' ? html`<span class="tag">Due ${rel(c.nextDue)}</span>` : ''}${desk.scope !== 'mine' && c.status !== 'closed' ? html`<span class="tag">${c.ownerName.split(' ')[0]}</span>` : ''}</div></a>`;
}

function timeline(c) {
  const label = e => e.kind === 'contact' ? html`${c.consumer.name}<span class="tag">${D.CHANNELS[e.channel] || e.channel}</span>${e.chase ? html`<span class="tag bad">Chasing an overdue promise</span>` : ''}${e.afterHandover ? html`<span class="tag warn">After a handover, before any update</span>` : ''}${e.resubmission ? html`<span class="tag warn">Evidence added later</span>` : ''}`
    : e.kind === 'reply' ? html`${e.by} to consumer` : e.kind === 'note' ? html`${e.by}<span class="tag">Internal note</span>` : e.kind === 'handover' ? html`Handover<span class="tag">Internal</span>` : e.kind === 'decision' ? html`Decision by ${e.by}` : e.kind === 'engine' ? html`Follow-up engine<span class="tag">Internal</span>` : html`Sent to consumer automatically`;
  return html`<ul class="tl">${c.timeline.slice().reverse().map(e => html`<li class="${e.kind} ${e.internal ? 'internal' : ''}"><time>${fmtDT(e.at)}</time><div><div class="from">${label(e)}</div><div class="text">${e.text}</div>
    ${e.summary ? html`<div class="sum"><b>Handover summary</b> <span class="ai-mark">${e.summarySource === 'ai' ? 'Drafted by ' + aiName() + ', confirmed by ' + e.by : 'From the case record, confirmed by ' + e.by}</span><br>${e.summary}</div>` : ''}</div></li>`)}</ul>`;
}

function promiseRow(c, p) {
  const late = !p.doneAt && p.dueAt < c.now, canAct = !p.doneAt && c.status !== 'closed';
  return html`<div class="promise ${p.doneAt ? 'done' : late ? 'late' : ''}"><span class="box"></span>
    <span class="what">${p.text}<br><span class="small muted">${staffName(p.owner)}${p.type === 'first_response' ? ', service target' : p.source === 'ai' ? ', found by ' + aiName() + ' and confirmed' : p.source === 'rule' ? ', found by rules and confirmed' : ', entered by hand'}${p.escalatedAt && !p.doneAt ? html` <span class="tag bad">Escalated</span>` : ''}${(p.moves || []).length ? html` <span class="tag">Moved ${p.moves.length}×</span>` : ''}${p.cancelled ? html` <span class="tag">Cancelled at close</span>` : ''}</span>
      ${desk.moving === p.id ? html`<form class="row" data-submit="movePromise" data-pid="${p.id}" style="margin-top:8px"><input type="datetime-local" name="due" value="${toLocalInput(Math.max(c.now, p.dueAt) + D.DAY)}" style="width:210px" aria-label="New deadline"><input type="text" name="reason" placeholder="Reason the consumer will see" style="flex:1;min-width:180px" aria-label="Reason"><button class="btn sm">Save</button></form>` : ''}</span>
    <span class="when">${p.doneAt ? (p.doneAt > p.dueAt ? 'Done late, ' : 'Done ') + fmtDay(p.doneAt) : (late ? 'Overdue ' : 'Due ') + rel(p.dueAt, c.now)}${canAct && p.type !== 'first_response' ? html`<br><button class="link small" data-action="promiseDone" data-pid="${p.id}">Mark done</button> <button class="link small" data-action="promiseMoveOpen" data-pid="${p.id}">Move</button>` : ''}</span></div>`;
}

function actionPane(c, b) {
  const role = me().role, who = me().who, approver = b.approvers.includes(who);
  const approved = c.decision && ['replacement', 'repair', 'refund'].includes(c.decision.type);
  const openPromises = c.promises.filter(p => !p.doneAt && p.type !== 'first_response');
  const btn = (k, label, show = true) => show ? html`<button class="btn sm ${desk.pane === k ? '' : 'ghost'}" data-action="pane" data-k="${k}">${label}</button>` : '';
  if (c.status === 'closed') return html`<p class="muted small" style="margin-top:8px">Closed ${fmtDT(c.closedAt)}: ${c.resolution}. If the consumer replies, it reopens with ${staffName(c.lastFrontline)}.</p>
    <div class="acts">${btn('contact', 'Log a contact from the consumer')}${btn('note', 'Internal note')}</div>${paneBody(c, b)}`;
  return html`<div class="acts">${btn('reply', 'Reply')}${btn('request', 'Ask for information')}${btn('handover', 'Hand over')}${btn('promise', 'Add a promise')}${btn('contact', 'Log a contact')}${btn('note', 'Note')}
      ${btn('decide', 'Decide the claim', c.claim && !approved)}${btn('dispatch', c.decision && c.decision.type === 'refund' ? 'Record the refund' : c.decision && c.decision.type === 'repair' ? 'Record the label sent' : 'Record dispatch', approved && c.status === 'decision_made')}${btn('close', 'Close')}</div>
    ${desk.suggest ? html`<div class="suggest"><b>${desk.suggest.items.length ? 'That reply contains a promise' : 'No dated promise found in that reply'}</b> <span class="ai-mark">${desk.suggest.source === 'ai' ? 'Read by AI' : 'Read by rules'}</span>
        <p class="small muted" style="margin-top:2px">${desk.suggest.items.length ? 'Nothing is tracked until you confirm it. Correct the wording or the deadline first if needed.' : 'If you did commit to something, add it by hand so it is tracked.'}</p>
        ${desk.suggest.items.map((p, i) => html`<form class="srow" data-submit="confirmPromise" data-i="${i}"><input type="text" name="text" value="${p.text}" aria-label="Promise"><div class="row" style="gap:8px"><input type="datetime-local" name="due" value="${p.dueAt ? toLocalInput(p.dueAt) : ''}" aria-label="Deadline" style="width:215px">${p.dueAt ? '' : html`<span class="small muted">No deadline was stated. Set one to track it.</span>`}<button class="btn sm go">Confirm as task</button><button type="button" class="btn sm ghost" data-action="dismissPromise" data-i="${i}">Not a promise</button></div></form>`)}
        ${desk.suggest.items.length ? '' : html`<button class="link small" data-action="dismissPromise" data-i="-1">Dismiss</button>`}</div>` : ''}
    ${paneBody(c, b, { role, approver, approved, openPromises })}`;
}
function paneBody(c, b, x = {}) {
  const first = c.consumer.name.split(' ')[0];
  switch (desk.pane) {
    case 'reply': return html`<form class="act-pane" data-submit="sendReply"><h3>Reply to ${first}</h3><textarea name="text" style="margin-top:10px" aria-label="Reply">${desk.draft}</textarea>
      <p class="small muted" style="margin-top:6px">If the reply commits to something by a time, OneCare will find it and ask you to confirm it as a tracked task.</p><button class="btn sm" style="margin-top:10px">Send reply</button></form>`;
    case 'request': return html`<form class="act-pane" data-submit="requestInfo"><h3>Ask for information</h3><p class="small muted">Anything already on the case cannot be asked for again.</p>
      <div class="checks">${Object.entries(D.EVIDENCE).map(([k, e]) => { const have = c.evidence[k] && c.evidence[k].status === 'provided'; return html`<label class="${have ? 'dis' : ''}"><input type="checkbox" name="item" value="${k}" ${have ? raw('disabled') : ''} ${c.missing.includes(k) ? raw('checked') : ''}>${e.label}${have ? ' (already on the case)' : ''}</label>`; })}</div>
      <div class="field"><label for="why">Why it is needed</label><input id="why" type="text" name="why" placeholder="One sentence the consumer will see"></div><button class="btn sm" style="margin-top:12px">Send request</button></form>`;
    case 'handover': {
      const teams = Object.entries(D.TEAMS).filter(([k]) => k !== c.owner.team);
      const route = c.route && c.route !== c.owner.team ? c.route : teams[0][0];
      return html`<form class="act-pane" data-submit="handover"><h3>Hand over</h3><p class="small muted">The next owner is named, and the case does not move without a reason and a next action.</p>
        <div class="grid2"><div class="field"><label for="hto">To</label><select class="f" id="hto" name="to">${teams.map(([k, t]) => html`<option value="${k}" ${k === (desk.summary ? desk.summary.to : route) ? raw('selected') : ''}>${t.label}</option>`)}</select></div>
          <div class="field"><label for="hre">Reason</label><input id="hre" type="text" name="reason" value="${desk.summary ? desk.summary.reason : c.claim && !c.missing.length ? 'Warranty claim with complete evidence' : ''}"></div></div>
        <div class="field"><label for="htd">What is still to do</label><input id="htd" type="text" name="todo" value="${desk.summary ? desk.summary.todo : c.claim ? (c.route === 'technical' && c.owner.team === 'frontline' ? 'Assess the fault from the photo and description' : 'Check cover and decide the claim') : ''}"></div>
        ${desk.summary ? html`<div class="field"><label for="hsm">Handover summary <span class="ai-mark">${desk.summary.source === 'ai' ? 'Drafted by ' + aiName() + '. Check it before you confirm.' : 'Built from the case record. Check it before you confirm.'}</span></label><textarea id="hsm" name="summary" style="min-height:120px">${desk.summary.text}</textarea></div>
          <div class="row" style="margin-top:12px"><button class="btn sm go">Confirm handover</button><button type="button" class="btn sm ghost" data-action="draftSummary">Draft again</button></div>`
          : html`<button type="button" class="btn sm" style="margin-top:12px" data-action="draftSummary">Draft the summary</button>`}</form>`;
    }
    case 'promise': return html`<form class="act-pane" data-submit="addPromise"><h3>Add a promise</h3><div class="grid2"><div class="field"><label for="pt">What was promised</label><input id="pt" type="text" name="text" placeholder="Call back with the engineer’s answer."></div><div class="field"><label for="pd">By when</label><input id="pd" type="datetime-local" name="due" value="${toLocalInput(c.now + 2 * D.DAY)}"></div></div><button class="btn sm" style="margin-top:12px">Track it</button></form>`;
    case 'contact': return html`<form class="act-pane" data-submit="logContact"><h3>Log a contact from ${first}</h3><p class="small muted">A call or email about this problem belongs on this case, not a new one.</p>
      <div class="field"><label for="lc">Channel</label><select class="f" id="lc" name="channel"><option value="phone">Phone</option><option value="email">Email</option></select></div><div class="field"><label for="lt">What they said</label><textarea id="lt" name="text"></textarea></div><button class="btn sm" style="margin-top:10px">Add to the case</button></form>`;
    case 'note': return html`<form class="act-pane" data-submit="addNote"><h3>Internal note</h3><p class="small muted">Staff only. The consumer never sees it.</p><textarea name="text" style="margin-top:8px" aria-label="Note"></textarea><button class="btn sm" style="margin-top:10px">Save note</button></form>`;
    case 'decide': {
      if (x.role !== 'warranty' || !x.approver) return html`<div class="act-pane"><h3>Decide the claim</h3><p style="margin-top:6px">Only an authorised ${b.name} approver can decide: <b>${b.approvers.map(staffName).join(', ')}</b>. ${c.owner.team === 'frontline' ? 'Hand the case over to the warranty team.' : 'Switch to that person at the top of the page to continue the demo.'}</p></div>`;
      const w = c.warranty;
      return html`<form class="act-pane" data-submit="decide"><h3>Decide the claim</h3>
        <p class="small" style="margin-top:4px">${c.missing.length ? html`<span class="miss">Evidence is missing (${c.missing.map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ')}), so the claim cannot be approved yet.</span>` : w ? (w.covered ? html`<span class="got">Inside the ${b.warrantyMonths}-month warranty, which runs to ${fmtD(w.until)}.</span>` : html`<span class="miss">Outside the warranty, which ended ${fmtD(w.until)}. Approving needs a reason.</span>`) : 'No purchase date on the case.'} OneCare shows the facts; the decision is yours.</p>
        <div class="field"><label for="dt">Decision</label><select class="f" id="dt" name="type">${Object.entries(D.DECISIONS).filter(([k]) => k !== 'advice').map(([k, d]) => html`<option value="${k}">${d.label}</option>`)}</select></div>
        <div class="field"><label for="dr">Reason</label><input id="dr" type="text" name="reason" placeholder="Needed when declining or approving outside the warranty"></div><button class="btn sm" style="margin-top:12px">Record decision</button></form>`;
    }
    case 'dispatch': return html`<form class="act-pane" data-submit="dispatch"><h3>${c.decision.type === 'refund' ? 'Record the refund' : c.decision.type === 'repair' ? 'Record the returns label' : 'Record dispatch'}</h3><div class="field"><label for="tr">Tracking or reference</label><input id="tr" type="text" name="tracking" placeholder="RM123456789GB"></div><p class="small muted" style="margin-top:6px">This completes the open promise and tells the consumer.</p><button class="btn sm" style="margin-top:10px">Record and tell the consumer</button></form>`;
    case 'close': return html`<form class="act-pane" data-submit="closeCase"><h3>Close the case</h3><div class="field"><label for="rs">Resolution</label><input id="rs" type="text" name="resolution" value="${c.decision ? D.DECISIONS[c.decision.type].label : c.claim ? '' : 'Resolved with advice'}"></div>
      ${(x.openPromises || []).length ? html`<div class="field"><label for="cr">${x.openPromises.length} promise${x.openPromises.length > 1 ? 's are' : ' is'} still open. Reason for closing anyway</label><input id="cr" type="text" name="reason"></div>` : ''}<button class="btn sm" style="margin-top:12px">Close and invite a rating</button></form>`;
    default: return '';
  }
}

function caseCard(c) {
  const b = brandOf(c.brand), n = c.next, w = c.warranty;
  const files = c.files || [];
  return html`
    <div class="cc-head"><div><h2><span class="mono" style="font-weight:600">${c.id}</span> ${c.consumer.name}</h2>
        <div class="row" style="margin-top:8px;gap:6px"><span class="tag dark">${b.name}</span><span class="tag">${D.STATUS[c.status]}</span><span class="tag">Came in by ${D.CHANNELS[c.channel].toLowerCase()}</span>${c.handovers.length ? html`<span class="tag">${c.handovers.length} handover${c.handovers.length > 1 ? 's' : ''}</span>` : ''}${c.consumerContacts ? html`<span class="tag ${c.chases ? 'bad' : ''}">${c.consumerContacts} repeat contact${c.consumerContacts > 1 ? 's' : ''}</span>` : ''}${c.reopened ? html`<span class="tag warn">Reopened</span>` : ''}${c.rating ? html`<span class="tag ${c.rating <= 2 ? 'bad' : 'ok'}">Rated ${c.rating}</span>` : ''}</div></div>
      <div class="right small muted">Owner<br><b style="color:var(--ink);font-size:16px">${c.ownerName}</b><br>${D.TEAMS[c.owner.team].label}</div></div>
    <div class="cc-strip">
      <div><h4>Whose turn</h4><b>${TURN[c.turn] || 'P&G'}</b></div>
      <div><h4>Next step</h4><span class="${n.late ? 'late' : ''}">${n.text}${n.dueAt ? html`<br><b class="${n.late ? 'late' : ''}">${n.late ? 'Overdue ' : 'Due '}${rel(n.dueAt, c.now)}</b>` : ''}</span></div>
      <div><h4>Warranty</h4>${w ? html`<b>${w.covered ? 'Inside' : 'Outside'}</b> <span class="small muted">${w.covered ? 'until' : 'ended'} ${fmtD(w.until)}</span>` : html`<span class="muted">No purchase date yet</span>`}</div>
      <div><h4>Time so far</h4><span class="small">P&amp;G ${dur(c.clocks.pg)}<br>Consumer ${dur(c.clocks.consumer)}${c.clocks.carrier ? html`<br>Courier ${dur(c.clocks.carrier)}` : ''}</span></div>
    </div>
    <div class="cc"><div>
      <section><h3>Already on the case</h3><p class="small muted">Do not ask for any of this again.</p>
        <div class="known" style="margin-top:8px"><dl>
          <dt>Product</dt><dd>${c.productName}${c.fromRegistration ? html` <span class="tag">From product registration</span>` : ''}</dd>
          <dt>Problem</dt><dd>${c.issueLabel}${c.issueNote ? html`<br><span class="small muted">${c.issueNote}</span>` : ''}</dd>
          <dt>In their words</dt><dd>${c.description || raw('<span class="muted">Nothing written</span>')}</dd>
          <dt>Model</dt><dd>${c.model || raw('<span class="muted">Not given</span>')}</dd>${c.serial ? html`<dt>Serial</dt><dd>${c.serial}</dd>` : ''}
          <dt>Bought</dt><dd>${c.purchaseDate ? html`${fmtD(Date.parse(c.purchaseDate))}${c.retailer ? ', ' + c.retailer : ''}` : raw('<span class="muted">Not given</span>')}</dd>
          <dt>Contact</dt><dd>${c.consumer.email}</dd>
          ${Object.entries(c.evidence).map(([k, e]) => html`<dt>${D.EVIDENCE[k].label}</dt><dd>${e.status === 'provided' ? html`<span class="got">✓ On the case</span>` : html`<span class="miss">Missing</span>`}</dd>`)}
        </dl></div>
        ${files.length ? html`<div class="row" style="margin-top:10px">${files.map(f => f.dataUrl ? html`<a href="${f.dataUrl}" target="_blank" rel="noopener" title="${D.EVIDENCE[f.kind].label}"><img class="thumb" src="${f.dataUrl}" alt="${D.EVIDENCE[f.kind].label}"></a>` : html`<span class="filechip">${D.EVIDENCE[f.kind].label}: ${f.name}</span>`)}</div>` : ''}
        ${c.aiAssisted ? html`<p class="small muted" style="margin-top:8px">Some fields were read from the consumer’s text or photos and confirmed by them before submitting.</p>` : ''}</section>
      <section class="sect"><h3>Promises to the consumer</h3>${c.promises.length ? c.promises.slice().sort((a, b2) => (a.doneAt ? 1 : 0) - (b2.doneAt ? 1 : 0) || a.dueAt - b2.dueAt).map(p => promiseRow(c, p)) : html`<p class="muted small">None yet.</p>`}</section>
      <section class="sect"><h3>Actions</h3>${actionPane(c, b)}</section>
      <section class="sect"><details class="audit"><summary>Audit trail (${c.audit.length})</summary><table style="margin-top:8px"><tbody>${c.audit.slice().reverse().map(a => html`<tr><td class="nowrap small muted">${fmtDT(a.at)}</td><td class="small">${staffName(a.who)}</td><td class="small"><b>${a.action.replace(/_/g, ' ')}</b>: ${a.detail}</td></tr>`)}</tbody></table></details></section>
    </div><div><section><h3>One record, every channel</h3><p class="small muted">Shaded entries are internal. The consumer sees the rest in My Cases.</p>${timeline(c)}</section></div></div>`;
}

views.desk = async r => {
  const rows = await api('GET', '/api/cases', null, { scope: desk.scope, brand: desk.brand, q: desk.q });
  const id = r.a || (rows[0] && rows[0].id) || '';
  if (id !== desk.caseId || desk.person !== me().key) Object.assign(desk, { caseId: id, person: me().key, pane: '', draft: '', suggest: null, summary: null, moving: '' });
  const c = id ? await api('GET', `/api/cases/${id}`) : null;
  if (c) S.now = c.now;
  const p = me();
  const tab = (k, label) => html`<button data-action="deskScope" data-k="${k}" aria-pressed="${desk.scope === k}">${label}</button>`;
  return html`<div class="desk">
    <aside class="queue" aria-label="Case queue"><div class="qh">
        <div class="row" style="justify-content:space-between"><b>${p.label.split(',')[0]}</b><span class="row" style="gap:6px"><button class="btn sm ghost" data-action="emailIn">Email in</button><button class="btn sm ghost" data-action="phoneIn">Phone call</button></span></div>
        <div class="tabs">${tab('mine', 'Mine')}${tab('team', 'My team')}${tab('open', 'All open')}${tab('closed', 'Closed')}</div>
        <form class="row" data-submit="deskSearch" style="gap:6px"><input type="search" name="q" value="${desk.q}" placeholder="Case ID, name or email" aria-label="Search cases" style="flex:1;min-width:0;padding:6px 10px"><select class="f" name="brand" data-change="deskBrand" aria-label="Brand" style="width:auto;padding:6px 8px"><option value="">All brands</option>${Object.values(S.meta.brands).map(b => html`<option value="${b.key}" ${desk.brand === b.key ? raw('selected') : ''}>${b.name}</option>`)}</select></form></div>
      <div class="ql">${rows.length ? rows.map(x => queueItem(x, id)) : html`<div class="empty small"><b>Nothing here</b>${desk.scope === 'mine' ? 'No open cases are assigned to you.' : 'No cases match.'}</div>`}</div></aside>
    <div>${c ? caseCard(c) : html`<div class="empty"><b>No case selected</b>Choose one from the queue, or bring a new one in by email or phone.</div>`}</div></div>`;
};
const cid = () => desk.caseId;
const post = (path, body, done) => attempt(() => api('POST', `/api/cases/${cid()}/${path}`, body), done);
actions.deskScope = el => { desk.scope = el.dataset.k; desk.q = ''; go('#/desk'); };
actions.deskBrand = el => { desk.brand = el.value; go('#/desk'); };
actions.deskSearch = f => { desk.q = f.q.value; go('#/desk'); };
actions.pane = el => { desk.pane = desk.pane === el.dataset.k ? '' : el.dataset.k; if (desk.pane !== 'handover') desk.summary = null; render(); };
actions.sendReply = async f => {
  const text = f.text.value;
  if (!(await post('reply', { text }, 'Reply sent'))) return;
  desk.draft = ''; desk.pane = '';
  const found = await api('POST', '/api/ai/promises', { text }).catch(() => null);
  desk.suggest = found ? { source: found.source, items: found.promises || [] } : null;
  render();
};
actions.confirmPromise = async f => {
  const i = +f.dataset.i, due = Date.parse(f.due.value);
  if (!f.due.value || isNaN(due)) return toast('Set a deadline before confirming', true);
  if (!(await post('promises', { text: f.text.value, dueAt: due, source: desk.suggest.source === 'ai' ? 'ai' : 'rule' }, 'Promise is now a tracked task'))) return;
  desk.suggest.items.splice(i, 1); if (!desk.suggest.items.length) desk.suggest = null; render();
};
actions.dismissPromise = el => { const i = +el.dataset.i; if (i < 0) desk.suggest = null; else { desk.suggest.items.splice(i, 1); if (!desk.suggest.items.length) desk.suggest = null; } render(); };
actions.addPromise = async f => { const due = Date.parse(f.due.value); if (await post('promises', { text: f.text.value, dueAt: due, source: 'manual' }, 'Promise tracked')) { desk.pane = ''; render(); } };
actions.promiseDone = async el => { if (await post(`promises/${el.dataset.pid}/done`, {}, 'Marked done. The consumer has been told')) render(); };
actions.promiseMoveOpen = el => { desk.moving = desk.moving === el.dataset.pid ? '' : el.dataset.pid; render(); };
actions.movePromise = async f => { if (await post(`promises/${f.dataset.pid}/move`, { dueAt: Date.parse(f.due.value), reason: f.reason.value }, 'New date recorded and sent to the consumer')) { desk.moving = ''; render(); } };
actions.requestInfo = async f => { const items = $$('input[name=item]:checked', f).map(i => i.value); if (await post('request-info', { items, why: f.why.value }, 'Request sent. The case now waits on the consumer')) { desk.pane = ''; render(); } };
actions.draftSummary = async el => {
  const f = el.closest('form'); el.disabled = true; el.textContent = 'Drafting…';
  const r = await attempt(() => api('POST', '/api/ai/handover', { caseId: cid(), reason: f.reason.value, todo: f.todo.value }));
  if (r) desk.summary = { text: r.summary, source: r.source, to: f.to.value, reason: f.reason.value, todo: f.todo.value };
  render();
};
actions.handover = async f => {
  if (await post('handover', { to: f.to.value, reason: f.reason.value, todo: f.todo.value, summary: f.summary ? f.summary.value : '', summarySource: desk.summary ? desk.summary.source : 'template' }, 'Handed over. The consumer has been told they will not need to repeat anything')) {
    desk.pane = ''; desk.summary = null; if (desk.scope === 'mine') desk.scope = 'open'; render(); }
};
actions.logContact = async f => { if (await post('contact', { text: f.text.value, channel: f.channel.value }, 'Added to the same case')) { desk.pane = ''; render(); } };
actions.addNote = async f => { if (await post('note', { text: f.text.value }, 'Note saved')) { desk.pane = ''; render(); } };
actions.decide = async f => {
  const r = await post('decision', { type: f.type.value, reason: f.reason.value }, 'Decision recorded');
  if (!r) return;
  desk.draft = r.suggestedReply || ''; desk.pane = r.suggestedReply ? 'reply' : ''; render();
};
actions.dispatch = async f => { if (await post('dispatch', { tracking: f.tracking.value }, 'Recorded. The promise is complete')) { desk.pane = ''; render(); } };
actions.closeCase = async f => { if (await post('close', { resolution: f.resolution.value, reason: f.reason ? f.reason.value : '' }, 'Case closed')) { desk.pane = ''; render(); } };

function dialog(body, foot) { const d = $('#dlg'); d.innerHTML = html`<div class="dlg-body">${body}</div><div class="dlg-foot">${foot}</div>`.s; d.showModal(); }
actions.closeDlg = () => $('#dlg').close();
actions.emailIn = () => dialog(html`<h2>An email arrives</h2><p class="muted small" style="margin:6px 0 4px">OneCare opens a case from it, or adds it to the existing case if the subject quotes a case number.</p>
  <form id="emailForm" data-submit="emailSend"><div class="grid2"><div class="field"><label for="eb">Sent to</label><select class="f" id="eb" name="brand">${Object.values(S.meta.brands).map(b => html`<option value="${b.key}">${b.name} support</option>`)}</select></div><div class="field"><label for="ef">From</label><input id="ef" type="email" name="from" value="freya.walker@example.com"></div></div>
    <div class="field"><label for="es">Subject</label><input id="es" type="text" name="subject" value="Toothbrush stopped charging"></div>
    <div class="field"><label for="ebd">Message</label><textarea id="ebd" name="body" style="min-height:120px">Hello, my Oral-B iO6 has stopped charging. I bought it at Argos on 03/09/2026. The light on the stand does not come on any more. Freya Walker</textarea></div></form>`,
  html`<button class="btn ghost" data-action="closeDlg">Cancel</button><button class="btn" form="emailForm">Deliver the email</button>`);
actions.emailSend = async f => {
  const name = (f.body.value.trim().split(/\n|\. /).pop() || '').replace(/[^A-Za-z '-]/g, '').trim();
  const r = await attempt(() => api('POST', '/api/inbound/email', { brand: f.brand.value, from: f.from.value, subject: f.subject.value, body: f.body.value, name: /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name) ? name : '' }));
  if (!r) return;
  $('#dlg').close(); toast(r.linked ? `Added to existing case ${r.id}` : `Case ${r.id} opened from the email`); desk.scope = 'open'; go(`#/desk/${r.id}`);
};
actions.phoneIn = () => dialog(html`<h2>A consumer phones</h2><p class="muted" style="margin-top:6px">Which brand are they calling about? You fill in the same case record a web form would create.</p>`,
  html`<button class="btn ghost" data-action="closeDlg">Cancel</button>${Object.values(S.meta.brands).map(b => html`<button class="btn" data-action="phoneGo" data-b="${b.key}">${b.name}</button>`)}`);
actions.phoneGo = el => { $('#dlg').close(); go(`#/new/${el.dataset.b}?staff=1`); };

// ───────── Signal Radar ─────────
const mean = xs => { const v = xs.filter(x => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
function tile(title, weeks, key, nKey, { good = 'up', fmt = pctText, min = 0, note = '' } = {}) {
  const w = weeks[7], v = w[key], n = nKey ? w[nKey] : null, before = mean(weeks.slice(3, 7).map(x => x[key]));
  const quiet = v === null || (n !== null && n < min);
  const vals = weeks.map(x => x[key]), top = Math.max(...vals.filter(x => x !== null), 0.0001);
  const worse = v !== null && before !== null && (good === 'up' ? v < before - 0.0001 : v > before + 0.0001);
  return html`<div class="tile"><h4>${title}</h4><div class="v ${quiet ? 'quiet' : ''}">${fmt(v)}</div>
    <div class="d">${n !== null ? `n = ${n}` : ''}${quiet && n !== null && n < min ? ', too few to judge' : ''}${before !== null ? `${n !== null ? '. ' : ''}Previous four weeks: ${fmt(before)}` : ''}${note ? '. ' + note : ''}</div>
    <div class="spark" role="img" aria-label="${title}, last eight weeks">${weeks.map((x, i) => x[key] === null ? html`<i class="none" data-tip="Week of ${fmtDay(x.from)}: no data"></i>` : html`<i class="${i === 7 ? 'now' : ''} ${i === 7 && worse && !quiet ? 'bad' : ''}" style="height:${Math.max(6, x[key] / top * 100)}%" data-tip="Week of ${fmtDay(x.from)}: ${fmt(x[key])}${nKey ? ' (n = ' + x[nKey] + ')' : ''}"></i>`)}</div></div>`;
}
function brandColumn(b, min) {
  const w = b.weeks, s = b.snapshot, last = w[7], maxTheme = Math.max(...b.themes.map(t => t.n), 1);
  const split = last.split || (w[6] && w[6].split), tot = split ? split.reduce((a, x) => a + x, 0) : 0;
  return html`<section class="bcol"><h2>${b.name}<span class="small muted" style="font-family:var(--body);font-weight:500">${last.opened} new cases this week</span></h2>
    <div class="tiles">
      ${tile('Complete at first submission', w, 'firstComplete', 'nClaims', { min })}
      ${tile('Contact after a handover, before any update', w, 'afterHandover', 'nHanded', { good: 'down', min })}
      ${tile('Promises kept on time', w, 'onTime', 'nDue', { min })}
      ${tile('Low ratings, 1 or 2 stars', w, 'lowRating', 'nRated', { good: 'down', min })}
      ${tile('Median time to close', w, 'medianHours', 'nClosed', { good: 'down', min: 3, fmt: v => v === null ? 'n/a' : (v / 24).toFixed(1) + ' days' })}
      ${tile('Closed with no repeat contact', w, 'fcr', 'nClosed', { min })}
    </div>
    <h3 style="margin-top:22px">Right now</h3>
    <p class="small" style="margin-top:4px"><b>${s.open}</b> open: ${s.withPG} with P&amp;G, ${s.waitingConsumer} waiting on the consumer, ${s.withCarrier} with the courier.</p>
    ${s.overdue.length ? html`<table style="margin-top:8px"><thead><tr><th>Overdue promise</th><th>Owner</th><th class="n">Late by</th></tr></thead><tbody>${s.overdue.slice(0, 6).map(o => html`<tr><td><a href="#/desk/${o.caseId}" data-action="openCase" data-id="${o.caseId}">${o.caseId}</a> ${o.text}${o.escalated ? html` <span class="tag bad">Escalated</span>` : ''}</td><td>${staffName(o.owner)}</td><td class="n">${dur(S.now - o.dueAt)}</td></tr>`)}</tbody></table>` : html`<p class="small muted">No promise is overdue.</p>`}
    ${split && tot ? html`<h3 style="margin-top:22px">Where the time goes</h3><p class="small muted">Average for cases closed ${last.split ? 'this week' : 'last week'}. Waiting for the consumer or the courier is not counted against the team.</p>
      <div class="split">${[['P&G', '#0f2e2a'], ['Consumer', '#a86a12'], ['Courier', '#3c4580']].map(([name, col], i) => split[i] / tot > 0.005 ? html`<i style="flex:${split[i]};background:${col}" data-tip="${name}: ${dur(split[i] * D.HOUR)} on average">${split[i] / tot > 0.14 ? `${name} ${Math.round(split[i] / tot * 100)}%` : ''}</i>` : '')}</div>
      <div class="legend"><span><i style="background:#0f2e2a"></i>With P&amp;G</span><span><i style="background:#a86a12"></i>Waiting on the consumer</span><span><i style="background:#3c4580"></i>With the courier</span></div>` : ''}
    <h3 style="margin-top:22px">What comments say</h3><p class="small muted">${b.nComments} comments in the last four weeks, tagged ${S.meta.ai.on ? (S.meta.ai.cloud ? 'by ' + aiName() : 'by the local model') : 'by rules'}. Red themes map to stall points.</p>
    ${b.themes.length ? b.themes.map(t => html`<div class="hbar ${t.good ? 'good' : ''}" data-tip="${t.label}: ${t.n} of ${b.nComments} comments"><span>${t.label}</span><span class="t"><i style="width:${t.n / maxTheme * 100}%"></i></span><span class="right">${t.n}</span></div>`) : html`<p class="small muted">No comments yet.</p>`}
    <h3 style="margin-top:22px">Patterns this week</h3>
    ${b.clusters.length ? html`<table style="margin-top:6px"><thead><tr><th>Product and problem</th><th class="n">7 days</th><th class="n">Weekly before</th></tr></thead><tbody>${b.clusters.map(c => html`<tr><td>${c.product}: ${c.issueLabel}</td><td class="n"><b>${c.recent}</b></td><td class="n">${c.weeklyBefore.toFixed(1)}</td></tr>`)}</tbody></table>` : html`<p class="small muted">Nothing repeated this week.</p>`}
  </section>`;
}
let radarSeen = false;
views.radar = async () => {
  const r = await api('GET', '/api/radar'); S.now = r.now;
  const intro = !radarSeen; radarSeen = true;
  const open = r.alerts.filter(a => a.status === 'open'), done = r.alerts.filter(a => a.status !== 'open').slice(0, 4);
  const canAck = me().role === 'manager';
  return html`
    <div class="radar-head"><div><h1>Signal Radar</h1><p class="muted" style="margin-top:8px;max-width:46em">The week so far, for each brand separately. An alert is a prompt to look, not a conclusion, and stays quiet when there are fewer than ${r.minSample} cases to judge from.</p></div>
      <div class="small muted right">As of ${fmtDT(r.now)}<br>Weeks are the seven days up to now</div></div>
    <div class="alerts">
      ${open.length ? open.map(a => html`<div class="alert"><div><h3>${a.title}</h3><p class="small" style="margin-top:2px">${a.detail}</p></div><div class="small muted right nowrap">Raised ${rel(a.createdAt)}<br>For ${staffName(a.owner)}</div>
        ${canAck ? html`<form class="act" data-submit="ackAlert" data-id="${a.id}"><input type="text" name="action" placeholder="What will you do about it? This is recorded." aria-label="Action"><button class="btn sm">Record action</button></form>` : ''}</div>`) : html`<div class="panel wash"><b>No open alerts.</b> <span class="muted">Nothing crossed a threshold with enough cases behind it.</span></div>`}
      ${done.map(a => html`<div class="alert acked"><div><h3 style="font-size:15px">${a.title}</h3><p class="small muted" style="margin-top:2px">Action recorded by ${staffName(a.ackBy)}, ${fmtDay(a.ackAt)}: ${a.action}</p></div><div class="small muted right nowrap">Raised ${fmtDay(a.createdAt)}</div></div>`)}
    </div>
    <div class="brands2 ${intro ? 'intro' : ''}" style="--n:${Math.min(3, Object.keys(r.brands).length)}">${Object.values(r.brands).map(b => brandColumn(b, r.minSample))}</div>`;
};
actions.ackAlert = async f => { if (await attempt(() => api('POST', `/api/alerts/${f.dataset.id}/ack`, { action: f.action.value }), 'Action recorded')) render(); };
actions.openCase = el => { desk.scope = 'open'; go(`#/desk/${el.dataset.id}`); };

// ───────── Brand rules ─────────
const rulesUI = { editing: '' };
function matrix(b) {
  const keys = Object.keys(D.EVIDENCE);
  return html`<table class="matrix" style="margin-top:10px"><thead><tr><th>Problem</th>${keys.map(k => html`<th class="c">${D.EVIDENCE[k].label.replace(' or short video of the fault', '').replace(' / production code', '').replace(' or type number', '')}</th>`)}<th>Goes to</th></tr></thead>
    <tbody>${b.issues.map(i => html`<tr><td>${i.label}</td>${keys.map(k => html`<td class="c">${i.needs.includes(k) ? raw('<span class="yes" title="Needed"></span>') : raw('<span class="no">–</span>')}</td>`)}<td class="small">${D.TEAMS[i.route].short}${i.claim ? '' : ', no claim'}</td></tr>`)}</tbody></table>`;
}
views.rules = async () => {
  const brands = Object.values(S.meta.brands), preset = S.meta.preset;
  return html`
    <h1>Brand rules</h1><p class="muted" style="margin-top:8px;max-width:48em">Every brand runs on the same core. What a brand owns is a short set of rules: its products, what evidence each kind of problem needs, where it goes, the warranty period and who may approve a claim. Adding a brand means adding rules.</p>
    <div class="rules">
      <aside class="core-list"><h3>Shared core</h3><p class="small" style="margin-top:4px;opacity:.85">Built once. Not touched when a brand joins.</p>
        <ul><li>Case ID, status, owner, handover log</li><li>Evidence upload, Case Card, timeline</li><li>PromiseTrack tasks, reminders, escalation</li><li>My Cases status page</li><li>Signal Radar and KPI definitions</li><li>Roles, audit trail, privacy rules</li></ul>
        <p class="small" style="margin-top:14px;opacity:.85">${brands.length} brands live: ${brands.map(b => b.name).join(', ')}.</p></aside>
      <div>
        ${preset ? html`<div class="preset"><h3>Bring in a third brand</h3><p style="margin-top:6px">Gillette’s rules are written and waiting: ${preset.products.length} products, ${preset.issues.length} kinds of problem, a ${preset.warrantyMonths}-month warranty, approver ${preset.approvers.map(staffName).join(', ')}. Switching it on changes no code. Its support page, case IDs, evidence checklists, approvals and Signal Radar column all come from these rules.</p>
          <button class="btn go" style="margin-top:12px" data-action="addPreset">Switch on Gillette</button></div>` : ''}
        ${brands.map(b => html`<section class="brule"><h3><span>${b.name} <span class="tag">${b.prefix}-00000</span></span><span class="row" style="gap:8px"><a class="btn sm ghost" href="#/support/${b.key}">Support page</a><button class="btn sm ghost" data-action="editRules" data-k="${b.key}">${rulesUI.editing === b.key ? 'Close editor' : 'Edit rules'}</button></span></h3>
          <p class="small muted" style="margin-top:4px">${b.warrantyMonths}-month warranty. Claims approved by ${b.approvers.map(staffName).join(', ')}. ${b.products.length} products: ${b.products.map(p => p.name).join(', ')}.</p>
          ${matrix(b)}
          ${rulesUI.editing === b.key ? html`<form data-submit="saveRules" style="margin-top:14px"><label for="js-${b.key}">Rules for ${b.name}</label><textarea class="json" id="js-${b.key}" name="json" spellcheck="false">${JSON.stringify(b, null, 2)}</textarea>
            <p class="small muted" style="margin-top:6px">Try it: add <span class="mono">"serial"</span> to the <span class="mono">needs</span> of a problem and save. The next consumer sees it on their checklist. Rules that would break an open case are refused.</p><button class="btn sm" style="margin-top:10px">Save rules</button></form>` : ''}</section>`)}
      </div></div>`;
};
actions.editRules = el => { rulesUI.editing = rulesUI.editing === el.dataset.k ? '' : el.dataset.k; render(); };
actions.saveRules = async f => { let rules; try { rules = JSON.parse(f.json.value); } catch (e) { return toast('That is not valid JSON: ' + e.message, true); } if (await attempt(() => api('POST', '/api/brands', { rules }), `${rules.name} rules saved. They apply to the next case`)) { rulesUI.editing = ''; render(); } };
actions.addPreset = async () => { const rules = S.meta.preset; if (await attempt(() => api('POST', '/api/brands', { rules }), 'Gillette is live. No code changed')) render(); };
})();
