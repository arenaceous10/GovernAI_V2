// Notifications, quick search (Ctrl/Cmd+K), toasts and the regulatory deadline radar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CalendarClock, CheckCircle2, CornerDownLeft, Hourglass, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { STAGES } from '../data/lifecycle.js';
import { FRAMEWORKS } from '../data/frameworks.js';
import { deadlineRadar, deadlinesFor, urgency } from '../data/deadlines.js';
import { fmtDate, TierBadge } from './ui.jsx';
import { useStore, waitingOn } from '../store/store.jsx';
import { reviewTimers, DEFAULT_SLA } from '../engine/ops.js';

// ---------- toasts ----------
export const toast = (text, tone = 'good') => window.dispatchEvent(new CustomEvent('gov-toast', { detail: { text, tone, id: Math.random() } }));
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const t = e.detail; setItems((x) => [...x.slice(-2), t]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), 3600);
    };
    window.addEventListener('gov-toast', on);
    return () => window.removeEventListener('gov-toast', on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.tone === 'warn' ? <CornerDownLeft size={16} /> : <CheckCircle2 size={16} />}<span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------- notifications: what the other side did on your products ----------
const seenKey = (me, role) => `governai.seen.${me?.id || role}`;
export function useNotifications() {
  const { systems, withdrawn: withdrawnList, role, me, state } = useStore();
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(seenKey(me, role)) || ''; } catch { return ''; } });
  useEffect(() => { try { setSeen(localStorage.getItem(seenKey(me, role)) || ''); } catch { /* ignore */ } }, [me, role]);
  const items = useMemo(() => {
    const out = [];
    for (const s of systems) {
      for (const [n, rec] of Object.entries(s.stages || {})) {
        for (const e of rec.log || []) {
          const mine = role === 'client' ? e.who !== 'client' : (role === 'assessor' || role === 'lead') && e.outcome === 'Submitted';
          if (mine) out.push({ at: e.at, s, n: +n, outcome: e.outcome, comment: e.comment });
        }
      }
    }
    if (role === 'admin') {
      for (const u of state.users || []) if (u.status === 'pending') out.push({ at: u.createdAt || '', person: u, outcome: 'Waiting for approval' });
    }
    // Withdrawal requests for those who decide them; decisions for the client.
    for (const sy of [...systems, ...(withdrawnList || [])]) {
      const w = sy.withdrawal;
      if (!w) continue;
      if (w.status === 'requested' && (role === 'lead' || role === 'admin')) out.push({ at: w.at, s: sy, withdraw: 'requested', comment: `${w.category}: ${w.reason}`, sticky: true });
      if (['approved', 'rejected'].includes(w.status) && role === 'client') out.push({ at: w.decidedAt, s: sy, withdraw: w.status, comment: w.comment });
    }
    // Reviews past the service level, for the people who can act on them. Shown as unread until decided.
    if (role === 'assessor' || role === 'lead' || role === 'admin') {
      const sla = Number(state.settings?.reviewSlaDays) || DEFAULT_SLA;
      for (const t of reviewTimers(systems, { sla, waitingOn })) {
        if (t.state === 'over' && (role === 'admin' || t.waiting.includes(role) || (role === 'lead' && t.waiting.includes('assessor')))) {
          out.push({ at: t.at, s: t.s, n: t.n, outcome: 'Overdue', comment: `${t.days} working days waiting, target ${sla}`, sticky: true });
        }
      }
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30);
  }, [systems, withdrawnList, role, state.users, state.settings]);
  const unread = items.filter((i) => (i.person || i.sticky ? true : String(i.at) > seen)).length;
  const markRead = () => { const now = new Date().toISOString(); try { localStorage.setItem(seenKey(me, role), now); } catch { /* ignore */ } setSeen(now); };
  return { items, unread, seen, markRead };
}

const ICON = { Submitted: Hourglass, Returned: CornerDownLeft, Overridden: ShieldAlert, Overdue: CalendarClock };
export function Notifications({ nav }) {
  const { items, unread, seen, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="notif" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={17} />{unread > 0 && <span className="dot-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head"><b>Notifications</b>{items.length > 0 && <button type="button" className="btn ghost sm" onClick={markRead}>Mark all read</button>}</div>
          {items.length === 0 ? <div className="notif-empty">Nothing yet. Decisions and submissions on your products appear here.</div> : (
            <ul>
              {items.map((i, k) => {
                const Icon = i.withdraw ? Trash2 : ICON[i.outcome] || CheckCircle2;
                const fresh = i.person || i.sticky || String(i.at) > seen;
                return (
                  <li key={k}>
                    <button type="button" className={fresh ? 'fresh' : ''} onClick={() => { setOpen(false); nav(i.person ? '/admin' : `/product/${i.s.id}`); }}>
                      <span className={`ni ni-${i.withdraw === 'requested' ? 'warn' : i.withdraw === 'rejected' ? 'info' : i.outcome === 'Overdue' ? 'bad' : i.outcome === 'Returned' ? 'warn' : i.outcome === 'Submitted' || i.person ? 'info' : 'good'}`}><Icon size={14} /></span>
                      <span className="nt">
                        <span>{i.person ? <><b>{i.person.name}</b> is waiting for approval</> : i.withdraw ? <><b>{i.s.name}</b>: {{ requested: 'withdrawal requested', approved: 'withdrawn', rejected: 'withdrawal refused' }[i.withdraw]}</> : <><b>{i.s.name}</b>: stage {i.n} {i.outcome === 'Overdue' ? 'review overdue' : i.outcome.toLowerCase()}</>}</span>
                        {i.comment && <span className="xs mute nc">{i.comment}</span>}
                        <span className="xs mute">{i.person ? i.person.email : i.withdraw ? fmtDate(i.at) : `${STAGES[i.n - 1]?.short} · ${fmtDate(i.at)}`}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- quick search ----------
export function QuickSearch({ nav, pages }) {
  const { systems, state, role } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    const on = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || '';
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pg = pages.filter((p) => !t || p.label.toLowerCase().includes(t)).map((p) => ({ kind: 'page', label: p.label, to: p.to, icon: p.icon }));
    const pr = systems.filter((s) => s.assessment && s.status !== 'Draft')
      .filter((s) => !t || `${s.name} ${s.code} ${s.owner || ''} ${role !== 'client' ? cname(s.clientId) : ''}`.toLowerCase().includes(t))
      .slice(0, 8).map((s) => ({ kind: 'product', label: s.name, sub: `${role !== 'client' ? `${cname(s.clientId)} · ` : ''}${s.code} · stage ${s.stage}`, to: `/product/${s.id}`, s }));
    return [...pr, ...pg].slice(0, 12);
  }, [q, systems, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (r) => { if (!r) return; setOpen(false); nav(r.to); };
  return (
    <>
      <button type="button" className="search-btn" onClick={() => setOpen(true)} aria-label="Search (Ctrl K)"><Search size={15} /><span>Search</span><kbd>Ctrl K</kbd></button>
      {open && (
        <div className="palette-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="palette" role="dialog" aria-label="Search">
            <div className="palette-in"><Search size={17} />
              <input ref={input} value={q} placeholder="Search products and pages" aria-label="Search products and pages"
                onChange={(e) => { setQ(e.target.value); setI(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, results.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
                  if (e.key === 'Enter') { e.preventDefault(); go(results[i]); }
                  if (e.key === 'Escape') setOpen(false);
                }} />
              <kbd>Esc</kbd>
            </div>
            <ul className="palette-list" role="listbox">
              {results.length === 0 && <li className="palette-empty">No matches.</li>}
              {results.map((r, k) => (
                <li key={`${r.kind}-${r.to}`} role="option" aria-selected={k === i}>
                  <button type="button" className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => go(r)}>
                    {r.kind === 'page' ? <r.icon size={15} /> : <span className="stage-chip sm">{r.s.stage}</span>}
                    <span className="pl-main"><b>{r.label}</b>{r.sub && <span className="xs mute">{r.sub}</span>}</span>
                    {r.kind === 'product' ? <TierBadge tier={r.s.assessment.results.tier} /> : <span className="xs mute">Page</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- deadline radar ----------
const fmtD = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const label = (days) => (days < 0 ? `${-days} days ago` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`);

export function DeadlineRadar({ systems, nav, limit = 5 }) {
  const items = deadlineRadar(systems).slice(0, limit);
  if (!items.length) return <div className="empty-sm"><CalendarClock size={20} /> No regulatory deadlines ahead for these products.</div>;
  return (
    <ol className="radar">
      {items.map((d, k) => (
        <li key={d.id} className={`rd rd-${urgency(d.days)}`} style={{ animationDelay: `${Math.min(k, 10) * 60}ms` }}>
          <div className="rd-when"><b className="num">{label(d.days)}</b><span className="xs">{fmtD(d.date)}</span></div>
          <div className="rd-main">
            <div className="small"><b>{d.title}</b></div>
            <div className="xs mute">{d.what}</div>
            <div className="rd-products">
              {d.products.slice(0, 4).map((s) => <button key={s.id} type="button" className="chip-link" onClick={() => nav(`/product/${s.id}`)}>{s.name}</button>)}
              {d.products.length > 4 && <span className="xs mute">+{d.products.length - 4} more</span>}
            </div>
          </div>
          <span className="rd-fw" style={{ color: FRAMEWORKS[d.fw]?.color }}>{FRAMEWORKS[d.fw]?.name}</span>
        </li>
      ))}
    </ol>
  );
}

export function ProductDeadlines({ s }) {
  const items = deadlinesFor(s);
  if (!items.length) return null;
  const next = items.find((d) => d.days >= 0) || items[0];
  return (
    <span className={`deadline-chip rd-${urgency(next.days)}`} title={`${next.title}: ${fmtD(next.date)}`}>
      <CalendarClock size={13} /> {next.days >= 0 ? `${label(next.days)} to ${next.title.replace(/^EU AI Act |^DPDP /, '')}` : `${next.title}: in force`}
    </span>
  );
}
