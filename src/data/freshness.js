// How long something read automatically (from Databricks or MLflow) counts as current. Shared by the lifecycle
// counts and the governance rules, so the rail, the completion scale and the reviewer's view always agree.
//
// Anything GovernAI reads from a registry is a picture of one moment. It counts as current for 30 days (the
// administrator can change this); after that it is shown as out of date and no longer counted as evidence.
export const AUTO_MAX_AGE_DAYS = 30;
export function autoMaxAge(settings) {
  const n = Number(settings?.autoEvidenceDays);
  if (!Number.isFinite(n) || n < 1) return AUTO_MAX_AGE_DAYS;
  return Math.min(365, Math.round(n));
}
export function pullState(at, { now = new Date(), maxAgeDays = AUTO_MAX_AGE_DAYS } = {}) {
  const t = at ? new Date(at).getTime() : NaN;
  if (!Number.isFinite(t)) return { at: null, ageDays: null, expired: true };
  const ageDays = Math.max(0, Math.floor((new Date(now).getTime() - t) / 86400000));
  return { at, ageDays, expired: ageDays > maxAgeDays };
}
// Evidence a person attached never expires. Evidence attached automatically stops counting once the read behind it
// is older than the limit. A stage that is already approved is judged on its approval day (asOf), so what was
// current when it was approved stays part of the record.
export function evidenceCurrent(v, { now = new Date(), asOf = null, maxAgeDays = AUTO_MAX_AGE_DAYS } = {}) {
  if (!v || !(String(v.ref || '').trim() || String(v.file || '').trim())) return false;
  if (!v.auto) return true;
  return !pullState(v.auto.at, { now: asOf || now, maxAgeDays }).expired;
}
// The day a stage record is judged on: its approval day once approved, otherwise today.
export const recordAsOf = (rec) => (rec?.status === 'approved' && rec.approvedAt ? rec.approvedAt : null);
