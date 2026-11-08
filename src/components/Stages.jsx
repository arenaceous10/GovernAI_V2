import { Check, CornerDownLeft, Hourglass } from 'lucide-react';
import { STAGES, PHASES, ON_DEMAND, STAGE_STATUS } from '../data/lifecycle.js';
import { stagePct } from '../data/controls.js';

// State of stage n for a product: done, current (with its status), upcoming, on-demand or skipped.
export function stageState(s, n) {
  if (s.status === 'Retired') return { kind: n === 10 || s.stages?.[n]?.status === 'approved' || n <= 7 ? 'done' : 'skipped' };
  const rec = s.stages?.[n];
  if (n === s.stage && s.status !== 'Retired') return { kind: 'current', status: s.status === 'Blocked' ? 'blocked' : rec?.status || 'open' };
  if (rec?.status === 'approved' || (n < s.stage && n <= 6) || (s.stage >= 7 && n <= 7 && n !== s.stage)) return { kind: ON_DEMAND.includes(n) && rec?.status !== 'approved' ? 'ondemand' : 'done' };
  return { kind: ON_DEMAND.includes(n) ? 'ondemand' : 'upcoming' };
}

const SUB = { open: 'In progress', submitted: 'In review', returned: 'Returned', blocked: 'Blocked', approved: 'Approved' };
const SUB_ICON = { submitted: Hourglass, returned: CornerDownLeft };

// Full lifecycle rail: ten stages grouped into four phases. Click a stage to view it.
export function LifecycleRail({ s, viewing, onPick }) {
  const live = s.stage >= 7 || s.status === 'Retired';
  const pct = live ? 100 : Math.round(((s.stage - 1) / 6) * 100);
  const label = s.status === 'Retired' ? 'Retired' : live ? 'In production' : `${s.stage - 1} of 6 stages to production`;
  return (
    <div className="rail">
      <div className="rail-top">
        <div className="rail-progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
        <span className="xs mute num">{label}</span>
      </div>
      <div className="rail-phases">
        {PHASES.map((ph) => (
          <div key={ph.id} className="rail-phase" style={{ flexGrow: ph.stages.length }}>
            <div className="rail-phase-name">{ph.name}</div>
            <ol className="rail-steps">
              {ph.stages.map((n) => {
                const st = stageState(s, n); const meta = STAGES[n - 1];
                const Icon = SUB_ICON[st.status];
                return (
                  <li key={n} className={`rs ${st.kind} ${st.status ? `is-${st.status}` : ''} ${viewing === n ? 'viewing' : ''}`}>
                    <button type="button" onClick={() => onPick?.(n)} aria-current={st.kind === 'current' ? 'step' : undefined} aria-label={`Stage ${n}: ${meta.name}`} title={meta.name}>
                      <span className="rs-dot">{st.kind === 'done' ? <Check size={14} strokeWidth={2.5} /> : Icon ? <Icon size={13} /> : n}</span>
                      <span className="rs-name">{meta.short}</span>
                      {st.kind === 'current' && <span className="rs-sub">{SUB[st.status]}{['open', 'returned'].includes(st.status) ? ` · ${stagePct(meta, s.stages?.[n])}%` : ''}</span>}
                      {st.kind === 'ondemand' && <span className="rs-sub mute">If needed</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

// Compact stage indicator for tables and cards.
export function StageMini({ s, stage, status }) {
  const n = s?.stage ?? stage; const meta = STAGES[n - 1];
  const sub = s ? stageState(s, n).status : null;
  return (
    <div className="smini" title={`Stage ${n}: ${meta.name}`}>
      <div className="smini-bars">{STAGES.map((x) => <i key={x.n} className={(s?.status ?? status) === 'Retired' || x.n < n ? 'done' : x.n === n ? `now ${sub ? `is-${sub}` : ''}` : ''} />)}</div>
      <div className="xs">{n}. {meta.short}</div>
    </div>
  );
}

// Circular progress for "done of total".
export function Ring({ done, total, size = 44, label }) {
  const pct = total ? done / total : 0; const r = (size - 6) / 2; const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label || `${done} of ${total} done`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className={`ring-fg ${pct === 1 ? 'full' : ''}`} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="num">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export const stageLabel = (s) => (s.status === 'Blocked' ? 'Blocked' : s.status === 'Retired' ? 'Retired' : STAGE_STATUS[s.stages?.[s.stage]?.status || 'open']);
