// OneCare cloud reader, seen from the site. The page holds no key: it sends a photo or a piece of text
// to the small service in cloud/main.ts, which asks the model (DeepSeek or Claude) and returns a
// structured answer.
// Everything that comes back is checked against the brand rules before it reaches a case.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./domain'));
  else root.OCCloud = factory(root.OCDomain);
})(typeof self !== 'undefined' ? self : this, function (D) {
  function create(endpoint) {
    const url = String(endpoint || '').replace(/\/+$/, '');
    const ai = { ready: false, cloud: true, name: 'AI', maker: '', model: null, vision: true };
    async function call(task, body, timeout) {
      // Sent as bytes, not as "application/json": the host's gateway caps text bodies at 100 KB, and a photo is larger.
      const r = await fetch(url + '/v1/' + task, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout || 30000) });
      if (!r.ok) throw new Error('Cloud reader answered ' + r.status);
      const j = await r.json();
      if (j.model) ai.model = j.model;
      return j.result;
    }
    // Is the reader there, and does it have a key? Until this says yes the rules do the reading.
    ai.check = async () => {
      try {
        const j = await (await fetch(url + '/', { signal: AbortSignal.timeout(8000) })).json();
        ai.ready = !!(j.ok && j.ready); ai.model = j.model || null; ai.name = j.name || 'AI'; ai.maker = j.maker || '';
      } catch { ai.ready = false; }
      return ai.ready;
    };
    ai.intake = async ({ brand, text, image, kind }) => {
      const j = await call('intake', {
        brand: { name: brand.name, products: brand.products.map(p => ({ id: p.id, name: p.name, models: p.models, types: p.types })), issues: brand.issues.map(i => ({ key: i.key, label: i.label })) },
        text: text || '', image: image || '',
      }, 45000);
      return j ? D.aiIntake(j, brand, kind) : null;
    };
    ai.promises = async ({ text, now }) => {
      if (!text.trim()) return { promises: [] };
      const j = await call('promises', { text, now });
      if (!j) return null;
      const out = D.aiPromises(j, now, 'read by AI');
      if (!out.length && D.detectPromises(text, now).length) return null; // the rules saw one: let them speak
      return { promises: out };
    };
    ai.handover = async ({ c, brand, reason, todo }) => {
      const j = await call('handover', { brandName: brand.name, facts: D.handoverFacts(c, reason, todo) });
      const summary = j && typeof j.summary === 'string' ? j.summary.replace(/\s+/g, ' ').trim().slice(0, 700) : '';
      return summary ? { summary } : null;
    };
    ai.tags = async ({ text }) => {
      if (!text.trim()) return { tags: [] };
      const j = await call('tags', { text });
      return j ? { tags: (j.tags || []).filter(k => D.THEMES[k]) } : null;
    };
    return ai;
  }
  return { create };
});
