// "Record" tab on a product and the public "Check an evidence pack" page.
// The database keeps a hash-chained record of every registration, submission, decision and edit (migration 007).
// This screen re-checks that chain in the browser and compares it with what the product shows now.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Fingerprint, Loader2, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { cloud } from '../lib/cloud.js';
import { callApi, downloadJson } from '../lib/api.js';
import { verifyChain, compareWithProduct, localLedger, entries, describe, verifyPack, liveExtendsPack, packSnapshot, PACK_FORMAT } from '../lib/ledger.js';
import { EVIDENCE_PUBLIC_KEY } from '../data/evidenceKey.js';
import { ROLES } from '../data/lifecycle.js';
import { Panel, Pill, fmtDate } from './ui.jsx';
import { toast } from './Extras.jsx';
import { useStore } from '../store/store.jsx';

const short = (h) => (h ? `${h.slice(0, 10)}…` : '—');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const who = (a) => ROLES[a]?.name || (a === 'system' ? 'System' : a === 'demo' ? 'Demo' : a || '—');
const meta = (e) => `${when(e.data?.entry?.at || e.at)}${e.data?.copied ? ' · copied when the record started' : e.actor === 'system' ? '' : ` · ${who(e.actor)}`}`;
const fileName = (s) => `evidence-pack-${(s.code || s.id).replace(/[^A-Za-z0-9-]/g, '')}-${new Date().toISOString().slice(0, 10)}.json`;

export async function loadLedger(s) {
  if (!cloud) return localLedger(s);
  const { data, error } = await cloud.from('v2_ledger').select('*').eq('chain', s.id).order('seq', { ascending: true }).limit(20000);
  if (error) throw new Error(error.message || 'Could not read the record');
  return data || [];
}

function Verdict({ ok, title, children }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className={`verdict ${ok ? 'ok' : 'bad'}`}>
      <Icon size={22} aria-hidden />
      <div><b>{title}</b>{children && <div className="small">{children}</div>}</div>
    </div>
  );
}

export function RecordTab({ s }) {
  const { sync, state, me, role } = useStore();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setErr('');
    try {
      if (cloud) await sync.retry?.();    // save first, so the record includes what is on screen
      const r = await loadLedger(s);
      const chain = await verifyChain(r);
      setRows(r); setCheck({ chain, cmp: compareWithProduct(r, s) });
    } catch (e) { setErr(e.message); }
  }, [s, sync]);
  useEffect(() => { const t = setTimeout(refresh, cloud ? 600 : 0); return () => clearTimeout(t); }, [refresh]);

  const pack = async () => {
    setBusy(true);
    try {
      let p;
      if (cloud) p = await callApi('/api/evidence', { productId: s.id });
      else {
        const r = await localLedger(s); const chain = await verifyChain(r); const cmp = compareWithProduct(r, s);
        const client = state.clients.find((c) => c.id === s.clientId);
        p = {
          format: PACK_FORMAT, issuedAt: new Date().toISOString(), issuedTo: { name: me?.name || ROLES[role]?.name, role },
          client: client ? { id: client.id, name: client.name } : null, product: packSnapshot(s),
          record: { count: r.length, head: chain.head, rows: r },
          checkedAtIssue: { chain: chain.ok, problems: chain.problems, matchesProduct: cmp.ok, unrecorded: cmp.unrecorded.length, missing: cmp.missing.length },
          signature: null, demo: true,
        };
      }
      downloadJson(p, fileName(s));
      toast(cloud ? 'Signed evidence pack downloaded' : 'Evidence pack downloaded (not signed in demo mode)');
    } catch (e) { toast(`Could not make the pack: ${e.message}`, 'warn'); }
    finally { setBusy(false); }
  };

  const list = rows ? entries(rows).reverse() : [];
  const c = check?.cmp;
  return (
    <div className="grid g2 record">
      <Panel title="Tamper-evident record" sub="The database adds an entry for every registration, submission, decision and edit. Each entry carries a fingerprint of itself and of the entry before it, so changing or removing any entry breaks the chain from that point on."
        right={<button className="btn ghost sm" onClick={refresh} aria-label="Check the record again"><RefreshCw size={14} /> Check again</button>}>
        {err && <p className="small bad-text" role="alert">{err}</p>}
        {!check && !err && <p className="small mute"><Loader2 size={14} className="spin" /> Checking the record…</p>}
        {check && (
          <>
            <Verdict ok={check.chain.ok} title={check.chain.ok ? 'Record intact' : 'Record broken'}>
              {check.chain.ok
                ? `${check.chain.count} entries, every fingerprint checked in your browser just now.`
                : check.chain.problems.slice(0, 3).map((p) => `Entry ${p.seq}: ${p.what}.`).join(' ')}
            </Verdict>
            <Verdict ok={c.ok} title={c.ok ? 'Matches the product' : 'Does not match the product'}>
              {c.ok ? 'Every submission and decision shown on this product was recorded, and nothing recorded is missing.'
                : `${c.unrecorded.length ? `${c.unrecorded.length} entr${c.unrecorded.length === 1 ? 'y' : 'ies'} on screen ${c.unrecorded.length === 1 ? 'was' : 'were'} never recorded. ` : ''}${c.missing.length ? `${c.missing.length} recorded entr${c.missing.length === 1 ? 'y is' : 'ies are'} missing from the product.` : ''}`}
            </Verdict>
            {c.removed.length > 0 && (
              <div className="verdict warn"><AlertTriangle size={20} aria-hidden /><div><b>{c.removed.length} earlier entr{c.removed.length === 1 ? 'y was' : 'ies were'} edited or removed</b>
                <div className="small">{c.removed.slice(0, 3).map((e) => `${when(e.at)} by ${who(e.actor)}: stage ${e.data?.stage} “${e.data?.entry?.outcome}”`).join('; ')}. The original wording stays in the record.</div></div></div>
            )}
            <dl className="kv small">
              <dt>Last entry</dt><dd>{check.chain.head ? `#${check.chain.head.seq}, ${when(check.chain.head.at)}` : '—'}</dd>
              <dt>Fingerprint</dt><dd className="mono" title={check.chain.head?.hash}>{short(check.chain.head?.hash)}</dd>
            </dl>
            {!cloud && <p className="xs mute">Demo mode: this record is built in your browser from the product's own log. Connected to the cloud database, the database keeps it and nobody can write to it directly.</p>}
          </>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={pack} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} {cloud ? 'Download signed evidence pack' : 'Download evidence pack'}</button>
          <a className="btn ghost" href="#verify"><FileCheck2 size={15} /> Check a pack</a>
        </div>
        <p className="xs mute" style={{ marginTop: 8 }}>The pack holds this product, its full record and a digital signature. Anyone can check it on the “Check an evidence pack” page, without an account, and it shows if a single character was changed after it was issued. Keep the pack as your receipt: if the record were ever rewritten later, it would no longer match the pack.</p>
      </Panel>
      <Panel title="Entries" sub="Newest first.">
        {!rows ? null : list.length === 0 ? <p className="small mute">No entries yet.</p> : (
          <ol className="ledger-list">
            {list.slice(0, 200).map((e) => (
              <li key={e.seq}>
                <span className="num mute xs">#{e.seq}</span>
                <div><div className="small">{describe(e)}</div><div className="xs mute">{meta(e)}</div></div>
                <span className="mono xs mute" title={e.hash}><Fingerprint size={12} aria-hidden /> {short(e.hash).slice(0, 8)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

// ---------- public check page ----------
export function VerifyPage({ onBack }) {
  const store = useStore();
  const [res, setRes] = useState(null);
  const [pack, setPack] = useState(null);
  const [err, setErr] = useState('');
  const [live, setLive] = useState(null);
  const [drag, setDrag] = useState(false);

  const read = async (file) => {
    setErr(''); setRes(null); setLive(null);
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setErr('That file is too large to be an evidence pack.'); return; }
    let p;
    try { p = JSON.parse(await file.text()); } catch { setErr('That file is not an evidence pack (it is not JSON).'); return; }
    if (p?.format !== PACK_FORMAT) { setErr('That file is not a GovernAI evidence pack.'); return; }
    setPack(p);
    const v = await verifyPack(p, EVIDENCE_PUBLIC_KEY);
    setRes(v);
    // Signed in and allowed to see this product? Compare with the live record too.
    if (cloud && store?.role && p.product?.id) {
      try {
        const { data } = await cloud.from('v2_ledger').select('seq,hash').eq('chain', p.product.id).order('seq');
        if (data?.length) setLive(liveExtendsPack(data, p));
      } catch { /* not visible to this person */ }
    }
  };

  const sig = res?.signature;
  return (
    <div className={`verify-page ${store?.role ? '' : 'standalone'}`}>
      {onBack && <button className="btn ghost back" onClick={onBack}>← {store?.role ? 'Back' : 'GovernAI'}</button>}
      <h1>Check an evidence pack</h1>
      <p className="mute">An evidence pack is the signed record of one AI product, downloaded from GovernAI. The check runs in this browser; the file is not uploaded anywhere.</p>
      <label className={`dropzone ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}>
        <Upload size={22} aria-hidden />
        <span><b>Choose an evidence pack</b> or drop it here</span>
        <input type="file" accept="application/json,.json" aria-label="Evidence pack file" onChange={(e) => read(e.target.files?.[0])} />
      </label>
      {err && <p className="bad-text" role="alert">{err}</p>}
      {res && pack && (
        <div className="panel fade-in" style={{ marginTop: 16 }}>
          <div className="panel-head"><div><h2>{pack.product?.name || 'Product'} <span className="mute small">{pack.product?.code}</span></h2>
            <p>{pack.client?.name ? `${pack.client.name} · ` : ''}Issued {when(pack.issuedAt)}{pack.issuedTo?.name ? ` to ${pack.issuedTo.name}` : ''}</p></div></div>
          <Verdict ok={sig === 'valid'} title={{ valid: 'Signature valid', invalid: 'Signature does not match', missing: 'Not signed', unsupported: 'This browser cannot check the signature' }[sig]}>
            {{ valid: 'The pack was issued by GovernAI and nothing in it has changed since.', invalid: 'The pack was changed after it was issued, or it was not issued by this GovernAI service.',
              missing: pack.demo ? 'Made in demo mode, where packs are not signed.' : 'The pack carries no signature.', unsupported: 'Use a current version of Chrome, Edge, Firefox or Safari.' }[sig]}
          </Verdict>
          <Verdict ok={res.chain.ok} title={res.chain.ok ? `Record intact (${res.chain.count} entries)` : 'Record broken'}>
            {res.chain.ok ? `Last entry #${res.chain.head?.seq}, ${when(res.chain.head?.at)}.` : res.chain.problems.slice(0, 3).map((p) => `Entry ${p.seq}: ${p.what}.`).join(' ')}
          </Verdict>
          <Verdict ok={res.matches.ok} title={res.matches.ok ? 'Record matches the product snapshot' : 'Record and snapshot disagree'}>
            {res.matches.ok ? 'Every submission and decision in the snapshot is in the record.' : `${res.matches.unrecorded.length} unrecorded, ${res.matches.missing.length} missing.`}
          </Verdict>
          {live && (
            <Verdict ok={live.ok} title={live.ok ? 'The live record still agrees with this pack' : 'The live record no longer agrees with this pack'}>
              {live.ok ? (live.newer ? `Nothing it holds was changed. ${live.newer} newer entr${live.newer === 1 ? 'y has' : 'ies have'} been added since it was issued.` : 'Nothing it holds was changed, and nothing has been added since it was issued.') : `Entr${live.changed.length === 1 ? 'y' : 'ies'} ${live.changed.slice(0, 5).join(', ')} ${live.changed.length === 1 ? 'is' : 'are'} different or missing in the live record. Raise this with the governance team.`}
            </Verdict>
          )}
          <h3 style={{ marginTop: 16 }}>What the pack records</h3>
          <ol className="ledger-list">
            {entries(pack.record?.rows || []).reverse().slice(0, 60).map((e) => (
              <li key={e.seq}><span className="num mute xs">#{e.seq}</span><div><div className="small">{describe(e)}</div><div className="xs mute">{meta(e)}</div></div><span /></li>
            ))}
          </ol>
          <p className="xs mute" style={{ marginTop: 10 }}><ShieldCheck size={12} aria-hidden /> Signature: Ed25519, key {pack.signature?.keyId || '—'}. Fingerprints: SHA-256.</p>
        </div>
      )}
    </div>
  );
}

