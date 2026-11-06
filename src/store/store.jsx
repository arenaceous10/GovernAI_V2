// App state kept in the browser (localStorage). Swap load/save for Supabase or an API later;
// the rest of the app only uses the functions exposed by useStore().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildSeed } from './seed.js';
import { cloud } from '../lib/cloud.js';
import { applyOps, diffState, isEmptyOps, loadAll, resetDemo, T, profileFromRow } from './sync.js';
import { AuthScreen, PendingScreen } from '../pages/Auth.jsx';
import { removeEvidence } from '../lib/files.js';
import { requiredApprovals, nextStage, stageOf } from '../data/lifecycle.js';
import { TIERS, SELECTABLE_FRAMEWORKS } from '../data/frameworks.js';
import { controlFor, controlById, isMandatory, itemState, validReason, SKIP_REASONS } from '../data/controls.js';

const KEY = 'governai.v4';
const Ctx = createContext(null);

export const defaultSettings = () => ({ aiQuestions: true, enabledFrameworks: [...SELECTABLE_FRAMEWORKS], cutoffs: {} });
const freshState = (keep = {}) => ({
  ...buildSeed(), role: null, clientOrg: null, settings: defaultSettings(), bankOverrides: {}, ...keep,
});
const shell = () => ({ systems: [], audit: [], clients: [], users: [], notes: [], role: null, clientOrg: null, me: null, settings: defaultSettings(), bankOverrides: {} });
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("The database didn't respond in time. It may be paused.")), ms))]);
const fromRemote = (base, r) => ({
  ...base, systems: r.systems, clients: r.clients, users: r.users, audit: r.audit, notes: r.notes || [],
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

// The current stage, still with the client (not submitted, approved, retired or blocked).
const workable = (x, n) => n === x.stage && !['Retired', 'Blocked', 'Draft'].includes(x.status) && ['open', 'returned'].includes(x.stages?.[n]?.status || 'open');

export const newStage = () => ({ status: 'open', checklist: {}, evidence: {}, approvals: {}, note: '' });

// What stops the current stage from being submitted or approved.
// Mandatory items must be ticked. Other items must be ticked or skipped with a valid reason.
export function stageBlockers(sys, rules = {}) {
  const st = stageOf(sys.stage);
  const rec = sys.stages?.[sys.stage] || newStage();
  if (sys.status === 'Blocked') return ['Prohibited practice: this product cannot proceed'];
  if (sys.status === 'Retired') return ['Retired'];
  const tier = sys.assessment?.results?.tier;
  const open = st.checklist.filter((i) => itemState(rec, i) === 'open');
  const mand = open.filter((i) => isMandatory(i, tier, rules));
  const opt = open.length - mand.length;
  const out = [];
  if (mand.length) out.push(`${mand.length} mandatory check${mand.length > 1 ? 's' : ''} still to tick`);
  if (opt) out.push(`${opt} optional check${opt > 1 ? 's' : ''} to tick or skip with a reason`);
  return out;
}

// Open actions created by skipping a check go away when the check is ticked or un-skipped.
const dropSkipAction = (actions, n, item) => (actions || []).filter((a) => !(a.source === 'checklist' && a.stage === n && a.item === item && a.status === 'Open'));

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
  const [mode] = useState(cloud ? 'cloud' : 'local');
  const [boot, setBoot] = useState(cloud ? 'loading' : 'ready');
  const [bootError, setBootError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [state, setState] = useState(() => (cloud ? shell() : load()));
  // cloud only: 'checking' | 'signedout' | 'pending' | 'in'
  const [auth, setAuth] = useState({ phase: cloud ? 'checking' : 'none', profile: null, recovery: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  const savedRef = useRef(null);          // the last state the database is known to hold
  const queue = useRef(Promise.resolve());
  const lastFetch = useRef(0);
  const userRef = useRef(null);           // signed-in user id, so repeated auth events do not reload
  const recheck = useRef(null);           // re-reads the signed-in user's access

  // ----- cloud: load what this signed-in user may see (row-level security filters it) -----
  const start = useCallback(async (profile) => {
    setBoot('loading'); setBootError(''); setSyncError('');
    try {
      const remote = await withTimeout(loadAll(cloud), 15000);
      let next = fromRemote(shell(), remote);
      if (remote.empty && profile.role === 'admin') {
        const seed = { ...shell(), ...buildSeed() };
        await resetDemo(cloud, seed);
        next = fromRemote(shell(), await loadAll(cloud));
      }
      next = { ...next, role: profile.role, clientOrg: profile.role === 'client' ? profile.clientId || null : null, me: { id: profile.id, name: profile.name, email: profile.email } };
      savedRef.current = next; lastFetch.current = Date.now();
      setState(next); setBoot('ready');
    } catch (e) {
      setBootError(e.message || 'Could not reach the database'); setBoot('error');
    }
  }, []);

  const onSession = useCallback(async (session) => {
    if (!session) {
      userRef.current = null; savedRef.current = null;
      setState(shell()); setBoot('loading'); setAuth((a) => ({ ...a, phase: 'signedout', profile: null }));
      return;
    }
    if (userRef.current === session.user.id) return;
    userRef.current = session.user.id;
    setAuth((a) => ({ ...a, phase: 'checking' }));
    const { data, error } = await cloud.from(T.profiles).select('*').eq('id', session.user.id).maybeSingle();
    const profile = data ? profileFromRow(data) : null;
    if (error || !profile || profile.status !== 'active' || !profile.role || (profile.role === 'client' && !profile.clientId)) {
      setAuth((a) => ({ ...a, phase: 'pending', profile: profile || { email: session.user.email, status: error ? 'error' : 'missing' } }));
      return;
    }
    setAuth((a) => ({ ...a, phase: 'in', profile }));
    start(profile);
  }, [start]);

  // Re-read access for the signed-in user (after a refused save, or "Check again" on the waiting screen).
  recheck.current = async () => {
    const { data: sess } = await cloud.auth.getSession();
    if (!sess?.session) return;
    const { data } = await cloud.from(T.profiles).select('*').eq('id', sess.session.user.id).maybeSingle();
    const profile = data ? profileFromRow(data) : null;
    const ok = profile && profile.status === 'active' && profile.role && (profile.role !== 'client' || profile.clientId);
    const same = ok && auth.profile && profile.role === auth.profile.role && profile.clientId === auth.profile.clientId && auth.phase === 'in';
    if (same) return;
    userRef.current = null; savedRef.current = null;
    onSession(sess.session);
  };

  useEffect(() => {
    if (!cloud) return undefined;
    // Supabase advises not to await its own calls inside this callback, so work is deferred.
    const { data } = cloud.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setAuth((a) => ({ ...a, recovery: true }));
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) setTimeout(() => onSession(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [onSession]);

  // ----- local mode: keep everything in this browser -----
  useEffect(() => { if (mode === 'local') save(state); }, [state, mode]);

  // ----- cloud: save whatever changed since the last successful save, one write at a time -----
  const flush = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const target = stateRef.current;
      if (!savedRef.current) return;
      const ops = diffState(savedRef.current, target, { users: false });
      if (isEmptyOps(ops)) { savedRef.current = target; return; }
      try { await applyOps(cloud, ops); savedRef.current = target; setSyncError(''); }
      catch (e) {
        setSyncError(e.message || 'Could not save');
        // Refused by the database: access may have been changed or turned off since sign-in.
        if (/row-level security|permission denied|42501|JWT/i.test(e.message || '')) recheck.current?.();
      }
    });
    return queue.current;
  }, []);
  useEffect(() => { if (mode === 'cloud' && boot === 'ready' && savedRef.current && savedRef.current !== state) flush(); }, [state, mode, boot, flush]);

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
        if (!isEmptyOps(diffState(savedRef.current, cur, { users: false }))) return;
        const next = fromRemote(cur, remote);
        savedRef.current = next; setState(next);
      } catch { /* keep what is on screen */ }
    };
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [mode, boot]);

  const log = (s, action, target, detail) => ({
    ...s, audit: [{ at: nowIso(), actor: s.role, actorName: s.me?.name, org: s.role === 'client' ? s.clientOrg : null, action, target, detail }, ...s.audit].slice(0, 800),
  });

  const updateSystem = useCallback((id, fn, action, detail) => {
    setState((s) => {
      let changed = false;
      const systems = s.systems.map((x) => { if (x.id !== id) return x; const y = fn(x, s); if (y !== x) changed = true; return y; });
      if (!changed) return s;   // a guarded no-op (double click, stale screen) changes nothing and logs nothing
      return action ? log({ ...s, systems }, action, id, typeof detail === 'function' ? detail(s) : detail) : { ...s, systems };
    });
  }, []);

  const api = useMemo(() => {
    const systems = visibleSystems(state);
    const getSystem = (id) => systems.find((x) => x.id === id);
    // Clients only see their own products, so a running number would clash across organisations.
    const nextCode = (list) => {
      const taken = new Set(list.map((x) => x.code));
      for (;;) {
        const c = `AI-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        if (!taken.has(c)) return c;
      }
    };
    const blank = (s, id) => ({
      id, code: nextCode(s.systems), clientId: s.role === 'client' ? s.clientOrg : s.clients[0]?.id, createdAt: nowIso(), createdBy: s.role,
      stage: 1, stages: { 1: newStage() }, status: 'Draft', nextReview: null, actions: [], history: [], events: [], datasets: [], outputs: [], assessment: null,
    });
    return {
      state, systems, getSystem,
      role: state.role,
      clientOrg: state.clientOrg,
      client: state.clients.find((c) => c.id === state.clientOrg),
      me: state.me,
      // Demo mode only. Signed-in users get their role from their profile and cannot change it.
      setRole: (role, clientOrg = null) => mode === 'local' && setState((s) => ({ ...s, role, clientOrg: role === 'client' ? clientOrg || s.clients[0]?.id : null })),
      signOut: async () => { if (mode === 'cloud') { await queue.current; await cloud.auth.signOut(); } else setState((s) => ({ ...s, role: null, clientOrg: null })); },
      // Administrator: approve people, set their role and organisation.
      updatePerson: async (id, patch) => {
        if (mode !== 'cloud' || state.role !== 'admin') return 'Not allowed';
        const row = {};
        if ('role' in patch) row.role = patch.role;
        if ('status' in patch) row.status = patch.status;
        if ('clientId' in patch) row.client_id = patch.clientId || null;
        row.updated_at = nowIso();
        const { error } = await cloud.from(T.profiles).update(row).eq('id', id);
        if (error) return error.message;
        const { data } = await cloud.from(T.profiles).select('*').order('created_at', { ascending: true });
        const users = (data || []).map(profileFromRow);
        const who = users.find((u) => u.id === id);
        setState((s) => log({ ...s, users }, 'Access changed', null, `${who?.name || id}: ${Object.entries(patch).map(([k, v]) => `${k} ${v}`).join(', ')}`));
        if (savedRef.current) savedRef.current = { ...savedRef.current, users };
        return '';
      },
      setSetting: (k, v) => setState((s) => log({ ...s, settings: { ...s.settings, [k]: v } }, 'Setting changed', null, `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)),
      resetDemo: async () => {
        if (mode === 'cloud') {
          if (state.role !== 'admin') return;
          try {
            await queue.current;
            await resetDemo(cloud, { ...shell(), ...buildSeed(), settings: state.settings, bankOverrides: state.bankOverrides });
            const next = { ...fromRemote(stateRef.current, await loadAll(cloud)) };
            savedRef.current = next; setState(next); setSyncError('');
          } catch (e) { setSyncError(e.message || 'Could not reset'); }
          return;
        }
        setState(freshState({ role: state.role, clientOrg: state.role === 'client' ? state.clients[0]?.id || null : null }));
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
        if (!workable(x, n)) return x;
        const rec = x.stages[n] || newStage();
        const skipped = { ...(rec.skipped || {}) }; delete skipped[item];
        return { ...x, actions: dropSkipAction(x.actions, n, item), stages: { ...x.stages, [n]: { ...rec, skipped, checklist: { ...rec.checklist, [item]: !rec.checklist[item] } } } };
      }),
      // Skip an optional check with a reason. Reasons that need follow-up become actions linked to the control.
      skipCheck: (id, n, item, { category, reason, due }) => {
        if (!CAN.work(state.role)) return 'Only the client can skip checks';
        const x = state.systems.find((y) => y.id === id);
        if (!x || !workable(x, n)) return 'This stage cannot be changed now';
        if (isMandatory(item, x.assessment?.results?.tier, state.settings.checklistRules)) return 'This check is mandatory and cannot be skipped';
        const why = SKIP_REASONS.find((r) => r.id === category);
        if (!why) return 'Choose why it is skipped';
        const bad = validReason(reason); if (bad) return bad;
        if (why.needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(due || '')) return 'Choose the date it will be done';
        if (why.needsDate && due < new Date().toISOString().slice(0, 10)) return 'The date must be today or later';
        const c = controlFor(item);
        updateSystem(id, (y) => {
          if (!workable(y, n)) return y;
          const rec = y.stages[n] || newStage();
          const checklist = { ...rec.checklist }; delete checklist[item];
          const act = why.action ? [{
            id: uid('act'), qid: `check:${n}:${c.id}`, source: 'checklist', stage: n, item, control: c.id, topic: c.name,
            action: `${why.id === 'planned' ? 'Complete' : 'Review the accepted risk for'}: ${item.replace(/\.$/, '')}. Reason given: ${reason.trim()}`,
            principle: 'accountability', refs: `Control ${c.id}, stage ${n}`, priority: why.id === 'accepted' ? 'High' : 'Medium',
            due: due || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), status: 'Open', owner: '',
          }] : [];
          return {
            ...y, actions: [...dropSkipAction(y.actions, n, item), ...act],
            stages: { ...y.stages, [n]: { ...rec, checklist, skipped: { ...(rec.skipped || {}), [item]: { category, reason: reason.trim(), due: due || null, at: nowIso(), control: c.id } } } },
          };
        }, 'Check skipped', `Stage ${n}: ${item} (${why.label}: ${reason.trim()})`);
        return '';
      },
      unskipCheck: (id, n, item) => CAN.work(state.role) && updateSystem(id, (x) => {
        if (!workable(x, n)) return x;
        const rec = x.stages[n] || newStage();
        const skipped = { ...(rec.skipped || {}) }; delete skipped[item];
        return { ...x, actions: dropSkipAction(x.actions, n, item), stages: { ...x.stages, [n]: { ...rec, skipped } } };
      }),
      // Ticks every item that is not skipped; skipped items keep their reason.
      checkAll: (id, n, items) => CAN.work(state.role) && updateSystem(id, (x) => {
        if (!workable(x, n)) return x;
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, checklist: Object.fromEntries(items.filter((i) => !rec.skipped?.[i]).map((i) => [i, true])) } } };
      }),
      setEvidence: (id, n, item, value) => CAN.work(state.role) && updateSystem(id, (x) => {
        if (!workable(x, n)) return x;
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, evidence: { ...rec.evidence, [item]: value } } } };
      }),
      submitStage: (id, n, note) => CAN.work(state.role) && updateSystem(id, (x) => {
        if (!workable(x, n) || stageBlockers(x, state.settings.checklistRules).length) return x;
        return { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...x.stages[n], status: 'submitted', note, submittedAt: nowIso(), approvals: {}, returnNote: '', log: [...(x.stages[n]?.log || []), { at: nowIso(), who: 'client', outcome: 'Submitted', comment: note }] } } };
      }, 'Stage submitted for review', () => `Stage ${n}: ${stageOf(n).name}`),
      // One update for the decision and its internal note, so a repeated click can neither skip a stage nor leave a stray note.
      reviewStage: (id, n, who, outcome, comment, internal = '') => CAN.review(state.role) && setState((s) => {
        const x = s.systems.find((y) => y.id === id);
        const rec = x?.stages?.[n];
        if (!x || x.stage !== n || rec?.status !== 'submitted') return s;
        const waiting = waitingOn(x);
        const need = requiredApprovals(n, x.assessment.results.tier);
        const role = who === 'lead' && !need.includes('lead') ? 'assessor' : who;   // the lead can sign in the reviewer's place
        if (!waiting.includes(role) || (who !== s.role)) return s;
        const text = (internal || '').trim();
        const note = text ? { id: uid('note'), productId: id, stage: n, at: nowIso(), byRole: s.role, byName: s.me?.name || null, text } : null;
        const entry = { at: nowIso(), who: s.role, as: role, outcome, comment, ...(note ? { noteId: note.id } : {}) };
        const log2 = [...(rec.log || []), entry];
        let y;
        if (outcome === 'Returned') {
          y = { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...rec, status: 'returned', returnNote: comment, log: log2, approvals: { ...rec.approvals, [role]: { outcome, comment, at: nowIso() } } } } };
        } else {
          const approvals = { ...rec.approvals, [role]: { outcome, comment, at: nowIso() } };
          const withApproval = { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...rec, approvals, log: log2 } } };
          const done = need.every((r) => approvals[r] && approvals[r].outcome !== 'Returned');
          y = done ? advanceFrom(withApproval, n, outcome === 'Approved with conditions' ? comment : '') : withApproval;
        }
        const next = { ...s, systems: s.systems.map((z) => (z.id === id ? y : z)), notes: note ? [...(s.notes || []), note] : s.notes };
        return log(next, `Stage ${outcome === 'Returned' ? 'returned' : 'approved'}`, id, `Stage ${n}${comment ? `: ${comment}` : ''}`);
      }),
      override: (id, n, reason) => CAN.override(state.role) && updateSystem(id, (x) => {
        if (x.stage !== n || ['Retired', 'Blocked', 'Draft'].includes(x.status) || x.stages?.[n]?.status === 'approved') return x;
        return advanceFrom({
          ...x, stages: { ...x.stages, [n]: { ...(x.stages[n] || newStage()), log: [...(x.stages[n]?.log || []), { at: nowIso(), who: 'lead', outcome: 'Overridden', comment: reason }], approvals: { ...(x.stages[n]?.approvals || {}), lead: { outcome: 'Approved with conditions', comment: `Override: ${reason}`, at: nowIso() } } } },
        }, n, `Override: ${reason}`);
      }, 'Gate overridden', `Stage ${n}: ${reason}`),
      startEvent: (id, kind, text) => CAN.raiseEvent(state.role) && updateSystem(id, (x) => {
        const to = { change: 8, incident: 9, retire: 10 }[kind];
        if (!to || x.stage !== 7 || x.status !== 'In production') return x;
        return { ...x, stage: to, stages: { ...x.stages, [to]: newStage() }, events: [...(x.events || []), { at: nowIso(), kind, text }] };
      }, { change: 'Change raised', incident: 'Incident reported', retire: 'Retirement started' }[kind], text),

      // ----- actions and data -----
      // AI card: the client documents the use case. Each save is a numbered version listing what changed.
      saveCard: (id, patch) => CAN.work(state.role) && updateSystem(id, (x) => {
        const prev = x.card || {};
        const clean = { ...patch }; delete clean.versions; delete clean.version; delete clean.updatedAt; delete clean.updatedBy;
        clean.metrics = (clean.metrics || []).filter((m) => String(m.name || '').trim()).map((m) => ({ name: String(m.name).trim().slice(0, 60), value: String(m.value || '').trim().slice(0, 40), at: m.at || '' }));
        clean.tags = [...new Set((clean.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
        const changed = Object.keys(clean).filter((k) => JSON.stringify(clean[k] ?? '') !== JSON.stringify(prev[k] ?? ''));
        if (!changed.length) return x;
        const version = (prev.version || 0) + 1;
        return { ...x, updatedAt: nowIso(), card: { ...prev, ...clean, version, updatedAt: nowIso(), updatedBy: state.role,
          versions: [...(prev.versions || []), { version, at: nowIso(), by: state.role, byName: state.me?.name || null, changed }].slice(-30) } };
      }, 'AI card updated', (s2) => `Version ${((s2.systems.find((y) => y.id === id)?.card?.version) || 0) + 1}`),
      // New action, by the client or as a requirement from the governance team (e.g. on a control gap).
      addAction: (id, a) => {
        if (!CAN.work(state.role) && !CAN.review(state.role)) return 'Not allowed';
        if (String(a.action || '').trim().length < 10) return 'Describe the action in at least 10 characters';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.due || '')) return 'Choose a due date';
        const c = a.control ? controlById(a.control) || (state.systems.find((y) => y.id === id)?.customControls || []).find((k) => k.id === a.control) : null;
        updateSystem(id, (x) => ({ ...x, actions: [...(x.actions || []), {
          id: uid('act'), qid: `manual:${a.control || 'none'}`, source: CAN.review(state.role) ? 'reviewer' : 'manual', control: a.control || null,
          topic: (a.topic || c?.name || 'Action').slice(0, 60), action: a.action.trim(), principle: 'accountability',
          refs: c ? `Control ${c.id}` : '', priority: ['High', 'Medium', 'Low'].includes(a.priority) ? a.priority : 'Medium',
          due: a.due, status: 'Open', owner: (a.owner || '').trim(), raisedBy: state.role,
        }] }), 'Action added', `${a.topic || c?.name || ''}: ${a.action.trim()}`);
        return '';
      },
      // Product-specific control on top of the library (e.g. a sector rule).
      addControl: (id, k) => {
        if (!CAN.work(state.role) && !CAN.review(state.role)) return 'Not allowed';
        if (String(k.name || '').trim().length < 4) return 'Name the control';
        updateSystem(id, (x) => ({ ...x, customControls: [...(x.customControls || []), {
          id: `CUS-${String((x.customControls || []).length + 1).padStart(2, '0')}`, name: k.name.trim(), family: k.family || 'Custom',
          type: k.type || 'Preventive', compass: k.compass || 'accountability', owner: (k.owner || '').trim(), frequency: k.frequency || 'Per release',
          description: (k.description || '').trim(), status: 'Designed', addedBy: state.role, at: nowIso(),
        }] }), 'Control added', k.name.trim());
        return '';
      },
      updateControl: (id, cid, patch) => (CAN.work(state.role) || CAN.review(state.role)) && updateSystem(id, (x) => ({
        ...x, customControls: (x.customControls || []).map((k) => (k.id === cid ? { ...k, ...patch } : k)),
      }), 'Control updated', `${cid}: ${Object.entries(patch).map(([a, b]) => `${a} ${b}`).join(', ')}`),
      updateAction: (id, actionId, patch) => CAN.work(state.role) && updateSystem(id, (x) => ({
        ...x, actions: x.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
      }), 'Action updated', Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')),
      saveData: (id, datasets, outputs) => CAN.work(state.role) && updateSystem(id, (x) => ({ ...x, datasets, outputs }), 'Data assets updated', `${datasets.length} datasets`),

      // ----- admin -----
      addClient: (c) => state.role === 'admin' && setState((s) => log({ ...s, clients: [...s.clients, { ...c, id: uid('cli') }] }, 'Client added', null, c.name)),
      // Administrator: rename or update an organisation. Its products keep their link, so names follow everywhere.
      updateClient: (id, patch) => {
        if (state.role !== 'admin') return 'Not allowed';
        const name = (patch.name ?? '').trim();
        if (!name) return 'Enter an organisation name.';
        if (state.clients.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return 'Another organisation already has this name.';
        setState((s) => {
          const before = s.clients.find((c) => c.id === id);
          if (!before) return s;
          const after = { ...before, name, sector: (patch.sector ?? before.sector ?? '').trim(), contact: (patch.contact ?? before.contact ?? '').trim() };
          if (after.name === before.name && after.sector === (before.sector || '') && after.contact === (before.contact || '')) return s;
          return log({ ...s, clients: s.clients.map((c) => (c.id === id ? after : c)) }, 'Client edited', null, before.name === name ? name : `${before.name} renamed to ${name}`);
        });
        return '';
      },
      // Administrator: delete an organisation with its products (and their notes and evidence files).
      // Its people are not deleted: they go back to "waiting for approval" with no organisation.
      deleteClient: async (id) => {
        if (state.role !== 'admin') return 'Not allowed';
        const client = state.clients.find((c) => c.id === id);
        if (!client) return '';
        const products = state.systems.filter((x) => x.clientId === id);
        const pids = new Set(products.map((x) => x.id));
        const people = state.users.filter((u) => u.clientId === id);
        if (mode === 'cloud') {
          try {
            await queue.current;
            if (people.length) {
              const { error } = await cloud.from(T.profiles).update({ client_id: null, status: 'pending', updated_at: nowIso() }).eq('client_id', id);
              if (error) return error.message;
            }
            if (pids.size) {
              const { error } = await cloud.from(T.notes).delete().in('product_id', [...pids]);
              if (error) return error.message;
            }
          } catch (e) { return e.message || 'Could not delete'; }
          // evidence files: best effort, a leftover file is harmless
          for (const x of products) for (const rec of Object.values(x.stages || {})) for (const v of Object.values(rec.evidence || {})) if (v?.path) removeEvidence(v);
        }
        setState((s) => {
          const users = mode === 'cloud'
            ? s.users.map((u) => (u.clientId === id ? { ...u, clientId: undefined, status: 'pending' } : u))
            : s.users.map((u) => (u.clientId === id ? { ...u, clientId: undefined } : u));
          if (mode === 'cloud' && savedRef.current) savedRef.current = { ...savedRef.current, users };
          return log({
            ...s, users, clients: s.clients.filter((c) => c.id !== id), systems: s.systems.filter((x) => !pids.has(x.id)),
            notes: (s.notes || []).filter((n) => !pids.has(n.productId)),
          }, 'Client deleted', null, `${client.name}: ${products.length} product${products.length === 1 ? '' : 's'} removed, ${people.length} ${people.length === 1 ? 'person' : 'people'} moved to waiting for approval`);
        });
        return '';
      },
      addUser: (u) => setState((s) => log({ ...s, users: [...s.users, { ...u, id: uid('usr') }] }, 'User added', null, `${u.name} (${u.role})`)),
      removeUser: (userId) => setState((s) => log({ ...s, users: s.users.filter((u) => u.id !== userId) }, 'User removed', null, s.users.find((u) => u.id === userId)?.name || '')),
      // Administrator: add, edit, turn off or delete their own questions. Existing assessments keep the copy they were scored with.
      saveCustomQuestion: (q) => state.role === 'admin' && setState((s) => {
        const list = s.settings.customQuestions || [];
        const exists = list.some((x) => x.id === q.id);
        const item = { ...q, id: q.id || `CQ-${Date.now().toString(36).toUpperCase()}`, updatedAt: nowIso(), by: s.me?.name || null };
        const next = exists ? list.map((x) => (x.id === q.id ? item : x)) : [...list, item];
        return log({ ...s, settings: { ...s.settings, customQuestions: next } }, exists ? 'Question edited' : 'Question added', null, `${item.id}: ${item.q}`);
      }),
      removeCustomQuestion: (id) => state.role === 'admin' && setState((s) => log({
        ...s, settings: { ...s.settings, customQuestions: (s.settings.customQuestions || []).filter((x) => x.id !== id) },
      }, 'Question deleted', null, id)),
      setOverride: (qid, o) => setState((s) => log({ ...s, bankOverrides: { ...s.bankOverrides, [qid]: o } }, 'Question wording edited', null, qid)),
      clearOverride: (qid) => setState((s) => {
        const b = { ...s.bankOverrides }; delete b[qid];
        return log({ ...s, bankOverrides: b }, 'Question wording reset', null, qid);
      }),
    };
  }, [state, updateSystem, mode, syncError, flush]);

  if (mode === 'cloud') {
    if (auth.recovery) return <AuthScreen mode="recovery" onDone={() => setAuth((a) => ({ ...a, recovery: false }))} />;
    if (auth.phase === 'signedout') return <AuthScreen />;
    if (auth.phase === 'pending') return <PendingScreen profile={auth.profile} onSignOut={() => cloud.auth.signOut()} onCheck={() => recheck.current?.()} />;
  }
  if (boot !== 'ready' || (mode === 'cloud' && auth.phase !== 'in')) {
    return (
      <div className="boot" role="status">
        <div className="mark boot-mark">G</div>
        {boot !== 'error' ? <p>Loading GovernAI…</p> : (
          <>
            <p><b>Couldn't reach the database.</b></p>
            <p className="small mute">{bootError}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => auth.profile && start(auth.profile)}>Try again</button>
              <button className="btn" onClick={() => cloud.auth.signOut()}>Sign out</button>
            </div>
          </>
        )}
      </div>
    );
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
