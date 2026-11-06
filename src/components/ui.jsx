import { useEffect, useRef, useState } from 'react';
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

export function Single({ options, value, onChange, name, className = 'choices' }) {
  return (
    <div className={className} role="radiogroup" aria-label={name}>
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
            <span className="dot" aria-hidden />
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

// Brand mark: a small branching "G" made of nodes, echoing a governed network.
export function Mark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark-svg">
      <path d="M19 7.5A8 8 0 1 0 20 13h-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="13" cy="13" r="2.2" fill="#FFB81C" />
    </svg>
  );
}

// Number that counts up when it first appears (skipped when the person prefers reduced motion).
export function CountUp({ value, ms = 700 }) {
  const n = typeof value === 'number' ? value : null;
  const [v, setV] = useState(n == null ? value : 0);
  useEffect(() => {
    if (n == null) { setV(value); return undefined; }
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || n === 0) { setV(n); return undefined; }
    let raf; const t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / ms); setV(Math.round(n * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [n, value, ms]);
  return <>{v}</>;
}

// A slow, quiet field of linked points (a governed network). Canvas, paused when off screen or hidden.
export function ParticleField({ density = 0.00009, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return undefined;
    const ctx = c.getContext('2d'); if (!ctx) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0; let h = 0; let pts = []; let raf = 0; let visible = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      const r = c.getBoundingClientRect(); w = r.width; h = r.height;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(18, Math.min(90, Math.round(w * h * density)));
      pts = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18, r: Math.random() * 1.4 + 0.6, gold: Math.random() < 0.12 }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j]; const dx = a.x - b.x; const dy = a.y - b.y; const d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120) { ctx.strokeStyle = `rgba(120, 190, 235, ${0.16 * (1 - Math.sqrt(d2) / 120)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
      }
      for (const p of pts) { ctx.fillStyle = p.gold ? 'rgba(255, 184, 28, 0.9)' : 'rgba(190, 225, 255, 0.75)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    };
    const tick = () => {
      for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; }
      draw(); if (visible) raf = requestAnimationFrame(tick);
    };
    size(); draw();
    const ro = new ResizeObserver(() => { size(); draw(); }); ro.observe(c);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; cancelAnimationFrame(raf); if (visible && !reduce) raf = requestAnimationFrame(tick); });
    io.observe(c);
    const vis = () => { visible = !document.hidden; cancelAnimationFrame(raf); if (visible && !reduce) raf = requestAnimationFrame(tick); };
    document.addEventListener('visibilitychange', vis);
    if (!reduce) raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, [density]);
  return <canvas ref={ref} className={`particles ${className}`} aria-hidden="true" />;
}
