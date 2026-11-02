import { Check } from 'lucide-react';
import { STAGES } from '../data/lifecycle.js';

// Full tracker: ten numbered steps with short names. Optional onPick to view a stage.
export function StageTracker({ stage, status, viewing, onPick, stages = {} }) {
  const retired = status === 'Retired';
  return (
    <ol className="stracker" aria-label="Lifecycle stages">
      {STAGES.map((s) => {
        const done = retired || stages[s.n]?.status === 'approved' || (s.n < stage && s.n <= 6);
        const now = !retired && s.n === stage;
        return (
          <li key={s.n} className={`${done ? 'done' : ''} ${now ? 'now' : ''} ${viewing === s.n ? 'viewing' : ''}`}>
            <button type="button" disabled={!onPick} onClick={() => onPick?.(s.n)} aria-current={now ? 'step' : undefined} title={s.name}>
              <span className="sdot">{done && !now ? <Check size={13} /> : s.n}</span>
              <span className="slabel">{s.short}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// Compact version for tables.
export function StageMini({ stage, status }) {
  const s = STAGES[stage - 1];
  return (
    <div className="smini" title={`Stage ${stage}: ${s.name}`}>
      <div className="smini-bars">{STAGES.map((x) => <i key={x.n} className={status === 'Retired' || x.n < stage ? 'done' : x.n === stage ? 'now' : ''} />)}</div>
      <div className="xs">{stage}. {s.short}</div>
    </div>
  );
}
