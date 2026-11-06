// Vercel serverless function: POST /api/connector
//   { action: 'seal', productId, token }                       -> { sealed }   (token encrypted for this product)
//   { action: 'test', productId, kind, host, model, token }    -> registry read with a token that is not stored
//   { action: 'sync', productId }                              -> registry read with the product's sealed token
// The product is read with the caller's own Supabase token (row-level security), so nobody can use another
// organisation's connection. Clients and admins may connect a model; the governance team may also sync.
import { signedIn, readBody } from '../src/lib/serverAuth.js';
import { seal, unseal, readRegistry } from '../src/lib/server/connector.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const keyB64 = process.env.CONNECTOR_KEY;
  if (!keyB64) return res.status(503).json({ error: 'Model connections are not configured on the server' });
  const { body, error, status } = readBody(req, 8192);
  if (error) return res.status(status).json({ error });
  const id = String(body.productId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.status(400).json({ error: 'Unknown product' });
  let who;
  try { who = await signedIn(req); } catch { who = { status: 503, error: 'Sign-in check failed' }; }
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  const row = (await who.get(`v2_products?select=id,data&id=eq.${encodeURIComponent(id)}`))?.[0];
  if (!row) return res.status(404).json({ error: 'Unknown product' });
  const canConnect = ['client', 'admin'].includes(who.profile.role);
  const opts = { allowLocal: process.env.CONNECTOR_ALLOW_LOCAL === '1' };
  try {
    if (body.action === 'seal') {
      if (!canConnect) return res.status(403).json({ error: 'Only the client or an administrator can connect a model' });
      const t = String(body.token || '');
      if (!t || t.length > 2000) return res.status(400).json({ error: 'Enter the access token' });
      return res.status(200).json({ sealed: seal(t, id, keyB64) });
    }
    if (body.action === 'test') {
      if (!canConnect) return res.status(403).json({ error: 'Only the client or an administrator can connect a model' });
      const t = String(body.token || '').slice(0, 2000);
      return res.status(200).json(await readRegistry({ kind: body.kind, host: body.host, model: body.model, token: t }, opts));
    }
    if (body.action === 'sync') {
      const c = row.data?.connector;
      if (!c?.host || !c?.model) return res.status(400).json({ error: 'This product has no model connection' });
      let token = '';
      if (c.tokenSealed) { try { token = unseal(c.tokenSealed, id, keyB64); } catch { return res.status(400).json({ error: 'The saved token cannot be used. Connect the model again.' }); } }
      return res.status(200).json(await readRegistry({ kind: c.kind, host: c.host, model: c.model, token }, opts));
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(502).json({ error: e?.message && e.message.length < 200 ? e.message : 'The registry could not be read' });
  }
}
