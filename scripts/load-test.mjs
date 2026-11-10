// A small, polite load test for a deployed GovernAI. It only reads public pages: the app itself and /api/health
// (which checks the database). It never signs in and never writes anything.
//
//   node scripts/load-test.mjs https://governai-v2.vercel.app 300 20
//                               address                      requests  at once
//
// Reports response times (median, 95th percentile, slowest) and any failures for each address.
const [base = 'http://localhost:4173', total = '200', concurrency = '10'] = process.argv.slice(2);
const N = Math.min(2000, +total || 200); const C = Math.min(50, +concurrency || 10);
const targets = [['app page', '/'], ['health (database)', '/api/health']];

async function run(path) {
  const times = []; const fails = {}; let i = 0;
  const worker = async () => {
    while (i < N) {
      i++;
      const t = performance.now();
      try {
        const r = await fetch(base.replace(/\/$/, '') + path, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        await r.arrayBuffer();
        if (!r.ok) fails[r.status] = (fails[r.status] || 0) + 1;
      } catch (e) { fails[e.name] = (fails[e.name] || 0) + 1; }
      times.push(performance.now() - t);
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: C }, worker));
  const secs = (performance.now() - t0) / 1000;
  times.sort((a, b) => a - b);
  const q = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))]);
  return { requests: times.length, perSecond: +(times.length / secs).toFixed(1), medianMs: q(0.5), p95Ms: q(0.95), slowestMs: Math.round(times.at(-1)), failures: fails };
}

console.log(`Load test: ${base}, ${N} requests per address, ${C} at a time`);
for (const [name, path] of targets) console.log(name.padEnd(18), JSON.stringify(await run(path)));
