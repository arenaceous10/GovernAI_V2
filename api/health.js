// Health check: GET /api/health. Public, and says nothing private: whether the database answers, and which server
// features are configured (true/false only). An uptime monitor can poll it; the daily scheduled call (vercel.json)
// also keeps a free Supabase project from pausing after a week without activity.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ error: 'Use GET' }); return; }
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const t0 = Date.now();
  let db = false; let dbError = '';
  if (url && anon) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/gov_health`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
      db = r.ok && (await r.json())?.db === true;
      if (!r.ok) dbError = `database answered ${r.status}`;
    } catch (e) { dbError = e.name === 'TimeoutError' ? 'database did not answer in 8 seconds' : 'database unreachable'; }
  } else dbError = 'database not configured';
  const out = {
    ok: db,
    at: new Date().toISOString(),
    database: db ? 'up' : 'down', ...(dbError ? { problem: dbError } : {}),
    ms: Date.now() - t0,
    configured: {
      database: !!(url && anon),
      aiQuestions: !!process.env.GEMINI_API_KEY,
      evidenceSigning: !!process.env.EVIDENCE_SIGNING_KEY,
      modelConnector: !!process.env.CONNECTOR_KEY,
    },
    build: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'local',
  };
  res.status(db ? 200 : 503).json(out);
}
