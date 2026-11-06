import { Component, StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Layers, Map as MapIcon, Monitor, Moon, Network, Sun } from 'lucide-react';
import './styles/tokens.css';
import { Map as SchematicMap } from './components/Map';
import { Sheet } from './components/Sheet';
import { loadData, type Data } from './lib/data';
import { useStore } from './store/store';
import { LiveMap, PROVIDERS, type Provider } from './live/LiveMap';
import { NearbySheet } from './live/NearbySheet';
import { useArrivals, useLocation, useNearby } from './live/api';
import { warmPlanner } from './router/client';
import { startReminders } from './live/reminders';

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

/** One button for map style and theme, so the map stays clear. */
function LayersMenu() {
  const { provider, setProvider, theme, setTheme } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="layers">
      <button className="roundbtn" aria-label="Map style and theme" aria-expanded={open} onClick={() => setOpen(!open)}><Layers size={21} /></button>
      {open && (
        <div className="layers-panel" role="dialog" aria-label="Map settings">
          <h4>Map style</h4>
          <div className="seg">
            {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
              <button key={p} aria-pressed={provider === p} onClick={() => setProvider(p)}>{PROVIDERS[p].label}</button>
            ))}
          </div>
          <h4>Theme</h4>
          <div className="seg">
            {([['auto', Monitor, 'Auto'], ['light', Sun, 'Light'], ['dark', Moon, 'Dark']] as const).map(([t, Icon, label]) => (
              <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}><Icon size={15} />{label}</button>
            ))}
          </div>
          <button className="layers-done" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}

/** A map failure (WebGL, tiles, an old browser) must not take the Nearby sheet down with it. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('map failed', e); }
  render() {
    return this.state.failed
      ? <div className="livemap mapfail"><p>The map couldn’t load on this device. Live times below still work.</p></div>
      : this.props.children;
  }
}

function Live({ data }: { data: Data }) {
  const { pos, state } = useLocation();
  const { stops, error, retry } = useNearby(pos);
  const setMe = useStore((x) => x.setMe);
  useEffect(() => { setMe(state === 'ok' ? pos : null); }, [pos, state, setMe]);
  const [stopHub, setStopHub] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch('/data/stops.json').then((r) => r.json()).then((rows: [string, number, number, string][]) => setStopHub(new Map(rows.map((r) => [r[0], r[3]]))));
  }, []);
  // reminders for saved trips (while the app is open or in the background)
  useEffect(() => startReminders(), []);
  // get the journey planner's network ready in the background once the home screen has settled
  useEffect(() => { const t = window.setTimeout(warmPlanner, 4000); return () => clearTimeout(t); }, []);
  const ids = useMemo(() => (stops ?? []).slice(0, 12).map((s) => s.id), [stops]);
  const { arrivals, updated } = useArrivals(ids, true);
  return (
    <>
      <MapBoundary><LiveMap data={data} pos={pos} nearby={stops} /></MapBoundary>
      <div className="floattop">
        <ModeSwitch />
      </div>
      <LayersMenu />
      <NearbySheet data={data} stopHub={stopHub} pos={pos} locState={state} stops={stops} error={error} retry={retry} arrivals={arrivals} updated={updated} />
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
