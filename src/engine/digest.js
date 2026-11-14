// The daily digest: what each person needs to know without logging in. Pure functions: no network, no storage.
// A client user sees only their own organisation's products; the governance team sees what is waiting for them.
import { STAGES } from '../data/lifecycle.js';
import { incidentClocks } from './governance.js';
import { autoMaxAge, pullState } from '../data/freshness.js';

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cut = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// Items for one product: [{ for: 'client' | 'team', kind, text }]. `read` is the latest daily registry read, if any.
export function digestItems(x, { now = new Date(), settings = {}, read = null } = {}) {
  if (!x || typeof x !== 'object' || ['Draft', 'Withdrawn', 'Retired'].includes(x.status)) return [];
  const list = (v) => (Array.isArray(v) ? v.filter((i) => i && typeof i === 'object') : []);
  const out = []; const t = new Date(now).getTime(); const today = iso(now);
  const n = Number.isInteger(Number(x.stage)) && Number(x.stage) >= 1 && Number(x.stage) <= 10 ? Number(x.stage) : 1; const rec = (x.stages && typeof x.stages === 'object' && x.stages[n]) || {}; const st = STAGES[n - 1];
  if (rec.status === 'returned') out.push({ for: 'client', kind: 'returned', text: `Stage ${n} (${st?.name}) was returned: ${cut(rec.returnNote, 200) || 'see the reviewer\'s comment'}` });
  if (rec.status === 'submitted') {
    const days = rec.submittedAt ? Math.floor((t - new Date(rec.submittedAt).getTime()) / DAY) : 0;
    const sla = Number(settings.reviewSlaDays) || 5;
    out.push({ for: 'team', kind: 'review-waiting', text: `Stage ${n} (${st?.name}) is waiting for review${days > sla ? `, ${days} days, past the ${sla}-day review target` : ''}` });
  }
  const open = list(x.actions).filter((a) => a.status !== 'Done' && typeof a.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.due));
  const late = open.filter((a) => a.due < today);
  if (late.length) out.push({ for: 'client', kind: 'overdue', text: `${plural(late.length, 'action')} past ${late.length === 1 ? 'its' : 'their'} due date: ${late.slice(0, 3).map((a) => cut(a.action, 80)).join('; ')}` });
  const soon = open.filter((a) => a.priority === 'High' && a.due >= today && a.due <= iso(t + 3 * DAY));
  if (soon.length) out.push({ for: 'client', kind: 'due-soon', text: `${plural(soon.length, 'high-priority action')} due within 3 days: ${soon.slice(0, 3).map((a) => cut(a.action, 80)).join('; ')}` });
  // An open incident (stage 9, not yet closed) with its legal clocks.
  if (n === 9 && rec.status !== 'approved') {
    const inc = list(x.events).reverse().find((e) => e.kind === 'incident');
    const r = x.assessment?.results;
    const clocks = inc ? incidentClocks(inc, Array.isArray(x.assessment?.frameworks) ? x.assessment.frameworks : [], { highRisk: r?.legal?.tier === 'high' || r?.tier === 'high' }) : [];
    if (clocks.length) {
      const text = `Incident reporting clocks: ${clocks.map((c) => { const h = Math.floor((new Date(c.due).getTime() - t) / 3600000); return `${c.ref}: ${h >= 0 ? `${plural(h, 'hour')} left` : `deadline passed ${iso(c.due)}`}`; }).join('; ')}`;
      out.push({ for: 'client', kind: 'incident', text }, { for: 'team', kind: 'incident', text });
    }
  }
  // Evidence attached automatically on the stage being worked on.
  if (rec.status !== 'approved') {
    const max = autoMaxAge(settings);
    const autos = Object.entries(rec.evidence && typeof rec.evidence === 'object' ? rec.evidence : {}).filter(([, v]) => typeof v?.auto?.at === 'string' && Number.isFinite(new Date(v.auto.at).getTime()));
    const expired = autos.filter(([, v]) => pullState(v.auto.at, { now, maxAgeDays: max }).expired);
    const left = (v) => max - pullState(v.auto.at, { now, maxAgeDays: max }).ageDays;
    const expiring = autos.filter(([, v]) => !pullState(v.auto.at, { now, maxAgeDays: max }).expired && left(v) <= 5);
    if (expired.length) out.push({ for: 'client', kind: 'evidence-expired', text: `${plural(expired.length, 'automatic evidence item')} out of date and no longer counted: ${expired.map(([k]) => k).slice(0, 3).join('; ')}. Refresh from the registry.` });
    else if (expiring.length) out.push({ for: 'client', kind: 'evidence-expiring', text: `Automatic evidence expires in ${plural(Math.min(...expiring.map(([, v]) => left(v))), 'day')}: ${expiring.map(([k]) => k).slice(0, 3).join('; ')}` });
  }
  if (typeof x.nextReview === 'string' && x.nextReview <= iso(t + 14 * DAY)) out.push({ for: 'client', kind: 'review', text: x.nextReview < today ? `Periodic review overdue since ${x.nextReview}` : `Periodic review due on ${x.nextReview}` });
  // The daily registry check, when it is newer than the last read the app applied.
  const c = x.connector;
  if (c && typeof c === 'object' && read?.read_at && Number.isFinite(new Date(read.read_at).getTime()) && (!c.lastSync || new Date(read.read_at) > new Date(c.lastSync))) {
    if (read.error === 'auth') out.push({ for: 'client', kind: 'registry-auth', text: `The daily check could not sign in to the model registry for ${c.model}: the access token may have expired. Connect the model again on the AI card.` });
    const latest = read.result?.latest;
    if (latest != null && c.seenVersion != null && String(latest) !== String(c.seenVersion) && (+latest || 0) >= (+c.seenVersion || 0)) {
      const text = `New model version ${latest} found in the registry for ${c.model} (was ${c.seenVersion}). Open the product to review the change.`;
      out.push({ for: 'client', kind: 'new-version', text }, { for: 'team', kind: 'new-version', text });
    }
  }
  return out;
}

const EMAIL = /^[^\s@<>"']{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;
// One digest per person who has something to read: [{ to, name, role, products: [{ id, name, items: [text] }], count }].
export function buildDigests(products, people, { now = new Date(), settings = {}, reads = {} } = {}) {
  const per = (products || []).map((x) => ({ x, items: digestItems(x, { now, settings, read: reads[x?.id] || null }) })).filter((p) => p.items.length);
  const out = [];
  for (const u of people || []) {
    if (!u || u.status !== 'active' || !EMAIL.test(String(u.email || ''))) continue;
    const side = u.role === 'client' ? 'client' : ['assessor', 'lead'].includes(u.role) ? 'team' : null;
    if (!side) continue;
    const mine = per.filter((p) => (side === 'team' ? true : u.clientId && p.x.clientId === u.clientId))
      .map((p) => ({ id: p.x.id, name: String(p.x.name || 'Unnamed product'), items: p.items.filter((i) => i.for === side).map((i) => i.text) })).filter((p) => p.items.length);
    if (mine.length) out.push({ to: u.email, name: String(u.name || ''), role: u.role, products: mine.slice(0, 40), count: mine.reduce((a, p) => a + p.items.length, 0) });
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function renderDigest(d, { appUrl = '' } = {}) {
  const subject = `GovernAI: ${plural(d.count, 'item')} ${d.count === 1 ? 'needs' : 'need'} you`;
  const hello = `Hello${d.name ? ` ${d.name}` : ''},`;
  const text = [hello, '', ...d.products.flatMap((p) => [p.name, ...p.items.map((i) => `  - ${i}`), '']), appUrl ? `Open GovernAI: ${appUrl}` : '', '',
    'You receive this because you have an active GovernAI account. It is sent at most once a day, and only when something needs attention.'].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1b2333"><p>${esc(hello)}</p>${d.products.map((p) => `<p style="margin:14px 0 4px"><b>${esc(p.name)}</b></p><ul style="margin:0;padding-left:18px">${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}${appUrl ? `<p><a href="${esc(appUrl)}">Open GovernAI</a></p>` : ''}<p style="color:#667;font-size:12px">You receive this because you have an active GovernAI account. It is sent at most once a day, and only when something needs attention.</p></div>`;
  return { subject, text, html };
}
