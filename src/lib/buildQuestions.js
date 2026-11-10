// Builds the control question set for a product: the fixed questions for the frameworks in scope plus a share
// tailored to the use case, written by AI when it is switched on and picked by rules otherwise.
import { fixedQuestions, adaptiveTarget, selectAdaptive, aiAdaptive, orderQuestions } from '../engine/engine.js';
import { cloud } from './cloud.js';

export async function buildControlQuestions(state, profile, fws, clientId) {
  const overrides = state.bankOverrides || {};
  const custom = state.settings.customQuestions || [];
  const fixed = fixedQuestions(profile, fws, overrides, custom);
  const target = adaptiveTarget(fixed.length);
  let adaptive = []; let source = 'Rule-based tailoring';
  const orgAi = state.clients.find((c) => c.id === (clientId || state.clientOrg))?.aiQuestions !== false;
  if (state.settings.aiQuestions && orgAi) {
    // Names the AI must never see, on top of the product's own name, owner and business unit.
    const known = [...state.clients.map((c) => c.name), ...(state.users || []).map((u) => u.name), state.me?.name].filter(Boolean);
    // The endpoint only answers signed-in clients and administrators, so send the session token.
    const token = cloud ? (await cloud.auth.getSession()).data.session?.access_token : null;
    const ai = await aiAdaptive(profile, fws, target, fixed, { known, token });
    if (ai.questions.length) { adaptive = ai.questions; source = `AI (${ai.model || 'Gemini'})`; }
  }
  if (adaptive.length < target) adaptive = [...adaptive, ...selectAdaptive(profile, fws, target - adaptive.length, overrides, new Set(adaptive.map((q) => q.id)), custom)];
  return { questions: orderQuestions([...fixed, ...adaptive], fws), source };
}
