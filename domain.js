// OneCare domain: the shared core's vocabulary, the brand rules, and the rule-based fallbacks
// that stand in when no AI model is reachable. Shared by the Node server and the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OCDomain = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY;

// ───────── Shared core (identical for every brand) ─────────
const STATUSES = [
  { key: 'received', label: 'Received' },
  { key: 'under_review', label: 'Under review' },
  { key: 'more_info', label: 'More information needed' },
  { key: 'decision_made', label: 'Decision made' },
  { key: 'replacement_arranged', label: 'Replacement arranged' },
  { key: 'closed', label: 'Closed' },
];
const STATUS = Object.fromEntries(STATUSES.map(s => [s.key, s.label]));

const TEAMS = {
  frontline: { label: 'Frontline advisor', short: 'Advisor' },
  warranty: { label: 'Warranty team', short: 'Warranty' },
  technical: { label: 'Technical team', short: 'Technical' },
};

// Synthetic staff directory. Approval rights come from each brand's rules, not from this list.
const STAFF = [
  { id: 'tom', name: 'Tom Ellis', team: 'frontline', supervisor: 'dana' },
  { id: 'priya', name: 'Priya Shah', team: 'frontline', supervisor: 'dana' },
  { id: 'hannah', name: 'Hannah Brooks', team: 'warranty', supervisor: 'owen' },
  { id: 'marcus', name: 'Marcus Reid', team: 'warranty', supervisor: 'owen' },
  { id: 'jo', name: 'Jo Patel', team: 'technical', supervisor: 'owen' },
  { id: 'dana', name: 'Dana Whitfield', team: 'frontline', role: 'supervisor' },
  { id: 'owen', name: 'Owen Clarke', team: 'warranty', role: 'supervisor' },
  { id: 'leah', name: 'Leah Morgan', team: 'management', role: 'manager' },
];
const staff = id => STAFF.find(s => s.id === id);

// Who can do what. The API enforces this; the interface only hides what it would refuse.
const ROLES = {
  consumer: { label: 'Consumer', can: [] },
  advisor: { label: 'Frontline advisor', can: ['reply', 'request_info', 'log_contact', 'handover', 'promise', 'close', 'create'] },
  warranty: { label: 'Warranty specialist', can: ['reply', 'request_info', 'log_contact', 'handover', 'promise', 'close', 'decide', 'dispatch'] },
  manager: { label: 'Care operations manager', can: ['ack_alert', 'reassign'] },
  admin: { label: 'Brand rules admin', can: ['edit_rules'] },
};

const CHANNELS = { web: 'Web form', qr: 'QR code', email: 'Email', phone: 'Phone', chatbot: 'ChatBot handover' };

const DECISIONS = {
  replacement: { label: 'Replacement approved', consumer: 'Your replacement has been approved.' },
  repair: { label: 'Repair approved', consumer: 'A repair has been approved.' },
  refund: { label: 'Refund approved', consumer: 'A refund has been approved.' },
  declined: { label: 'Not covered by warranty', consumer: 'We are sorry: this is not covered by the warranty.' },
  advice: { label: 'Resolved with advice', consumer: 'We have sent you advice that should resolve this.' },
};

const EVIDENCE = {
  model: { label: 'Model or type number', how: 'text', help: 'Printed on the product. A clear photo of the label works too.' },
  serial: { label: 'Serial / production code', how: 'text', help: 'The short code printed next to the type number.' },
  purchase_date: { label: 'Purchase date', how: 'date', help: 'Roughly is fine if you have the receipt.' },
  proof_of_purchase: { label: 'Proof of purchase', how: 'file', help: 'Receipt, invoice or order confirmation from the shop you bought it from.' },
  fault_photo: { label: 'Photo or short video of the fault', how: 'file', help: 'Show the problem as you see it.' },
};

// Complaint themes Signal Radar tags comments with. Stall points 1–3 each have a theme.
const THEMES = {
  proof: { label: 'Asked for proof again', stall: 1 },
  passed: { label: 'Passed around', stall: 2 },
  no_follow_up: { label: 'No follow-up', stall: 3 },
  slow: { label: 'Too slow' },
  unresolved: { label: 'Not resolved' },
  kept_informed: { label: 'Kept informed', good: true },
  easy: { label: 'Easy to submit', good: true },
};

// ───────── Brand rules (the only part that changes per brand) ─────────
const BRANDS = {
  'oral-b': {
    key: 'oral-b', name: 'Oral-B', prefix: 'OB', accent: '#0a3d8f', tagline: 'Electric toothbrushes and oral care',
    warrantyMonths: 24, approvers: ['hannah'],
    products: [
      { id: 'io', name: 'iO Series electric toothbrush', device: true, typeHint: 'Type 3758 / 3753', models: ['iO3', 'iO5', 'iO6', 'iO7', 'iO8', 'iO9', 'iO10'], types: ['3758', '3753', '3771'] },
      { id: 'pro', name: 'Pro Series electric toothbrush', device: true, typeHint: 'Type 3772 / 3766', models: ['Pro 1', 'Pro 3', 'Pro 3 3000', 'Pro 3 3500'], types: ['3772', '3766', '3791'] },
      { id: 'charger', name: 'Charging stand or travel case', device: true, typeHint: 'Type 3757 / 3768', models: ['iO magnetic charger', 'Pro charger'], types: ['3757', '3768'] },
      { id: 'heads', name: 'Replacement brush heads', device: false, models: ['iO Ultimate Clean', 'CrossAction', 'Sensitive Clean'], types: [] },
    ],
    issues: [
      { key: 'no_charge', label: 'Will not charge or hold charge', needs: ['model', 'purchase_date', 'proof_of_purchase', 'fault_photo'], route: 'warranty', claim: true },
      { key: 'no_power', label: 'Will not turn on', needs: ['model', 'purchase_date', 'proof_of_purchase'], route: 'warranty', claim: true },
      { key: 'damage', label: 'Damaged, cracked or leaking', needs: ['model', 'purchase_date', 'proof_of_purchase', 'fault_photo'], route: 'warranty', claim: true },
      { key: 'heads_quality', label: 'Brush head wearing out too fast', needs: ['fault_photo'], route: 'frontline', claim: false },
      { key: 'how_to', label: 'How do I use or set it up?', needs: [], route: 'frontline', claim: false },
    ],
    promiseDefaults: { replacement: 'Dispatch the replacement', hours: 48 },
  },
  braun: {
    key: 'braun', name: 'Braun', prefix: 'BR', accent: '#111111', tagline: 'Shavers, trimmers and grooming',
    warrantyMonths: 24, approvers: ['marcus'],
    products: [
      { id: 's9', name: 'Series 9 Pro shaver', device: true, typeHint: 'Type 5793', models: ['9465cc', '9477cc', '9517s'], types: ['5793', '5795'] },
      { id: 's7', name: 'Series 7 shaver', device: true, typeHint: 'Type 5764', models: ['71-N1000s', '71-S7200cc'], types: ['5764', '5765'] },
      { id: 's5', name: 'Series 5 shaver', device: true, typeHint: 'Type 5762', models: ['51-W1000s', '51-B1200s'], types: ['5762'] },
      { id: 'trimmer', name: 'Beard trimmer', device: true, typeHint: 'Type 5544', models: ['BT5', 'BT7', 'BT9'], types: ['5544', '5541'] },
      { id: 'foil', name: 'Foil and cutter cassette', device: false, models: ['92S', '73S', '53B'], types: [] },
    ],
    issues: [
      { key: 'no_charge', label: 'Will not charge or hold charge', needs: ['model', 'serial', 'purchase_date', 'proof_of_purchase'], route: 'warranty', claim: true },
      { key: 'motor', label: 'Motor noise, weak or stops while shaving', needs: ['model', 'serial', 'purchase_date', 'proof_of_purchase', 'fault_photo'], route: 'technical', claim: true },
      { key: 'display', label: 'Display or buttons not working', needs: ['model', 'serial', 'purchase_date', 'proof_of_purchase', 'fault_photo'], route: 'warranty', claim: true },
      { key: 'foil_wear', label: 'Foil or cutter worn or pulling', needs: ['model', 'fault_photo'], route: 'frontline', claim: false, note: 'Foils and cutters are wear parts; advise on replacement intervals before any claim.' },
      { key: 'how_to', label: 'How do I use, clean or set it up?', needs: [], route: 'frontline', claim: false },
    ],
    promiseDefaults: { replacement: 'Dispatch the replacement', hours: 72 },
  },
};

// A third brand that can be switched on from the rules page with configuration only.
const GILLETTE_PRESET = {
  key: 'gillette', name: 'Gillette', prefix: 'GL', accent: '#0b2a6f', tagline: 'Razors and shaving care',
  warrantyMonths: 24, approvers: ['marcus'],
  products: [
    { id: 'labs', name: 'GilletteLabs heated razor', device: true, typeHint: 'Model on the charging dock', models: ['Heated Razor', 'Heated Razor travel kit'], types: ['HR1'] },
    { id: 'styler', name: 'Styler and body trimmer', device: true, typeHint: 'Model on the handle', models: ['Styler 4-in-1', 'Intimate trimmer i5'], types: ['ST4', 'I5'] },
    { id: 'blades', name: 'Blades and cartridges', device: false, models: ['Labs', 'ProGlide', 'Fusion5'], types: [] },
  ],
  issues: [
    { key: 'no_charge', label: 'Will not charge or hold charge', needs: ['model', 'purchase_date', 'proof_of_purchase'], route: 'warranty', claim: true },
    { key: 'no_heat', label: 'Not heating', needs: ['model', 'purchase_date', 'proof_of_purchase', 'fault_photo'], route: 'warranty', claim: true },
    { key: 'blade_quality', label: 'Blades dull or uncomfortable', needs: ['fault_photo'], route: 'frontline', claim: false },
    { key: 'how_to', label: 'How do I use or set it up?', needs: [], route: 'frontline', claim: false },
  ],
  promiseDefaults: { replacement: 'Dispatch the replacement', hours: 48 },
};

function validateBrand(b) {
  const errs = [];
  if (!b || typeof b !== 'object') return ['Rules must be a JSON object'];
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(b.key || '')) errs.push('key: lowercase letters, digits and dashes');
  if (!b.name) errs.push('name is required');
  if (b.accent && !/^#[0-9a-f]{6}$/i.test(b.accent)) errs.push('accent must be a hex colour such as #0a3d8f');
  if (!/^[A-Z]{2,3}$/.test(b.prefix || '')) errs.push('prefix: 2–3 capital letters for case IDs');
  if (!(b.warrantyMonths > 0)) errs.push('warrantyMonths must be a positive number');
  if (!Array.isArray(b.products) || !b.products.length) errs.push('at least one product');
  if (!Array.isArray(b.issues) || !b.issues.length) errs.push('at least one issue type');
  for (const i of b.issues || []) {
    if (!i.key || !i.label) errs.push('every issue needs a key and a label');
    for (const n of i.needs || []) if (!EVIDENCE[n]) errs.push(`issue "${i.key}" asks for unknown evidence "${n}"`);
    if (!TEAMS[i.route]) errs.push(`issue "${i.key}" routes to unknown team "${i.route}"`);
  }
  for (const a of b.approvers || []) if (!staff(a)) errs.push(`unknown approver "${a}"`);
  if (!(b.approvers || []).length) errs.push('at least one authorised approver');
  return errs;
}

// ───────── Rule-based fallbacks (used when no AI model answers) ─────────

// Pull product facts out of free text: an email body, a phone note, a form description.
// Text read from a photo confuses O with 0, I with 1 and S with 5; match names tolerantly.
function fuzzy(word) {
  return [...word].map(ch => /\s/.test(ch) ? '\\s*' : /[Oo0]/.test(ch) ? '[Oo0]' : /[Il1]/.test(ch) ? '[Il1|]' : /[Ss5]/.test(ch) ? '[Ss5]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('').replace(/(\\s\*)+/g, '\\s*');
}
function extractFacts(text, brand) {
  const t = ' ' + (text || '') + ' ';
  const out = {};
  for (const p of brand.products) {
    const hit = [...p.models].sort((a, b) => b.length - a.length).find(m => new RegExp('(^|[^a-z0-9])' + fuzzy(m) + '([^a-z0-9]|$)', 'i').test(t));
    const type = p.types.find(x => new RegExp('\\b' + x + '\\b').test(t));
    if (hit || type) { out.productId = p.id; out.model = [hit, type ? 'Type ' + type : ''].filter(Boolean).join(', '); break; }
  }
  // "PC 5 2 3 1 8 8 4" on a label is one code; close up digits that are spaced out before looking for it.
  const tight = t.replace(/\b([A-Za-z]{1,3})((?:\s\d){6,10})\b/g, (m, a, n) => a + n.replace(/\s/g, ''));
  const serial = tight.match(/\b(?:serial|production code|s\/n|sn)[\s:#-]*([A-Z0-9]{5,14})\b/i) || tight.match(/\b([A-Z]{1,3}\d{6,10}[A-Z]?)\b/i);
  if (serial && !/^(GB|VAT|TILL|OP)/i.test(serial[1])) out.serial = serial[1].toUpperCase();
  const d = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/) || null;
  const d2 = t.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  const d3 = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i);
  const pad = n => String(n).padStart(2, '0');
  if (d) out.purchaseDate = `${d[1]}-${pad(d[2])}-${pad(d[3])}`;
  else if (d2) out.purchaseDate = `${d2[3]}-${pad(d2[2])}-${pad(d2[1])}`; // UK order: day first
  else if (d3) out.purchaseDate = `${d3[3]}-${pad('janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(d3[2].toLowerCase().slice(0, 3)) / 3 + 1)}-${pad(d3[1])}`;
  const shop = ['Boots', 'Argos', 'Amazon', 'Tesco', 'Currys', 'Superdrug', 'John Lewis', "Sainsbury's", 'Asda'].find(n => new RegExp('(^|[^a-z0-9])' + fuzzy(n).replace("'", "'?") + '([^a-z0-9]|$)', 'i').test(t));
  if (shop) out.retailer = shop;
  const kw = [
    ['no_charge', /(won'?t|not|doesn'?t|stopped|no longer)\s+(charg|hold)|charg\w*\s+(light|stand|fault)|battery (dies|dead|drain)/i],
    ['no_power', /(won'?t|not|doesn'?t)\s+(turn|switch|power)\s*on|completely dead/i],
    ['motor', /motor|rattl|grinding|stops (mid|while|during)|very loud/i],
    ['display', /display|screen|button/i],
    ['no_heat', /(not|won'?t|doesn'?t)\s+heat/i],
    ['damage', /crack|leak|broke|snapp|damag/i],
    ['foil_wear', /foil|cutter|pull(s|ing) (hair|my)/i],
    ['heads_quality', /brush ?head|bristle/i],
    ['blade_quality', /blade|dull|cartridge/i],
    ['how_to', /how (do|to|can)|set ?up|pair|bluetooth|instructions/i],
  ];
  const issue = kw.find(([k, re]) => re.test(t) && brand.issues.some(i => i.key === k));
  if (issue) out.issue = issue[0];
  return out;
}

// Find commitments in an advisor's reply. Returns suggestions only: an advisor confirms each one.
function detectPromises(text, now) {
  const found = [];
  const sentences = (text || '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const unit = { hour: HOUR, hours: HOUR, hr: HOUR, hrs: HOUR, day: DAY, days: DAY, week: WEEK, weeks: WEEK };
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, a: 1, an: 1 };
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const s of sentences) {
    if (!/\b(i|we)('ll| will| shall)\b|\b(i|we)('m| am| are) going to\b|\byou('ll| will) (receive|get|hear)\b/i.test(s)) continue;
    let due = null, basis = '';
    const m = s.match(/\b(?:within|in|after)\s+(\d+|one|two|three|four|five|six|seven|ten|a|an)\s+(working |business )?(hours?|hrs?|days?|weeks?)\b/i);
    const by = s.match(/\bby\s+(?:end of (?:the )?day|close of business)\b/i);
    const dayName = s.match(/\b(?:by|on|before)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : words[m[1].toLowerCase()];
      const u = unit[m[3].toLowerCase()];
      due = m[2] ? addWorkingTime(now, n * u) : now + n * u;
      basis = m[0];
    } else if (/\btomorrow\b/i.test(s)) { due = endOfDay(now + DAY); basis = 'tomorrow'; }
    else if (/\b(today|later today|this afternoon)\b/i.test(s) || by) { due = endOfDay(now); basis = 'today'; }
    else if (dayName) {
      const want = days.indexOf(dayName[1].toLowerCase()), d = new Date(now);
      const ahead = ((want - d.getDay() + 7) % 7) || 7;
      due = endOfDay(now + ahead * DAY); basis = dayName[0];
    }
    if (!due) continue; // a promise without a time is not trackable; the advisor can add one by hand
    found.push({ text: tidyPromise(s), dueAt: due, basis });
  }
  return found;
}
function endOfDay(ms) { const d = new Date(ms); d.setHours(17, 30, 0, 0); return d.getTime(); }
function addWorkingTime(from, ms) { // skip weekends for "working days"
  let t = from, left = Math.round(ms / DAY);
  if (ms < DAY) return from + ms;
  while (left > 0) { t += DAY; const g = new Date(t).getDay(); if (g !== 0 && g !== 6) left--; }
  return t;
}
function tidyPromise(s) {
  let x = s.replace(/^(thanks?|thank you|hi|hello|dear)[^,.!]*[,.!]\s*/i, '').replace(/\s+/g, ' ').trim();
  x = x.replace(/^(and|so|also)\s+/i, '');
  return x.length > 110 ? x.slice(0, 107) + '…' : x;
}

// Tag a consumer comment with complaint themes.
function tagComment(text) {
  const t = (text || '').toLowerCase();
  const rules = [
    ['proof', /(proof|receipt|invoice|photo|evidence)[^.]*\b(again|twice|three times|second time|already sent|resend|re-send)|asked (me )?(again|twice) for|kept asking for/],
    ['passed', /passed (around|from|between)|transferr|different (person|people|department|team)|explain(ed)? (it |everything |myself )?(all over )?again|repeat(ed)? (myself|everything)|start(ed)? (all over|again)/],
    ['no_follow_up', /no(body| one|t once)? (ever )?(got|came|called|rang|phoned|emailed)? ?back|never heard|no (update|follow|reply|response)|had to chase|chas(ed|ing)|still waiting to hear|promised .* (never|didn'?t|not)/],
    ['slow', /\b(slow|weeks|took (so|too|far too) long|waiting (for )?(weeks|ages)|ages)\b/],
    ['unresolved', /(still|never) (not )?(fixed|resolved|sorted|working|broken)|not resolved|no solution|gave up/],
    ['kept_informed', /kept (me )?(informed|updated|in the loop)|could see (where|what|the status)|knew (what|when|who)|clear (update|next step)|on time|when (they|you) said/],
    ['easy', /\b(easy|simple|quick|straightforward|painless)\b|one go|first time|didn'?t have to (repeat|explain|send)/],
  ];
  return rules.filter(([, re]) => re.test(t)).map(([k]) => k);
}

// A handover summary built from structured fields only.
function handoverTemplate(c, brand, why, todo) {
  const prod = brand.products.find(p => p.id === c.productId);
  const issue = brand.issues.find(i => i.key === c.issue);
  const have = Object.entries(c.evidence).filter(([, e]) => e.status === 'provided').map(([k]) => EVIDENCE[k].label.toLowerCase());
  const miss = Object.entries(c.evidence).filter(([, e]) => e.status === 'missing').map(([k]) => EVIDENCE[k].label.toLowerCase());
  const open = c.promises.filter(p => !p.doneAt).map(p => p.text);
  return [
    `${c.consumer.name}: ${prod ? prod.name : 'product'}${c.model ? ' (' + c.model + ')' : ''}, ${issue ? issue.label.toLowerCase() : 'issue reported'}.`,
    c.description ? `In their words: “${c.description.slice(0, 140)}”.` : '',
    have.length ? `Already on the case: ${have.join(', ')}.` : 'No evidence on the case yet.',
    miss.length ? `Still missing: ${miss.join(', ')}.` : 'Nothing is missing; do not ask the consumer to resend anything.',
    open.length ? `Open promise to the consumer: ${open.join('; ')}.` : '',
    why ? `Handed over because: ${why}.` : '',
    todo ? `Next action for you: ${todo}.` : '',
  ].filter(Boolean).join(' ');
}

function inWarranty(c, brand, now) {
  if (!c.purchaseDate) return null;
  const bought = Date.parse(c.purchaseDate);
  if (isNaN(bought)) return null;
  const end = new Date(bought); end.setMonth(end.getMonth() + brand.warrantyMonths);
  return { covered: now <= end.getTime(), until: end.getTime() };
}

// ───────── What a model says is checked here before it reaches a case ─────────
const aiClean = (s, max = 80) => (typeof s === 'string' && s.trim() && !/^(null|none|unknown|n\/a)$/i.test(s.trim())) ? s.trim().slice(0, max) : '';
function aiIntake(j, brand, kind) {
  const facts = {};
  if (brand.products.some(p => p.id === j.productId)) facts.productId = j.productId;
  if (brand.issues.some(i => i.key === j.issue)) facts.issue = j.issue;
  if (aiClean(j.model)) facts.model = aiClean(j.model);
  if (aiClean(j.serial)) facts.serial = aiClean(j.serial).toUpperCase().replace(/\s+/g, '');
  if (/^20\d{2}-\d{2}-\d{2}$/.test(j.purchaseDate || '') && !isNaN(Date.parse(j.purchaseDate))) facts.purchaseDate = j.purchaseDate;
  if (aiClean(j.retailer)) facts.retailer = aiClean(j.retailer);
  return { facts, kind: ['fault_photo', 'proof_of_purchase', 'product_label', 'other'].includes(j.kind) ? j.kind : (kind || 'other'), note: aiClean(j.note, 200) };
}
function aiPromises(j, now, basis) {
  return (j.promises || []).filter(p => p && aiClean(p.text, 140)).slice(0, 4).map(p => {
    const h = +p.due_in_hours;
    let dueAt = h > 0 && h < 24 * 120 ? now + h * HOUR : null;
    if (dueAt && p.working_days) { let t = now, left = Math.round(h / 24); while (left > 0) { t += DAY; const g = new Date(t).getDay(); if (g !== 0 && g !== 6) left--; } dueAt = t; }
    return { text: aiClean(p.text, 140), dueAt, basis };
  });
}
// The facts a handover summary may use. Nothing else about the case is given to the model.
function handoverFacts(c, reason, todo) {
  const ev = k => EVIDENCE[k].label.toLowerCase();
  return [
    `Consumer: ${c.consumer.name}`, `Product: ${c.productName}${c.model ? ' (' + c.model + ')' : ''}`, `Issue: ${c.issueLabel}`,
    `Consumer's words: ${c.description || 'none'}`, `Purchase date: ${c.purchaseDate || 'not given'}${c.warranty ? (c.warranty.covered ? ' (inside the warranty period)' : ' (outside the warranty period)') : ''}`,
    `Evidence on the case: ${Object.entries(c.evidence).filter(([, e]) => e.status === 'provided').map(([k]) => ev(k)).join(', ') || 'none'}`,
    `Evidence missing: ${c.missing.map(ev).join(', ') || 'none'}`,
    `Open promises to the consumer: ${c.promises.filter(p => !p.doneAt && p.type === 'promise').map(p => p.text).join('; ') || 'none'}`,
    `Contacts from the consumer so far: ${c.consumerContacts + 1}`, `Reason for handover: ${reason || 'not given'}`, `Next action: ${todo || 'not given'}`,
    'Recent messages: ' + c.timeline.filter(e => ['contact', 'reply', 'note'].includes(e.kind)).slice(-5).map(e => `${e.by || e.from}: ${e.text}`).join(' / ').slice(0, 900),
  ].join('\n');
}

return {
  HOUR, DAY, WEEK, STATUSES, STATUS, TEAMS, STAFF, staff, ROLES, CHANNELS, DECISIONS, EVIDENCE, THEMES,
  BRANDS, GILLETTE_PRESET, validateBrand, extractFacts, detectPromises, tagComment, handoverTemplate, inWarranty, endOfDay, aiIntake, aiPromises, handoverFacts,
};
});
