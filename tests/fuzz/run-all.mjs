// Runs every fuzz suite and the store regression checks. Exits non-zero on any finding.
// Usage: npm run test:fuzz            (about 300,000 generated cases; set SCALE=0.2 for a quick pass)
import { execFileSync } from 'node:child_process';
const scale = Number(process.env.SCALE || 1);
const runs = [
  ['engine.fuzz.mjs', { N: Math.round(6000 * scale) }],
  ['modules.fuzz.mjs', { N: Math.round(1500 * scale) }],
  ['server.fuzz.mjs', {}],
  ['workflow.fuzz.mjs', { STEPS: Math.round(5000 * scale), SEED: 31 }],
  ['workflow.fuzz.mjs', { STEPS: Math.round(5000 * scale), SEED: 32 }],
  ['db.fuzz.mjs', { STEPS: Math.round(3000 * scale) }],
];
let total = 0; let bad = 0;
for (const [file, env] of runs) {
  const out = execFileSync(process.execPath, [new URL(file, import.meta.url).pathname], { env: { ...process.env, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])) }, maxBuffer: 64 * 1024 * 1024 }).toString();
  const r = JSON.parse(out.slice(out.indexOf('{')));
  total += r.cases; bad += r.findings.length;
  console.log(`${r.suite.padEnd(10)} ${String(r.cases).padStart(7)} cases  ${r.findings.length ? `${r.findings.length} findings` : 'ok'}`);
  for (const f of r.findings) console.log(`  - ${f.finding} (${f.count}x) ${String(f.example).slice(0, 200)}`);
}
execFileSync(process.execPath, [new URL('store.regress.mjs', import.meta.url).pathname], { stdio: 'inherit' });
console.log(`total ${total} cases, ${bad} findings`);
process.exit(bad ? 1 : 0);
