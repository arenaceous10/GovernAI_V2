import { useState } from 'react';
import { Building2, ShieldCheck } from 'lucide-react';
import { ROLES, STAGES } from '../data/lifecycle.js';
import { useStore } from '../store/store.jsx';

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
        <div className="brand" style={{ padding: 0 }}><div className="mark">G</div><div>GovernAI</div></div>
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
        <p className="mute small" style={{ color: '#A9B1C3' }}>The AI lifecycle</p>
        <ol className="landing-stages">
          {STAGES.map((s) => (
            <li key={s.n}><span className="ls-n">{s.n}</span><span><b>{s.short}</b><span>{s.gate}</span></span></li>
          ))}
        </ol>
      </div>
    </div>
  );
}
