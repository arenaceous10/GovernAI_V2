// App state kept in the browser (localStorage). Swap load/save for Supabase or an API later;
// the rest of the app only uses the functions exposed by useStore().
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { buildSeed } from './seed.js';
import { requiredApprovals, nextStage, stageOf } from '../data/lifecycle.js';
import { TIERS, SELECTABLE_FRAMEWORKS } from '../data/frameworks.js';

const KEY = 'governai.v4';
const Ctx = createContext(null);

const freshState = (keep = {}) => ({
  ...buildSeed(), role: null, clientOrg: null,
  settings: { aiQuestions: true, enabledFrameworks: [...SELECTABLE_FRAMEWORKS], cutoffs: {} }, bankOverrides: {}, ...keep,
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
  const [state, setState] = useState(load);
  useEffect(() => save(state), [state]);

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
      resetDemo: () => setState((s) => freshState({ role: s.role, clientOrg: s.role === 'client' ? s.clients[0]?.id : null })),

      // ----- registration -----
      saveDraft: (id, draft, meta) => {
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
      toggleCheck: (id, n, item) => updateSystem(id, (x) => {
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, checklist: { ...rec.checklist, [item]: !rec.checklist[item] } } } };
      }),
      checkAll: (id, n, items) => updateSystem(id, (x) => {
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, checklist: Object.fromEntries(items.map((i) => [i, true])) } } };
      }),
      setEvidence: (id, n, item, value) => updateSystem(id, (x) => {
        const rec = x.stages[n] || newStage();
        return { ...x, stages: { ...x.stages, [n]: { ...rec, evidence: { ...rec.evidence, [item]: value } } } };
      }),
      submitStage: (id, n, note) => updateSystem(id, (x) => ({
        ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...x.stages[n], status: 'submitted', note, submittedAt: nowIso(), approvals: {}, returnNote: '' } },
      }), 'Stage submitted for review', (s) => `Stage ${n}: ${stageOf(n).name}`),
      reviewStage: (id, n, who, outcome, comment) => updateSystem(id, (x) => {
        const rec = x.stages[n];
        const need = requiredApprovals(n, x.assessment.results.tier);
        const role = who === 'lead' && !need.includes('lead') ? 'assessor' : who;   // the lead can sign in the reviewer's place
        if (outcome === 'Returned') {
          return { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...rec, status: 'returned', returnNote: comment, approvals: { ...rec.approvals, [role]: { outcome, comment, at: nowIso() } } } } };
        }
        const approvals = { ...rec.approvals, [role]: { outcome, comment, at: nowIso() } };
        const withApproval = { ...x, updatedAt: nowIso(), stages: { ...x.stages, [n]: { ...rec, approvals } } };
        const done = need.every((r) => approvals[r] && approvals[r].outcome !== 'Returned');
        return done ? advanceFrom(withApproval, n, outcome === 'Approved with conditions' ? comment : '') : withApproval;
      }, `Stage ${outcome === 'Returned' ? 'returned' : 'approved'}`, `Stage ${n}${comment ? `: ${comment}` : ''}`),
      override: (id, n, reason) => updateSystem(id, (x) => advanceFrom({
        ...x, stages: { ...x.stages, [n]: { ...(x.stages[n] || newStage()), approvals: { ...(x.stages[n]?.approvals || {}), lead: { outcome: 'Approved with conditions', comment: `Override: ${reason}`, at: nowIso() } } } },
      }, n, `Override: ${reason}`), 'Gate overridden', `Stage ${n}: ${reason}`),
      startEvent: (id, kind, text) => updateSystem(id, (x) => {
        const to = { change: 8, incident: 9, retire: 10 }[kind];
        return { ...x, stage: to, stages: { ...x.stages, [to]: newStage() }, events: [...(x.events || []), { at: nowIso(), kind, text }] };
      }, { change: 'Change raised', incident: 'Incident reported', retire: 'Retirement started' }[kind], text),

      // ----- actions and data -----
      updateAction: (id, actionId, patch) => updateSystem(id, (x) => ({
        ...x, actions: x.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
      }), 'Action updated', Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', ')),
      saveData: (id, datasets, outputs) => updateSystem(id, (x) => ({ ...x, datasets, outputs }), 'Data assets updated', `${datasets.length} datasets`),

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
  }, [state, updateSystem]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
