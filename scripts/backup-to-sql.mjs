// Turns a GovernAI backup (Settings > System health > Download a full backup) into SQL that puts back rows that
// are missing. Rows that still exist are left as they are (ON CONFLICT DO NOTHING), so it is safe to run on a live
// database. The tamper-evident record is restored row for row, so it still verifies afterwards.
//
//   node scripts/backup-to-sql.mjs governai-backup-2026-11-10.json > restore.sql
//   then paste restore.sql into the Supabase SQL editor and run it.
//
// No keys are needed: the SQL runs in your own Supabase dashboard.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/backup-to-sql.mjs <backup.json> > restore.sql'); process.exit(1); }
const backup = JSON.parse(readFileSync(file, 'utf8'));
if (backup.format !== 'governai-backup') { console.error('This is not a GovernAI backup file.'); process.exit(1); }

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  return `'${String(v).replaceAll("'", "''")}'`;
};
// Columns the database fills itself are left out.
const SKIP = { v2_audit: ['id'], v2_client_errors: ['id'] };
const KEY = { v2_clients: 'id', v2_profiles: 'id', v2_products: 'id', v2_notes: 'id', v2_settings: 'key', v2_ledger: 'chain, seq' };
const ORDER = ['v2_clients', 'v2_profiles', 'v2_products', 'v2_notes', 'v2_settings', 'v2_audit', 'v2_ledger'];   // error reports are not restored

const out = [`-- GovernAI restore from a backup taken ${backup.exportedAt}`, 'begin;',
  '-- Lifecycle rules and record triggers are paused while old rows go back in, then switched on again.',
  'alter table public.v2_products disable trigger user;', 'alter table public.v2_audit disable trigger user;', 'alter table public.v2_ledger disable trigger user;'];
for (const table of ORDER) {
  const rows = backup.tables?.[table];
  if (!Array.isArray(rows) || !rows.length) { out.push(`-- ${table}: nothing to restore`); continue; }
  if (table === 'v2_profiles') { out.push('-- v2_profiles: people sign in with their own accounts; profiles come back when they sign in again (roles below).'); }
  const cols = Object.keys(rows[0]).filter((c) => !(SKIP[table] || []).includes(c));
  const target = table === 'v2_profiles' ? null : table;
  if (!target) {
    for (const r of rows) out.push(`update public.v2_profiles set role = ${lit(r.role)}, status = ${lit(r.status)}, client_id = ${lit(r.client_id)} where id = ${lit(r.id)};`);
    continue;
  }
  out.push(`-- ${table}: ${rows.length} rows`);
  for (const r of rows) {
    if (table === 'v2_audit') {
      // Audit rows have no natural key: put one back only if the same entry is not there already.
      const same = cols.map((c) => `${c} is not distinct from ${lit(r[c])}`).join(' and ');
      out.push(`insert into public.v2_audit (${cols.join(', ')}) select ${cols.map((c) => lit(r[c])).join(', ')} where not exists (select 1 from public.v2_audit where ${same});`);
      continue;
    }
    out.push(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((c) => lit(r[c])).join(', ')}) on conflict (${KEY[table]}) do nothing;`);
  }
}
out.push('alter table public.v2_products enable trigger user;', 'alter table public.v2_audit enable trigger user;', 'alter table public.v2_ledger enable trigger user;', 'commit;');
console.log(out.join('\n'));
