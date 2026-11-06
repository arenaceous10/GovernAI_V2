import { useState } from 'react';
import { Building2, Check, FileCheck2, LockKeyhole, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { ROLES } from '../data/lifecycle.js';
import { useStore } from '../store/store.jsx';
import { Mark, ParticleField } from '../components/ui.jsx';

const OPTIONS = [
  { id: 'client', icon: Building2, title: 'Client portal', text: 'Register AI products, attach evidence and follow each one through approval.' },
  { id: 'team', icon: ShieldCheck, title: 'Governance team', text: 'Review evidence, sign off lifecycle stages and oversee the portfolio.' },
];

export default function Landing() {
  const { setRole } = useStore();
  const [side, setSide] = useState('');
  const [teamRole, setTeamRole] = useState('assessor');
  const enter = () => (side === 'client' ? setRole('client') : setRole(teamRole));
  return (
    <div className="landing">
      <div className="landing-l">
        <div className="brand" style={{ padding: 0 }}><div className="mark"><Mark /></div><div>GovernAI</div></div>
        <h1>Responsible AI governance, from intake to retirement.</h1>
        <p className="lead">One place to register AI products, score their risk and approve every lifecycle stage on evidence.</p>

        <div className="entry" role="radiogroup" aria-label="How do you want to sign in?">
          {OPTIONS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={side === o.id} className="entry-card" onClick={() => setSide(o.id)}>
              <span className="entry-ico"><o.icon size={20} /></span>
              <span><b>{o.title}</b><span>{o.text}</span></span>
            </button>
          ))}
        </div>
        {side === 'team' && (
          <div className="seg" role="radiogroup" aria-label="Your role">
            {['assessor', 'lead', 'admin'].map((r) => (
              <button key={r} type="button" role="radio" aria-checked={teamRole === r} onClick={() => setTeamRole(r)}>{ROLES[r].name}</button>
            ))}
          </div>
        )}
        <button type="button" className="btn primary enter-btn" disabled={!side} onClick={enter}>Enter GovernAI</button>
        <p className="demo">Demo workspace with sample data.</p>
      </div>

      <div className="landing-r">
        <ParticleField density={0.00012} />
        <div className="landing-message">
          <h2>Make responsible AI a practice, not a promise.</h2>
          <p>Bring evidence, ownership and oversight together in one clear view.</p>
        </div>

        <div className="governance-preview" aria-hidden="true">
          <div className="preview-head">
            <div><span className="preview-eyebrow">Review snapshot</span><strong>AI product review</strong></div>
            <span className="preview-shield"><ShieldCheck size={20} /></span>
          </div>
          <div className="preview-product">
            <span className="preview-product-mark">AI</span>
            <span><b>Clinical triage assistant</b><small>Internal decision support</small></span>
          </div>
          <div className="preview-divider" />
          <div className="preview-row">
            <span className="preview-row-icon"><FileCheck2 size={17} /></span>
            <span><b>Evidence documented</b><small>Records linked to decisions</small></span>
            <Check className="preview-check" size={17} />
          </div>
          <div className="preview-row">
            <span className="preview-row-icon"><UserRoundCheck size={17} /></span>
            <span><b>Accountable owner</b><small>Review responsibility assigned</small></span>
            <Check className="preview-check" size={17} />
          </div>
          <div className="preview-status"><span />Ready for governance review</div>
        </div>

        <div className="landing-footnote"><LockKeyhole size={14} />Private demo workspace</div>
      </div>
    </div>
  );
}
