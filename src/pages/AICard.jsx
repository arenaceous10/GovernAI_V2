// AI cards: one page per AI use case, laid out like a business glossary term for a data asset:
// definition, attributes, accountable people, intended and prohibited use, limitations, metrics,
// related assets, certification and version history. Facts the app already holds (risk, stage,
// datasets, approvals) fill in automatically; the client writes the rest.
import { useMemo, useState } from 'react';
import { ArrowLeft, BadgeCheck, BookMarked, Boxes, Database, DownloadCloud, Pencil, Plus, Search, Tag, Trash2, Users } from 'lucide-react';
import { DOMAINS, SOURCING, TIERS, PRINCIPLES, PRINCIPLE_IDS, selectionLabel, systemTypeLabel } from '../data/frameworks.js';
import { geoName } from '../data/countries.js';
import { STAGES, ROLES } from '../data/lifecycle.js';
import { controlStatus } from '../data/controls.js';
import { Field, Panel, Pill, TierBadge, fmtDate } from '../components/ui.jsx';
import { fwName } from '../components/Results.jsx';
import { toast } from '../components/Extras.jsx';
import { useStore, CAN } from '../store/store.jsx';
import RegistryPanel, { GenAIPanel, MonitoringPanel } from '../components/Registry.jsx';

import { CARD_FIELDS, cardCompleteness, cardStatus } from '../data/card.js';
export { CARD_FIELDS, cardCompleteness, cardStatus };

const definitionOf = (s) => s.card?.summary || s.description;

export function CardRegistry({ nav }) {
  const { systems, state, role } = useStore();
  const [q, setQ] = useState(''); const [dom, setDom] = useState(''); const [st, setSt] = useState('');
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || '';
  const list = systems.filter((s) => s.assessment && s.status !== 'Draft');
  const rows = list.filter((s) => (!q || `${s.name} ${definitionOf(s)} ${(s.card?.tags || []).join(' ')} ${s.owner}`.toLowerCase().includes(q.toLowerCase()))
    && (!dom || s.assessment.profile.domain === dom) && (!st || cardStatus(s).label === st))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = rows.reduce((m, s) => { const L = s.name[0].toUpperCase(); (m[L] ||= []).push(s); return m; }, {});
  const avg = list.length ? Math.round(list.reduce((a, s) => a + cardCompleteness(s), 0) / list.length) : 0;
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>AI cards</h1><p>The register of AI use cases: one card per product with its definition, owners, intended use, limits and controls. Like a business glossary, but for AI.</p></div>
      </div>
      <div className="grid g4">
        <div className="stat"><div className="v num">{list.length}</div><div className="l">AI cards</div></div>
        <div className="stat"><div className="v num">{list.filter((s) => cardStatus(s).tone === 'good').length}</div><div className="l">Certified for production</div></div>
        <div className="stat"><div className="v num">{avg}%</div><div className="l">Average completeness</div></div>
        <div className="stat"><div className="v num">{list.filter((s) => cardCompleteness(s) < 50).length}</div><div className="l">Cards under half complete</div></div>
      </div>
      <Panel style={{ marginTop: 16 }}>
        <div className="grid g3" style={{ marginBottom: 14 }}>
          <label className="field"><span>Search</span><div className="search-wrap"><Search size={14} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, definition, tag or owner" /></div></label>
          <label className="field"><span>Business domain</span><select className="input" value={dom} onChange={(e) => setDom(e.target.value)}><option value="">All</option>{DOMAINS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          <label className="field"><span>Status</span><select className="input" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option>{['Certified for production', 'Under governance', 'Candidate', 'Blocked', 'Retired'].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        {rows.length === 0 && <div className="empty">No AI cards match.</div>}
        {Object.entries(groups).map(([L, xs]) => (
          <div key={L} className="glossary-group">
            <div className="glossary-letter">{L}</div>
            {xs.map((s) => {
              const cs = cardStatus(s); const pc = cardCompleteness(s);
              return (
                <button key={s.id} type="button" className="glossary-row" onClick={() => nav(`/card/${s.id}`)}>
                  <span className="gr-main">
                    <span className="row" style={{ gap: 8 }}><b>{s.name}</b><TierBadge tier={s.assessment.results.tier} /><Pill tone={cs.tone}>{cs.label}</Pill></span>
                    <span className="small mute gr-def">{definitionOf(s)}</span>
                    <span className="xs mute">{role !== 'client' ? `${cname(s.clientId)} · ` : ''}{selectionLabel(DOMAINS, s.assessment.profile.domain, s.assessment.profile.domainOther)} · Owner {s.owner || 'not set'}{(s.card?.tags || []).length ? ` · ${s.card.tags.map((t) => `#${t}`).join(' ')}` : ''}</span>
                  </span>
                  <span className="gr-meter" title={`${pc}% complete`}><span className="meter"><i style={{ width: `${pc}%`, background: pc >= 80 ? 'var(--good)' : pc >= 50 ? 'var(--ok)' : 'var(--warn)' }} /></span><span className="xs mute num">{pc}%</span></span>
                </button>
              );
            })}
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Attr({ label, children }) {
  return <div className="attr"><dt>{label}</dt><dd>{children || <span className="mute">Not documented</span>}</dd></div>;
}

// The registry version whose metrics describe the product: the one marked champion (or in Production), else the newest.
function registryVersion(c) {
  const vs = c?.versions || [];
  return vs.find((v) => (v.aliases || []).some((a) => /champion|prod/i.test(a)) || /production/i.test(v.stage || '')) || vs[0] || null;
}

export default function AICardPage({ id, nav }) {
  const { getSystem, systems, state, role, saveCard } = useStore();
  const s = getSystem(id);
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState({});
  const [tag, setTag] = useState('');
  const related = useMemo(() => {
    if (!s) return [];
    const mine = new Set((s.datasets || []).map((x) => `${x.name}|${x.sourceSystem}`.toLowerCase()));
    return systems.filter((o) => o.id !== s.id && o.assessment && o.status !== 'Draft').map((o) => {
      const shared = (o.datasets || []).filter((x) => mine.has(`${x.name}|${x.sourceSystem}`.toLowerCase())).map((x) => x.name);
      const sameDomain = o.assessment.profile.domain === s.assessment.profile.domain && o.clientId === s.clientId;
      return { o, shared, sameDomain };
    }).filter((r) => r.shared.length || r.sameDomain).sort((a, b) => b.shared.length - a.shared.length).slice(0, 6);
  }, [s, systems]);
  if (!s || !s.assessment) return <div className="panel empty">This AI card was not found. <button className="btn ghost" onClick={() => nav('/cards')}>Back to AI cards</button></div>;
  const c = s.card || {}; const a = s.assessment; const p = a.profile; const r = a.results;
  const cs = cardStatus(s); const pc = cardCompleteness(s);
  const canEdit = CAN.work(role) && s.status !== 'Retired';
  const client = state.clients.find((x) => x.id === s.clientId);
  const approvers = STAGES.flatMap((st) => Object.entries(s.stages?.[st.n]?.approvals || {}).filter(([, v]) => v.outcome !== 'Returned').map(([k, v]) => ({ k, at: v.at, n: st.n })));
  const lastApproval = approvers.sort((x, y) => String(y.at).localeCompare(String(x.at)))[0];
  const stewards = [...new Set((s.datasets || []).map((x) => x.steward).filter(Boolean))];
  const ctl = controlStatus(s, state.settings.checklistRules || {});
  const versions = [...(c.versions || [])].reverse();
  const start = () => { setD({ ...c, metrics: (c.metrics || []).map((m) => ({ ...m })), tags: [...(c.tags || [])] }); setEdit(true); };
  const save = () => { saveCard(s.id, d); setEdit(false); toast('AI card saved'); };
  // Fills only empty fields, from the registry: description, model name, the version in use and its owner.
  const fillFromRegistry = () => {
    const con = s.connector; const rv = registryVersion(con); const info = con?.info || {};
    const kind = con?.kind === 'databricks-uc' ? 'Databricks Unity Catalog' : 'MLflow';
    const offer = {
      summary: info.description,
      modelName: con?.model ? `${con.model} (${kind})` : '',
      modelVersion: rv ? `${rv.version}${rv.aliases?.length ? ` (${rv.aliases.join(', ')})` : ''}` : '',
      modelOwner: info.owner,
    };
    const patch = Object.fromEntries(Object.entries(offer).filter(([k, v]) => v && !String(c[k] || '').trim()));
    const names = Object.keys(patch).map((k) => CARD_FIELDS.find((x) => x.k === k)?.label.toLowerCase());
    if (!names.length) { toast('Nothing to fill: those fields already have content, or the registry has no value for them', 'warn'); return; }
    saveCard(s.id, { ...c, ...patch });
    toast(`Filled from the registry: ${names.join(', ')}`);
  };
  const f = (k) => (edit ? d[k] : c[k]);

  return (
    <div className="fade-in">
      <button className="btn ghost back" onClick={() => nav('/cards')}><ArrowLeft size={16} /> AI cards</button>
      <section className="product-hero card-hero">
        <div style={{ minWidth: 0 }}>
          <div className="row"><h1>{s.name}</h1><TierBadge tier={r.tier} /><Pill tone={cs.tone}>{cs.tone === 'good' && <BadgeCheck size={12} />} {cs.label}</Pill></div>
          <p className="card-def">{definitionOf(s)}</p>
          <div className="row xs mute" style={{ gap: 14 }}>
            <span>AI card {s.code}{role !== 'client' && client ? `, ${client.name}` : ''}</span><span>Version {c.version || 1}</span><span>Updated {fmtDate(c.updatedAt || s.updatedAt)}</span>
            {(f('tags') || []).map((t) => <span key={t} className="tag"><Tag size={10} /> {t}</span>)}
          </div>
        </div>
        <div className="card-meter">
          <div className="xs mute">Card completeness</div>
          <div className="cm-v num">{pc}%</div>
          <span className="meter" style={{ width: 140 }}><i style={{ width: `${pc}%`, background: pc >= 80 ? 'var(--good)' : pc >= 50 ? 'var(--ok)' : 'var(--warn)' }} /></span>
        </div>
        <div className="row" style={{ alignSelf: 'flex-start' }}>
          <button className="btn" onClick={() => nav(`/product/${s.id}`)}><Boxes size={15} /> Open lifecycle</button>
          {canEdit && !edit && s.connector?.versions?.length > 0 && <button className="btn" onClick={fillFromRegistry} title="Fill empty card fields from the connected model registry"><DownloadCloud size={15} /> Fill from registry</button>}
          {canEdit && !edit && <button className="btn primary" onClick={start}><Pencil size={15} /> Edit card</button>}
          {edit && <><button className="btn" onClick={() => setEdit(false)}>Cancel</button><button className="btn primary" onClick={save}>Save card</button></>}
        </div>
      </section>

      <div className="card-layout">
        <div className="stack">
          <Panel title="About this AI">
            {edit ? (
              <div className="stack">
                {CARD_FIELDS.filter((x) => x.rows).map((x) => (
                  <Field key={x.k} label={x.label} hint={x.hint}><textarea className="input" rows={x.rows} value={d[x.k] || ''} onChange={(e) => setD({ ...d, [x.k]: e.target.value })} /></Field>
                ))}
              </div>
            ) : (
              <dl className="card-sections">
                {CARD_FIELDS.filter((x) => x.rows && x.k !== 'summary').map((x) => (
                  <div key={x.k}><dt>{x.label}</dt><dd>{c[x.k] ? c[x.k] : <span className="mute">Not documented yet{canEdit ? '. Edit the card to add it.' : '.'}</span>}</dd></div>
                ))}
              </dl>
            )}
          </Panel>

          <Panel title="Performance and evaluation metrics" sub="The figures the owner stands behind, with the date they were measured.">
            {edit ? (
              <div className="stack">
                {(d.metrics || []).map((m, i) => (
                  <div key={i} className="grid g4" style={{ alignItems: 'end' }}>
                    <Field label="Metric"><input className="input" value={m.name} onChange={(e) => setD({ ...d, metrics: d.metrics.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)) })} placeholder="e.g. AUC" /></Field>
                    <Field label="Value"><input className="input" value={m.value} onChange={(e) => setD({ ...d, metrics: d.metrics.map((y, k) => (k === i ? { ...y, value: e.target.value } : y)) })} placeholder="e.g. 0.87" /></Field>
                    <Field label="Measured on"><input className="input" type="date" value={m.at || ''} onChange={(e) => setD({ ...d, metrics: d.metrics.map((y, k) => (k === i ? { ...y, at: e.target.value } : y)) })} /></Field>
                    <button type="button" className="btn ghost sm" aria-label="Remove metric" onClick={() => setD({ ...d, metrics: d.metrics.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
                  </div>
                ))}
                <div><button type="button" className="btn sm" onClick={() => setD({ ...d, metrics: [...(d.metrics || []), { name: '', value: '', at: '' }] })}><Plus size={14} /> Add metric</button></div>
              </div>
            ) : (() => {
              const own = (c.metrics || []).filter((m) => m.name);
              const rv = registryVersion(s.connector);
              const reg = rv?.metrics ? Object.entries(rv.metrics) : [];
              if (!own.length && !reg.length) return <p className="small mute">No metrics recorded yet. Add them here, or connect the model registry below to bring them in from the latest training run.</p>;
              return (
                <>
                  {own.length > 0 && <div className="metric-grid">{own.map((m, i) => <div key={i} className="metric"><span className="xs mute">{m.name}</span><b className="num">{m.value}</b>{m.at && <span className="xs mute">{fmtDate(m.at)}</span>}</div>)}</div>}
                  {reg.length > 0 && (
                    <>
                      <p className="xs mute" style={{ margin: own.length ? '14px 0 6px' : '0 0 6px' }}>
                        From {s.connector.kind === 'databricks-uc' ? 'Databricks Unity Catalog' : 'MLflow'}: version {rv.version}{rv.aliases?.length ? ` (${rv.aliases.join(', ')})` : ''}{rv.createdAt ? `, registered ${fmtDate(rv.createdAt)}` : ''}. Updated each time the registry is checked.
                      </p>
                      <div className="metric-grid">{reg.map(([k, v]) => <div key={k} className="metric"><span className="xs mute">{k}</span><b className="num">{Math.round(v * 10000) / 10000}</b></div>)}</div>
                    </>
                  )}
                </>
              );
            })()}
          </Panel>

          <RegistryPanel s={s} />
          <GenAIPanel s={s} />
          <MonitoringPanel s={s} />

          <Panel title="Responsible AI profile" sub="From the latest assessment">
            <div className="bars">
              {PRINCIPLE_IDS.map((k) => {
                const x = r.principles[k];
                return (
                  <div key={k} className="bar-row">
                    <span className="small">{PRINCIPLES[k].name}</span>
                    <span className="meter"><i style={{ width: `${x.readiness ?? 0}%`, background: (x.readiness ?? 0) >= 70 ? 'var(--good)' : (x.readiness ?? 0) >= 40 ? 'var(--warn)' : 'var(--bad)' }} /></span>
                    <span className="xs num mute">{x.readiness ?? '—'}% controls · risk {x.risk}</span>
                  </div>
                );
              })}
            </div>
            <ul className="list-plain small" style={{ marginTop: 10 }}>{r.reasons.slice(0, 4).map((x) => <li key={x}>{x}</li>)}</ul>
          </Panel>

          <Panel title="Version history" sub={s.connector?.versions?.length ? 'Edits to this card, and the model versions registered in the connected registry.' : undefined}>
            <h3 className="vh-h">Card edits</h3>
            {versions.length === 0 ? <p className="small mute">The card has not been edited yet.{s.connector?.versions?.length && canEdit ? ' Use "Fill from registry" to start it from the registry.' : ''}</p> : versions.map((v, i) => (
              <div key={i} className="small" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--line-2)' : 0 }}>
                <b style={{ fontWeight: 500 }}>Version {v.version}</b> <span className="mute num">{fmtDate(v.at)}</span> <span className="mute">by {v.byName || ROLES[v.by]?.name || v.by}</span>
                {v.changed?.length ? <div className="xs mute">Changed: {v.changed.map((k) => CARD_FIELDS.find((x) => x.k === k)?.label.toLowerCase() || k).join(', ')}</div> : null}
              </div>
            ))}
            {s.connector?.versions?.length > 0 && (
              <>
                <h3 className="vh-h" style={{ marginTop: 14 }}>Model versions ({s.connector.kind === 'databricks-uc' ? 'Databricks Unity Catalog' : 'MLflow'})</h3>
                {s.connector.versions.slice(0, 12).map((v, i) => (
                  <div key={v.version} className="small" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--line-2)' : 0 }}>
                    <b style={{ fontWeight: 500 }}>Model version {v.version}</b> <span className="mute num">{fmtDate(v.createdAt)}</span>
                    {v.aliases?.length ? <> <Pill tone="ok">{v.aliases.join(', ')}</Pill></> : null}
                    {v.description ? <div className="xs mute">{v.description}</div> : null}
                  </div>
                ))}
              </>
            )}
          </Panel>
        </div>

        <aside className="stack">
          <Panel title="Attributes">
            <dl className="attrs">
              <Attr label="Business domain">{selectionLabel(DOMAINS, p.domain, p.domainOther)}</Attr>
              <Attr label="Business unit">{s.bu}</Attr>
              <Attr label="Type of AI">{systemTypeLabel(p.systemType, p.systemTypeOther)}</Attr>
              <Attr label="Sourcing">{selectionLabel(SOURCING, p.sourcing, p.sourcingOther)}</Attr>
              {edit ? (
                <>{CARD_FIELDS.filter((x) => !x.rows).map((x) => <Field key={x.k} label={x.label} hint={x.hint}><input className="input" value={d[x.k] || ''} onChange={(e) => setD({ ...d, [x.k]: e.target.value })} /></Field>)}</>
              ) : (
                <><Attr label="Model or service">{c.modelName}</Attr><Attr label="Version in production">{c.modelVersion || (s.connector?.latest ? `${s.connector.latest} (latest in the registry)` : '')}</Attr></>
              )}
              <Attr label="Countries">{p.geos.map(geoName).join(', ')}</Attr>
              <Attr label="Frameworks">{a.frameworks.map(fwName).join(', ')}</Attr>
              <Attr label="Risk tier">{TIERS[r.tier].label} · score {r.residual}/100</Attr>
              <Attr label="Lifecycle stage">{s.stage}. {STAGES[s.stage - 1].name}</Attr>
              <Attr label="Next periodic review">{s.nextReview ? fmtDate(s.nextReview) : ''}</Attr>
            </dl>
            {edit && (
              <div style={{ marginTop: 10 }}>
                <Field label="Tags" hint="Synonyms and keywords people search for">
                  <div className="row">
                    <input className="input" style={{ flex: 1 }} value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tag.trim()) { e.preventDefault(); setD({ ...d, tags: [...new Set([...(d.tags || []), tag.trim().toLowerCase()])] }); setTag(''); } }} placeholder="Type and press Enter" />
                  </div>
                </Field>
                <div className="row" style={{ marginTop: 6 }}>{(d.tags || []).map((t) => <button type="button" key={t} className="tag" onClick={() => setD({ ...d, tags: d.tags.filter((x) => x !== t) })} title="Remove">#{t} ×</button>)}</div>
              </div>
            )}
          </Panel>

          <Panel title={<span className="row" style={{ gap: 6 }}><Users size={15} /> People</span>}>
            <dl className="attrs">
              <Attr label="Business owner">{s.owner}</Attr>
              <Attr label="Model owner">{edit ? null : c.modelOwner}</Attr>
              <Attr label="Data stewards">{stewards.join(', ')}</Attr>
              <Attr label="Organisation">{client?.name}</Attr>
              <Attr label="Last approval">{lastApproval ? `${ROLES[lastApproval.k]?.name}, stage ${lastApproval.n}, ${fmtDate(lastApproval.at)}` : ''}</Attr>
            </dl>
          </Panel>

          <Panel title="Controls">
            <div className="row" style={{ gap: 6 }}>
              {['Operating', 'In progress', 'Partial', 'Gap'].map((k) => { const n = ctl.filter((x) => x.status === k).length; return n ? <Pill key={k} tone={{ Operating: 'good', 'In progress': 'ok', Partial: 'warn', Gap: 'bad' }[k]}>{n} {k.toLowerCase()}</Pill> : null; })}
            </div>
            <p className="xs mute" style={{ marginTop: 6 }}>{s.actions.filter((x) => x.status !== 'Done').length} open actions. See the product's Actions tab.</p>
          </Panel>

          <Panel title={<span className="row" style={{ gap: 6 }}><Database size={15} /> Related data assets</span>}>
            {(s.datasets || []).length === 0 ? <p className="small mute">No datasets linked.</p> : s.datasets.map((x) => (
              <div key={x.id} className="rel-row"><b className="small" style={{ fontWeight: 500 }}>{x.name}</b><span className="xs mute">{x.role} · {x.sourceSystem} · {x.classification}{x.personal ? ' · personal data' : ''}</span></div>
            ))}
            {(s.outputs || []).length > 0 && <p className="xs mute" style={{ marginTop: 8 }}>Outputs go to: {s.outputs.join(', ')}</p>}
          </Panel>

          <Panel title="Related AI products">
            {related.length === 0 ? <p className="small mute">None share data or a domain with this product.</p> : related.map(({ o, shared }) => (
              <button key={o.id} type="button" className="rel-row link" onClick={() => nav(`/card/${o.id}`)}>
                <span className="row" style={{ gap: 6 }}><b className="small" style={{ fontWeight: 500 }}>{o.name}</b><TierBadge tier={o.assessment.results.tier} /></span>
                <span className="xs mute">{shared.length ? `Shares ${shared.join(', ')}` : 'Same business domain'}</span>
              </button>
            ))}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
