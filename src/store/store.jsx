// App state kept in the browser (localStorage). Swap load/save for Supabase or an API later;
// the rest of the app only uses the functions exposed by useStore().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildSeed } from './seed.js';
import { cloud } from '../lib/cloud.js';
import { applyOps, diffState, isEmptyOps, loadAll, resetAll } from './sync.js';
import { requiredApprovals, nextStage, stageOf } from '../data/lifecycle.js';
import { TIERS, SELECTABLE_FRAMEWORKS } from '../data/frameworks.js';

const KEY = 'governai.v4';
const Ctx = createContext(null);

const SESSION = 'governai.session';
export const defaultSettings = () => ({ aiQuestions: true, enabledFrameworks: [...SELECTABLE_FRAMEWORKS], cutoffs: {} });
const freshState = (keep = {}) => ({
  ...buildSeed(), role: null, clientOrg: null, settings: defaultSettings(), bankOverrides: {}, ...keep,
});
const shell = () => ({ systems: [], audit: [], clients: [], users: [], role: null, clientOrg: null, settings: defaultSettings(), bankOverrides: {} });
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("The database didn't respond in time. It may be paused.")), ms))]);
const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION)) || {}; } catch { return {}; } };
const fromRemote = (base, r) => ({
  ...base, systems: r.systems, clients: r.clients, users: r.users, audit: r.audit,
  settings: { ...defaultSettings(), ...(r.settings || {}) }, bankOverrides: r.bankOverrides || {},
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.systems) && Array.isArray(s.clients)) return s;
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return freshState();
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Who may do what. The client does the lifecycle work; the governance team reviews.
export const CAN = {
  work: (role) => role === 'client',                       // checklist, evidence, submit, register, re-assess, data, actions
  review: (role) => role === 'assessor' || role === 'lead',
  override: (role) => role === 'lead',
  raiseEvent: (role) => role === 'client' || role === 'lead', // change, incident, retirement from production
  internal: (role) => role === 'assessor' || role === 'lead' || role === 'admin', // sees internal notes
};

export const newStage = () => ({ status: 'open', checklist: {}, evidence: {}, approvals: {}, note: '' });

// What stops the current stage from being submitted or approved.
export function stageBlockers(sys) {
  const st = stageOf(sys.stage);
  const rec = sys.stages?.[sys.stage] || newStage();
  if (sys.status === 'Blocked') return ['Prohibited practice: this product cannot proceed'];
  if (sys.status === 'Retired') return ['Retired'];
  const missing = st.checklist.filter((i) => !rec.checklist[i]);
  return missing.length ? [`${missing.length} checklist item${missing.length > 1 ? 's' : ''} still to confirm`] : [];
}

export function waitingOn(sys) {
  const rec = sys.stages?.[sys.stage];
  if (!rec || rec.status !== 'submitted') return [];
  return requiredApprovals(sys.stage, sys.assessment.results.tier).filter((r) => rec.approvals?.[r]?.outcome !== 'Approved' && rec.approvals?.[r]?.outcome !== 'Approved with conditions');
}

// Clients see only their organisation. Drafts are visible only to the client who owns them.
export function visibleSystems(state) {
  if (state.role === 'client') return state.systems.filter((s) => s.clientId === state.clientOrg);
  return state.systems.filter((s) => (s.status === 'Draft' ? s.createdBy !== 'client' : !!s.assessment));
}

function advanceFrom(x, n, conditions = '') {
  const tier = x.assessment.results.tier;
  const stages = { ...x.stages, [n]: { ...x.stages[n], status: 'approved', approvedAt: nowIso(), conditions } };
  if (n === 10) return { ...x, stages, status: 'Retired' };
  const to = nextStage(n);
  const out = { ...x, stages: { ...stages, [to]: to === n ? newStage() : (x.stages[to]?.status === 'approved' ? newStage() : x.stages[to] || newStage()) }, stage: to };
  if (n === 6 || n === 7 || n === 8 || n === 9) {
    out.status = 'In production';
    out.nextReview = new Date(Date.now() + TIERS[tier].review * 30 * 86400000).toISOString().slice(0, 10);
  }
  if (to === 7 && n !== 7) out.stages[7] = newStage();
  return out;
}

export function StoreProvider({ children }) {
  const [mode, setMode] = useState(cloud ? 'cloud' : 'local');
  const [boot, setBoot] = useState(cloud ? 'loading' : 'ready');
  const [bootError, setBootError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [state, setState] = useState(() => (cloud ? shell() : load()));
  const stateRef = useRef(state);
  stateRef.current = state;
  const savedRef = useRef(null);          // the last state the database is known to hold
  const queue = useRef(Promise.resolve());
  const lastFetch = useRef(0);
  const started = useRef(false);          // React dev mode runs effects twice; load and seed only once

  // ----- cloud: first load (seeds the sample data when the tables are empty) -----
  const start = useCallback(async () => {
    setBoot('loading'); setBootError('');
    try {
      const remote = await withTimeout(loadAll(cloud), 15000);
      let next;
      if (remote.empty) {
        next = { ...shell(), ...buildSeed() };
        await resetAll(cloud, next);
      } else {
        next = fromRemote(shell(), remote);
      }
      const sess = readSession();
      const valid = sess.role && (sess.role !== 'client' || next.clients.some((c) => c.id === sess.clientOrg));
      next = { ...next, role: valid ? sess.role : null, clientOrg: valid ? sess.clientOrg || null : null };
      savedRef.current = next; lastFetch.current = Date.now();
      setState(next); setBoot('ready');
    } catch (e) {
      setBootError(e.message || 'Could not reach the database'); setBoot('error');
    }
  }, []);
  useEffect(() => { if (mode === 'cloud' && !started.current) { started.current = true; start(); } }, [mode, start]);

  // ----- local mode: keep everything in this browser -----
  useEffect(() => { if (mode === 'local') save(state); }, [state, mode]);

  // ----- cloud: save whatever changed since the last successful save, one write at a time -----
  const flush = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const target = stateRef.current;
      if (!savedRef.current) return;
      const ops = diffState(savedRef.current, target);
      if (isEmptyOps(ops)) { savedRef.current = target; return; }
      try { await applyOps(cloud, ops); savedRef.current = target; setSyncError(''); }
      catch (e) { setSyncError(e.message || 'Could not save'); }
    });
    return queue.current;
  }, []);
  useEffect(() => { if (mode === 'cloud' && boot === 'ready' && savedRef.current && savedRef.current !== state) flush(); }, [state, mode, boot, flush]);
  useEffect(() => {
    if (mode === 'cloud' && boot === 'ready') { try { localStorage.setItem(SESSION, JSON.stringify({ role: state.role, clientOrg: state.clientOrg })); } catch { /* ignore */ } }
  }, [state.role, state.clientOrg, mode, boot]);

  // ----- cloud: pick up other people's changes when the tab regains focus (never over unsaved changes) -----
  useEffect(() => {
    if (mode !== 'cloud' || boot !== 'ready') return undefined;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFetch.current < 15000) return;
      lastFetch.current = Date.now();
      await queue.current;
      try {
        const remote = await loadAll(cloud);
        if (remote.empty || !savedRef.current) return;
        const cur = stateRef.current;
        if (!isEmptyOps(diffState(savedRef.current, cur))) return;
        const next = fromRemote(cur, remote);
        savedRef.current = next; setState(next);
      } catch { /* keep what is on screen */ }
    };
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [mode, boot]);

  const log = (s, action, target, detail) => ({
    ...s, audit: [{ at: nowIso(), actor: s.role, org: s.role === 'client' ? s.clientOrg : null, action, target, detail }, ...s.audit].slice(0, 800),
  });

  const updateSystem = useCallback((id, fn, action, detail) => {
    setState((s) => {
      const systems = s.systems.map((x) => (x.id === id ? fn(x, s) : x));
      return action ? log({ ...s, systems }, action, id, typeof detail === 'function' ? detail(s) : detail) : { ...s, systems };
    });
  }, []);

  const api = useMemo(() => {
    const systems = visibleSystems(state);
    const getSystem = (id) => systems.find((x) => x.id === id);
    const nextCode = (list) => `AI-${new Date().getFullYear()}-${String(list.length + 1).padStart(3, '0')}`;
    const blank = (s, id) => ({
      id, code: nextCode(s.systems), clientId: s.role === 'client' ? s.clientOrg : s.clients[0]?.id, createdAt: nowIso(), createdBy: s.role,
      stage: 1, stages: { 1: newStage() }, status: 'Draft', nextReview: null, actions: [], history: [], events: [], datasets: [], outputs: [], assessment: null,
    });
    return {
      state, systems, getSystem,
      role: state.role,
      clientOrg: state.clientOrg,
      client: state.clients.find((c) => c.id === state.clientOrg),
      setRole: (role, clientOrg = null) => setState((s) => ({ ...s, role, clientOrg: role === 'client' ? clientOrg || s.clients[0]?.id : null })),
      setSetting: (k, v) => setState((s) => log({ ...s, settings: { ...s.settings, [k]: v } }, 'Setting changed', null, `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)),
      resetDemo: async () => {
        const next = freshState({ role: state.role, clientOrg: state.role === 'client' ? state.clients[0]?.id || null : null });
        if (mode === 'cloud') {
          try { await queue.current; await resetAll(cloud, next); savedRef.current = next; setSyncError(''); }
          catch (e) { setSyncError(e.message || 'Could not reset'); return; }
        }
        setState(next);
      },
      sync: { mode, error: syncError, retry: flush },

      // ----- registration -----
      saveDraft: (id, draft, meta) => {
        if (!CAN.work(state.role)) return id;
        const newId = id || uid('sys');
        setState((s) => {
          const exists = s.systems.some((x) => x.id === newId);
          const base = exists ? s.systems.find((x) => x.id === newId) : blank(s, newId);
          const sys = { ...base, ...meta, draft, updatedAt: nowIso() };
          const list = exists ? s.systems.map((x) => (x.id === newId ? sys : x)) : [sys, ...s.systems];
          return log({ ...s, systems: list }, 'Draft saved', newId, meta.name || 'Untitled');
        });
        return newId;
      },
      deleteDraft: (id) => setState((s) => log({ ...s, systems: s.systems.filter((x) => !(x.id === id && x.status === 'Draft')) }, 'Draft deleted', id, '')),

      register: (id, meta, assessment, actions) => {
        if (!CAN.work(state.role)) return id;
        const newId = id || uid('sys');
        setState((s) => {
          const exists = s.systems.some((x) => x.id === newId);
          const prev = exists ? s.systems.find((x) => x.id === newId) : blank(s, newId);
          const r = assessment.results;
          const first = !prev.assessment;
          const keepDone = (prev.actions || []).filter((a) => a.status === 'Done');
          const stage1 = first ? { ...newStage(), checklist: { 'The use case is entered into the inventory.': true, 'Initial risk classification and review path are complete.': true } } : null;
          const sys = {
            ...prev, ...meta, draft: null, updatedAt: nowIso(), assessment,
            status: r.tier === 'unacceptable' ? 'Blocked' : first ? 'Active' : prev.status === 'Blocked' ? 'Active' : prev.status,
            stages: first ? { 1: stage1 } : prev.stages,
            actions: [...actions.filter((a) => !keepDone.some((k) => k.qid === a.qid)), ...keepDone],
            history: [...(prev.history || []), { at: nowIso(), tier: r.tier, inherent: r.inherent, residual: r.residual, readiness: r.readiness }],
          };
          const list = exists ? s.systems.map((x) => (x.id === newId ? sys : x)) : [sys, ...s.systems];
          return log({ ...s, systems: list }, first ? 'Registered' : 'Re-assessed', newId, `${meta.name}: ${TIERS[r.tier].label} risk, score ${r.residual}`);
        });
        return newId;
      },

      // ----- lifecycle -----
      toggleCheck: (id, n, item) => CAN.work(state.role) && updateSystem(id, (x) => {
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, checklist: { ...rec.checklist, [item]: !rec.checklist[item] } } } };
      }),
      checkAll: (id, n, items) => CAN.work(state.role) && updateSystem(id, (x) => {
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, checklist: Object.fromEntries(items.map((i) => [i, true])) } } };
      }),
      setEvidence: (id, n, item, value) => CAN.work(state.role) && updateSystem(id, (x) => {
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, evidence: { ...rec.evidence, [item]: value } } } };
      }),
      submitStage: (id, n, note) => CAN.work(state.role) && updateSystem(id, (x) => ({
        ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...x.stages[n], status: 'submitted', note, submittedAt: nowIso(), approvals: {}, returnNote: '', log: [...(x.stages[n]?.log || []), { at: nowIso(), who: 'client', outcome: 'Submitted', comment: note }] } },
      }), 'Stage submitted for review', (s) => `Stage ${n}: ${stageOf(n).name}`),
      reviewStage: (id, n, who, outcome, comment, internal = '') => CAN.review(state.role) && updateSystem(id, (x) => {
        const rec = x.stages[n];
        const need = requiredApprovals(n, x.assessment.results.tier);
        const role = who === 'lead' && !need.includes('lead') ? 'assessor' : who;   // the lead can sign in the reviewer's place
        const entry = { at: nowIso(), who: state.role, as: role, outcome, comment, internal };
        const log = [...(rec.log || []), entry];
        if (outcome === 'Returned') {
          return { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...rec, status: 'returned', returnNote: comment, log, approvals: { ...rec.approvals, [role]: { outcome, comment, internal, at: nowIso() } } } } };
        }
        const approvals = { ...rec.approvals, [role]: { outcome, comment, internal, at: nowIso() } };
        const withApproval = { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...rec, approvals, log } } };
        const done = need.every((r) => approvals[r] && approvals[r].outcome !== 'Returned');
        return done ? advanceFrom(withApproval, n, outcome === 'Approved with conditions' ? comment : '') : withApproval;
      }, `Stage ${outcome === 'Returned' ? 'returned' : 'approved'}`, `Stage ${n}${comment ? `: ${comment}` : ''}`),
      override: (id, n, reason) => CAN.override(state.role) && updateSystem(id, (x) => advanceFrom({
        ...x, stages: { ...x.stages, [n]: { ...(x.stages[n] || newStage()), log: [...(x.stages[n]?.log || []), { at: nowIso(), who: 'lead', outcome: 'Overridden', comment: reason }], approvals: { ...(x.stages[n]?.approvals || {}), lead: { outcome: 'Approved with conditions', comment: `Override: ${reason}`, at: nowIso() } } } },
      }, n, `Override: ${reason}`), 'Gate overridden', `Stage ${n}: ${reason}`),
      startEvent: (id, kind, text) => CAN.raiseEvent(state.role) && updateSystem(id, (x) => {
        const to = { change: 8, incident: 9, retire: 10 }[kind];
        return { ...x, stage: to, stages: { ...x.stages, [to]: newStage() }, events: [...(x.events || []), { at: nowIso(), kind, text }] };
      }, { change: 'Change raised', incident: 'Incident reported', retire: 'Retirement started' }[kind], text),

      // ----- actions and data -----
      updateAction: (id, actionId, patch) => CAN.work(state.role) && updateSystem(id, (x) => ({
        ...x, actions: x.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
      }), 'Action updated', Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')),
      saveData: (id, datasets, outputs) => CAN.work(state.role) && updateSystem(id, (x) => ({ ...x, datasets, outputs }), 'Data assets updated', `${datasets.length} datasets`),

      // ----- admin -----
      addClient: (c) => setState((s) => log({ ...s, clients: [...s.clients, { ...c, id: uid('cli') }] }, 'Client added', null, c.name)),
      addUser: (u) => setState((s) => log({ ...s, users: [...s.users, { ...u, id: uid('usr') }] }, 'User added', null, `${u.name} (${u.role})`)),
      removeUser: (userId) => setState((s) => log({ ...s, users: s.users.filter((u) => u.id !== userId) }, 'User removed', null, s.users.find((u) => u.id === userId)?.name || '')),
      setOverride: (qid, o) => setState((s) => log({ ...s, bankOverrides: { ...s.bankOverrides, [qid]: o } }, 'Question wording edited', null, qid)),
      clearOverride: (qid) => setState((s) => {
        const b = { ...s.bankOverrides }; delete b[qid];
        return log({ ...s, bankOverrides: b }, 'Question wording reset', null, qid);
      }),
    };
  }, [state, updateSystem, mode, syncError, flush]);

  if (boot !== 'ready') {
    return (
      <div className="boot" role="status">
        <div className="mark">G</div>
        {boot === 'loading' ? <p>Loading GovernAI…</p> : (
          <>
            <p><b>Couldn't reach the database.</b></p>
            <p className="small mute">{bootError}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={start}>Try again</button>
              <button className="btn" onClick={() => { setMode('local'); setState(load()); setBoot('ready'); }}>Use demo data in this browser</button>
            </div>
          </>
        )}
      </div>
    );
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
