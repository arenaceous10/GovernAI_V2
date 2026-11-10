// Error reports. When something breaks on a signed-in person's screen, a short report (page, message, first lines of
// the stack, build) goes to v2_client_errors so an administrator can see it under Settings > System health.
// Personal details are scrubbed first; the same error is sent once a minute at most; nothing is sent in the demo.
import { cloud } from './cloud.js';
import { scrubText } from './redact.js';

export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'local';   // eslint-disable-line no-undef
const recent = new Map();
let role = null;
export const setErrorRole = (r) => { role = r || null; };

export async function reportError(err, context = '') {
  try {
    if (!cloud) return;
    const message = scrubText(String(err?.message || err || 'Unknown error')).slice(0, 480);
    if (!message || /ResizeObserver loop|Load failed|NetworkError|Failed to fetch/i.test(message)) return;   // browser noise and offline moments
    const key = `${message}|${context}`;
    if (Date.now() - (recent.get(key) || 0) < 60000) return;
    recent.set(key, Date.now());
    const { data } = await cloud.auth.getSession();
    if (!data?.session) return;
    const stack = String(err?.stack || '').split('\n').slice(0, 8).join('\n');
    await cloud.from('v2_client_errors').insert({
      role, page: String(window.location.hash || '#').slice(0, 190), message,
      detail: scrubText(`${context ? `${context}\n` : ''}${stack}`).slice(0, 1900), build: BUILD,
    });
  } catch { /* reporting must never cause another error */ }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.error || e.message, 'window error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandled promise'));
}
