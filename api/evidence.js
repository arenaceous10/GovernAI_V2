// Vercel serverless function.
//   GET  /api/evidence            -> the public key that checks evidence packs (anyone may fetch it)
//   POST /api/evidence {productId} -> a signed evidence pack for one AI product the caller may see
// Reads go through the caller's own Supabase token, so row-level security limits what can be packed.
import { signedIn, readBody } from '../src/lib/serverAuth.js';
import { loadKey, keyId, buildPack } from '../src/lib/server/evidence.js';

let cached;
const key = () => (cached !== undefined ? cached : (cached = (() => { try { return loadKey(process.env.EVIDENCE_SIGNING_KEY); } catch { return null; } })()));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const k = key();
  if (!k) return res.status(503).json({ error: 'Signed evidence packs are not configured on the server' });
  if (req.method === 'GET') return res.status(200).json({ alg: 'Ed25519', keyId: await keyId(k.publicKey), publicKey: k.publicKey });
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
  const { body, error, status } = readBody(req, 4096);
  if (error) return res.status(status).json({ error });
  const id = String(body.productId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.status(400).json({ error: 'Unknown product' });
  let who;
  try { who = await signedIn(req); } catch { who = { status: 503, error: 'Sign-in check failed' }; }
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  try {
    const [rowList, rows] = await Promise.all([
      who.get(`v2_products?select=id,client_id,data&id=eq.${encodeURIComponent(id)}`),
      who.get(`v2_ledger?select=*&chain=eq.${encodeURIComponent(id)}&order=seq.asc&limit=20000`),
    ]);
    const row = rowList?.[0];
    if (!row) return res.status(404).json({ error: 'Unknown product' });
    const client = row.client_id ? (await who.get(`v2_clients?select=id,name&id=eq.${encodeURIComponent(row.client_id)}`))?.[0] : null;
    const pack = await buildPack({ row, rows: rows || [], client, issuedTo: { name: who.profile.name, role: who.profile.role }, key: k });
    return res.status(200).json(pack);
  } catch {
    return res.status(500).json({ error: 'Could not build the evidence pack' });
  }
}
