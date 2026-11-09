// Shared helpers for the fuzz suites: a seeded random source, case counting and a findings log.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  r.some = (xs, p = 0.3) => xs.filter(() => r() < p);
  r.bool = (p = 0.5) => r() < p;
  r.str = (n = 12) => Array.from({ length: r.int(0, n) }, () => r.pick('abcdefghijklmnopqrstuvwxyz ABC.,-@1234567890é​"\'<>{}'.split(''))).join('');
  return r;
}
export function suite(name) {
  const findings = new Map(); let cases = 0;
  return {
    name,
    get cases() { return cases; },
    tick(n = 1) { cases += n; },
    fail(key, detail) { const f = findings.get(key) || { count: 0, example: detail }; f.count++; findings.set(key, f); },
    check(cond, key, detail) { if (!cond) this.fail(key, detail); return cond; },
    async run(key, fn, detail) { try { return await fn(); } catch (e) { this.fail(`${key}: threw ${e.message}`.slice(0, 200), detail); return undefined; } },
    report() { return { suite: name, cases, findings: [...findings].map(([k, v]) => ({ finding: k, count: v.count, example: v.example })) }; },
  };
}
export const short = (x) => { try { return JSON.stringify(x).slice(0, 400); } catch { return String(x).slice(0, 400); } };
