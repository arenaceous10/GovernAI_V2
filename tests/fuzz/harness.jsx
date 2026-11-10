// Renders the real store (local mode) so the fuzz can call its actions directly.
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { StoreProvider, useStore, stageBlockers, waitingOn, canWithdraw, purgeEligible, visibleSystems, WITHDRAW_REASONS } from '../../src/store/store.jsx';
import { STAGES, requiredApprovals } from '../../src/data/lifecycle.js';
import { isMandatory } from '../../src/data/controls.js';
import { SKIP_REASONS } from '../../src/data/controls.js';
function Probe() { globalThis.__api = useStore(); return null; }
export async function mount() {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<StoreProvider><Probe /></StoreProvider>); });
  return { root, api: () => globalThis.__api };
}
export { emptyProfile, buildQuestionnaire, scoreAssessment, buildActions, UNKNOWN, FLOW, rescore, controlGaps, evidenceNeed, evidenceMet, effectiveAnswers, isProvisional, isStaged, refreshQuestions } from '../../src/engine/engine.js';
export { PROFILE_QUESTIONS, PROHIBITED, SELECTABLE_FRAMEWORKS } from '../../src/data/frameworks.js';
export { act, stageBlockers, waitingOn, canWithdraw, purgeEligible, visibleSystems, STAGES, requiredApprovals, isMandatory, SKIP_REASONS, WITHDRAW_REASONS };
