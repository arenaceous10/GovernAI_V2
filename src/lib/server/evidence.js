// Builds and signs an evidence pack on the server. The private key (EVIDENCE_SIGNING_KEY, base64 PKCS#8 Ed25519)
// never leaves the server; the matching public key is published in src/data/evidenceKey.js and at GET /api/evidence.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { PACK_FORMAT, packSnapshot, signingText, verifyChain, compareWithProduct, sha256hex } from '../ledger.js';
import { productFromRow } from '../../store/sync.js';

export function loadKey(b64) {
  if (!b64) return null;
  const priv = createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  return { priv, publicKey: Buffer.from(spki).toString('base64') };
}
export const keyId = async (publicKeyB64) => (await sha256hex(publicKeyB64)).slice(0, 16);

export async function buildPack({ row, rows, client, issuedTo, key, now = new Date() }) {
  const product = productFromRow(row);
  if (!product) throw new Error('This product cannot be read');
  const chain = await verifyChain(rows);
  const cmp = compareWithProduct(rows, product);
  const pack = {
    format: PACK_FORMAT,
    issuedAt: now.toISOString(),
    issuedTo,
    client: client ? { id: client.id, name: client.name } : null,
    product: packSnapshot(product),
    record: {
      count: rows.length, head: chain.head,
      rows: rows.map((r) => ({ chain: r.chain, seq: r.seq, at: r.at, kind: r.kind, actor: r.actor, body: r.body, prev: r.prev, hash: r.hash })),
    },
    checkedAtIssue: { chain: chain.ok, problems: chain.problems, matchesProduct: cmp.ok, unrecorded: cmp.unrecorded.length, missing: cmp.missing.length },
  };
  const value = sign(null, Buffer.from(signingText(pack)), key.priv).toString('base64');
  return { ...pack, signature: { alg: 'Ed25519', keyId: await keyId(key.publicKey), value } };
}
