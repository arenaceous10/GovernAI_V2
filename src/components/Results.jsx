import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PILLARS, PRINCIPLES, PRINCIPLE_IDS, TIERS, FRAMEWORKS } from '../data/frameworks.js';
import { riskLabel, sectionName, sectionOrder, readinessStatus, tierBand } from '../engine/engine.js';
import { legalByLaw } from '../engine/governance.js';
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
          <PolarGrid stroke="#E3E8EF" />
          <PolarAngleAxis dataKey="pillar" tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={{ stroke: '#D5DCE5' }} />
          <PolarRadiusAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: '#4A5568' }} axisLine={{ stroke: '#D5DCE5' }} tickLine={{ stroke: '#D5DCE5' }} />
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
          <PolarGrid stroke="#E3E8EF" />
          <PolarAngleAxis dataKey="p" tick={{ fontSize: 12, fill: '#4A5568' }} axisLine={{ stroke: '#D5DCE5' }} />
          <PolarRadiusAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: '#4A5568' }} axisLine={{ stroke: '#D5DCE5' }} tickLine={{ stroke: '#D5DCE5' }} />
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
  const v2 = PRINCIPLE_IDS.some((p) => principles[p]?.credit != null);
  return (
    <table className="table">
      <thead><tr><th>Principle</th><th>Risk</th><th style={{ width: 160 }}>Controls in place</th>{v2 && <th>Credit towards the score</th>}</tr></thead>
      <tbody>
        {PRINCIPLE_IDS.map((p) => {
          const x = principles[p]; const st = readinessStatus(x.readiness);
          return (
            <tr key={p}>
              <td>{PRINCIPLES[p].name}</td>
              <td><Pill tone={{ High: 'bad', Medium: 'warn', Low: 'good' }[riskLabel(x.risk)]}>{riskLabel(x.risk)}</Pill></td>
              <td><div className="spread small"><span className="num">{x.readiness ?? '—'}%</span></div><Bar value={x.readiness} color={toneColor(st.tone)} /></td>
              {v2 && <td className="small">{x.creditNote ? <span className="mute">{x.creditNote}</span> : <span className="num">{x.credit}%</span>}{x.floored ? <div className="xs mute">Risk held at Medium by the stakes floor</div> : null}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// The legal position, one law at a time. Kept apart from the governance tier so "High" (the tier) is never confused
// with "high-risk" (an EU AI Act category), and so GDPR and DPDP duties are visible even though they set no tier.
const DPIA_TEXT = { required: 'DPIA required', screen: 'DPIA screening needed', none: 'No DPIA trigger found', na: 'Not applicable: no personal data' };
export function LegalPosition({ profile, frameworks }) {
  const l = legalByLaw(profile, frameworks);
  if (!Object.keys(l).length) return null;
  return (
    <Panel title="Legal position, law by law" sub="Indicative, from the risk profile. It shows which duties to confirm with legal and privacy; it is not legal advice.">
      <div className="grid g3">
        {l.EU_AI_ACT && (
          <div><div className="small" style={{ fontWeight: 600 }}>{FRAMEWORKS.EU_AI_ACT.name}</div>
            <div className="row" style={{ gap: 6, margin: '6px 0' }}><Pill tone={{ unacceptable: 'bad', high: 'bad', limited: 'warn', minimal: 'good' }[l.EU_AI_ACT.tier]}>{l.EU_AI_ACT.category}</Pill><Pill tone="mute">{l.EU_AI_ACT.role}</Pill></div>
            <p className="small mute">{l.EU_AI_ACT.reason}.{l.EU_AI_ACT.derogation ? ' Keep the documented Art. 6(3) assessment and give it to the authority on request.' : ''}{!l.EU_AI_ACT.roleStated ? ' The role is assumed from how the system is sourced: confirm it when you re-assess.' : ''}</p></div>
        )}
        {l.GDPR && (
          <div><div className="small" style={{ fontWeight: 600 }}>{FRAMEWORKS.GDPR.name}</div>
            <div className="row" style={{ gap: 6, margin: '6px 0', flexWrap: 'wrap' }}><Pill tone={{ required: 'bad', screen: 'warn', none: 'good', na: 'mute' }[l.GDPR.dpia]}>{DPIA_TEXT[l.GDPR.dpia]}</Pill>{l.GDPR.art22 && <Pill tone="bad">Art. 22 applies</Pill>}{l.GDPR.special && <Pill tone="warn">Art. 9 condition needed</Pill>}</div>
            <p className="small mute">{l.GDPR.criteria.length ? `Art. 35 indicators: ${l.GDPR.criteria.join(', ')}.` : l.GDPR.applies ? 'None of the usual Art. 35 indicators apply.' : 'The risk profile lists no personal data.'}{l.GDPR.art22 ? ' Decisions are solely automated with a significant effect: people can ask for human review and contest the decision.' : ''}</p></div>
        )}
        {l.DPDP && (
          <div><div className="small" style={{ fontWeight: 600 }}>{FRAMEWORKS.DPDP.name}</div>
            <div className="row" style={{ gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>{!l.DPDP.applies ? <Pill tone="mute">Not applicable: no personal data</Pill> : <>{l.DPDP.sdfCheck ? <Pill tone="warn">Check Significant Data Fiduciary status</Pill> : <Pill tone="good">Standard Data Fiduciary duties</Pill>}{l.DPDP.children && <Pill tone="bad">Children's data: Sec. 9</Pill>}</>}</div>
            <p className="small mute">{!l.DPDP.applies ? 'The risk profile lists no personal data.' : `${l.DPDP.sdfCheck ? 'The scale or sensitivity of the data means the Government could notify you as a Significant Data Fiduciary (Sec. 10): a DPO in India, a yearly DPIA and an independent audit would then apply.' : 'Notice, consent or legitimate use, security safeguards, breach reporting and rights apply.'}${l.DPDP.children ? ' Verifiable parental consent is needed, and tracking, behavioural monitoring and targeted advertising of children are barred.' : ''}`}</p></div>
        )}
      </div>
    </Panel>
  );
}

export default function Results({ results, frameworks, profile }) {
  const t = TIERS[results.tier];
  const c = results.cutoffs || { limited: 35, high: 60 };
  const scoreBand = tierBand(results.residual, c);
  const byLaw = results.tier !== scoreBand && results.legal?.tier === results.tier;
  const byFloor = results.tier !== scoreBand && !byLaw;
  return (
    <div className="stack">
      <Panel>
        <div className="grid g-wide" style={{ alignItems: 'center' }}>
          <div>
            <div className="verdict"><span className="big" style={{ color: t.color }}>{t.label} risk</span>{results.provisional && <span className="tag">Provisional</span>}<span className="mute">score {results.residual}/100</span></div>
            <p className="mute small" style={{ marginTop: 6 }}>{t.meaning}</p>
            {byLaw && <p className="small" style={{ marginTop: 6 }}><b>Set by law, not by the score.</b> The score alone would be {TIERS[scoreBand].label}; {results.legal.reason} sets the tier to {t.label}.</p>}
            {byFloor && <p className="small" style={{ marginTop: 6 }}><b>Set by the severe-risk floor.</b> The score alone would be {TIERS[scoreBand].label}; three or more critical principles are at severe risk.</p>}
            {results.creditSuspended && <p className="small" style={{ marginTop: 6, color: 'var(--bad)' }}><b>Control credit suspended.</b> {(results.signals || []).filter((x) => x.suspends).map((x) => x.text).join('; ')}. The score would be {results.declaredResidual}/100 once resolved.</p>}
            <div style={{ marginTop: 40 }}><RiskScale inherent={results.inherent} residual={results.residual} tier={results.tier} cut={c} /></div>
          </div>
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="panel stat"><div className="v num">{results.residual}</div><div className="l">{results.provisional ? 'Risk score, before controls' : 'Risk score, after controls'}</div></div>
            <div className="panel stat"><div className="v num">{results.questionCount ? `${results.readiness}%` : '—'}</div><div className="l">{!results.questionCount ? 'Controls: assessed at stage 2' : results.provisional ? 'Controls declared, not yet confirmed' : 'Controls in place'}</div></div>
            <div className="panel stat"><div className="v num">{results.dg.level || '—'}<span className="small mute">/5</span></div><div className="l">Data governance maturity</div></div>
            <div className="panel stat"><div className="v num" style={{ color: results.criticalGaps.length ? 'var(--bad)' : undefined }}>{results.criticalGaps.length}</div><div className="l">Critical gaps</div></div>
          </div>
        </div>
      </Panel>
      {profile && <LegalPosition profile={profile} frameworks={frameworks} />}
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
