import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, Footprints, LocateFixed, MapPin, Search } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, type Data } from '../lib/data';
import { useStore, type Place, type Trip } from '../store/store';
import type { LatLon } from './api';
import { LiveIcon } from './NearbySheet';
import { planJourney, warmPlanner } from '../router/client';
import type { Plan } from '../router/raptor';

// ---------------------------------------------------------------- display model
interface UStop { id: string; name: string; letter: string; lat: number; lon: number }
interface ULeg {
  mode: 'bus' | 'walk'; minutes: number; dep: Date; line: string | null; towards: string;
  from: UStop; to: UStop; stops: number; path: [number, number][]; waitMin: number; everyMin: number; metres: number;
}
interface UJourney { minutes: number; start: Date; arrive: Date; rides: number; walkMetres: number; legs: ULeg[] }

const MIN_SEARCH_MS = 2400; // long enough to see the network light up
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const time = (d: Date) => fmt.format(d);
const londonClock = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
};

function toUi(plan: Plan, st: { id: string[]; name: string[]; letter: string[]; lat: number[]; lon: number[] }, now: number): UJourney {
  const stop = (i: number | undefined, fallback: { name: string; lat: number; lon: number }): UStop =>
    i === undefined ? { id: '', name: fallback.name, letter: '', lat: fallback.lat, lon: fallback.lon }
      : { id: st.id[i], name: st.name[i], letter: st.letter[i], lat: st.lat[i], lon: st.lon[i] };
  const legs: ULeg[] = plan.legs.map((l) => {
    if (l.mode === 'walk') {
      const from = stop(l.from.stop, l.from), to = stop(l.to.stop, l.to);
      return { mode: 'walk', minutes: Math.max(1, Math.round(l.seconds / 60)), dep: new Date(now + l.start * 1000), line: null, towards: '', from, to, stops: 0,
        path: [[from.lon, from.lat], [to.lon, to.lat]], waitMin: 0, everyMin: 0, metres: Math.round(l.metres) };
    }
    return {
      mode: 'bus', minutes: Math.max(1, Math.round(l.ride / 60)), dep: new Date(now + (l.start + l.wait) * 1000), line: l.route, towards: l.towards,
      from: stop(l.board, { name: '', lat: 0, lon: 0 }), to: stop(l.alight, { name: '', lat: 0, lon: 0 }), stops: l.stops.length - 1,
      path: l.stops.map((s) => [st.lon[s], st.lat[s]] as [number, number]), waitMin: Math.round(l.wait / 60), everyMin: Math.round(l.headway / 60), metres: 0,
    };
  });
  return { minutes: Math.round(plan.seconds / 60), start: new Date(now), arrive: new Date(now + plan.seconds * 1000), rides: plan.rides, walkMetres: Math.round(plan.walkMetres), legs };
}

/** Colour of a bus leg: the route's colour at the hub nearest where you board. */
function legColour(data: Data, l: ULeg): string {
  const r = l.line ? data.routes.get(l.line) : undefined;
  if (!r) return NEUTRAL;
  let best = '', bd = Infinity;
  for (const id of r.path) {
    const h = data.hubs.get(id)!;
    const d = (h.lat - l.from.lat) ** 2 + ((h.lon - l.from.lon) * 0.62) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best ? colourAt(r, best, data.hubs) : NEUTRAL;
}

function toTrip(data: Data, j: UJourney): Trip {
  return {
    legs: j.legs.map((l) => ({ mode: l.mode, c: l.mode === 'bus' ? legColour(data, l) : '#6F7C78', path: l.path })),
    points: [
      ...j.legs.filter((l) => l.mode === 'bus').map((l) => ({ lon: l.from.lon, lat: l.from.lat, kind: 'change' as const, c: legColour(data, l) })),
      { lon: j.legs[j.legs.length - 1].to.lon, lat: j.legs[j.legs.length - 1].to.lat, kind: 'end', c: '#0B6E69' },
    ],
  };
}

/** Live wait for the first bus of a journey, from the stop you board at. */
function useFirstBusLive(j: UJourney | undefined) {
  const first = j?.legs.find((l) => l.mode === 'bus');
  const [eta, setEta] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!first?.from.id || !first.line) return;
    let live = true;
    setEta(undefined);
    fetch(`/api/arrivals?ids=${first.from.id}`).then((r) => r.json())
      .then((d) => { if (!live) return; const a = (d.arrivals ?? []).find((x: { line: string }) => x.line === first.line); setEta(a ? a.eta : null); })
      .catch(() => live && setEta(null));
    return () => { live = false; };
  }, [first?.from.id, first?.line]);
  return eta;
}

// ---------------------------------------------------------------- pieces
/** The "searching" view: route badges in their colours light up one after another. */
function Searching({ data, to }: { data: Data; to: Place }) {
  const sample = useMemo(() => {
    const coloured = [...data.routes.values()].filter((r) => r.via.length > 1 && !r.night && !r.school);
    return Array.from({ length: 18 }, (_, i) => coloured[Math.floor((i * 37.3) % coloured.length)]);
  }, [data]);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick((n) => n + 1), 140); return () => clearInterval(t); }, []);
  return (
    <div className="searching" role="status" aria-live="polite">
      <div className="searching-title">Finding the fastest buses to {to.name}…</div>
      <div className="searching-bar"><span /></div>
      <div className="searching-badges" aria-hidden="true">
        {sample.map((r, i) => (
          <span key={i} className={`cbadge${(tick + i) % 6 === 0 ? ' on' : ''}`} style={{ background: data.hubs.get(r.via[0])!.colour! }}>{r.id}</span>
        ))}
      </div>
      <p className="searching-note">Checking every route, change and short walk across {data.meta.routeCount} bus routes.</p>
    </div>
  );
}

function LegChips({ data, j }: { data: Data; j: UJourney }) {
  return (
    <span className="legchips">
      {j.legs.map((l, i) => (
        <span key={i} className="legchip">
          {i > 0 && <ArrowRight size={12} className="sep-arrow" aria-hidden="true" />}
          {l.mode === 'bus'
            ? <span className="cbadge" style={{ background: legColour(data, l) }}>{l.line}</span>
            : <span className="walkchip"><Footprints size={14} aria-hidden="true" />{l.minutes}</span>}
        </span>
      ))}
    </span>
  );
}

function LegList({ data, j, liveEta }: { data: Data; j: UJourney; liveEta: number | null | undefined }) {
  const firstBus = j.legs.findIndex((l) => l.mode === 'bus');
  return (
    <ol className="legs">
      {j.legs.map((l, i) => (
        <li key={i} className={`leg ${l.mode}`} style={{ ['--c' as string]: l.mode === 'bus' ? legColour(data, l) : '#8A9692' }}>
          <span className="leg-time">{time(l.dep)}</span>
          <span className="leg-rail" aria-hidden="true" />
          <div className="leg-body">
            {l.mode === 'bus' ? (
              <>
                <b><span className="cbadge" style={{ background: legColour(data, l) }}>{l.line}</span> towards {l.towards}</b>
                <span>Board at {l.from.name}{l.from.letter ? ` (Stop ${l.from.letter})` : ''}</span>
                {i === firstBus && typeof liveEta === 'number'
                  ? <span className="livewait"><LiveIcon /> Next {l.line} {liveEta < 60 ? 'due now' : `in ${Math.floor(liveEta / 60)} min`}</span>
                  : <span className="muted">Every {l.everyMin} min{l.waitMin ? <><span className="dot" />allow {l.waitMin} min to wait</> : ''}</span>}
                <span className="muted">{l.stops === 1 ? '1 stop' : `${l.stops} stops`}<span className="dot" />{l.minutes} min<span className="dot" />get off at {l.to.name}</span>
              </>
            ) : (
              <>
                <b><Footprints size={15} aria-hidden="true" /> Walk {l.minutes} min</b>
                <span className="muted">{l.metres} m to {l.to.name}</span>
              </>
            )}
          </div>
        </li>
      ))}
      <li className="leg end"><span className="leg-time">{time(j.arrive)}</span><span className="leg-rail" aria-hidden="true" /><div className="leg-body"><b><MapPin size={15} aria-hidden="true" /> Arrive</b></div></li>
    </ol>
  );
}

function JourneyCard({ data, j, active, fastest, fewest, onSelect }: { data: Data; j: UJourney; active: boolean; fastest: boolean; fewest: boolean; onSelect: () => void }) {
  const liveEta = useFirstBusLive(active ? j : undefined);
  const first = j.legs.find((l) => l.mode === 'bus');
  return (
    <article className={`jcard${active ? ' active' : ''}`}>
      <button className="jcard-head" onClick={onSelect} aria-pressed={active}>
        <span className="jdur"><b>{j.minutes}</b><small>min</small></span>
        <span className="jmain">
          <LegChips data={data} j={j} />
          <span className="muted">
            {time(j.start)} → {time(j.arrive)}
            {fastest && <span className="fast">Fastest</span>}
            {fewest && !fastest && <span className="fast alt">Fewest changes</span>}
          </span>
          {first && <span className="muted">From {first.from.name}{first.from.letter ? ` (${first.from.letter})` : ''}{j.rides > 1 ? <><span className="dot" />{j.rides - 1} change{j.rides > 2 ? 's' : ''}</> : ''}</span>}
        </span>
      </button>
      {active && <LegList data={data} j={j} liveEta={liveEta} />}
    </article>
  );
}

/** Choose where to start: your location or any place. */
function FromPicker({ data, onPick, onClose }: { data: Data; onPick: (p: Place | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const places = ql.length < 2 ? [] : [...data.hubs.values()].filter((h) => h.name.toLowerCase().includes(ql))
    .sort((a, b) => Number(b.major) - Number(a.major) || b.routes.length - a.routes.length).slice(0, 8);
  return (
    <div className="frompicker">
      <div className="nsearch">
        <Search size={20} aria-hidden="true" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start from a stop or place" aria-label="Start from" />
        <button className="iconbtn ghost" onClick={onClose}>Cancel</button>
      </div>
      <div className="results">
        <button className="result" onClick={() => onPick(null)}><span className="pdot go"><LocateFixed size={16} /></span><span className="result-text">Your location</span></button>
        {places.map((h) => (
          <button key={h.id} className="result" onClick={() => onPick({ name: h.name, lat: h.lat, lon: h.lon })}>
            <span className="pdot" style={{ background: h.major ? h.colour : 'var(--surface)', boxShadow: h.major ? undefined : 'inset 0 0 0 3px #8A9692' }} />
            <span className="result-text">{h.name}<small>{h.routes.length} routes</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screen
export function JourneyScreen({ data, pos, to: initialTo }: { data: Data; pos: LatLon | null; to: Place }) {
  const { back, setSearching, setTrip } = useStore();
  const [to, setTo] = useState<Place>(initialTo);
  const [from, setFrom] = useState<Place | null>(null); // null = your location
  const [picking, setPicking] = useState(false);
  const [journeys, setJourneys] = useState<UJourney[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);

  const start = from ?? (pos ? { name: 'Your location', lat: pos.lat, lon: pos.lon } : null);
  useEffect(() => { warmPlanner(); }, []);
  // postcodes: look up their position (postcodes.io: free, no key)
  useEffect(() => {
    if (to.lat !== undefined || !to.query) return;
    let live = true;
    fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(to.query)}`).then((r) => r.json())
      .then((d) => { if (live && d.result) setTo({ name: d.result.postcode, lat: d.result.latitude, lon: d.result.longitude }); else if (live) setError('that postcode wasn’t found'); })
      .catch(() => live && setError('couldn’t look up that postcode'));
    return () => { live = false; };
  }, [to]);

  useEffect(() => {
    if (!start || to.lat === undefined || to.lon === undefined) return;
    let live = true;
    setJourneys(null); setError(null);
    setSearching({ from: { lat: start.lat!, lon: start.lon! }, to });
    const t0 = Date.now();
    planJourney({ lat: start.lat!, lon: start.lon!, name: start.name }, { lat: to.lat, lon: to.lon, name: to.name }, londonClock())
      .then(async (res) => {
        await new Promise((r) => setTimeout(r, Math.max(0, MIN_SEARCH_MS - (Date.now() - t0))));
        if (!live) return;
        if (res.error || !res.plans || !res.stops) throw new Error(res.error ?? 'no result');
        const now = Date.now();
        setJourneys(res.plans.map((p) => toUi(p, res.stops!, now))); setSel(0);
      })
      .catch((e) => live && setError(String(e.message ?? e)))
      .finally(() => { if (live) setSearching(null); });
    return () => { live = false; setSearching(null); };
  }, [start?.lat, start?.lon, to.lat, to.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setTrip(journeys?.[sel] ? toTrip(data, journeys[sel]) : null); }, [journeys, sel, data, setTrip]);
  useEffect(() => () => setTrip(null), [setTrip]);

  const swap = () => {
    if (!start) return;
    setTo({ name: start.name, lat: start.lat, lon: start.lon });
    setFrom(to);
  };
  const fastest = journeys?.length ? Math.min(...journeys.map((j) => j.minutes)) : 0;
  const fewest = journeys?.filter((j) => j.rides > 0).length ? Math.min(...journeys.filter((j) => j.rides > 0).map((j) => j.rides)) : 0;

  if (picking) return <FromPicker data={data} onClose={() => setPicking(false)} onPick={(p) => { setFrom(p); setPicking(false); }} />;
  return (
    <>
      <div className="shead">
        <button className="iconbtn ghost" aria-label="Back" onClick={back}><ArrowLeft size={22} /></button>
        <div className="fromto">
          <button className="ftrow" onClick={() => setPicking(true)} aria-label="Change start">
            <span className="ftdot me" /><span className="ftlabel">From</span><b>{from ? from.name : 'Your location'}</b>
          </button>
          <div className="ftrow static"><span className="ftdot end" /><span className="ftlabel">To</span><b>{to.name}</b></div>
        </div>
        <button className="iconbtn ghost" aria-label="Swap start and destination" onClick={swap}><ArrowDownUp size={20} /></button>
      </div>
      <div className="nlist">
        {!start && <p className="empty">Getting your location…</p>}
        {start && to.lat === undefined && !error && <p className="empty">Finding {to.name}…</p>}
        {start && !journeys && !error && to.lat !== undefined && <Searching data={data} to={to} />}
        {error && <div className="notice errbox"><span>Couldn’t plan this journey: {error}.</span></div>}
        {journeys && !journeys.length && <p className="empty">No bus journey found within a few changes. Try a nearby stop or station.</p>}
        {journeys?.map((j, i) => (
          <JourneyCard key={i} data={data} j={j} active={i === sel} fastest={j.minutes === fastest} fewest={j.rides === fewest && journeys.filter((x) => x.rides === fewest).indexOf(j) === 0}
            onSelect={() => setSel(i)} />
        ))}
        {journeys && journeys.length > 0 && <p className="fineprint">Planned by Busline from bus timetables and typical waits. Live times shown for your first bus.</p>}
      </div>
    </>
  );
}
