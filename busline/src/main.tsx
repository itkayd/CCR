import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Map as MapIcon, Monitor, Moon, Network, Sun } from 'lucide-react';
import './styles/tokens.css';
import { Map as SchematicMap } from './components/Map';
import { Sheet } from './components/Sheet';
import { loadData, type Data } from './lib/data';
import { useStore } from './store/store';
import { LiveMap, PROVIDERS, type Provider } from './live/LiveMap';
import { NearbySheet } from './live/NearbySheet';
import { useArrivals, useLocation, useNearby } from './live/api';

function ThemeButton() {
  const { theme, cycleTheme } = useStore();
  const Icon = theme === 'auto' ? Monitor : theme === 'dark' ? Moon : Sun;
  return (
    <button className="roundbtn" onClick={cycleTheme} aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`}>
      <Icon size={20} />
    </button>
  );
}

function ModeSwitch() {
  const { mode, setMode } = useStore();
  return (
    <div className="modeswitch" role="tablist" aria-label="Map view">
      <button role="tab" aria-selected={mode === 'live'} onClick={() => setMode('live')}><MapIcon size={16} />Map</button>
      <button role="tab" aria-selected={mode === 'schematic'} onClick={() => setMode('schematic')}><Network size={16} />Schematic</button>
    </div>
  );
}

function ProviderTabs() {
  const { provider, setProvider } = useStore();
  return (
    <div className="subtabs" role="tablist" aria-label="Map style">
      {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
        <button key={p} role="tab" aria-selected={provider === p} onClick={() => setProvider(p)}>{PROVIDERS[p].label}</button>
      ))}
    </div>
  );
}

function Live({ data }: { data: Data }) {
  const { pos, state } = useLocation();
  const { stops, error } = useNearby(pos);
  const [stopHub, setStopHub] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch('/data/stops.json').then((r) => r.json()).then((rows: [string, number, number, string][]) => setStopHub(new Map(rows.map((r) => [r[0], r[3]]))));
  }, []);
  const ids = useMemo(() => (stops ?? []).slice(0, 12).map((s) => s.id), [stops]);
  const { arrivals, updated } = useArrivals(ids, true);
  return (
    <>
      <LiveMap data={data} pos={pos} nearby={stops} />
      <div className="floattop">
        <div className="floatrow">
          <ModeSwitch />
          <ThemeButton />
        </div>
        <ProviderTabs />
      </div>
      <NearbySheet data={data} stopHub={stopHub} pos={pos} locState={state} stops={stops} error={error} arrivals={arrivals} updated={updated} />
    </>
  );
}

function Schematic({ data }: { data: Data }) {
  const date = new Date(data.meta.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="app">
      <header className="topbar">
        <ModeSwitch />
        <div className="spacer" />
        <ThemeButton />
      </header>
      <main className="stage">
        <SchematicMap data={data} />
        <Sheet data={data} />
        <div className="footer">Powered by TfL Open Data, {date}</div>
      </main>
    </div>
  );
}

function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { mode } = useStore();
  useEffect(() => { loadData().then(setData, (e) => setError(String(e))); }, []);
  if (!data) return <div className="loading">{error ?? 'Loading network…'}</div>;
  return mode === 'live' ? <Live data={data} /> : <Schematic data={data} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
