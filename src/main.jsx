import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './styles.css';
import App from './App.jsx';
import { StoreProvider } from './store/store.jsx';
import { VerifyPage } from './components/Proof.jsx';

// Pages anyone may open without signing in.
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const on = () => setHash(window.location.hash); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const open = hash === '#verify' ? <VerifyPage onBack={() => { window.location.hash = ''; }} /> : null;
  return <StoreProvider standalone={open}><App /></StoreProvider>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
