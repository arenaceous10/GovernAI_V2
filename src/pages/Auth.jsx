// Sign in, create an account, reset a password, and the "waiting for approval" screen.
// Talks to Supabase Auth directly. What an account can see is decided in the database, not here.
import { useState } from 'react';
import { Building2, Eye, EyeOff, Loader2, LogOut, MailCheck, ShieldCheck } from 'lucide-react';
import { STAGES } from '../data/lifecycle.js';
import { cloud } from '../lib/cloud.js';

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const redirect = () => `${window.location.origin}${window.location.pathname}`;
const friendly = (m = '') => {
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link we sent.';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/password/i.test(m) && /characters|short|weak/i.test(m)) return 'Choose a stronger password: at least 8 characters.';
  return m || 'Something went wrong. Try again.';
};

const SIDES = [
  { id: 'client', icon: Building2, title: 'Client', text: 'Register AI products and take them through each stage.' },
  { id: 'team', icon: ShieldCheck, title: 'Governance team', text: 'Review evidence and sign off stages.' },
];

function Shell({ children }) {
  return (
    <div className="landing auth">
      <div className="landing-l">
        <div className="brand" style={{ padding: 0 }}><div className="mark">G</div><div>GovernAI</div></div>
        <div className="auth-card fade-in">{children}</div>
      </div>
      <div className="landing-r">
        <h2 className="auth-tag">Responsible AI governance, from intake to retirement.</h2>
        <p className="mute small" style={{ color: '#A9B1C3', marginTop: 26 }}>The AI lifecycle</p>
        <ol className="landing-stages">
          {STAGES.map((s) => (
            <li key={s.n}><span className="ls-n">{s.n}</span><span><b>{s.short}</b><span>{s.gate}</span></span></li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Password({ value, onChange, label = 'Password', autoComplete, id }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="pw">
        <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required />
        <button type="button" className="pw-eye" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
    </label>
  );
}

export function AuthScreen({ mode: initial = 'signin', onDone }) {
  const [mode, setMode] = useState(initial);
  const [f, setF] = useState({ email: '', password: '', name: '', side: '', company: '', requestedRole: 'assessor' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');
  const up = (p) => setF((x) => ({ ...x, ...p }));
  const go = (m) => { setMode(m); setErr(''); setSent(''); };

  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(friendly(e.message)); } finally { setBusy(false); } };

  const signIn = (e) => { e.preventDefault(); run(async () => {
    if (!emailOk(f.email) || !f.password) throw new Error('Enter your email and password.');
    const { error } = await cloud.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    if (error) throw error;
  }); };

  const signUp = (e) => { e.preventDefault(); run(async () => {
    if (!f.side) throw new Error('Choose Client or Governance team.');
    if (!f.name.trim()) throw new Error('Enter your full name.');
    if (!emailOk(f.email)) throw new Error('Enter a valid email address.');
    if (f.side === 'client' && !f.company.trim()) throw new Error('Enter your organisation name.');
    if (f.password.length < 8) throw new Error('Choose a password with at least 8 characters.');
    const { data, error } = await cloud.auth.signUp({
      email: f.email.trim(), password: f.password,
      options: { emailRedirectTo: redirect(), data: { name: f.name.trim(), side: f.side, company: f.side === 'client' ? f.company.trim() : null, requested_role: f.side === 'team' ? f.requestedRole : null } },
    });
    if (error) throw error;
    // Supabase hides whether an email is already registered: an existing account comes back with no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('already registered');
    if (!data.session) setSent('confirm');
  }); };

  const forgot = (e) => { e.preventDefault(); run(async () => {
    if (!emailOk(f.email)) throw new Error('Enter the email you signed up with.');
    const { error } = await cloud.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: redirect() });
    if (error) throw error;
    setSent('reset');
  }); };

  const setNew = (e) => { e.preventDefault(); run(async () => {
    if (f.password.length < 8) throw new Error('Choose a password with at least 8 characters.');
    const { error } = await cloud.auth.updateUser({ password: f.password });
    if (error) throw error;
    window.history.replaceState(null, '', window.location.pathname);
    onDone?.();
  }); };

  if (sent) {
    return (
      <Shell>
        <div className="auth-done">
          <span className="auth-ico"><MailCheck size={22} /></span>
          <h1>Check your email</h1>
          <p className="mute">{sent === 'confirm'
            ? <>We sent a confirmation link to <b>{f.email}</b>. Open it to finish creating your account, then sign in.</>
            : <>If an account exists for <b>{f.email}</b>, you'll get a link to choose a new password.</>}</p>
          <button className="btn" onClick={() => go('signin')}>Back to sign in</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {(mode === 'signin' || mode === 'signup') && (
        <div className="auth-tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'signin'} onClick={() => go('signin')}>Sign in</button>
          <button role="tab" aria-selected={mode === 'signup'} onClick={() => go('signup')}>Create account</button>
        </div>
      )}
      {err && <div className="callout bad small" role="alert" style={{ marginBottom: 12 }}>{err}</div>}

      {mode === 'signin' && (
        <form className="stack" onSubmit={signIn} noValidate>
          <h1>Welcome back</h1>
          <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => up({ email: e.target.value })} /></label>
          <Password value={f.password} onChange={(v) => up({ password: v })} autoComplete="current-password" />
          <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={15} className="spin" />} Sign in</button>
          <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => go('forgot')}>Forgot password?</button>
        </form>
      )}

      {mode === 'signup' && (
        <form className="stack" onSubmit={signUp} noValidate>
          <h1>Create your account</h1>
          <div className="auth-sides" role="radiogroup" aria-label="I am joining as">
            {SIDES.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={f.side === o.id} className="entry-card" onClick={() => up({ side: o.id })}>
                <span className="entry-ico"><o.icon size={18} /></span>
                <span><b>{o.title}</b><span>{o.text}</span></span>
              </button>
            ))}
          </div>
          <label className="field"><span>Full name</span><input className="input" autoComplete="name" value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
          <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => up({ email: e.target.value })} /></label>
          {f.side === 'client' && (
            <label className="field"><span>Organisation</span><input className="input" autoComplete="organization" value={f.company} onChange={(e) => up({ company: e.target.value })} />
              <small>A new organisation is ready straight away. Joining one that already uses GovernAI needs an administrator's approval.</small></label>
          )}
          {f.side === 'team' && (
            <label className="field"><span>Role you need</span>
              <select className="input" value={f.requestedRole} onChange={(e) => up({ requestedRole: e.target.value })}>
                <option value="assessor">Governance reviewer</option><option value="lead">Governance lead</option>
              </select>
              <small>An administrator confirms governance team access before you can sign in.</small></label>
          )}
          <Password value={f.password} onChange={(v) => up({ password: v })} autoComplete="new-password" />
          <small className="xs mute" style={{ marginTop: -6 }}>At least 8 characters.</small>
          <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={15} className="spin" />} Create account</button>
        </form>
      )}

      {mode === 'forgot' && (
        <form className="stack" onSubmit={forgot} noValidate>
          <h1>Reset your password</h1>
          <p className="mute small">We'll email you a link to choose a new one.</p>
          <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => up({ email: e.target.value })} /></label>
          <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={15} className="spin" />} Send reset link</button>
          <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => go('signin')}>Back to sign in</button>
        </form>
      )}

      {mode === 'recovery' && (
        <form className="stack" onSubmit={setNew} noValidate>
          <h1>Choose a new password</h1>
          <Password value={f.password} onChange={(v) => up({ password: v })} label="New password" autoComplete="new-password" />
          <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={15} className="spin" />} Save password</button>
        </form>
      )}
    </Shell>
  );
}

export function PendingScreen({ profile, onSignOut }) {
  const disabled = profile?.status === 'disabled';
  const broken = profile?.status === 'error' || profile?.status === 'missing';
  return (
    <Shell>
      <div className="auth-done">
        <span className="auth-ico"><ShieldCheck size={22} /></span>
        <h1>{disabled ? 'Access turned off' : broken ? 'Account not set up' : 'Waiting for approval'}</h1>
        <p className="mute">
          {disabled ? 'An administrator has turned off access for this account.'
            : broken ? "We couldn't load your access details. Sign out and try again, or contact your administrator."
              : profile?.side === 'team'
                ? 'Governance team accounts are confirmed by an administrator. You can sign in once your role is assigned.'
                : `${profile?.company || 'Your organisation'} already uses GovernAI, so an administrator needs to approve you before you can see its products.`}
        </p>
        <p className="small mute">Signed in as {profile?.email}</p>
        <button className="btn" onClick={onSignOut}><LogOut size={15} /> Sign out</button>
      </div>
    </Shell>
  );
}
