// OneCare core: the Unified Case Record, PromiseTrack, the follow-up engine, Signal Radar and the API.
// Shared by the Node server and the browser (standalone mode when no server is running).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./domain'), require('./seed'));
  else root.OCCore = factory(root.OCDomain, root.OCSeed);
})(typeof self !== 'undefined' ? self : this, function (D, S) {

class Refused extends Error { constructor(status, message) { super(message); this.status = status; } }
const refuse = (status, message) => { throw new Refused(status, message); };
const clone = x => JSON.parse(JSON.stringify(x));
// Only inline images are stored; anything else a client sends as a "file" is kept as a name only.
const safeImage = u => (typeof u === 'string' && u.length < 3e6 && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u)) ? u : '';

function createCore({ load, save, onChange = () => {}, ai = null } = {}) {
  let db = null, vnow = null, team = null;
  const now = () => vnow !== null ? vnow : Date.now() + (db.clockOffset || 0);
  const rid = p => p + Math.random().toString(36).slice(2, 8);
  const brandOf = c => db.brands[c.brand];
  const findCase = id => db.cases.find(c => c.id === String(id).toUpperCase());
  const need = id => findCase(id) || refuse(404, 'No case with that ID');
  const nameOf = id => (D.staff(id) || {}).name || id;
  function changed(what) { if (vnow === null) { save(db); onChange(what); } }

  function fresh() {
    db = { version: 1, clockOffset: 0, seq: 10200, brands: clone(D.BRANDS), cases: [], products: [], alerts: [], audit: [], seededAt: Date.now() };
    team = S.run(internals);
    vnow = null;
    save(db);
  }

  // ───────── record helpers ─────────
  function line(c, kind, text, extra = {}) {
    const e = { id: rid('e'), at: now(), kind, text, internal: ['note', 'engine', 'handover'].includes(kind), ...extra };
    c.timeline.push(e); c.updatedAt = e.at;
    return e;
  }
  function audit(c, who, action, detail) {
    db.audit.push({ at: now(), caseId: c ? c.id : null, who, action, detail });
    if (db.audit.length > 4000) db.audit.splice(0, db.audit.length - 4000);
  }
  function setTurn(c, turn) {
    if (c.turn === turn) return;
    c.turn = turn; c.turnLog.push({ turn, at: now() });
  }
  function setStatus(c, status, who) {
    if (c.status === status) return;
    audit(c, who, 'status', `${D.STATUS[c.status] || 'New'} → ${D.STATUS[status]}`);
    c.status = status;
    if (status === 'more_info') c.awaitingSince = now(); else delete c.awaitingSince;
    if (status === 'closed') c.closedAt = now();
  }
  function missing(c) { return Object.entries(c.evidence).filter(([, e]) => e.status === 'missing').map(([k]) => k); }
  function recomputeEvidence(c) {
    const has = {
      model: !!c.model, serial: !!c.serial, purchase_date: !!c.purchaseDate,
      proof_of_purchase: c.files.some(f => f.kind === 'proof_of_purchase'),
      fault_photo: c.files.some(f => f.kind === 'fault_photo'),
    };
    for (const k of Object.keys(c.evidence)) {
      const was = c.evidence[k].status;
      c.evidence[k].status = has[k] ? 'provided' : 'missing';
      if (has[k] && was !== 'provided') c.evidence[k].at = now();
    }
  }
  function leastLoaded(team, prefer) {
    const pool = D.STAFF.filter(s => s.team === team && !s.role);
    if (prefer && pool.some(s => s.id === prefer)) return prefer;
    const load = id => db.cases.filter(c => c.status !== 'closed' && c.owner.id === id).length;
    return pool.sort((a, b) => load(a.id) - load(b.id))[0].id;
  }
  function clocks(c, t = now()) {
    const out = { pg: 0, consumer: 0, carrier: 0 };
    const end = c.closedAt || t;
    c.turnLog.forEach((x, i) => {
      const until = i + 1 < c.turnLog.length ? c.turnLog[i + 1].at : end;
      if (out[x.turn] !== undefined) out[x.turn] += Math.max(0, until - x.at);
    });
    return out;
  }
  function nextStep(c, t = now()) {
    const open = c.promises.filter(p => !p.doneAt).sort((a, b) => a.dueAt - b.dueAt);
    const team = D.TEAMS[c.owner.team].label;
    if (c.status === 'closed') return { who: 'done', text: 'Closed. Reply at any time to reopen this case with the same advisor.' };
    if (c.status === 'more_info') return { who: 'consumer', text: 'We need: ' + missing(c).map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ') + '.' };
    if (open.length) return { who: c.turn === 'carrier' ? 'carrier' : 'pg', text: open[0].text, dueAt: open[0].dueAt, late: open[0].dueAt < t };
    if (c.status === 'replacement_arranged') return { who: 'carrier', text: 'Your replacement is on its way. Tell us when it arrives.' };
    if (c.status === 'decision_made') return { who: 'pg', text: c.decision && ['declined', 'advice'].includes(c.decision.type) ? 'Decision sent. We will close the case unless you reply.' : `${team} to arrange the next step.` };
    return { who: 'pg', text: `${team} to review your case.` };
  }

  // ───────── Unified Case Record: every channel lands here ─────────
  function createCase(input, actor = {}) {
    const brand = db.brands[input.brand] || refuse(400, 'Unknown brand');
    const issue = brand.issues.find(i => i.key === input.issue) || refuse(400, 'Choose what is wrong');
    const product = brand.products.find(p => p.id === input.productId) || refuse(400, 'Choose a product');
    const consumer = input.consumer || {};
    if (!consumer.name || !/.+@.+\..+/.test(consumer.email || '')) refuse(400, 'A name and an email address are needed so we can keep you updated');
    const t = now();
    const c = {
      id: `${brand.prefix}-${++db.seq}`, brand: brand.key, productId: product.id, model: (input.model || '').trim(), serial: (input.serial || '').trim(),
      purchaseDate: input.purchaseDate || '', retailer: input.retailer || '', issue: issue.key, description: (input.description || '').trim(),
      consumer: { name: consumer.name.trim(), email: consumer.email.trim().toLowerCase(), phone: consumer.phone || '' },
      channel: D.CHANNELS[input.channel] ? input.channel : 'web',
      files: (input.files || []).filter(f => f && D.EVIDENCE[f.kind]).map(f => ({ id: rid('f'), kind: f.kind, name: String(f.name || 'upload').slice(0, 80), dataUrl: safeImage(f.dataUrl), at: t })),
      evidence: Object.fromEntries(issue.needs.map(k => [k, { status: 'missing', at: null }])),
      status: null, turn: null, turnLog: [], owner: null, lastFrontline: null,
      handovers: [], promises: [], timeline: [], decision: null, rating: null, comment: '', tags: [], intent: null,
      consumerContacts: 0, chases: 0, contactsAfterHandover: 0, resubmissions: 0, aiAssisted: !!input.aiAssisted, fromRegistration: !!input.fromRegistration,
      createdAt: t, updatedAt: t, closedAt: null,
    };
    recomputeEvidence(c);
    c.firstComplete = missing(c).length === 0;
    c.owner = { team: 'frontline', id: leastLoaded('frontline', actor.role === 'advisor' ? actor.who : null) };
    c.lastFrontline = c.owner.id;
    db.cases.push(c);
    line(c, 'contact', c.description || issue.label, { channel: c.channel, from: 'consumer', by: c.consumer.name });
    if (c.firstComplete) { setStatus(c, 'received', 'system'); setTurn(c, 'pg'); }
    else { setStatus(c, 'more_info', 'system'); setTurn(c, 'consumer'); }
    line(c, 'system', `Case ${c.id} opened${c.channel === 'email' ? ' from your email' : ''}. ` +
      (c.firstComplete ? 'We have everything we need to start.' : 'To start, we still need: ' + missing(c).map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ') + '.') +
      ' You can follow this case at any time in My Cases.');
    c.promises.push({ id: rid('p'), type: 'first_response', text: 'First reply from an advisor', dueAt: D.endOfDay(t + D.DAY), owner: c.owner.id, createdAt: t, source: 'rule' });
    audit(c, actor.who || c.consumer.email, 'create', `${D.CHANNELS[c.channel]}; evidence ${c.firstComplete ? 'complete' : 'incomplete'} at first submission`);
    changed('case');
    return c;
  }

  function firstResponseDone(c) {
    const p = c.promises.find(x => x.type === 'first_response' && !x.doneAt);
    if (p) p.doneAt = now();
  }
  function reply(c, actor, text) {
    if (!text || !text.trim()) refuse(400, 'Write a reply first');
    line(c, 'reply', text.trim(), { from: 'staff', by: nameOf(actor.who), team: c.owner.team });
    firstResponseDone(c);
    if (c.status === 'received') setStatus(c, 'under_review', actor.who);
    changed('case');
  }
  function note(c, actor, text) {
    if (!text || !text.trim()) refuse(400, 'Write a note first');
    line(c, 'note', text.trim(), { by: nameOf(actor.who) });
    changed('case');
  }
  function requestInfo(c, actor, items, why) {
    const keys = (items || []).filter(k => D.EVIDENCE[k]);
    if (!keys.length) refuse(400, 'Choose what is needed');
    const already = keys.filter(k => c.evidence[k] && c.evidence[k].status === 'provided');
    if (already.length) refuse(409, `Already on the case: ${already.map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ')}. Evidence is asked for once.`);
    for (const k of keys) c.evidence[k] = c.evidence[k] || { status: 'missing', at: null };
    recomputeEvidence(c);
    line(c, 'reply', `To move this on we need: ${keys.map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ')}.${why ? ' ' + why.trim() : ''} You can add it in My Cases; nothing you have already sent is needed again.`, { from: 'staff', by: nameOf(actor.who), team: c.owner.team });
    firstResponseDone(c);
    setStatus(c, 'more_info', actor.who); setTurn(c, 'consumer');
    c.infoRequests = (c.infoRequests || 0) + 1;
    changed('case');
  }
  function addEvidence(c, input) {
    const before = missing(c);
    for (const k of ['model', 'serial', 'purchaseDate', 'retailer']) if (input[k]) c[k] = String(input[k]).trim();
    for (const f of input.files || []) if (f && D.EVIDENCE[f.kind]) c.files.push({ id: rid('f'), kind: f.kind, name: String(f.name || 'upload').slice(0, 80), dataUrl: safeImage(f.dataUrl), at: now() });
    recomputeEvidence(c);
    const after = missing(c), added = before.filter(k => !after.includes(k));
    if (!added.length) refuse(400, 'Nothing new was added');
    c.resubmissions++;
    line(c, 'contact', 'Added: ' + added.map(k => D.EVIDENCE[k].label.toLowerCase()).join(', ') + '.', { channel: 'web', from: 'consumer', by: c.consumer.name, resubmission: true });
    if (!after.length && c.status === 'more_info') {
      setStatus(c, c.timeline.some(e => e.kind === 'reply') ? 'under_review' : 'received', c.consumer.email); setTurn(c, 'pg');
      line(c, 'system', 'Thank you. We now have everything we need, and you will not be asked for it again.');
    }
    changed('case');
  }
  // Any later contact, on any channel, updates the same case.
  function contact(c, input) {
    const text = (input.text || '').trim();
    if (!text) refuse(400, 'Write a message first');
    const t = now();
    if (c.status === 'closed') {
      setStatus(c, 'under_review', c.consumer.email); c.closedAt = null; c.reopened = (c.reopened || 0) + 1;
      c.owner = { team: 'frontline', id: c.lastFrontline }; setTurn(c, 'pg');
      line(c, 'system', `Case reopened and returned to ${nameOf(c.lastFrontline)}, who handled it before.`);
      c.promises.push({ id: rid('p'), type: 'first_response', text: 'Reply to the reopened case', dueAt: D.endOfDay(t + D.DAY), owner: c.owner.id, createdAt: t, source: 'rule' });
    }
    const overdue = c.promises.some(p => !p.doneAt && p.dueAt < t);
    const lastHandover = c.handovers.length ? c.handovers[c.handovers.length - 1].at : null;
    const updatedSince = lastHandover && c.timeline.some(e => e.at > lastHandover && ['reply', 'decision'].includes(e.kind));
    const afterHandover = !!lastHandover && !updatedSince;
    c.consumerContacts++;
    if (overdue) c.chases++;
    if (afterHandover) c.contactsAfterHandover++;
    line(c, 'contact', text, { channel: D.CHANNELS[input.channel] ? input.channel : 'web', from: 'consumer', by: c.consumer.name, chase: overdue, afterHandover });
    changed('case');
  }
  function handover(c, actor, input) {
    const team = D.TEAMS[input.to] ? input.to : refuse(400, 'Choose the team to hand over to');
    if (!input.reason || !input.reason.trim()) refuse(400, 'Say why the case is moving: the next owner needs the reason');
    if (!input.todo || !input.todo.trim()) refuse(400, 'Say what is still to do: a handover without a next action loses the case');
    if (!input.summary || !input.summary.trim()) refuse(400, 'Confirm the handover summary first');
    const prefer = team === 'warranty' ? brandOf(c).approvers[0] : null;
    const to = { team, id: input.toId && D.staff(input.toId) && D.staff(input.toId).team === team ? input.toId : leastLoaded(team, prefer) };
    if (to.id === c.owner.id) refuse(409, 'That person already owns the case');
    const h = { at: now(), from: { ...c.owner }, to, reason: input.reason.trim(), todo: input.todo.trim(), summary: input.summary.trim(), summarySource: input.summarySource || 'template', confirmedBy: actor.who };
    c.handovers.push(h);
    line(c, 'handover', `${nameOf(h.from.id)} → ${nameOf(to.id)} (${D.TEAMS[team].label}). Reason: ${h.reason}. To do: ${h.todo}.`, { by: nameOf(actor.who), summary: h.summary, summarySource: h.summarySource });
    for (const p of c.promises) if (!p.doneAt && p.type !== 'first_response' && input.movePromises !== false) p.owner = to.id;
    c.owner = to; if (team === 'frontline') c.lastFrontline = to.id;
    firstResponseDone(c);
    if (['received', 'decision_made'].includes(c.status) && team !== 'frontline') setStatus(c, 'under_review', actor.who);
    if (c.status === 'received') setStatus(c, 'under_review', actor.who);
    setTurn(c, c.status === 'more_info' ? 'consumer' : 'pg');
    line(c, 'system', `Your case is now with our ${D.TEAMS[team].label.toLowerCase()}. Everything you sent has moved with it, so you will not need to explain anything again.`);
    audit(c, actor.who, 'handover', `${nameOf(h.from.id)} → ${nameOf(to.id)}: ${h.reason}`);
    changed('case');
    return h;
  }

  // ───────── PromiseTrack ─────────
  function addPromise(c, actor, input) {
    const text = (input.text || '').trim(), dueAt = +input.dueAt;
    if (!text) refuse(400, 'Say what was promised');
    if (!(dueAt > now())) refuse(400, 'A promise needs a deadline in the future');
    const p = { id: rid('p'), type: 'promise', text, dueAt, owner: c.owner.id, createdAt: now(), source: input.source === 'ai' ? 'ai' : input.source === 'rule' ? 'rule' : 'manual', confirmedBy: actor.who };
    c.promises.push(p);
    line(c, 'system', `We have committed to: ${text} Due ${fmtDate(dueAt)}.`, { promiseId: p.id });
    audit(c, actor.who, 'promise', `${text} (due ${fmtDate(dueAt)}; ${p.source === 'manual' ? 'entered by hand' : 'suggested, then confirmed'})`);
    changed('case');
    return p;
  }
  function promiseDone(c, actor, pid) {
    const p = c.promises.find(x => x.id === pid) || refuse(404, 'No such promise');
    if (p.doneAt) return p;
    p.doneAt = now(); p.doneBy = actor.who;
    line(c, 'system', `Done${p.dueAt < p.doneAt ? ', later than we said' : ''}: ${p.text}`, { promiseId: p.id });
    audit(c, actor.who, 'promise_done', `${p.text} (${p.dueAt < p.doneAt ? 'late' : 'on time'})`);
    changed('case');
    return p;
  }
  function promiseMove(c, actor, pid, dueAt, reason) {
    const p = c.promises.find(x => x.id === pid) || refuse(404, 'No such promise');
    if (p.doneAt) refuse(409, 'That promise is already done');
    if (!(+dueAt > now())) refuse(400, 'Choose a new deadline in the future');
    if (!reason || !reason.trim()) refuse(400, 'Give the reason: the consumer will see it');
    p.moves = (p.moves || []).concat({ from: p.dueAt, to: +dueAt, reason: reason.trim(), by: actor.who, at: now() });
    p.dueAt = +dueAt; delete p.overdueAt; delete p.escalatedAt; delete p.remindedAt;
    line(c, 'system', `New date for “${p.text}”: ${fmtDate(p.dueAt)}. Reason: ${reason.trim()}`, { promiseId: p.id });
    audit(c, actor.who, 'promise_moved', `${p.text}: ${fmtDate(p.moves[p.moves.length - 1].from)} → ${fmtDate(p.dueAt)} (${reason.trim()})`);
    changed('case');
    return p;
  }

  // ───────── Decisions belong to authorised people ─────────
  function decide(c, actor, input) {
    const brand = brandOf(c);
    if (actor.role !== 'warranty' || !brand.approvers.includes(actor.who)) refuse(403, `Only an authorised ${brand.name} approver can decide a warranty claim (${brand.approvers.map(nameOf).join(', ')})`);
    const d = D.DECISIONS[input.type] ? input.type : refuse(400, 'Choose a decision');
    const approving = ['replacement', 'repair', 'refund'].includes(d);
    if (approving && missing(c).length) refuse(409, 'Evidence is still missing: ' + missing(c).map(k => D.EVIDENCE[k].label.toLowerCase()).join(', '));
    const w = D.inWarranty(c, brand, now());
    if ((d === 'declined' || (approving && w && !w.covered)) && !(input.reason || '').trim()) refuse(400, d === 'declined' ? 'Give the reason: the consumer will see it' : 'Outside the warranty period: record why you are approving it');
    c.decision = { type: d, reason: (input.reason || '').trim(), by: actor.who, at: now(), inWarranty: w ? w.covered : null };
    setStatus(c, 'decision_made', actor.who);
    firstResponseDone(c);
    line(c, 'decision', D.DECISIONS[d].consumer + (d === 'declined' && c.decision.reason ? ' ' + c.decision.reason : ''), { by: nameOf(actor.who), decision: d });
    if (!approving) setTurn(c, 'consumer');
    audit(c, actor.who, 'decision', `${D.DECISIONS[d].label}${c.decision.reason ? ': ' + c.decision.reason : ''}`);
    changed('case');
    const def = brand.promiseDefaults || { hours: 48 };
    return { suggestedReply: d === 'replacement' ? `Good news: your replacement is approved. We will dispatch it within ${def.hours} hours and send you the tracking details.` : d === 'refund' ? 'Your refund is approved. We will process it within 3 working days.' : d === 'repair' ? 'A repair is approved. We will send you a prepaid returns label within 2 working days.' : '' };
  }
  function dispatch(c, actor, input) {
    if (!D.ROLES[actor.role] || !D.ROLES[actor.role].can.includes('dispatch')) refuse(403, 'Only the warranty team can arrange a replacement');
    if (!c.decision || !['replacement', 'repair', 'refund'].includes(c.decision.type)) refuse(409, 'There is no approved decision to act on yet');
    const tracking = (input.tracking || '').trim();
    setStatus(c, 'replacement_arranged', actor.who); setTurn(c, 'carrier');
    line(c, 'reply', (c.decision.type === 'refund' ? 'Your refund has been processed.' : c.decision.type === 'repair' ? 'Your returns label has been sent.' : 'Your replacement has been dispatched.') + (tracking ? ` Tracking: ${tracking}.` : ''), { from: 'staff', by: nameOf(actor.who), team: c.owner.team });
    for (const p of c.promises) if (!p.doneAt && p.type !== 'first_response' && (!input.promiseIds || input.promiseIds.includes(p.id))) { p.doneAt = now(); p.doneBy = actor.who; }
    audit(c, actor.who, 'dispatch', tracking || 'no tracking recorded');
    changed('case');
  }
  function close(c, actor, input = {}) {
    if (c.status === 'closed') return;
    const open = c.promises.filter(p => !p.doneAt && p.type !== 'first_response');
    if (open.length && actor.role !== 'consumer' && !(input.reason || '').trim()) refuse(409, `${open.length} promise${open.length > 1 ? 's are' : ' is'} still open. Finish ${open.length > 1 ? 'them' : 'it'}, or give a reason for closing anyway.`);
    for (const p of c.promises) if (!p.doneAt) { p.doneAt = now(); p.cancelled = p.type !== 'first_response' && actor.role !== 'consumer'; }
    c.resolution = (input.resolution || '').trim() || (c.decision ? D.DECISIONS[c.decision.type].label : 'Resolved');
    c.closedBy = actor.role === 'consumer' ? 'consumer' : actor.who; c.closedReason = input.closedReason || null;
    setStatus(c, 'closed', actor.who || c.consumer.email); setTurn(c, 'done');
    line(c, 'system', actor.role === 'consumer' ? 'Thanks for confirming. This case is now closed. How did we do?' : `This case is now closed: ${c.resolution}. How did we do? Reply at any time to reopen it.`);
    audit(c, actor.who || c.consumer.email, 'close', c.resolution + (input.reason ? ` (closed with open promises: ${input.reason})` : ''));
    changed('case');
  }
  function rate(c, input) {
    const r = Math.round(+input.rating);
    if (!(r >= 1 && r <= 5)) refuse(400, 'Choose a rating from 1 to 5');
    c.rating = r; c.comment = (input.comment || '').trim().slice(0, 600); c.ratedAt = now();
    c.intent = ['more', 'same', 'less'].includes(input.intent) ? input.intent : null;
    c.tags = Array.isArray(input.tags) ? input.tags.filter(k => D.THEMES[k]) : D.tagComment(c.comment);
    c.tagSource = input.tagSource || 'rule';
    changed('case');
  }
  function registerProduct(input) {
    const brand = db.brands[input.brand] || refuse(400, 'Unknown brand');
    const product = brand.products.find(p => p.id === input.productId) || refuse(400, 'Choose a product');
    if (!/.+@.+\..+/.test(input.email || '')) refuse(400, 'An email address is needed');
    if (!input.consent) refuse(400, 'Registration is voluntary and needs your consent to store these details');
    const r = { id: rid('r'), email: input.email.trim().toLowerCase(), name: input.name || '', brand: brand.key, productId: product.id, model: input.model || '', serial: input.serial || '', purchaseDate: input.purchaseDate || '', retailer: input.retailer || '', at: now() };
    db.products.push(r); changed('product');
    return r;
  }

  // ───────── Follow-up engine ─────────
  function tick() {
    const t = now(); let dirty = false;
    if (team && vnow === null && team.pending()) team.advance(t);
    for (const c of db.cases) {
      if (c.status === 'closed') continue;
      for (const p of c.promises) {
        if (p.doneAt) continue;
        const owner = D.staff(p.owner);
        if (!p.remindedAt && !p.overdueAt && p.dueAt - t < 4 * D.HOUR && p.dueAt > t && p.type !== 'first_response') {
          p.remindedAt = t; dirty = true;
          line(c, 'engine', `Due soon: “${p.text}”. Reminder sent to ${nameOf(p.owner)}.`);
        }
        if (p.dueAt < t && !p.overdueAt) {
          p.overdueAt = t; dirty = true;
          line(c, 'engine', `Overdue: “${p.text}”. ${nameOf(p.owner)} reminded; case moved to the top of the queue.`);
          line(c, 'system', p.type === 'first_response'
            ? 'Sorry for the wait. Your case is at the top of our queue and an advisor will reply shortly.'
            : `“${p.text}” is running late. We have not forgotten: ${owner ? D.TEAMS[owner.team].label.toLowerCase() : 'the team'} has been reminded and you do not need to chase.`);
        }
        if (p.overdueAt && !p.escalatedAt && t - p.dueAt > D.DAY) {
          p.escalatedAt = t; dirty = true;
          const sup = owner && owner.supervisor ? nameOf(owner.supervisor) : 'the team supervisor';
          line(c, 'engine', `Still overdue after 24 hours: “${p.text}”. Escalated to ${sup}.`);
          audit(c, 'engine', 'escalation', `${p.text} → ${sup}`);
        }
      }
      if (c.status === 'more_info' && c.awaitingSince) {
        const idle = t - c.awaitingSince;
        if (idle > 3 * D.DAY && !c.nudgedAt) {
          c.nudgedAt = t; dirty = true;
          line(c, 'system', 'A reminder: we still need a little more from you to finish this. Nothing you have already sent is needed again.');
        } else if (idle > 14 * D.DAY) {
          dirty = true;
          close(c, { role: 'engine', who: 'engine' }, { resolution: 'Closed after 14 days without the information needed', closedReason: 'consumer_silent', reason: 'no reply from consumer' });
        }
      }
      if (c.status === 'replacement_arranged' && t - c.updatedAt > 6 * D.DAY) {
        dirty = true;
        close(c, { role: 'engine', who: 'engine' }, { resolution: D.DECISIONS[c.decision.type].label + ', delivery assumed', closedReason: 'auto_delivered', reason: 'no reply after delivery window' });
      }
      if (c.status === 'decision_made' && c.decision && ['declined', 'advice'].includes(c.decision.type) && t - c.decision.at > 5 * D.DAY) {
        dirty = true;
        close(c, { role: 'engine', who: 'engine' }, { resolution: D.DECISIONS[c.decision.type].label, reason: 'no reply after decision' });
      }
    }
    if (refreshAlerts(t)) dirty = true;
    if (dirty) changed('engine');
  }

  // ───────── Signal Radar: a weekly operations view ─────────
  const MIN_N = 8;
  const pct = (a, b) => b ? a / b : null;
  const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  function weekStats(cases, from, to) {
    const made = cases.filter(c => c.createdAt >= from && c.createdAt < to);
    const claims = made.filter(c => Object.keys(c.evidence).length);
    const rated = cases.filter(c => c.rating && c.ratedAt >= from && c.ratedAt < to);
    const due = cases.flatMap(c => c.promises.filter(p => p.type === 'promise' && !p.cancelled && p.dueAt >= from && p.dueAt < to && (p.doneAt || p.dueAt < now())));
    const closedIn = cases.filter(c => c.closedAt && c.closedAt >= from && c.closedAt < to && c.closedReason !== 'consumer_silent');
    const handed = made.filter(c => c.handovers.length);
    return {
      from, to, opened: made.length,
      firstComplete: pct(claims.filter(c => c.firstComplete).length, claims.length), nClaims: claims.length,
      resubmissions: claims.length ? claims.reduce((s, c) => s + c.resubmissions, 0) / claims.length : null,
      repeatContact: pct(made.filter(c => c.consumerContacts >= 1).length, made.length),
      afterHandover: pct(handed.filter(c => c.contactsAfterHandover > 0).length, handed.length), nHanded: handed.length,
      onTime: pct(due.filter(p => p.doneAt && p.doneAt <= p.dueAt).length, due.length), nDue: due.length,
      lowRating: pct(rated.filter(c => c.rating <= 2).length, rated.length), avgRating: rated.length ? rated.reduce((s, c) => s + c.rating, 0) / rated.length : null, nRated: rated.length,
      netIntent: rated.filter(c => c.intent).length ? (rated.filter(c => c.intent === 'more').length - rated.filter(c => c.intent === 'less').length) / rated.filter(c => c.intent).length * 100 : null,
      medianHours: median(closedIn.map(c => (c.closedAt - c.createdAt) / D.HOUR)), nClosed: closedIn.length,
      handovers: closedIn.length ? closedIn.reduce((s, c) => s + c.handovers.length, 0) / closedIn.length : null,
      fcr: pct(closedIn.filter(c => !c.consumerContacts && !c.resubmissions).length, closedIn.length),
      split: closedIn.length ? ['pg', 'consumer', 'carrier'].map(k => closedIn.reduce((s, c) => s + clocks(c)[k], 0) / closedIn.length / D.HOUR) : null,
    };
  }
  function radar(brandKey) {
    const t = now();
    const keys = brandKey && db.brands[brandKey] ? [brandKey] : Object.keys(db.brands);
    const out = { now: t, minSample: MIN_N, brands: {}, alerts: db.alerts.filter(a => keys.includes(a.brand)).sort((a, b) => b.createdAt - a.createdAt) };
    for (const k of keys) {
      const cs = db.cases.filter(c => c.brand === k);
      const weeks = [];
      for (let i = 7; i >= 0; i--) weeks.push(weekStats(cs, t - (i + 1) * D.WEEK, t - i * D.WEEK));
      const open = cs.filter(c => c.status !== 'closed');
      const overdue = open.flatMap(c => c.promises.filter(p => !p.doneAt && p.dueAt < t).map(p => ({ caseId: c.id, text: p.text, dueAt: p.dueAt, owner: p.owner, escalated: !!p.escalatedAt, consumer: c.consumer.name })));
      const themes = {};
      for (const c of cs) if (c.ratedAt && c.ratedAt > t - 4 * D.WEEK) for (const g of c.tags) themes[g] = (themes[g] || 0) + 1;
      const groups = {};
      for (const c of cs) { const g = c.productId + '|' + c.issue; (groups[g] = groups[g] || { recent: 0, before: 0 }); if (c.createdAt > t - D.WEEK) groups[g].recent++; else if (c.createdAt > t - 5 * D.WEEK) groups[g].before++; }
      out.brands[k] = {
        name: db.brands[k].name, weeks,
        snapshot: {
          open: open.length, waitingConsumer: open.filter(c => c.turn === 'consumer').length, withPG: open.filter(c => c.turn === 'pg').length, withCarrier: open.filter(c => c.turn === 'carrier').length,
          overdue: overdue.sort((a, b) => a.dueAt - b.dueAt), byOwner: D.STAFF.filter(s => !s.role).map(s => ({ id: s.id, name: s.name, team: s.team, open: open.filter(c => c.owner.id === s.id).length })).filter(x => x.open),
        },
        themes: Object.entries(themes).map(([key, n]) => ({ key, n, ...D.THEMES[key] })).sort((a, b) => b.n - a.n),
        nComments: cs.filter(c => c.ratedAt && c.ratedAt > t - 4 * D.WEEK && c.comment).length,
        clusters: Object.entries(groups).map(([g, v]) => { const [productId, issue] = g.split('|'); return { productId, issue, recent: v.recent, weeklyBefore: v.before / 4, product: (db.brands[k].products.find(p => p.id === productId) || {}).name, issueLabel: (db.brands[k].issues.find(i => i.key === issue) || {}).label }; }).filter(x => x.recent >= 2).sort((a, b) => b.recent - a.recent).slice(0, 5),
      };
    }
    return out;
  }
  // Alerts are prompts for a person to look, never conclusions. Small samples stay quiet.
  function refreshAlerts(t) {
    let added = false;
    const weekKey = Math.floor(t / D.WEEK);
    const raise = (brand, kind, title, detail, owner) => {
      const key = [brand, kind, weekKey].join('|');
      const live = db.alerts.find(a => a.brand === brand && a.kind === kind && (a.status === 'open' || t - a.createdAt < D.WEEK));
      if (live) { if (live.status === 'open' && live.title !== title) { live.title = title; live.detail = detail; added = true; } return; }
      db.alerts.push({ id: rid('a'), key, brand, kind, title, detail, owner, createdAt: t, status: 'open', action: '', ackBy: null, ackAt: null });
      added = true;
    };
    for (const k of Object.keys(db.brands)) {
      const cs = db.cases.filter(c => c.brand === k), name = db.brands[k].name;
      const w = weekStats(cs, t - D.WEEK, t), base = weekStats(cs, t - 5 * D.WEEK, t - D.WEEK);
      const overdue = cs.filter(c => c.status !== 'closed').reduce((n, c) => n + c.promises.filter(p => !p.doneAt && p.type === 'promise' && p.dueAt < t).length, 0);
      if (overdue >= 3) raise(k, 'overdue', `${name}: ${overdue} promises to consumers are overdue`, 'Each one is on a named owner. Check workload before they turn into chasing contacts.', 'owen');
      if (w.nRated >= MIN_N && w.lowRating >= 0.3 && (base.lowRating === null || w.lowRating >= base.lowRating + 0.1)) raise(k, 'low_rating', `${name}: ${Math.round(w.lowRating * 100)}% low ratings this week`, `Up from ${base.lowRating === null ? 'no baseline' : Math.round(base.lowRating * 100) + '%'} over the previous four weeks (n = ${w.nRated}). Read the comments before drawing a conclusion.`, 'leah');
      if (w.nDue >= MIN_N && w.onTime < 0.8) raise(k, 'on_time', `${name}: only ${Math.round(w.onTime * 100)}% of promises kept on time this week`, `${w.nDue} promises fell due. The previous four weeks ran at ${base.onTime === null ? 'n/a' : Math.round(base.onTime * 100) + '%'}.`, 'owen');
      if (w.nClaims >= MIN_N && w.firstComplete < 0.6) raise(k, 'evidence', `${name}: ${Math.round(w.firstComplete * 100)}% of claims complete at first submission`, `n = ${w.nClaims}. Check which item is most often missing and whether the brand's evidence list is clear.`, 'dana');
      const groups = {};
      for (const c of cs) { const g = c.productId + '|' + c.issue; (groups[g] = groups[g] || { recent: 0, before: 0 }); if (c.createdAt > t - D.WEEK) groups[g].recent++; else if (c.createdAt > t - 5 * D.WEEK) groups[g].before++; }
      for (const [g, v] of Object.entries(groups)) {
        if (v.recent >= 5 && v.recent >= 2.5 * Math.max(1, v.before / 4)) {
          const [productId, issue] = g.split('|');
          const p = db.brands[k].products.find(x => x.id === productId), i = db.brands[k].issues.find(x => x.key === issue);
          raise(k, 'cluster:' + g, `${name}: ${v.recent} cases of “${i ? i.label : issue}” on ${p ? p.name : productId} in 7 days`, `The previous four weeks averaged ${(v.before / 4).toFixed(1)} a week. This is a pattern to investigate, not a cause.`, 'leah');
        }
      }
    }
    return added;
  }

  // ───────── views ─────────
  function fmtDate(ms) { return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function summary(c, t) {
    const open = c.promises.filter(p => !p.doneAt);
    const b = brandOf(c);
    return {
      id: c.id, brand: c.brand, brandName: b.name, consumer: c.consumer.name, product: (b.products.find(p => p.id === c.productId) || {}).name, model: c.model,
      issue: (b.issues.find(i => i.key === c.issue) || {}).label, status: c.status, turn: c.turn, owner: c.owner, ownerName: nameOf(c.owner.id), channel: c.channel,
      overdue: open.filter(p => p.dueAt < t).length, nextDue: open.length ? Math.min(...open.map(p => p.dueAt)) : null, missing: missing(c).length,
      createdAt: c.createdAt, updatedAt: c.updatedAt, rating: c.rating, handovers: c.handovers.length, contacts: c.consumerContacts,
    };
  }
  function staffView(c) {
    const t = now(), b = brandOf(c);
    return { ...c, files: c.files, brandName: b.name, productName: (b.products.find(p => p.id === c.productId) || {}).name, issueLabel: (b.issues.find(i => i.key === c.issue) || {}).label,
      issueNote: (b.issues.find(i => i.key === c.issue) || {}).note || '', route: (b.issues.find(i => i.key === c.issue) || {}).route, claim: !!(b.issues.find(i => i.key === c.issue) || {}).claim,
      missing: missing(c), next: nextStep(c, t), warranty: D.inWarranty(c, b, t), clocks: clocks(c, t), ownerName: nameOf(c.owner.id), approvers: b.approvers,
      audit: db.audit.filter(a => a.caseId === c.id), now: t };
  }
  function consumerView(c) {
    const t = now(), b = brandOf(c);
    return {
      id: c.id, brand: c.brand, brandName: b.name, productName: (b.products.find(p => p.id === c.productId) || {}).name, model: c.model, serial: c.serial, purchaseDate: c.purchaseDate,
      issueLabel: (b.issues.find(i => i.key === c.issue) || {}).label, description: c.description, status: c.status, turn: c.turn,
      ownerTeam: D.TEAMS[c.owner.team].label, ownerFirstName: nameOf(c.owner.id).split(' ')[0],
      evidence: c.evidence, missing: missing(c), files: c.files.map(f => ({ id: f.id, kind: f.kind, name: f.name, dataUrl: f.dataUrl })),
      promises: c.promises.filter(p => p.type === 'promise' && !p.cancelled).map(p => ({ id: p.id, text: p.text, dueAt: p.dueAt, doneAt: p.doneAt || null, late: !p.doneAt && p.dueAt < t, moved: (p.moves || []).length })),
      timeline: c.timeline.filter(e => !e.internal).map(e => ({ at: e.at, kind: e.kind, text: e.text, from: e.from || 'system', by: e.kind === 'reply' ? (e.by || '').split(' ')[0] : e.by, channel: e.channel })),
      decision: c.decision ? { type: c.decision.type, label: D.DECISIONS[c.decision.type].label } : null,
      next: nextStep(c, t), rating: c.rating, comment: c.comment, createdAt: c.createdAt, closedAt: c.closedAt, consumer: { name: c.consumer.name, email: c.consumer.email }, now: t,
    };
  }
  function queue(actor, q) {
    const t = now();
    let cs = db.cases.slice();
    if (q.get('brand')) cs = cs.filter(c => c.brand === q.get('brand'));
    const scope = q.get('scope') || 'mine';
    if (scope === 'mine') cs = cs.filter(c => c.owner.id === actor.who && c.status !== 'closed');
    else if (scope === 'team') { const team = (D.staff(actor.who) || {}).team; cs = cs.filter(c => c.owner.team === team && c.status !== 'closed'); }
    else if (scope === 'open') cs = cs.filter(c => c.status !== 'closed');
    else if (scope === 'closed') cs = cs.filter(c => c.status === 'closed').sort((a, b) => b.closedAt - a.closedAt).slice(0, 60);
    const s = (q.get('q') || '').trim().toLowerCase();
    if (s) cs = db.cases.filter(c => [c.id, c.consumer.name, c.consumer.email, c.model, c.serial].join(' ').toLowerCase().includes(s));
    const rows = cs.map(c => summary(c, t));
    if (scope !== 'closed') rows.sort((a, b) => (b.overdue - a.overdue) || ((a.turn === 'pg' ? 0 : 1) - (b.turn === 'pg' ? 0 : 1)) || ((a.nextDue || 9e15) - (b.nextDue || 9e15)) || (a.createdAt - b.createdAt));
    return rows;
  }

  // ───────── AI at the edges: suggestions only, with rule-based fallbacks ─────────
  async function aiTry(fn, fallback) {
    if (!ai || !ai.ready) return { ...fallback(), source: 'rules' };
    try { const r = await fn(); if (r) return { ...r, source: 'ai', model: ai.model }; } catch (e) { /* fall through */ }
    return { ...fallback(), source: 'rules' };
  }

  // ───────── routes ─────────
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
  const actorOf = (q, body) => {
    const role = D.ROLES[(body && body.as) || q.get('as')] ? ((body && body.as) || q.get('as')) : 'consumer';
    const who = (body && body.who) || q.get('who') || { advisor: 'tom', warranty: 'hannah', manager: 'leah', admin: 'admin' }[role] || '';
    return { role, who, email: ((body && body.email) || q.get('email') || '').toLowerCase() };
  };
  const allow = (actor, action) => (D.ROLES[actor.role].can.includes(action)) || refuse(403, `A ${D.ROLES[actor.role].label.toLowerCase()} cannot do that`);
  const mine = (c, actor) => (actor.role !== 'consumer' || actor.email === c.consumer.email) || refuse(403, 'Enter the email address used for this case');

  on('GET', '/api/meta', () => ({ now: now(), brands: db.brands, staff: D.STAFF, ai: ai && ai.ready ? { on: true, model: ai.model, vision: !!ai.vision, cloud: !!ai.cloud, name: ai.name || '', maker: ai.maker || '' } : { on: false, cloud: !!(ai && ai.cloud) }, preset: db.brands.gillette ? null : D.GILLETTE_PRESET, clockOffset: db.clockOffset || 0, counts: { cases: db.cases.length, open: db.cases.filter(c => c.status !== 'closed').length } }));

  on('POST', '/api/ai/intake', async ({ body }) => {
    const brand = db.brands[body.brand] || refuse(400, 'Unknown brand');
    // Only an inline image may reach the model: a URL here would make the model server fetch it.
    const image = body.image ? safeImage(body.image) : '';
    if (body.image && !image) refuse(400, 'Photos must be uploaded as images, not links');
    return aiTry(() => ai.intake({ brand, text: String(body.text || '').slice(0, 4000), image, kind: D.EVIDENCE[body.kind] ? body.kind : '' }), () => ({ facts: D.extractFacts(body.text || '', brand) }));
  });
  on('POST', '/api/ai/promises', async ({ body }) => {
    const t = now();
    const rules = () => ({ promises: D.detectPromises(body.text || '', t) });
    return aiTry(async () => { const r = await ai.promises({ text: body.text || '', now: t }); return r && r.promises ? r : null; }, rules);
  });
  on('POST', '/api/ai/handover', async ({ body, q }) => {
    const c = need(body.caseId); const actor = actorOf(q, body); allow(actor, 'handover');
    return aiTry(() => ai.handover({ c: staffView(c), brand: brandOf(c), reason: body.reason || '', todo: body.todo || '' }), () => ({ summary: D.handoverTemplate(c, brandOf(c), body.reason, body.todo) }));
  });

  on('GET', '/api/cases', ({ q }) => { const actor = actorOf(q); if (actor.role === 'consumer') return db.cases.filter(c => actor.email && c.consumer.email === actor.email).sort((a, b) => b.createdAt - a.createdAt).map(c => summary(c, now())); return queue(actor, q); });
  on('POST', '/api/cases', ({ body, q }) => { const actor = actorOf(q, body); if (actor.role !== 'consumer') allow(actor, 'create'); const c = createCase(body, actor); return { id: c.id, firstComplete: c.firstComplete, missing: missing(c) }; });
  on('GET', '/api/cases/:id', ({ p, q }) => { const c = need(p.id); const actor = actorOf(q); mine(c, actor); return actor.role === 'consumer' ? consumerView(c) : staffView(c); });

  const act = (path, action, fn) => on('POST', '/api/cases/:id/' + path, async ({ p, q, body }) => {
    const c = need(p.id); const actor = actorOf(q, body);
    if (action === 'consumer') { if (actor.role === 'consumer') mine(c, actor); } else if (action) allow(actor, action);
    const out = await fn(c, actor, body);
    return { ok: true, ...(out || {}) };
  });
  act('evidence', 'consumer', (c, a, b) => addEvidence(c, b));
  act('contact', 'consumer', (c, a, b) => { if (a.role !== 'consumer') allow(a, 'log_contact'); contact(c, b); });
  act('confirm', 'consumer', (c, a) => { if (c.status !== 'replacement_arranged' && c.status !== 'decision_made') refuse(409, 'There is nothing to confirm yet'); close(c, { role: 'consumer', who: c.consumer.email }, { resolution: (c.decision ? D.DECISIONS[c.decision.type].label : 'Resolved') + ', confirmed by the consumer' }); });
  act('rate', 'consumer', async (c, a, b) => {
    if (c.status !== 'closed') refuse(409, 'You can rate a case once it is closed');
    const tagged = await aiTry(async () => { const r = await ai.tags({ text: b.comment || '' }); return r && Array.isArray(r.tags) ? r : null; }, () => ({ tags: D.tagComment(b.comment || '') }));
    rate(c, { ...b, tags: tagged.tags, tagSource: tagged.source });
  });
  act('reply', 'reply', (c, a, b) => reply(c, a, b.text));
  act('note', 'reply', (c, a, b) => note(c, a, b.text));
  act('request-info', 'request_info', (c, a, b) => requestInfo(c, a, b.items, b.why));
  act('handover', 'handover', (c, a, b) => { handover(c, a, b); });
  act('promises', 'promise', (c, a, b) => ({ promise: addPromise(c, a, b) }));
  act('promises/:pid/done', 'promise', (c, a, b) => { promiseDone(c, a, b.pid); });
  act('promises/:pid/move', 'promise', (c, a, b) => { promiseMove(c, a, b.pid, b.dueAt, b.reason); });
  act('decision', null, (c, a, b) => decide(c, a, b));
  act('dispatch', null, (c, a, b) => dispatch(c, a, b));
  act('close', 'close', (c, a, b) => close(c, a, b));
  act('reassign', 'reassign', (c, a, b) => {
    const s = D.staff(b.toId); if (!s || s.role) refuse(400, 'Choose a member of staff');
    audit(c, a.who, 'reassign', `${nameOf(c.owner.id)} → ${s.name}: ${b.reason || 'workload'}`);
    line(c, 'note', `Reassigned to ${s.name} by ${nameOf(a.who)}${b.reason ? ': ' + b.reason : ''}.`, { by: nameOf(a.who) });
    for (const pr of c.promises) if (!pr.doneAt) pr.owner = s.id;
    c.owner = { team: s.team, id: s.id }; if (s.team === 'frontline') c.lastFrontline = s.id; changed('case');
  });

  // Other channels create or update the same record.
  on('POST', '/api/inbound/email', async ({ body }) => {
    const brand = db.brands[body.brand] || refuse(400, 'Unknown brand');
    const text = [body.subject, body.body].filter(Boolean).join('\n');
    if (!text.trim()) refuse(400, 'The email is empty');
    const existing = (text.match(/\b([A-Z]{2,3}-\d{5})\b/) || [])[1];
    if (existing && findCase(existing)) { const c = findCase(existing); contact(c, { channel: 'email', text: body.body || body.subject }); return { id: c.id, linked: true }; }
    const got = await aiTry(() => ai.intake({ brand, text, image: '', kind: 'email' }), () => ({ facts: D.extractFacts(text, brand) }));
    const f = got.facts || {};
    const productId = brand.products.some(p => p.id === f.productId) ? f.productId : brand.products[0].id;
    const issue = brand.issues.some(i => i.key === f.issue) ? f.issue : brand.issues[0].key;
    const c = createCase({ brand: brand.key, productId, issue, model: f.model, serial: f.serial, purchaseDate: f.purchaseDate, retailer: f.retailer, description: (body.body || '').trim().slice(0, 900), consumer: { name: body.name || (body.from || '').split('@')[0], email: body.from }, channel: 'email', aiAssisted: got.source === 'ai' }, {});
    line(c, 'engine', `Created automatically from an email. ${got.source === 'ai' ? 'AI' : 'Rules'} read the product and issue from the text; an advisor should check them.`);
    changed('case');
    return { id: c.id, linked: false, source: got.source, autoReply: `Thanks for your email. Your case number is ${c.id}. Follow it here: My Cases → ${c.id}.` };
  });
  on('POST', '/api/inbound/chatbot', ({ body }) => {
    const c = createCase({ ...body, channel: 'chatbot' }, {});
    if (Array.isArray(body.transcript) && body.transcript.length) line(c, 'note', 'ChatBot transcript attached at handover:\n' + body.transcript.map(m => `${m.from}: ${m.text}`).join('\n'), { by: 'ChatBot' });
    changed('case');
    return { id: c.id };
  });

  on('GET', '/api/products', ({ q }) => db.products.filter(r => r.email === (q.get('email') || '').toLowerCase()));
  on('POST', '/api/products', ({ body }) => registerProduct(body));
  on('GET', '/api/radar', ({ q }) => radar(q.get('brand')));
  on('POST', '/api/alerts/:id/ack', ({ p, q, body }) => {
    const actor = actorOf(q, body); allow(actor, 'ack_alert');
    const a = db.alerts.find(x => x.id === p.id) || refuse(404, 'No such alert');
    if (!(body.action || '').trim()) refuse(400, 'Record what you will do about it');
    Object.assign(a, { status: 'acknowledged', action: body.action.trim(), ackBy: actor.who, ackAt: now() });
    audit(null, actor.who, 'alert', `${a.title}: ${a.action}`); changed('alert');
    return a;
  });
  on('GET', '/api/audit', ({ q }) => db.audit.slice(-(+q.get('n') || 80)).reverse());
  on('POST', '/api/brands', ({ q, body }) => {
    const actor = actorOf(q, body); allow(actor, 'edit_rules');
    const errs = D.validateBrand(body.rules);
    if (errs.length) refuse(400, 'These rules cannot be saved: ' + errs.join('; '));
    const isNew = !db.brands[body.rules.key];
    const clash = Object.values(db.brands).find(b => b.key !== body.rules.key && b.prefix === body.rules.prefix);
    if (clash) refuse(409, `Prefix ${body.rules.prefix} is already used by ${clash.name}`);
    for (const c of db.cases) if (c.brand === body.rules.key && c.status !== 'closed') {
      if (!body.rules.products.some(p => p.id === c.productId) || !body.rules.issues.some(i => i.key === c.issue)) refuse(409, `Open case ${c.id} uses a product or issue these rules remove`);
    }
    db.brands[body.rules.key] = clone(body.rules);
    audit(null, actor.who, isNew ? 'brand_added' : 'brand_rules', `${body.rules.name}: ${body.rules.products.length} products, ${body.rules.issues.length} issue types, approvers ${body.rules.approvers.map(nameOf).join(', ')}`);
    changed('rules');
    return { ok: true, added: isNew };
  });
  on('POST', '/api/clock', ({ body }) => {
    const step = Math.min(8 * D.WEEK, Math.max(0, +body.hours || 0)) * D.HOUR, target = now() + step;
    while (now() < target) { db.clockOffset = (db.clockOffset || 0) + Math.min(2 * D.HOUR, target - now()); tick(); }
    changed('clock'); return { now: now() };
  });
  on('POST', '/api/reset', () => { fresh(); onChange('reset'); return { ok: true }; });

  async function handle(method, pathname, q, body) {
    const r = routes.find(x => x.method === method && x.re.test(pathname));
    if (!r) return { status: 404, body: { error: 'Not found' } };
    try { return { status: 200, body: await r.fn({ p: { ...r.re.exec(pathname).groups }, q: q || new URLSearchParams(), body: { ...(body || {}), ...pidOf(r, pathname) } }) }; }
    catch (e) { if (e instanceof Refused) return { status: e.status, body: { error: e.message } }; throw e; }
  }
  const pidOf = (r, pathname) => { const g = r.re.exec(pathname).groups || {}; return g.pid ? { pid: g.pid } : {}; };

  const internals = {
    D, get db() { return db; }, setNow: t => { vnow = t; }, now,
    createCase, reply, note, requestInfo, addEvidence, contact, handover, addPromise, promiseDone, promiseMove, decide, dispatch, close, rate, registerProduct, tick, missing, findCase,
  };

  db = load();
  if (!db || db.version !== 1) fresh();

  return { handle, tick, internals, radar, now };
}

return { createCore, Refused };
});
