// Vercel serverless function: POST /api/generate-questions
// Writes the tailored (adaptive) questions with Gemini. The key stays on the server (GEMINI_API_KEY).
// The model only writes wording; scores come from option position in the app, never from the model.
// If this endpoint is missing or fails, the app falls back to its rule-based question picker.
//
// Privacy: the request body is rebuilt from an allowlist and the description scrubbed again here, so even a
// modified client cannot send names, contact details, identifiers or secrets to the model. Nothing is logged.
import { safeUseCase, safeAvoid, looksSensitive } from '../src/lib/redact.js';

const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
const FW_NAMES = {
  EU_AI_ACT: 'EU AI Act', GDPR: 'GDPR', DPDP: 'India DPDP Act 2023 and DPDP Rules 2025',
  RAI: 'Responsible AI principles',
  DG: 'Data governance (catalog, lineage, quality, ownership, classification, retention)',
};
const PRINCIPLES = ['social', 'privacy', 'fairness', 'robustness', 'accountability', 'transparency'];

function buildPrompt({ count, frameworks, useCase, avoid }) {
  const fws = [...frameworks.filter((f) => FW_NAMES[f] && f !== 'DG' && f !== 'RAI'), 'RAI', 'DG'];
  const laws = fws.filter((f) => !['RAI', 'DG'].includes(f));
  return [
    'You are a senior AI governance and data governance assessor. Write control questions that are specific to THIS AI system,',
    'using its own terms. Do not write generic questions that would fit any AI system, and do not repeat or rephrase the questions listed under AVOID.',
    `Write exactly ${count} questions. Spread them across these frameworks only: ${fws.map((f) => `${f} (${FW_NAMES[f]})`).join('; ')}.`,
    `STRICT SCOPE: the only laws in scope are ${laws.length ? laws.map((f) => FW_NAMES[f]).join(', ') : 'none'}. Never mention, cite or rely on any other law, regulation or standard (for example HIPAA, CCPA, NIST, ISO${laws.includes('GDPR') ? '' : ', GDPR'}${laws.includes('DPDP') ? '' : ', DPDP'}${laws.includes('EU_AI_ACT') ? '' : ', EU AI Act'}).`,
    'Every question must follow from the use case below and from the chosen frameworks. The Responsible AI principles are: social well-being and planet inclusive (social), privacy and safety (privacy), fairness and equity (fairness), robustness and stability (robustness), accountability, transparency.',
    'Every question asks how mature one control is and has exactly four answer options, ordered from weakest to strongest:',
    'option 1 = not in place, option 2 = started or partial, option 3 = in place, option 4 = in place, tested and evidenced.',
    'Options are short, plain and specific to the question. Never use free-text answers.',
    'Return ONLY a JSON array. Each item: {"framework": one of ' + JSON.stringify(fws) + ', "ref": article or pillar (e.g. "Art. 14", "Sec. 8(3)", "Lineage"),',
    '"pillar": for DG only, one of ["catalog","lineage","quality","ownership","classification","retention"], "principle": one of ' + JSON.stringify(PRINCIPLES) + ', "topic": 2-4 words,',
    '"q": the question (under 220 characters), "options": [4 strings], "weight": 1, 2 or 3 (3 only where a gap would be serious on its own),',
    '"action": one sentence remediation if the control is weak, "why": one sentence on why this matters for this system}.',
    '', 'USE CASE:', JSON.stringify(useCase, null, 1), '', 'AVOID:', ...(avoid || []).map((a) => `- ${a}`),
  ].join('\n');
}

async function callGemini(key, prompt) {
  const models = [process.env.GEMINI_MODEL, ...(process.env.GEMINI_FALLBACK_MODELS || '').split(','), ...DEFAULT_MODELS]
    .map((m) => (m || '').trim()).filter((m, i, a) => m && a.indexOf(m) === i);
  let last = 'no model tried';
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(25000),
      });
      if (r.ok) {
        const data = await r.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '[]';
        return { model, items: JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) };
      }
      last = `${model}: HTTP ${r.status}`;
      if (![404, 429, 500, 503].includes(r.status)) break;      // another model will not fix a bad request or key
    } catch (e) {
      last = `${model}: ${e.name}`;
    }
  }
  throw new Error(last);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'GEMINI_API_KEY is not set' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const count = Math.min(25, Math.max(1, parseInt(body.count, 10) || 8));
  const frameworks = Array.isArray(body.frameworks) ? body.frameworks.filter((f) => FW_NAMES[f]) : [];
  const useCase = safeUseCase(body.useCase || {});
  const avoid = safeAvoid(body.avoid);
  if (looksSensitive(useCase.description) || avoid.some(looksSensitive)) return res.status(422).json({ error: 'Refused: the text still looks like it contains personal or secret data' });
  try {
    const { model, items } = await callGemini(key, buildPrompt({ count, frameworks, useCase, avoid }));
    return res.status(200).json({ model, questions: Array.isArray(items) ? items.slice(0, count * 2) : [] });
  } catch (e) {
    return res.status(502).json({ error: `Gemini unavailable (${String(e.message).replace(key, '[key]')})` });
  }
}
