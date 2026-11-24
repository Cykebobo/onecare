// Synthetic demo data. Nothing here comes from P&G: every name, case, date and comment is invented.
// The seed replays eight weeks of cases through the real engine, so the record shapes, promises,
// reminders and Signal Radar numbers are produced by the same code the live system runs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OCSeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const FIRST = ['Amelia', 'Oliver', 'Isla', 'George', 'Ava', 'Noah', 'Mia', 'Arthur', 'Freya', 'Leo', 'Grace', 'Harry', 'Ivy', 'Oscar', 'Lily', 'Theo', 'Evie', 'Jack', 'Poppy', 'Alfie', 'Zara', 'Imran', 'Chloe', 'Daniel', 'Aisha', 'Callum', 'Niamh', 'Rhys', 'Ella', 'Samir'];
const LAST = ['Hughes', 'Patel', 'Walker', 'Khan', 'Evans', 'Wright', 'Green', 'Hall', 'Wood', 'Ahmed', 'Clarke', 'Turner', 'Baker', 'Cooper', 'Morris', 'Ward', 'Bell', 'Murphy', 'Bailey', 'Kelly', 'Reid', 'Shaw', 'Begum', 'Fox', 'Marsh', 'Doyle', 'Singh', 'Price', 'Lowe', 'Hart'];
const SHOPS = ['Boots', 'Argos', 'Amazon', 'Tesco', 'Currys', 'Superdrug', 'John Lewis'];

const SAY = {
  no_charge: ['It stopped charging after about two weeks. The light on the stand does not come on at all.', 'Battery only lasts one use now, then it is dead again.', 'Put it on the charger overnight and nothing. Tried another socket too.'],
  no_power: ['Completely dead this morning. It was fine yesterday.', 'Will not turn on even after a full night on charge.'],
  damage: ['There is a crack near the base and water is getting in.', 'The handle is leaking a dark liquid from the bottom.'],
  motor: ['The motor makes a grinding noise and stops halfway through a shave.', 'It has gone very loud and feels much weaker than it used to.'],
  display: ['The display is stuck on the battery symbol and the buttons do nothing.', 'Screen flickers and then goes blank.'],
  heads_quality: ['The bristles are splaying after only three weeks.', 'Brush head feels worn out much faster than the last pack.'],
  foil_wear: ['The foil pulls my hair now instead of cutting it.', 'Shave is rough, I think the cutter is worn.'],
  how_to: ['How do I pair it with the app? It never shows up.', 'How often should I be cleaning it, and with what?'],
};
const COMMENTS = {
  late: ['I was told it would be sent in two days and had to chase before anything happened.', 'Promised an update and never heard back until I rang again.', 'Took far too long. Nobody got back to me when they said they would.'],
  resub: ['Asked me again for the receipt I had already sent.', 'Had to resend the photo and proof of purchase a second time.'],
  passed: ['I was passed between different people and had to explain everything again.', 'Transferred to another team and had to repeat myself.'],
  declined: ['Told it was out of warranty by a few weeks. Not resolved as far as I am concerned.', 'No solution offered, still broken.'],
  good: ['Really easy. Sent everything in one go and could see where it was the whole time.', 'Kept me informed at each step and the replacement arrived when they said.', 'Simple and quick, did not have to repeat anything.', 'Clear next step every time I looked. Sorted first time.'],
  ok: ['Fine in the end.', 'Got there, a bit slow.', ''],
};

function run(K) {
  const D = K.D, db = K.db;
  const rng = mulberry32(20261124);
  const r = (a, b) => a + rng() * (b - a);
  const pick = xs => xs[Math.floor(rng() * xs.length)];
  const weighted = pairs => { let x = rng() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[0][0]; };
  const T = Date.now(), START = T - 56 * D.DAY;
  const q = []; let n = 0;
  const at = (t, fn) => q.push({ t, fn, n: n++ });
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const staffAct = c => ({ role: c.owner.team === 'frontline' ? 'advisor' : 'warranty', who: c.owner.id });

  function arrive(brandKey, t, force = {}) {
    const brand = db.brands[brandKey];
    const productId = force.productId || (brandKey === 'oral-b'
      ? weighted([['io', 45], ['pro', 30], ['charger', 14], ['heads', 11]])
      : weighted([['s9', 30], ['s7', 25], ['s5', 20], ['trimmer', 15], ['foil', 10]]));
    const product = brand.products.find(p => p.id === productId);
    let issue = force.issue;
    if (!issue) {
      if (!product.device) issue = brandKey === 'oral-b' ? 'heads_quality' : 'foil_wear';
      else if (rng() < 0.1) issue = 'how_to';
      else if (brandKey === 'oral-b') issue = product.id === 'charger' ? 'no_charge' : weighted([['no_charge', 50], ['no_power', 25], ['damage', 25]]);
      else issue = product.id === 'trimmer' ? weighted([['no_charge', 60], ['motor', 40]]) : weighted([['no_charge', 35], ['motor', 35], ['display', 30]]);
    }
    const rule = brand.issues.find(i => i.key === issue);
    const channel = force.channel || weighted([['web', 34], ['phone', 34], ['email', 20], ['qr', 7], ['chatbot', 5]]);
    const complete = force.complete !== undefined ? force.complete : rng() < ({ web: 0.84, qr: 0.9, phone: 0.66, email: 0.42, chatbot: 0.6 })[channel];
    let skip = [];
    if (!complete && rule.needs.length) {
      skip = [rule.needs.includes('proof_of_purchase') && rng() < 0.7 ? 'proof_of_purchase' : pick(rule.needs)];
      if (rng() < 0.3) skip.push(pick(rule.needs));
    }
    const has = k => rule.needs.includes(k) && !skip.includes(k);
    const name = force.name || `${pick(FIRST)} ${pick(LAST)}`;
    const bought = t - r(2, 27) * 30 * D.DAY;
    const input = {
      brand: brandKey, productId: product.id, issue, channel,
      model: has('model') ? `${pick(product.models)}${product.types.length ? ', Type ' + pick(product.types) : ''}` : '',
      serial: has('serial') ? 'PC' + Math.floor(r(1e6, 9e6)) : '',
      purchaseDate: has('purchase_date') ? iso(force.bought || bought) : '', retailer: has('purchase_date') ? pick(SHOPS) : '',
      description: pick(SAY[issue] || SAY.how_to),
      consumer: { name, email: force.email || name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com' },
      files: [has('proof_of_purchase') && { kind: 'proof_of_purchase', name: 'receipt.jpg' }, has('fault_photo') && { kind: 'fault_photo', name: 'photo.jpg' }].filter(Boolean),
      aiAssisted: channel === 'web' || channel === 'qr', fromRegistration: !!force.registered,
    };
    const c = K.createCase(input, {});
    const fx = { slowWeek: brandKey === 'braun' && t > T - 17 * D.DAY && t < T + 2 * D.DAY, smooth: !!force.smooth };
    at(t + r(2, 20) * D.HOUR, () => firstTouch(c, rule, skip, fx));
    return c;
  }

  function firstTouch(c, rule, skip, fx) {
    if (c.status === 'closed') return;
    const miss = K.missing(c);
    if (miss.length) {
      K.requestInfo(c, staffAct(c), miss, '');
      if (rng() < 0.86) at(K.now() + r(0.6, 4) * D.DAY, () => {
        if (c.status !== 'more_info') return;
        const brand = db.brands[c.brand], product = brand.products.find(p => p.id === c.productId);
        K.addEvidence(c, {
          model: miss.includes('model') ? `${pick(product.models)}${product.types.length ? ', Type ' + pick(product.types) : ''}` : '',
          serial: miss.includes('serial') ? 'PC' + Math.floor(r(1e6, 9e6)) : '',
          purchaseDate: miss.includes('purchase_date') ? iso(K.now() - r(2, 27) * 30 * D.DAY) : '',
          files: [miss.includes('proof_of_purchase') && { kind: 'proof_of_purchase', name: 'receipt.jpg' }, miss.includes('fault_photo') && { kind: 'fault_photo', name: 'photo.jpg' }].filter(Boolean),
        });
        at(K.now() + r(3, 18) * D.HOUR, () => work(c, rule, fx));
      });
      return;
    }
    work(c, rule, fx);
  }

  function work(c, rule, fx) {
    if (c.status === 'closed') return;
    const first = c.consumer.name.split(' ')[0];
    if (!rule.claim) {
      K.reply(c, staffAct(c), `Hi ${first}, thanks for getting in touch. ${rule.key === 'how_to' ? 'I have sent the setup steps to your email; the short version is to hold the power button for three seconds to start pairing.' : 'That is quicker wear than we would expect. I am sending a replacement pack as a gesture of goodwill, and a note on care that should help.'}`);
      at(K.now() + r(4, 30) * D.HOUR, () => { if (c.status !== 'closed') { K.close(c, staffAct(c), { resolution: 'Resolved with advice' }); survey(c); } });
      return;
    }
    K.reply(c, staffAct(c), `Hi ${first}, thanks. I can see everything you sent, so you will not be asked for it again. I am passing your case to the team that decides warranty claims.`);
    const why = 'Warranty claim with complete evidence', todo = rule.route === 'technical' ? 'Assess the fault from the photo and description' : 'Check cover and decide the claim';
    K.handover(c, staffAct(c), { to: rule.route, reason: why, todo, summary: D.handoverTemplate(c, db.brands[c.brand], why, todo), summarySource: 'template' });
    if (rng() < (fx.smooth ? 0 : 0.11)) at(K.now() + r(6, 30) * D.HOUR, () => { if (c.status === 'under_review') K.contact(c, { channel: 'phone', text: 'Calling to check you actually have my receipt and photos, since it has moved to another team.' }); });
    if (rule.route === 'technical') {
      at(K.now() + r(10, 40) * D.HOUR, () => {
        if (c.status !== 'under_review') return;
        const why2 = 'Fault confirmed as a motor defect, not wear', todo2 = 'Decide the claim';
        K.note(c, staffAct(c), 'Assessed: consistent with a motor defect. Not user damage.');
        K.handover(c, staffAct(c), { to: 'warranty', reason: why2, todo: todo2, summary: D.handoverTemplate(c, db.brands[c.brand], why2, todo2), summarySource: 'template' });
        at(K.now() + r(6, 34) * D.HOUR, () => decideIt(c, fx));
      });
    } else at(K.now() + r(6, 38) * D.HOUR, () => decideIt(c, fx));
  }

  function decideIt(c, fx) {
    if (c.status !== 'under_review') return;
    const brand = db.brands[c.brand], who = { role: 'warranty', who: brand.approvers[0] };
    if (c.owner.id !== who.who) { const why = 'Needs an authorised approver', todo = 'Decide the claim'; K.handover(c, staffAct(c), { to: 'warranty', toId: who.who, reason: why, todo, summary: D.handoverTemplate(c, brand, why, todo), summarySource: 'template' }); }
    const w = D.inWarranty(c, brand, K.now());
    if (w && !w.covered && rng() < 0.8) {
      K.decide(c, who, { type: 'declined', reason: `The ${brand.warrantyMonths}-month warranty ended on ${new Date(w.until).toLocaleDateString('en-GB')}.` });
      c.declined = true; survey(c, 5.2 * D.DAY);
      return;
    }
    const type = weighted([['replacement', 86], ['repair', 9], ['refund', 5]]);
    const out = K.decide(c, who, { type, reason: w && !w.covered ? 'Goodwill: just outside the warranty period' : '' });
    K.reply(c, who, out.suggestedReply);
    const hours = type === 'replacement' ? brand.promiseDefaults.hours : 72;
    const p = K.addPromise(c, who, { text: type === 'replacement' ? 'Dispatch your replacement and send tracking details.' : type === 'refund' ? 'Process your refund.' : 'Send your prepaid returns label.', dueAt: K.now() + hours * D.HOUR, source: 'ai' });
    const onTime = rng() < (fx.smooth ? 1 : fx.slowWeek ? 0.4 : c.brand === 'oral-b' ? 0.9 : 0.8);
    const when = onTime ? p.dueAt - r(2, Math.min(40, hours - 2)) * D.HOUR : p.dueAt + (fx.slowWeek ? r(30, 130) : r(12, 70)) * D.HOUR;
    if (!onTime && rng() < 0.6) at(p.dueAt + r(3, 10) * D.HOUR, () => { if (!p.doneAt && c.status !== 'closed') K.contact(c, { channel: pick(['phone', 'email', 'web']), text: 'You said this would be sent by now and I have heard nothing. Can someone tell me what is happening?' }); });
    at(when, () => {
      if (c.status !== 'decision_made') return;
      K.dispatch(c, who, { tracking: 'RM' + Math.floor(r(1e8, 9e8)) + 'GB' });
      if (rng() < 0.72) at(K.now() + r(1.5, 4.5) * D.DAY, () => { if (c.status === 'replacement_arranged') { K.close(c, { role: 'consumer', who: c.consumer.email }, { resolution: 'Replacement approved, confirmed by the consumer' }); survey(c); } });
      else survey(c, 6.5 * D.DAY);
    });
  }

  function survey(c, delay = 0) {
    if (rng() > 0.68 && !c.forceRate) return;
    at(K.now() + delay + r(2, 30) * D.HOUR, () => {
      if (c.status !== 'closed' || c.rating) return;
      const late = c.promises.some(p => p.type === 'promise' && p.doneAt && p.doneAt > p.dueAt) || c.chases > 0;
      let score = 5 - (c.resubmissions ? 1 : 0) - (late ? 2 : 0) - (c.chases ? 1 : 0) - (c.contactsAfterHandover ? 1 : 0) - (c.declined ? 3 : 0) + (rng() < 0.2 ? -1 : 0) + (rng() < 0.12 ? 1 : 0);
      score = Math.max(1, Math.min(5, score));
      const pool = c.declined && score <= 3 ? COMMENTS.declined : late && score <= 3 ? COMMENTS.late : c.contactsAfterHandover && score <= 3 ? COMMENTS.passed : c.resubmissions && score <= 4 ? COMMENTS.resub : score >= 4 ? COMMENTS.good : COMMENTS.ok;
      const comment = rng() < 0.85 ? pick(pool) : '';
      K.rate(c, { rating: score, comment, intent: score >= 4 ? (rng() < 0.55 ? 'more' : 'same') : score <= 2 ? (rng() < 0.85 ? 'less' : 'same') : 'same' });
    });
  }

  // Arrivals over eight weeks, busier on weekdays.
  for (let d = 0; d < 56 + 28; d++) { // four more weeks are queued so the desk stays alive when the demo clock moves
    const day = START + d * D.DAY, wd = new Date(day).getDay(), weekend = wd === 0 || wd === 6;
    for (const [brandKey, rate] of [['oral-b', 3.1], ['braun', 1.7]]) {
      const count = Math.max(0, Math.round((weekend ? 0.45 : 1.15) * rate + r(-1, 1)));
      for (let i = 0; i < count; i++) { const t = day + r(8, 21) * D.HOUR; if (t < T - D.HOUR || t > T + D.HOUR) at(t, () => arrive(brandKey, t)); }
    }
  }
  // A pattern for Signal Radar to notice: one product, one fault, several cases in a few days.
  for (let i = 0; i < 6; i++) { const t = T - r(0.3, 5.5) * D.DAY; at(t, () => arrive('oral-b', t, { productId: 'pro', issue: 'damage' })); }
  // The demo consumer: one registered product and one earlier, smoothly handled case.
  K.setNow(START + 2 * D.DAY);
  K.registerProduct({ email: 'sarah.jenkins@example.com', name: 'Sarah Jenkins', brand: 'oral-b', productId: 'io', model: 'iO8, Type 3758', serial: '', purchaseDate: iso(T - 196 * D.DAY), retailer: 'Boots', consent: true });
  { const t = START + 20 * D.DAY + 10 * D.HOUR; at(t, () => { const c = arrive('oral-b', t, { productId: 'heads', issue: 'heads_quality', name: 'Sarah Jenkins', email: 'sarah.jenkins@example.com', channel: 'web', complete: true, smooth: true, registered: true }); c.forceRate = true; }); }

  const runOne = e => { try { e.fn(); } catch (err) { if (!err.status) throw err; } };
  let last = START;
  for (;;) {
    q.sort((a, b) => a.t - b.t || a.n - b.n);
    if (!q.length || q[0].t > T) break;
    const e = q.shift();
    while (last + 3 * D.HOUR <= e.t) { last += 3 * D.HOUR; K.setNow(last); K.tick(); }
    K.setNow(e.t); runOne(e);
  }
  while (last + 3 * D.HOUR <= T) { last += 3 * D.HOUR; K.setNow(last); K.tick(); }
  K.setNow(T); K.tick();
  for (const c of db.cases) { delete c.forceRate; delete c.declined; }
  // Older alerts were looked at when they were raised; this week's are left open for the demo.
  const ACTIONS = ['Checked with the team lead: two advisors were on leave. Cover arranged for next week.', 'Read the comments. Most mention the receipt upload; asked for the evidence list wording to be reviewed.', 'Reviewed the cases. No common batch or retailer; keeping it under watch for another week.', 'Raised at the weekly stand-up. Owner agreed to clear the overdue promises by Friday.'];
  for (const a of db.alerts) if (a.createdAt < T - 6.5 * D.DAY) Object.assign(a, { status: 'acknowledged', action: pick(ACTIONS), ackBy: 'leah', ackAt: a.createdAt + r(3, 30) * D.HOUR });
  // What is still queued is the rest of the team carrying on with their own cases. It plays out as
  // time passes, so moving the demo clock does not freeze every case except the one you are working on.
  return { advance(t) { for (;;) { q.sort((a, b) => a.t - b.t || a.n - b.n); if (!q.length || q[0].t > t) break; runOne(q.shift()); } }, pending: () => q.length };
}

return { run };
});
