// Vercel serverless function: GET /api/daily, called once a day by the schedule in vercel.json.
// Checks every connected model registry and mails each person a digest of what needs them (see lib/server/daily.js).
// Only the scheduler may call it: Vercel sends "Authorization: Bearer <CRON_SECRET>" when that variable is set.
// It answers with counts only.
import { timingSafeEqual } from 'node:crypto';
import { runDaily } from '../src/lib/server/daily.js';
import { unseal, readFull } from '../src/lib/server/connector.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const secret = process.env.CRON_SECRET || '';
  const got = String(req.headers?.authorization || '');
  const want = `Bearer ${secret}`;
  if (secret.length < 16 || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(401).json({ error: 'Not allowed' });
  const keyB64 = process.env.CONNECTOR_KEY;
  const opts = { allowLocal: false };
  const readOne = async (c, id) => {
    const token = c.tokenSealed ? unseal(c.tokenSealed, id, keyB64) : '';
    return readFull(c, token, opts);
  };
  try {
    const out = await runDaily({ readOne });
    return res.status(out.ok ? 200 : 503).json(out);
  } catch {
    return res.status(500).json({ ok: false, reason: 'The daily job failed' });
  }
}
