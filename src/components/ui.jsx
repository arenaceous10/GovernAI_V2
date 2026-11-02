import { TIERS } from '../data/frameworks.js';
import { LEVEL_NAMES } from '../data/questionBank.js';

export function TierBadge({ tier }) {
  const t = TIERS[tier];
  if (!t) return null;
  return <span className="tier" style={{ color: t.color, background: t.bg }}>{t.label}</span>;
}

export function Pill({ tone = 'mute', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Panel({ title, sub, right, children, style, className = '' }) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || right) && (
        <div className="panel-head">
          <div>{title && <h2>{title}</h2>}{sub && <p>{sub}</p>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ value, label, detail, color }) {
  return (
    <div className="panel stat">
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      <div className="l">{label}</div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

export function Bar({ value, color = 'var(--accent)' }) {
  return <div className="bar" role="img" aria-label={`${value ?? 0}%`}><span style={{ width: `${value ?? 0}%`, background: color }} /></div>;
}

export const toneColor = (tone) => ({ good: 'var(--good)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }[tone] || 'var(--mute)');

export function Single({ options, value, onChange, name }) {
  return (
    <div className="choices" role="radiogroup" aria-label={name}>
      {options.map((o, i) => {
        const v = o.value ?? i;
        return (
          <button type="button" key={v} className="choice" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
            <span className="dot" /> <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Multi({ options, value = [], onChange, chips = false, exclusive }) {
  const toggle = (v) => {
    if (exclusive && v === exclusive) return onChange(value.includes(v) ? [] : [v]);
    const base = value.filter((x) => x !== exclusive);
    onChange(base.includes(v) ? base.filter((x) => x !== v) : [...base, v]);
  };
  return (
    <div className={chips ? 'chips' : 'choices'}>
      {options.map((o) => (
        <button type="button" key={o.value} className="choice multi" role="checkbox" aria-checked={value.includes(o.value)} onClick={() => toggle(o.value)}>
          <span className="dot" /> <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// Four-step option ladder for control questions: position decides the score.
export function Ladder({ q, value, onChange }) {
  return (
    <>
      <div className="ladder" role="radiogroup" aria-label={q.q}>
        {q.options.map((label, i) => (
          <button type="button" key={i} className="choice" role="radio" aria-checked={value === i} onClick={() => onChange(i)} title={LEVEL_NAMES[i]}>
            <span className="lvl" aria-hidden>{[0, 1, 2, 3].map((k) => <i key={k} className={k <= i ? 'on' : ''} />)}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {q.na && (
        <div className="na-link">
          <button type="button" className="choice" role="radio" aria-checked={value === 'na'} onClick={() => onChange(value === 'na' ? null : 'na')}>
            <span className="dot" /> Not applicable: {q.na.charAt(0).toLowerCase() + q.na.slice(1)}
          </button>
        </div>
      )}
    </>
  );
}

// The risk scale: where the product sits on the four tiers, before and after controls.
// Segment widths follow the cut-offs of the frameworks in scope.
export function RiskScale({ inherent, residual, tier, compact, cut = { limited: 35, high: 60 } }) {
  const pos = (s) => `${(s / 114) * 100}%`;
  const unacceptable = tier === 'unacceptable';
  const widths = [cut.limited, cut.high - cut.limited, 100 - cut.high, 14];
  return (
    <div className={`scale${compact ? ' compact' : ''}`}>
      <div className="scale-track" style={{ gridTemplateColumns: widths.map((w) => `${w}fr`).join(' ') }}>
        {['minimal', 'limited', 'high', 'unacceptable'].map((k) => (
          <div key={k} style={{ background: TIERS[k].bg, color: TIERS[k].color, opacity: tier === k ? 1 : 0.7 }}>{compact ? '' : TIERS[k].label}</div>
        ))}
        {!unacceptable && inherent !== residual && (
          <div className="scale-marker ghost" style={{ left: pos(inherent) }}>{!compact && <span>Before controls {inherent}</span>}</div>
        )}
        <div className="scale-marker" style={{ left: unacceptable ? pos(107) : pos(residual) }}>
          {!compact && <span>{unacceptable ? 'Prohibited' : `${residual}/100`}</span>}
        </div>
      </div>
      {!compact && (
        <div className="scale-legend">
          {[[0, '0'], [cut.limited, String(cut.limited)], [cut.high, String(cut.high)], [100, '100']].map(([v, l]) => <span key={l} style={{ left: pos(v) }}>{l}</span>)}
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const STATUS_TONE = {
  Draft: 'mute', Active: 'ok', 'In production': 'good', Blocked: 'bad', Retired: 'mute',
  'In progress': 'mute', 'Awaiting review': 'ok', Returned: 'warn', Approved: 'good',
};
export function StatusPill({ status }) {
  return <Pill tone={STATUS_TONE[status] || 'mute'}>{status}</Pill>;
}

export function NoAccess({ onHome }) {
  return (
    <div className="panel empty" role="alert">
      <h2 style={{ marginBottom: 6 }}>This page is not available for your role</h2>
      <p className="mute">Each role sees only the pages it needs.</p>
      <button className="btn primary" style={{ marginTop: 14 }} onClick={onHome}>Go to my home page</button>
    </div>
  );
}
