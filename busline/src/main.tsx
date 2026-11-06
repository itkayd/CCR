import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import './styles/tokens.css';
import { Map } from './components/Map';
import { Sheet } from './components/Sheet';
import { loadData, type Data } from './lib/data';
import { useStore } from './store/store';

const TOAST_KEY = 'busline.toast.preview.v1';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function Toast({ text }: { text: string }) {
  const [show, setShow] = useState(() => !store.get(TOAST_KEY));
  if (!show) return null;
  const close = () => { store.set(TOAST_KEY, '1'); setShow(false); };
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      <button className="iconbtn ghost" aria-label="Dismiss" onClick={close}><X size={18} /></button>
    </div>
  );
}

function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme, cycleTheme } = useStore();
  useEffect(() => { loadData().then(setData, (e) => setError(String(e))); }, []);

  const date = data ? new Date(data.meta.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const ThemeIcon = theme === 'auto' ? Monitor : theme === 'dark' ? Moon : Sun;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Busline<span>London</span></div>
        <div className="spacer" />
        <button className="iconbtn ghost" onClick={cycleTheme} aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`}>
          <ThemeIcon size={20} />
        </button>
      </header>
      <main className="stage">
        {data ? <Map data={data} /> : <div className="loading">{error ?? 'Loading network…'}</div>}
        {data && <Sheet data={data} />}
        {data && <Toast text={`Preview: ${data.meta.routeCount} routes and ${data.meta.majorCount} major stations. Tap a station or a line.`} />}
        <div className="footer">Powered by TfL Open Data{date ? `, ${date}` : ''}</div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
