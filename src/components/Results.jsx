import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PILLARS, PRINCIPLES, PRINCIPLE_IDS, TIERS } from '../data/frameworks.js';
import { riskLabel, sectionName, sectionOrder, readinessStatus } from '../engine/engine.js';
import { Bar, Panel, Pill, RiskScale, toneColor } from './ui.jsx';

export const fwName = sectionName;

export function FrameworkBars({ results, frameworks }) {
  return (
    <div className="stack">
      {sectionOrder(frameworks).map((k) => {
        const f = results.frameworks[k];
        if (!f) return null;
        return (
          <div key={k}>
            <div className="spread small" style={{ marginBottom: 5 }}>
              <span>{fwName(k)}</span>
              <span className="row" style={{ gap: 8 }}><b className="num">{f.score ?? '—'}%</b><Pill tone={f.status.tone}>{f.status.label}</Pill></span>
            </div>
            <Bar value={f.score} color={toneColor(f.status.tone)} />
          </div>
        );
      })}
    </div>
  );
}

export function PillarRadar({ pillars, height = 240 }) {
  const data = Object.entries(PILLARS).map(([k, p]) => ({ pillar: p.short, score: pillars[k]?.score ?? 0 }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="#111111" strokeDasharray="3 3" />
          <PolarAngleAxis dataKey="pillar" tick={{ fontSize: 12, fill: '#111111' }} axisLine={{ stroke: '#111111' }} />
          <PolarRadiusAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: '#111111' }} axisLine={{ stroke: '#111111' }} tickLine={{ stroke: '#111111' }} />
          <Radar dataKey="score" stroke="#2F6B4F" fill="#2F6B4F" fillOpacity={0.22} isAnimationActive={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Six Responsible AI principles: inherent risk against control readiness.
export function PrincipleRadar({ principles, height = 280 }) {
  const data = PRINCIPLE_IDS.map((p) => ({ p: PRINCIPLES[p].short, Risk: principles[p]?.risk ?? 0, Readiness: principles[p]?.readiness ?? 0 }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="66%">
          <PolarGrid stroke="#111111" strokeDasharray="3 3" />
          <PolarAngleAxis dataKey="p" tick={{ fontSize: 12, fill: '#111111' }} axisLine={{ stroke: '#111111' }} />
          <PolarRadiusAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: '#111111' }} axisLine={{ stroke: '#111111' }} tickLine={{ stroke: '#111111' }} />
          <Radar name="Risk" dataKey="Risk" stroke="#B83A2E" fill="#B83A2E" fillOpacity={0.12} isAnimationActive={false} />
          <Radar name="Controls in place" dataKey="Readiness" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} isAnimationActive={false} />
          <Tooltip formatter={(v) => `${v}/100`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PrincipleTable({ principles }) {
  return (
    <table className="table">
      <thead><tr><th>Principle</th><th>Risk</th><th style={{ width: 160 }}>Controls in place</th></tr></thead>
      <tbody>
        {PRINCIPLE_IDS.map((p) => {
          const x = principles[p]; const st = readinessStatus(x.readiness);
          return (
            <tr key={p}>
              <td>{PRINCIPLES[p].name}</td>
              <td><Pill tone={{ High: 'bad', Medium: 'warn', Low: 'good' }[riskLabel(x.risk)]}>{riskLabel(x.risk)}</Pill></td>
              <td><div className="spread small"><span className="num">{x.readiness ?? '—'}%</span></div><Bar value={x.readiness} color={toneColor(st.tone)} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Results({ results, frameworks }) {
  const t = TIERS[results.tier];
  const c = results.cutoffs || { limited: 35, high: 60 };
  return (
    <div className="stack">
      <Panel>
        <div className="grid g-wide" style={{ alignItems: 'center' }}>
          <div>
            <div className="verdict"><span className="big" style={{ color: t.color }}>{t.label} risk</span><span className="mute">score {results.residual}/100</span></div>
            <p className="mute small" style={{ marginTop: 6 }}>{t.meaning}</p>
            <div style={{ marginTop: 40 }}><RiskScale inherent={results.inherent} residual={results.residual} tier={results.tier} cut={c} /></div>
          </div>
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="panel stat"><div className="v num">{results.residual}</div><div className="l">Risk score, after controls</div></div>
            <div className="panel stat"><div className="v num">{results.readiness}%</div><div className="l">Controls in place</div></div>
            <div className="panel stat"><div className="v num">{results.dg.level || '—'}<span className="small mute">/5</span></div><div className="l">Data governance maturity</div></div>
            <div className="panel stat"><div className="v num" style={{ color: results.criticalGaps.length ? 'var(--bad)' : undefined }}>{results.criticalGaps.length}</div><div className="l">Critical gaps</div></div>
          </div>
        </div>
      </Panel>
      <div className="grid g-wide">
        <Panel title="Responsible AI principles"><PrincipleTable principles={results.principles} /></Panel>
        <Panel title="Risk against controls"><PrincipleRadar principles={results.principles} /></Panel>
      </div>
      <div className="grid g3">
        <Panel title="How the tier was set">
          <ul className="list-plain small">{results.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Panel>
        <Panel title="Framework readiness"><FrameworkBars results={results} frameworks={frameworks} /></Panel>
        <Panel title="Data governance"><PillarRadar pillars={results.pillars} height={220} /></Panel>
      </div>
    </div>
  );
}
