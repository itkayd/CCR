import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, Clock, Footprints, LocateFixed, MapPin, Plus, Search, Shuffle, X } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, type Data } from '../lib/data';
import { useStore, type Place, type Trip } from '../store/store';
import type { LatLon } from './api';
import { LiveIcon } from './NearbySheet';
import { planTrip, warmPlanner } from '../router/client';
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

/** Everything to draw: the chosen journey of each leg of the trip, numbered stops, the destination. */
function toTrip(data: Data, js: UJourney[], vias: { lat: number; lon: number; label: string }[]): Trip {
  const legs = js.flatMap((j) => j.legs);
  if (!legs.length) return { legs: [], points: [] };
  const last = legs[legs.length - 1].to;
  return {
    legs: legs.map((l) => ({ mode: l.mode, c: l.mode === 'bus' ? legColour(data, l) : '#6F7C78', path: l.path })),
    points: [
      ...legs.filter((l) => l.mode === 'bus').map((l) => ({ lon: l.from.lon, lat: l.from.lat, kind: 'change' as const, c: legColour(data, l) })),
      ...vias.map((v) => ({ lon: v.lon, lat: v.lat, kind: 'via' as const, c: '#0B6E69', label: v.label })),
      { lon: last.lon, lat: last.lat, kind: 'end', c: '#0B6E69' },
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

/** Pick a place: your location (if allowed) or any stop or station. */
function PlacePicker({ data, title, allowMe, onPick, onClose }: { data: Data; title: string; allowMe: boolean; onPick: (p: Place | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const places = ql.length < 2 ? [] : [...data.hubs.values()].filter((h) => h.name.toLowerCase().includes(ql))
    .sort((a, b) => Number(b.major) - Number(a.major) || b.routes.length - a.routes.length).slice(0, 8);
  return (
    <div className="frompicker">
      <div className="nsearch">
        <Search size={20} aria-hidden="true" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={title} aria-label={title} />
        <button className="iconbtn ghost" onClick={onClose}>Cancel</button>
      </div>
      <div className="results">
        {allowMe && <button className="result" onClick={() => onPick(null)}><span className="pdot go"><LocateFixed size={16} /></span><span className="result-text">Your location</span></button>}
        {places.map((h) => (
          <button key={h.id} className="result" onClick={() => onPick({ name: h.name, lat: h.lat, lon: h.lon })}>
            <span className="pdot" style={{ background: h.major ? h.colour : 'var(--surface)', boxShadow: h.major ? undefined : 'inset 0 0 0 3px #8A9692' }} />
            <span className="result-text">{h.name}<small>{h.routes.length} routes</small></span>
          </button>
        ))}
        {ql.length >= 2 && !places.length && <p className="empty">No stops or places match “{q}”.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screen
interface Point { place: Place | null; stay: number } // place null = your location; stay in minutes
const STAYS = [0, 10, 15, 30, 45, 60, 90];
const MAX_STOPS = 6;

interface Result { order: number[]; optimised: boolean; tried: number; totalMin: number; arrive: Date; segments: { from: number; to: number; journeys: UJourney[] }[] }

export function JourneyScreen({ data, pos, to: initialTo }: { data: Data; pos: LatLon | null; to: Place }) {
  const { back, setSearching, setTrip } = useStore();
  const [points, setPoints] = useState<Point[]>([{ place: null, stay: 0 }, { place: initialTo, stay: 0 }]);
  const [optimise, setOptimise] = useState(true);
  const [picking, setPicking] = useState<{ index: number; insert: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number[]>([]);

  const resolved = points.map((p) => p.place ?? (pos ? { name: 'Your location', lat: pos.lat, lon: pos.lon } : null));
  const to = points[points.length - 1].place!;
  const ready = resolved.every((p) => p && p.lat !== undefined && p.lon !== undefined);
  const vias = points.length - 2;
  useEffect(() => { warmPlanner(); }, []);

  // postcodes: look up their position (postcodes.io: free, no key)
  useEffect(() => {
    points.forEach((p, i) => {
      if (!p.place || p.place.lat !== undefined || !p.place.query) return;
      fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(p.place.query)}`).then((r) => r.json())
        .then((d) => {
          if (d.result) setPoints((ps) => ps.map((x, j) => (j === i ? { ...x, place: { name: d.result.postcode, lat: d.result.latitude, lon: d.result.longitude } } : x)));
          else setError('that postcode wasn’t found');
        })
        .catch(() => setError('couldn’t look up that postcode'));
    });
  }, [points]);

  const key = JSON.stringify([resolved.map((p) => p && [p.lat, p.lon]), points.map((p) => p.stay), optimise]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setResult(null); setError(null);
    const pts = resolved.map((p) => ({ lat: p!.lat!, lon: p!.lon!, name: p!.name }));
    setSearching({ from: { lat: pts[0].lat, lon: pts[0].lon }, to: { name: to.name, lat: pts[pts.length - 1].lat, lon: pts[pts.length - 1].lon } });
    const t0 = Date.now();
    planTrip(pts, points.map((p) => p.stay * 60), optimise, londonClock())
      .then(async (res) => {
        await new Promise((r) => setTimeout(r, Math.max(0, MIN_SEARCH_MS - (Date.now() - t0))));
        if (!live) return;
        if (res.error || !res.tour || !res.stops) throw new Error(res.error ?? 'no result');
        const now = Date.now();
        const segs = res.tour.segments.map((s) => ({ from: s.from, to: s.to, journeys: s.plans.map((p) => toUi(p, res.stops!, now + s.start * 1000)) }));
        setResult({ order: res.tour.order, optimised: res.tour.optimised, tried: res.tour.tried, totalMin: Math.round(res.tour.seconds / 60), arrive: new Date(now + res.tour.seconds * 1000), segments: segs });
        setSel(segs.map(() => 0));
      })
      .catch((e) => live && setError(String(e.message ?? e)))
      .finally(() => { if (live) setSearching(null); });
    return () => { live = false; setSearching(null); };
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // map: chosen journey of each leg, numbered stops
  useEffect(() => {
    if (!result) { setTrip(null); return; }
    const chosen = result.segments.map((s, i) => s.journeys[sel[i] ?? 0]).filter(Boolean);
    const stopsInOrder = result.order.slice(1, -1).map((idx, n) => ({ lat: resolved[idx]!.lat!, lon: resolved[idx]!.lon!, label: String(n + 1) }));
    setTrip(toTrip(data, chosen, stopsInOrder));
  }, [result, sel, data, setTrip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setTrip(null), [setTrip]);

  const pick = (p: Place | null) => {
    if (!picking) return;
    setPoints((ps) => {
      const next = ps.slice();
      if (picking.insert) next.splice(picking.index, 0, { place: p, stay: 15 });
      else next[picking.index] = { ...next[picking.index], place: p };
      return next;
    });
    setPicking(null);
  };
  const remove = (i: number) => setPoints((ps) => ps.filter((_, j) => j !== i));
  const cycleStay = (i: number) => setPoints((ps) => ps.map((p, j) => (j === i ? { ...p, stay: STAYS[(STAYS.indexOf(p.stay) + 1) % STAYS.length] } : p)));
  const swap = () => setPoints((ps) => [{ ...ps[1], stay: 0 }, { place: ps[0].place ?? (pos ? { name: 'Your location', lat: pos.lat, lon: pos.lon } : null), stay: 0 }]);
  const nameOf = (i: number) => (points[i].place ? points[i].place!.name : 'Your location');

  if (picking) {
    return <PlacePicker data={data} title={picking.insert ? 'Add a stop on the way' : picking.index === 0 ? 'Start from' : 'Go to'} allowMe={!picking.insert && picking.index === 0} onPick={pick} onClose={() => setPicking(null)} />;
  }

  const orderChanged = result?.optimised && result.order.some((v, i) => v !== i);
  return (
    <>
      <div className="shead">
        <button className="iconbtn ghost" aria-label="Back" onClick={back}><ArrowLeft size={22} /></button>
        <div className="shead-main"><span className="shead-text"><b>{vias ? 'Trip with stops' : `To ${to.name}`}</b><small>Buses and walking</small></span></div>
        {vias === 0 && <button className="iconbtn ghost" aria-label="Swap start and destination" onClick={swap}><ArrowDownUp size={20} /></button>}
      </div>
      <div className="nlist">
        <ol className="stopedit" aria-label="Trip stops">
          {points.map((p, i) => {
            const first = i === 0, last = i === points.length - 1;
            return (
              <li key={i} className={`se-row${first ? ' first' : last ? ' last' : ' via'}`}>
                <span className="se-mark" aria-hidden="true">{first ? '' : last ? '' : i}</span>
                <button className="se-name" onClick={() => setPicking({ index: i, insert: false })}>
                  <small>{first ? 'From' : last ? 'To' : `Stop ${i}`}</small><b>{nameOf(i)}</b>
                </button>
                {!first && !last && (
                  <>
                    <button className="se-stay" onClick={() => cycleStay(i)} aria-label={`Stay ${p.stay} minutes at ${nameOf(i)}. Change`}>
                      <Clock size={13} aria-hidden="true" />{p.stay ? `${p.stay} min` : 'No stop'}
                    </button>
                    <button className="iconbtn ghost se-x" aria-label={`Remove ${nameOf(i)}`} onClick={() => remove(i)}><X size={18} /></button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
        <div className="se-actions">
          {vias < MAX_STOPS && (
            <button className="se-add" onClick={() => setPicking({ index: points.length - 1, insert: true })}><Plus size={17} aria-hidden="true" /> Add a stop on the way</button>
          )}
          {vias >= 2 && (
            <label className="se-opt">
              <input type="checkbox" checked={optimise} onChange={(e) => setOptimise(e.target.checked)} />
              <Shuffle size={15} aria-hidden="true" /> Best order for the quickest trip
            </label>
          )}
        </div>

        {!ready && !error && <p className="empty">{resolved.some((x) => !x) ? 'Getting your location…' : 'Finding that place…'}</p>}
        {ready && !result && !error && <Searching data={data} to={to} />}
        {error && <div className="notice errbox"><span>Couldn’t plan this trip: {error}.</span></div>}

        {result && vias > 0 && (
          <section className="tripsum">
            <div><b>{result.totalMin}</b> min in total<span className="dot" />arrive {time(result.arrive)}</div>
            <div className="muted">Includes {points.slice(1, -1).reduce((t, p) => t + p.stay, 0)} min at your stops
              {orderChanged ? <><span className="dot" />reordered for the quickest trip</> : result.optimised ? <><span className="dot" />your order is already the quickest</> : ''}
            </div>
            <div className="tripsum-order">
              {result.order.map((idx, n) => (
                <span key={n} className="tso">{n > 0 && <ArrowRight size={12} aria-hidden="true" />}{n > 0 && n < result.order.length - 1 && <i>{n}</i>}{nameOf(idx)}</span>
              ))}
            </div>
          </section>
        )}

        {result?.segments.map((seg, si) => {
          const fastest = Math.min(...seg.journeys.map((j) => j.minutes));
          const rideCounts = seg.journeys.filter((j) => j.rides > 0).map((j) => j.rides);
          const fewest = rideCounts.length ? Math.min(...rideCounts) : 0;
          const isStop = si < result.segments.length - 1;
          return (
            <section key={si} className="seg">
              {vias > 0 && <h4 className="sec">{si + 1}. To {nameOf(seg.to)}</h4>}
              {!seg.journeys.length && <p className="empty">No bus journey found for this part. Try a nearby stop.</p>}
              {seg.journeys.map((j, i) => (
                <JourneyCard key={i} data={data} j={j} active={i === (sel[si] ?? 0)} fastest={j.minutes === fastest}
                  fewest={j.rides === fewest && seg.journeys.filter((x) => x.rides === fewest).indexOf(j) === 0}
                  onSelect={() => setSel((s) => s.map((v, k) => (k === si ? i : v)))} />
              ))}
              {isStop && points[seg.to]?.stay > 0 && (
                <div className="staybar"><Clock size={15} aria-hidden="true" /> Stay {points[seg.to].stay} min at {nameOf(seg.to)}</div>
              )}
            </section>
          );
        })}
        {result && <p className="fineprint">Planned by Busline from bus timetables and typical waits. Live times shown for the first bus of each option.</p>}
      </div>
    </>
  );
}
