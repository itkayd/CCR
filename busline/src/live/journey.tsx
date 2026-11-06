import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Footprints, MapPin } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, type Data } from '../lib/data';
import { useStore, type Place, type Trip } from '../store/store';
import type { LatLon } from './api';

interface Leg {
  mode: string; duration: number; dep: string; arr: string; line: string | null; towards: string; summary: string;
  from: { name: string; letter: string; lat: number; lon: number }; to: { name: string; lat: number; lon: number };
  stops: number; path: [number, number][];
}
interface Journey { duration: number; start: string; arrive: string; legs: Leg[] }

const MIN_SEARCH_MS = 2400; // long enough to see the network light up
const time = (iso: string) => iso.slice(11, 16);
const isBus = (l: Leg) => l.mode === 'bus' || l.mode === 'tram';

/** Colour of a bus leg: the route's colour at the hub nearest where you board. */
function legColour(data: Data, l: Leg): string {
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

function toTrip(data: Data, j: Journey): Trip {
  const buses = j.legs.filter(isBus);
  return {
    legs: j.legs.map((l) => ({ mode: isBus(l) ? 'bus' : 'walk', c: isBus(l) ? legColour(data, l) : '#6F7C78', path: l.path })),
    points: [
      ...buses.map((l, i) => ({ lon: l.from.lon, lat: l.from.lat, kind: (i === 0 ? 'change' : 'change') as 'change', c: legColour(data, l) })),
      { lon: j.legs[j.legs.length - 1].to.lon, lat: j.legs[j.legs.length - 1].to.lat, kind: 'end', c: '#0B6E69' },
    ],
  };
}

/** The "searching" view: route badges in their colours light up one after another. */
function Searching({ data, to }: { data: Data; to: Place }) {
  const sample = useMemo(() => {
    const coloured = [...data.routes.values()].filter((r) => r.via.length > 1 && !r.night && !r.school);
    const out = [];
    for (let i = 0; i < 18; i++) out.push(coloured[Math.floor((i * 37.3) % coloured.length)]);
    return out;
  }, [data]);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick((n) => n + 1), 140); return () => clearInterval(t); }, []);
  return (
    <div className="searching" role="status" aria-live="polite">
      <div className="searching-title">Finding the fastest buses to {to.name}…</div>
      <div className="searching-bar"><span /></div>
      <div className="searching-badges" aria-hidden="true">
        {sample.map((r, i) => {
          const c = data.hubs.get(r.via[0])!.colour!;
          const on = (tick + i) % 6 === 0;
          return <span key={i} className={`cbadge${on ? ' on' : ''}`} style={{ background: c }}>{r.id}</span>;
        })}
      </div>
      <p className="searching-note">Checking every route, change and walk, with live and timetabled times.</p>
    </div>
  );
}

function LegChips({ data, j }: { data: Data; j: Journey }) {
  return (
    <span className="legchips">
      {j.legs.map((l, i) => (
        <span key={i} className="legchip">
          {i > 0 && <ArrowRight size={12} className="sep-arrow" aria-hidden="true" />}
          {isBus(l)
            ? <span className="cbadge" style={{ background: legColour(data, l) }}>{l.line}</span>
            : <span className="walkchip"><Footprints size={14} aria-hidden="true" />{l.duration}</span>}
        </span>
      ))}
    </span>
  );
}

function LegList({ data, j }: { data: Data; j: Journey }) {
  return (
    <ol className="legs">
      {j.legs.map((l, i) => (
        <li key={i} className={`leg ${isBus(l) ? 'bus' : 'walk'}`} style={{ ['--c' as string]: isBus(l) ? legColour(data, l) : '#8A9692' }}>
          <span className="leg-time">{time(l.dep)}</span>
          <span className="leg-rail" aria-hidden="true" />
          <div className="leg-body">
            {isBus(l) ? (
              <>
                <b><span className="cbadge" style={{ background: legColour(data, l) }}>{l.line}</span> towards {l.towards || l.to.name}</b>
                <span>Board at {l.from.name}{l.from.letter ? ` (Stop ${l.from.letter})` : ''}</span>
                <span className="muted">{l.stops > 1 ? `${l.stops - 1} stops` : '1 stop'}<span className="dot" />{l.duration} min<span className="dot" />get off at {l.to.name}</span>
              </>
            ) : (
              <>
                <b><Footprints size={15} aria-hidden="true" /> Walk {l.duration} min</b>
                <span className="muted">{l.summary.replace(/^Walk to /, 'To ')}</span>
              </>
            )}
          </div>
        </li>
      ))}
      <li className="leg end"><span className="leg-time">{time(j.arrive)}</span><span className="leg-rail" aria-hidden="true" /><div className="leg-body"><b><MapPin size={15} aria-hidden="true" /> Arrive</b></div></li>
    </ol>
  );
}

export function JourneyScreen({ data, pos, to }: { data: Data; pos: LatLon | null; to: Place }) {
  const { back, setSearching, setTrip } = useStore();
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const dest = to.query ?? `${to.lat},${to.lon}`;

  useEffect(() => {
    if (!pos) return;
    let live = true;
    setJourneys(null); setError(null);
    setSearching({ from: pos, to });
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    fetch(`/api/journey?from=${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}&to=${encodeURIComponent(dest)}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then(async (d) => {
        await new Promise((r) => setTimeout(r, Math.max(0, MIN_SEARCH_MS - (Date.now() - t0))));
        if (!live) return;
        if (d.error) throw new Error(d.error);
        setJourneys(d.journeys ?? []); setSel(0);
      })
      .catch((e) => live && setError(e.name === 'AbortError' ? 'the journey planner took too long' : String(e.message)))
      .finally(() => { clearTimeout(timer); if (live) setSearching(null); });
    return () => { live = false; ctl.abort(); setSearching(null); };
  }, [pos?.lat, pos?.lon, dest, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTrip(journeys?.[sel] ? toTrip(data, journeys[sel]) : null);
  }, [journeys, sel, data, setTrip]);
  useEffect(() => () => setTrip(null), [setTrip]);

  const fastest = journeys?.length ? Math.min(...journeys.map((j) => j.duration)) : 0;
  return (
    <>
      <div className="shead">
        <button className="iconbtn ghost" aria-label="Back" onClick={back}><ArrowLeft size={22} /></button>
        <div className="shead-main">
          <span className="shead-text"><b>To {to.name}</b><small>From your location<span className="dot" />buses and walking</small></span>
        </div>
      </div>
      <div className="nlist">
        {!pos && <p className="empty">Getting your location…</p>}
        {pos && !journeys && !error && <Searching data={data} to={to} />}
        {error && (
          <div className="notice errbox"><span>Couldn’t plan this journey: {error}.</span><button className="retry" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>
        )}
        {journeys && !journeys.length && <p className="empty">No bus journeys found. Try a nearby stop or station.</p>}
        {journeys?.map((j, i) => (
          <article key={i} className={`jcard${i === sel ? ' active' : ''}`}>
            <button className="jcard-head" onClick={() => setSel(i)} aria-pressed={i === sel}>
              <span className="jdur"><b>{j.duration}</b><small>min</small></span>
              <span className="jmain">
                <LegChips data={data} j={j} />
                <span className="muted">{time(j.start)} → {time(j.arrive)}{j.duration === fastest ? <span className="fast">Fastest</span> : ''}
                  {(() => { const b = j.legs.find(isBus); return b ? <><span className="dot" />from {b.from.name}{b.from.letter ? ` (${b.from.letter})` : ''}</> : null; })()}
                </span>
              </span>
            </button>
            {i === sel && <LegList data={data} j={j} />}
          </article>
        ))}
        {journeys && journeys.length > 0 && <p className="fineprint">Journey planning by TfL. Times include walking and waiting.</p>}
      </div>
    </>
  );
}
