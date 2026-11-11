// Vercel serverless function: POST /api/connector
//   { action: 'seal', productId, token }                       -> { sealed }   (token encrypted for this product)
//   { action: 'test', productId, kind, host, model, token }    -> registry read with a token that is not stored
//   { action: 'sync', productId }                              -> registry read with the product's sealed token, plus
//                                                                 GenAI evaluations and traces, and production monitoring
//   { action: 'tables', productId, tables: [...] }             -> Unity Catalog tables: owner, columns, lineage, monitor
// The product is read with the caller's own Supabase token (row-level security), so nobody can use another
// organisation's connection. Clients and admins may connect a model; the governance team may also sync.
import { signedIn, readBody } from '../src/lib/serverAuth.js';
import { registryOpen, REGISTRY_CLOSED_TEXT } from '../src/lib/registryStage.js';
import { seal, unseal, readRegistry, readGenAI, readMonitoring, readTables, validWarehouse, checkHost } from '../src/lib/server/connector.js';

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
  if (!registryOpen({ stage: row.data?.stage })) return res.status(409).json({ error: REGISTRY_CLOSED_TEXT });
  const canConnect = ['client', 'admin'].includes(who.profile.role);
  const opts = { allowLocal: process.env.CONNECTOR_ALLOW_LOCAL === '1' };
  try {
    if (body.action === 'seal') {
      if (!canConnect) return res.status(403).json({ error: 'Only the client or an administrator can connect a model' });
      const t = String(body.token || '');
      if (!t || t.length > 2000) return res.status(400).json({ error: 'Enter the access token' });
      return res.status(200).json({ sealed: seal(t, id, keyB64) });
    }
    // Registry, then (best effort, in parallel) GenAI evaluations and traces, and production monitoring.
    const full = async (c, token) => {
      const reg = await readRegistry({ kind: c.kind, host: c.host, model: c.model, token }, opts);
      const wh = validWarehouse(c.warehouseId) ? String(c.warehouseId).trim() : '';
      const [genai, monitoring] = await Promise.allSettled([
        readGenAI({ base: reg.base, token, experiment: c.experiment, versions: reg.versions }),
        c.kind === 'databricks-uc' && c.monitorTable ? readMonitoring({ base: reg.base, token, table: c.monitorTable, warehouseId: wh }) : Promise.resolve(null),
      ]);
      const { base, ...rest } = reg; void base;
      return {
        ...rest,
        genai: genai.status === 'fulfilled' ? genai.value : { notes: [genai.reason?.message || 'Evaluations could not be read'] },
        monitoring: monitoring.status === 'fulfilled' ? monitoring.value : { table: c.monitorTable, notes: [monitoring.reason?.message || 'Monitoring could not be read'] },
      };
    };
    const savedToken = (c) => {
      if (!c.tokenSealed) return '';
      try { return unseal(c.tokenSealed, id, keyB64); } catch { return null; }
    };
    if (body.action === 'test') {
      if (!canConnect) return res.status(403).json({ error: 'Only the client or an administrator can connect a model' });
      const t = String(body.token || '').slice(0, 2000);
      return res.status(200).json(await full({ kind: body.kind, host: body.host, model: body.model, experiment: body.experiment, monitorTable: body.monitorTable, warehouseId: body.warehouseId }, t));
    }
    if (body.action === 'sync') {
      const c = row.data?.connector;
      if (!c?.host || !c?.model) return res.status(400).json({ error: 'This product has no model connection' });
      const token = savedToken(c);
      if (token === null) return res.status(400).json({ error: 'The saved token cannot be used. Connect the model again.' });
      return res.status(200).json(await full(c, token));
    }
    if (body.action === 'tables') {
      const c = row.data?.connector;
      if (c?.kind !== 'databricks-uc') return res.status(400).json({ error: 'Connect the model to Databricks Unity Catalog on the AI card first' });
      const token = savedToken(c);
      if (token === null) return res.status(400).json({ error: 'The saved token cannot be used. Connect the model again.' });
      const base = new URL(await checkHost(c.host, opts)).origin;
      const wh = validWarehouse(c.warehouseId) ? String(c.warehouseId).trim() : '';
      const tables = Array.isArray(body.tables) ? body.tables.slice(0, 20) : [];
      return res.status(200).json(await readTables({ base, token, tables, warehouseId: wh }));
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(502).json({ error: e?.message && e.message.length < 200 ? e.message : 'The registry could not be read' });
  }
}
