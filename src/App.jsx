import { useEffect, useState } from 'react';
import { LogOut, BookOpen, BookMarked, ClipboardCheck, Database, FilePlus2, History, LayoutDashboard, Library, ListChecks, Settings, Boxes, Users, Activity } from 'lucide-react';
import { ROLES } from './data/lifecycle.js';
import { useStore, waitingOn } from './store/store.jsx';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewAssessment from './pages/NewAssessment.jsx';
import Products from './pages/Products.jsx';
import Product from './pages/Product.jsx';
import Catalog from './pages/Catalog.jsx';
import AICardPage, { CardRegistry } from './pages/AICard.jsx';
import { ActionsPage, AuditLog, Methodology, ReviewQueue } from './pages/Other.jsx';
import { AdminBank, AdminClients, AdminSettings } from './pages/Admin.jsx';
import { NoAccess, Mark } from './components/ui.jsx';
import { Notifications, QuickSearch, Toaster } from './components/Extras.jsx';
import { VerifyPage } from './components/Proof.jsx';
import Ops from './pages/Ops.jsx';

// Hash holds a plain name (e.g. #product--sys-1) so links survive hosts that only allow simple fragments.
function useHashRoute() {
  const get = () => `/${window.location.hash.replace(/^#\/?/, '').split('--').join('/')}`;
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const nav = (to) => {
    const h = to.replace(/^\//, '').split('/').join('--');
    if (window.location.hash.replace(/^#/, '') === h) setRoute(get()); else window.location.hash = h;
    window.scrollTo({ top: 0 });
  };
  return [route, nav];
}

const DASH = { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard };
const PRODUCTS = { to: '/products', label: 'AI products', icon: Boxes };
const NEW = { to: '/new', label: 'Register a product', icon: FilePlus2 };
const ACTIONS = { to: '/actions', label: 'Actions', icon: ListChecks };
const METHOD = { to: '/method', label: 'How it works', icon: BookOpen };
const CARDS = { to: '/cards', label: 'AI cards', icon: BookMarked };
const OPS = { to: '/ops', label: 'Operations', icon: Activity };
const NAV = {
  client: [DASH, PRODUCTS, CARDS, NEW, ACTIONS, METHOD],
  assessor: [DASH, { to: '/queue', label: 'Review queue', icon: ClipboardCheck, badge: true }, OPS, PRODUCTS, CARDS, { to: '/catalog', label: 'Data catalog', icon: Database }, ACTIONS, METHOD],
  admin: [DASH, OPS, PRODUCTS, CARDS, { to: '/admin', label: 'Clients and users', icon: Users }, { to: '/bank', label: 'Question bank', icon: Library }, { to: '/settings', label: 'Settings', icon: Settings }, { to: '/audit', label: 'Audit log', icon: History }, METHOD],
};
NAV.lead = NAV.assessor;
// Pages reached by link, per role.
const EXTRA = { client: ['product', 'draft', 'reassess', 'card', 'verify'], assessor: ['product', 'card', 'verify'], lead: ['product', 'card', 'verify'], admin: ['product', 'card', 'verify'] };

export default function App() {
  const { role, setRole, state, systems, client, sync, me, signOut } = useStore();
  const [route, nav] = useHashRoute();
  if (!role) return <Landing />;

  const items = NAV[role];
  const home = ROLES[role].home;
  const [, top = '', id] = route.split('/');
  const go = top ? `/${top}` : home;
  const allowed = !top || items.some((n) => n.to === go) || EXTRA[role].includes(top);
  const queue = role === 'assessor' || role === 'lead'
    ? systems.filter((s) => { const w = waitingOn(s); return w.includes(role) || (role === 'lead' && w.includes('assessor')); }).length : 0;
  const sys = id ? systems.find((s) => s.id === id) : null;
  const back = '/products';

  let page;
  if (!allowed) page = <NoAccess onHome={() => nav(home)} />;
  else if (go === '/new') page = <NewAssessment key="new" nav={nav} />;
  else if (go === '/draft') page = sys?.status === 'Draft' ? <NewAssessment key={`d-${id}`} nav={nav} existing={sys} /> : <NotFound nav={nav} />;
  else if (go === '/reassess') page = sys && sys.assessment && sys.status !== 'Draft' ? <NewAssessment key={`r-${id}`} nav={nav} existing={sys} /> : <NotFound nav={nav} />;
  else if (go === '/product') page = <Product key={id} id={id} nav={nav} back={back} />;
  else if (go === '/products') page = <Products nav={nav} />;
  else if (go === '/queue') page = <ReviewQueue nav={nav} />;
  else if (go === '/catalog') page = <Catalog nav={nav} />;
  else if (go === '/cards') page = <CardRegistry nav={nav} />;
  else if (go === '/card') page = <AICardPage key={id} id={id} nav={nav} />;
  else if (go === '/actions') page = <ActionsPage nav={nav} />;
  else if (go === '/method') page = <Methodology />;
  else if (go === '/admin') page = <AdminClients />;
  else if (go === '/bank') page = <AdminBank />;
  else if (go === '/settings') page = <AdminSettings />;
  else if (go === '/audit') page = <AuditLog />;
  else if (go === '/ops') page = <Ops nav={nav} />;
  else if (go === '/verify') page = <VerifyPage onBack={() => window.history.back()} />;
  else page = <Dashboard nav={nav} />;

  const current = go === '/product' || go === '/draft' || go === '/reassess' ? '/products' : go === '/card' ? '/cards' : go;
  const switchValue = role === 'client' ? `client:${state.clientOrg}` : role;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><div className="mark"><Mark /></div><div>GovernAI<small>{role === 'client' ? client?.name : 'Governance team'}</small></div><Notifications nav={nav} /></div>
        {role === 'client' && client?.brand && (
          <div className="client-brand" style={{ borderLeftColor: client.brand.color || undefined }}>
            {client.brand.logo ? <img src={client.brand.logo} alt={`${client.name} logo`} /> : <span style={{ color: client.brand.color }}>{client.name}</span>}
          </div>
        )}
        <QuickSearch nav={nav} pages={items} />
        <nav className="nav" aria-label="Main">
          {items.map(({ to, label, icon: Icon, badge }) => (
            <button key={to} aria-current={current === to ? 'page' : undefined} onClick={() => nav(to)}>
              <Icon size={17} strokeWidth={1.8} /> {label}
              {badge && queue > 0 && <span className="count">{queue}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className={`sync ${sync.error ? 'bad' : sync.mode === 'local' ? 'warn' : ''}`} role="status">
            <i aria-hidden />
            {sync.error ? <span>Not saved. <button onClick={sync.retry}>Retry</button></span> : sync.mode === 'local' ? 'Demo data in this browser' : 'Saved'}
          </div>
          <div className="who"><span className="xs mute">Signed in as</span><b>{me?.name || ROLES[role].name}</b>{me && <span className="xs mute who-sub">{ROLES[role].name}{role === 'client' && client ? ` · ${client.name}` : ''}</span>}</div>
          {sync.mode === 'local' && (
            <select className="input" aria-label="Switch role" value={switchValue} onChange={(e) => {
              const [r, org] = e.target.value.split(':');
              setRole(r, org); nav(ROLES[r].home);
            }}>
              <optgroup label="Client portal">
                {state.clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
              </optgroup>
              <optgroup label="Governance team">
                {['assessor', 'lead', 'admin'].map((k) => <option key={k} value={k}>{ROLES[k].name}</option>)}
              </optgroup>
            </select>
          )}
          <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={async () => { await signOut(); window.location.hash = ''; }}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <main className="main" key={go}>{page}</main>
      <Toaster />
    </div>
  );
}

function NotFound({ nav }) {
  return <div className="panel empty">This product is not available. <button className="btn ghost" onClick={() => nav('/products')}>Back to AI products</button></div>;
}
