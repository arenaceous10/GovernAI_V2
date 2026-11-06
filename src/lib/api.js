// Calls the app's own server functions (/api/*) with the signed-in person's Supabase token.
import { cloud } from './cloud.js';

export async function callApi(path, body, { method = 'POST' } = {}) {
  const token = cloud ? (await cloud.auth.getSession()).data.session?.access_token : null;
  let r;
  try {
    r = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
    });
  } catch { throw new Error('The server could not be reached'); }
  let data = null;
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(data?.error || (r.status === 404 ? 'This feature is not available on this server' : `Server error (${r.status})`));
  return data;
}

export const downloadJson = (obj, name) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
