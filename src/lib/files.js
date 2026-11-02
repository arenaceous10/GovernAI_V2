// Evidence files.
// Cloud mode: stored in the private Supabase Storage bucket and opened through a signed link (valid 10 minutes).
// Browser-only mode: small files are kept inside the browser's own demo data so they can still be opened.
import { cloud } from './cloud.js';

export const BUCKET = 'v2-evidence';
export const MAX_MB = 10;
export const LOCAL_MAX_MB = 2;

const safeName = (name) => name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';
const rid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 8);

export const isLink = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
export const hasFile = (v) => Boolean(v && (v.path || v.data));

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

// Returns the evidence fields to merge into the item: { file, path | data, size, type }.
export async function uploadEvidence(file, { systemId, stage }) {
  const limit = cloud ? MAX_MB : LOCAL_MAX_MB;
  if (file.size > limit * 1024 * 1024) throw new Error(`File is larger than ${limit} MB.`);
  const meta = { file: file.name, size: file.size, type: file.type || '' };
  if (!cloud) return { ...meta, data: await readAsDataUrl(file) };
  const path = `${systemId}/stage-${stage}/${rid()}-${safeName(file.name)}`;
  const { error } = await cloud.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error(error.message || 'Upload failed.');
  return { ...meta, path };
}

export async function evidenceUrl(v) {
  if (v?.data) return v.data;
  if (!v?.path) return null;
  if (!cloud) throw new Error('This file is stored in the database, which is not connected.');
  const { data, error } = await cloud.storage.from(BUCKET).createSignedUrl(v.path, 600);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open the file.');
  return data.signedUrl;
}

// Best effort: a leftover file is harmless, so failures are ignored.
export async function removeEvidence(v) {
  if (!cloud || !v?.path) return;
  try { await cloud.storage.from(BUCKET).remove([v.path]); } catch { /* ignore */ }
}

export const fmtSize = (b) => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
