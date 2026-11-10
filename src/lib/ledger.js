// Tamper-evident record (the "ledger") and signed evidence packs. Shared by the browser and the server function.
//
// The database writes one hash-chained ledger per AI product (supabase/migrations/007). Each row keeps the exact
// text that was hashed: hash = sha256(prev + "\n" + body). Anyone holding the rows can recompute every hash, so a
// changed, deleted or inserted entry shows. An evidence pack is a product snapshot plus its ledger, signed by the
// server with an Ed25519 key; the public key is in src/data/evidenceKey.js, so a pack can be checked offline.

export const GENESIS = '0'.repeat(64);
export const PACK_FORMAT = 'governai-evidence-pack/1';

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This browser cannot check signatures (Web Crypto is not available)');
  return s;
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256hex(text) { return hex(await subtle().digest('SHA-256', new TextEncoder().encode(text))); }

// JSON with object keys sorted, so the same data always gives the same text.
export function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

// Checks the chain itself. Returns { ok, count, head, problems: [{ seq, what }] }.
export async function verifyChain(rows) {
  const list = [...(rows || [])].sort((a, b) => a.seq - b.seq);
  const problems = [];
  let prev = GENESIS;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.seq !== i + 1) { problems.push({ seq: r.seq, what: i + 1 < r.seq ? `Entries ${i + 1} to ${r.seq - 1} are missing` : 'An entry number appears twice' }); break; }
    if (r.prev !== prev) problems.push({ seq: r.seq, what: 'Does not link to the entry before it' });
    if (await sha256hex(`${r.prev}\n${r.body}`) !== r.hash) problems.push({ seq: r.seq, what: 'Its content was changed after it was recorded' });
    const b = parse(r.body);
    if (!b || b.seq !== r.seq || (r.chain && b.chain !== r.chain) || (r.kind && b.kind !== r.kind)) problems.push({ seq: r.seq, what: 'Its details do not match what was hashed' });
    prev = r.hash;
  }
  const last = list[list.length - 1];
  return { ok: problems.length === 0, count: list.length, head: last ? { seq: last.seq, hash: last.hash, at: last.at } : null, problems };
}

export const entries = (rows) => [...(rows || [])].sort((a, b) => a.seq - b.seq).map((r) => ({ ...parse(r.body), hash: r.hash }));

// Compares the product as it is now with what the ledger recorded: every stage log entry on screen must have been
// recorded, and every recorded entry must still be there unless its removal was recorded too.
export function compareWithProduct(rows, product) {
  const live = new Map();   // stage -> Map(entryText -> count), as the ledger says it should be
  const bump = (st, txt, by) => {
    if (!live.has(st)) live.set(st, new Map());
    const m = live.get(st); m.set(txt, (m.get(txt) || 0) + by);
  };
  const removed = [];
  for (const e of entries(rows)) {
    if (e.kind === 'decision') bump(String(e.data?.stage), stable(e.data?.entry), 1);
    if (e.kind === 'decision-removed') { bump(String(e.data?.stage), stable(e.data?.entry), -1); removed.push(e); }
  }
  const unrecorded = []; const missing = [];
  const seenStages = new Set([...live.keys(), ...Object.keys(product?.stages || {}), ...(product?.rounds || []).map((rd) => String(rd.stage))]);
  for (const st of seenStages) {
    const want = new Map(live.get(st) || []);
    const archived = (product?.rounds || []).filter((rd) => String(rd.stage) === String(st)).flatMap((rd) => rd.record?.log || []);
    for (const entry of [...archived, ...(product?.stages?.[st]?.log || [])]) {
      const t = stable(entry);
      if ((want.get(t) || 0) > 0) want.set(t, want.get(t) - 1); else unrecorded.push({ stage: st, entry });
    }
    for (const [t, n] of want) for (let i = 0; i < n; i++) missing.push({ stage: st, entry: parse(t) });
  }
  return { ok: !unrecorded.length && !missing.length, unrecorded, missing, removed };
}

// Demo mode (no database): build the same kind of record in the browser from the product's own log, so the screens
// can be shown. It proves nothing on its own; the cloud database is what keeps the real one.
export async function localLedger(product) {
  const rows = []; let prev = GENESIS;
  const add = async (at, kind, data) => {
    const seq = rows.length + 1;
    const body = JSON.stringify({ chain: product.id, seq, at, kind, actor: 'demo', data });
    const hash = await sha256hex(`${prev}\n${body}`);
    rows.push({ chain: product.id, seq, at, kind, actor: 'demo', body, prev, hash }); prev = hash;
  };
  await add(product.createdAt || new Date(0).toISOString(), 'registered', { name: product.name, code: product.code, status: product.status, stage: product.stage });
  const all = [];
  for (const [st, rec] of Object.entries(product.stages || {})) for (const entry of rec.log || []) all.push({ st, entry });
  for (const rd of product.rounds || []) for (const entry of rd.record?.log || []) all.push({ st: String(rd.stage), entry });
  all.sort((a, b) => String(a.entry.at).localeCompare(String(b.entry.at)));
  for (const { st, entry } of all) await add(entry.at || '', 'decision', { stage: st, entry });
  return rows;
}

// What goes into a pack about the product: everything except file contents and secrets.
export function packSnapshot(p) {
  const strip = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !['data', 'url'].includes(k))) : v);
  const clean = (r) => ({ ...r, evidence: Object.fromEntries(Object.entries(r?.evidence || {}).map(([k, v]) => [k, strip(v)])) });
  const stages = Object.fromEntries(Object.entries(p.stages || {}).map(([n, r]) => [n, clean(r)]));
  const rounds = p.rounds ? p.rounds.map((rd) => ({ ...rd, record: clean(rd.record) })) : undefined;
  const card = p.card ? { ...p.card, versions: undefined } : undefined;
  const connector = p.connector ? { kind: p.connector.kind, host: p.connector.host, model: p.connector.model, versions: p.connector.versions, lastSync: p.connector.lastSync } : undefined;
  // Evidence attached to control answers: names and links stay, file contents do not.
  const assessment = p.assessment?.evidence ? { ...p.assessment, evidence: Object.fromEntries(Object.entries(p.assessment.evidence).map(([k, v]) => [k, strip(v)])) } : p.assessment;
  return { ...p, assessment, stages, rounds, card, connector };
}

// The text that is signed: the pack without its signature, keys sorted.
export const signingText = (pack) => stable({ ...pack, signature: undefined });

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Checks a pack: signature (with the published key), its own chain, and that the chain covers the snapshot.
export async function verifyPack(pack, publicKeyB64) {
  const out = { format: pack?.format === PACK_FORMAT, signature: 'missing', chain: null, matches: null };
  if (!out.format) return out;
  if (pack.signature?.value) {
    try {
      const key = await subtle().importKey('spki', b64(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
      const good = await subtle().verify({ name: 'Ed25519' }, key, b64(pack.signature.value), new TextEncoder().encode(signingText(pack)));
      out.signature = good ? 'valid' : 'invalid';
    } catch { out.signature = 'unsupported'; }
  }
  out.chain = await verifyChain(pack.record?.rows || []);
  if (out.chain.head && pack.record?.head && (out.chain.head.hash !== pack.record.head.hash || out.chain.head.seq !== pack.record.head.seq)) {
    out.chain.ok = false; out.chain.problems.push({ seq: pack.record.head.seq, what: 'The pack names a different last entry than its record holds' });
  }
  out.matches = compareWithProduct(pack.record?.rows || [], pack.product || {});
  return out;
}

// Does the live record still agree with a pack issued earlier? Every entry the pack holds must still be in the
// live record with the same fingerprint (newer entries are fine).
export function liveExtendsPack(liveRows, pack) {
  const mine = pack?.record?.rows || [];
  if (!mine.length) return { ok: false, newer: 0, changed: [] };
  const live = new Map((liveRows || []).map((r) => [r.seq, r.hash]));
  const changed = mine.filter((r) => live.get(r.seq) !== r.hash).map((r) => r.seq);
  const top = Math.max(...mine.map((r) => r.seq));
  return { ok: changed.length === 0, newer: (liveRows || []).filter((r) => r.seq > top).length, changed };
}

// Plain-language line for one ledger entry.
export function describe(e) {
  const d = e.data || {};
  switch (e.kind) {
    case 'registered': return `Registered as ${d.code || ''} ${d.name || ''}`.trim();
    case 'baseline': return 'Record started (earlier log entries copied from the product)';
    case 'status': return `Status ${d.from || 'none'} → ${d.to || 'none'}`;
    case 'stage': return `Moved from stage ${d.from} to stage ${d.to}`;
    case 'decision': return `Stage ${d.stage}: ${d.entry?.outcome || 'entry'}${d.entry?.who ? ` by ${d.entry.as || d.entry.who}` : ''}${d.entry?.comment ? ` · “${String(d.entry.comment).slice(0, 120)}”` : ''}${d.copied ? ' (copied)' : ''}`;
    case 'decision-removed': return `Stage ${d.stage}: an earlier “${d.entry?.outcome || 'entry'}” entry was edited or removed`;
    case 'audit': return `${d.action || 'Activity'}${d.by ? ` · ${d.by}` : ''}`;
    case 'deleted': return 'Product deleted';
    default: return e.kind;
  }
}
