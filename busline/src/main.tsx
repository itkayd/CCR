import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import { Map } from './components/Map';
import { Sheet } from './components/Sheet';
import { loadData, type Data } from './lib/data';
import { useStore } from './store/store';

function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme, cycleTheme } = useStore();
  useEffect(() => { loadData().then(setData, (e) => setError(String(e))); }, []);

  const date = data ? new Date(data.meta.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">Busline London<small>preview</small></div>
        <div className="spacer" />
        <button className="iconbtn" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`} style={{ fontSize: 13, padding: '0 10px' }}>
          {theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </div>
      <div className="stage">
        {data ? <Map data={data} /> : <div style={{ margin: 'auto', color: 'var(--muted)' }}>{error ?? 'Loading network…'}</div>}
        {data && <Sheet data={data} />}
        {data && (
          <div className="banner">
            <b>Milestone 1 preview.</b> {data.meta.routeCount} routes, {data.meta.majorCount} major stations at geographic positions.
            The octilinear schematic layout comes next. Tap a station or a line.
          </div>
        )}
        <div className="footer">Powered by TfL Open Data{date ? ` · data ${date}` : ''}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
