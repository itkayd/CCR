import { useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import { Bus, Clock, MapPin, Navigation, Search, X } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, routeSort, type Data } from '../lib/data';
import { useStore } from '../store/store';
import { distM, type Arrival, type LatLon, type LocState, type NearbyStop } from './api';
import { loadRouteDetail, PlaceScreen, RouteScreen, type RouteDetail } from './screens';
import { JourneyScreen } from './journey';
import { warmPlanner } from '../router/client';
import { HomeExtras, UpdatesScreen } from './home';
import { loadPlans } from './plans';

const HEADER_PX = 0; // no app header on the live map
const PEEK_PX = 148;

export interface DirRow { stop: NearbyStop; dir: string; dest: string; etas: number[]; walkMin: number }
export interface Card {
  line: string; colour: string; rows: DirRow[]; nearest: number;
  /** live data has loaded (so an empty row really means no live bus) */
  live: boolean;
  /** nearby stops this line serves, nearest first (for timetable fallback) */
  stops: NearbyStop[];
}

/** Group live arrivals by route and direction, keeping the nearest stop for each. */
export function buildCards(data: Data, stopHub: Map<string, string>, pos: LatLon, stops: NearbyStop[], arrivals: Arrival[] | null): Card[] {
  const dist = new Map(stops.map((s) => [s.id, distM(pos, s)]));
  const byStop = new Map(stops.map((s) => [s.id, s]));
  const groups = new Map<string, Map<string, Arrival[]>>(); // line → "dir" → arrivals (all stops)
  for (const a of arrivals ?? []) {
    const g = groups.get(a.line) ?? groups.set(a.line, new Map()).get(a.line)!;
    (g.get(a.dir) ?? g.set(a.dir, []).get(a.dir)!).push(a);
  }
  const lines = new Set<string>([...stops.flatMap((s) => s.lines), ...groups.keys()]);
  const cards: Card[] = [];
  for (const line of lines) {
    const rows: DirRow[] = [];
    for (const [, list] of groups.get(line) ?? []) {
      // nearest stop in this direction that has a prediction
      const stopId = [...new Set(list.map((a) => a.stop))].sort((a, b) => (dist.get(a) ?? 1e9) - (dist.get(b) ?? 1e9))[0];
      const at = list.filter((a) => a.stop === stopId);
      const dests = new Map<string, number>();
      for (const a of at) dests.set(a.dest, (dests.get(a.dest) ?? 0) + 1);
      const dest = [...dests].sort((a, b) => b[1] - a[1])[0][0];
      const stop = byStop.get(stopId)!;
      if (!stop) continue;
      rows.push({ stop, dir: list[0].dir, dest, etas: at.slice(0, 3).map((a) => a.eta), walkMin: Math.max(1, Math.round((dist.get(stopId) ?? 0) / 80)) });
    }
    if (!rows.length) {
      const stop = stops.filter((s) => s.lines.includes(line)).sort((a, b) => dist.get(a.id)! - dist.get(b.id)!)[0];
      if (!stop) continue;
      rows.push({ stop, dir: '', dest: stop.towards ? `Towards ${stop.towards}` : '', etas: [], walkMin: Math.max(1, Math.round(dist.get(stop.id)! / 80)) });
    }
    rows.sort((a, b) => (a.etas[0] ?? 1e9) - (b.etas[0] ?? 1e9));
    const route = data.routes.get(line);
    const hub = stopHub.get(rows[0].stop.id);
    const colour = route && hub ? colourAt(route, hub, data.hubs) : route?.via[0] ? data.hubs.get(route.via[0])!.colour! : NEUTRAL;
    const served = stops.filter((s) => s.lines.includes(line)).sort((a, b) => dist.get(a.id)! - dist.get(b.id)!);
    cards.push({ line, colour, rows: rows.slice(0, 2), nearest: Math.min(...rows.map((r) => dist.get(r.stop.id) ?? 1e9)), live: arrivals !== null, stops: served });
  }
  // nearest stop first, then soonest bus, then route number
  return cards.sort((a, b) => Math.round(a.nearest / 60) - Math.round(b.nearest / 60) || (a.rows[0].etas[0] ?? 1e9) - (b.rows[0].etas[0] ?? 1e9) || routeSort(a.line, b.line));
}

const fmtEtas = (etas: number[]) => etas.map((s) => (s < 60 ? 'Due' : String(Math.floor(s / 60)))).join(', ');

export function LiveIcon() {
  return (
    <svg className="liveicon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path className="a1" d="M2 12a10 10 0 0 1 10-10" />
      <path className="a2" d="M2 12a6 6 0 0 1 6-6" />
      <circle cx="2.6" cy="11.4" r="1.6" />
    </svg>
  );
}

// ---- timetable fallback --------------------------------------------------------
const londonNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute) };
};
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ttCache = new Map<string, Promise<number[]>>();
function useScheduled(line: string, stop: string) {
  const [times, setTimes] = useState<number[] | null>(null);
  useEffect(() => {
    const { date } = londonNow();
    const key = `${line}|${stop}|${date}`;
    if (!ttCache.has(key)) ttCache.set(key, fetch(`/api/timetable?line=${encodeURIComponent(line)}&stop=${stop}&d=${date}`).then((r) => r.json()).then((d) => d.times ?? []).catch(() => []));
    let live = true;
    ttCache.get(key)!.then((t) => live && setTimes(t));
    return () => { live = false; };
  }, [line, stop]);
  if (!times) return null;
  const now = londonNow().mins;
  return times.filter((t) => t >= now).slice(0, 3);
}

function Scheduled({ line, stop }: { line: string; stop: string }) {
  const next = useScheduled(line, stop);
  if (next === null) return <span className="nrow-eta none">Checking timetable…</span>;
  if (!next.length) return <span className="nrow-eta none">No more buses today</span>;
  return (
    <span className="nrow-eta sched" aria-label={`Scheduled at ${next.map(hhmm).join(', ')}`}>
      <Clock size={14} aria-hidden="true" /><b>{next.map(hhmm).join(', ')}</b>
    </span>
  );
}

/** No live buses: one row per direction from the nearest stop in that direction, with timetabled times. */
function useNoLiveRows(card: Card): DirRow[] | null {
  const need = card.live && card.rows.every((r) => !r.etas.length);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  useEffect(() => { if (need) loadRouteDetail(card.line).then(setDetail); }, [need, card.line]);
  if (!need || !detail) return null;
  const rows: DirRow[] = [];
  for (const d of detail.dirs) {
    const ids = new Set(d.stops.map((x) => x[0]));
    const stop = card.stops.find((s) => ids.has(s.id));
    if (stop && !(stop.id === d.stops[d.stops.length - 1][0])) rows.push({ stop, dir: d.dir, dest: d.to, etas: [], walkMin: card.rows.find((r) => r.stop.id === stop.id)?.walkMin ?? card.rows[0].walkMin });
  }
  return rows.length ? rows : null;
}

export function CardView({ card }: { card: Card }) {
  const { route, openRoute } = useStore();
  const active = route === card.line;
  const fallback = useNoLiveRows(card);
  const rows = fallback ?? card.rows;
  return (
    <article className={`ncard${active ? ' active' : ''}`}>
      <button className="ncard-head" onClick={() => openRoute(card.line, card.rows[0]?.dir || undefined)} aria-label={`Route ${card.line}: stops and connections`}>
        <Bus size={22} style={{ color: card.colour }} aria-hidden="true" />
        <span className="nbadge" style={{ background: card.colour }}>{card.line}</span>
      </button>
      {rows.map((r) => (
        <button key={r.stop.id + r.dest} className="nrow" onClick={() => openRoute(card.line, r.dir || undefined)}>
          <span className="nrow-main">
            <span className="nrow-dest">{r.dest || 'No destination'}</span>
            <span className="nrow-stop">
              {[r.stop.name, r.stop.letter && `Stop ${r.stop.letter}`, `${r.walkMin} min walk`].filter(Boolean).map((t, i, all) => (
                <span key={i}>{t}{i < all.length - 1 && <span className="dot" aria-hidden="true" />}</span>
              ))}
            </span>
          </span>
          {r.etas.length ? (
            <span className="nrow-eta" aria-label={`Next buses in ${fmtEtas(r.etas)} minutes`}>
              <LiveIcon /><b>{fmtEtas(r.etas)}</b>{r.etas.some((s) => s >= 60) && <small>min</small>}
            </span>
          ) : card.live ? <Scheduled line={card.line} stop={r.stop.id} /> : <span className="nrow-eta none">Loading…</span>}
        </button>
      ))}
    </article>
  );
}

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function SearchResults({ data, q, onPick }: { data: Data; q: string; onPick: () => void }) {
  const { openRoute, openPlace, openJourney } = useStore();
  const pc = q.trim().toUpperCase();
  const qq = q.trim().toUpperCase();
  const routes = [...data.routes.values()].filter((r) => r.id.startsWith(qq)).sort((a, b) => routeSort(a.id, b.id)).slice(0, 8);
  const ql = q.trim().toLowerCase();
  const places = ql.length < 2 ? [] : [...data.hubs.values()].filter((h) => h.name.toLowerCase().includes(ql))
    .sort((a, b) => Number(b.major) - Number(a.major) || b.routes.length - a.routes.length).slice(0, 8);
  if (!routes.length && !places.length && !POSTCODE.test(pc)) return <p className="empty">No routes, stops or postcodes match “{q}”.</p>;
  return (
    <div className="results">
      {POSTCODE.test(pc) && (
        <button className="result" onClick={() => { openJourney({ name: pc.replace(/\s*(\d[A-Z]{2})$/, ' $1'), query: pc.replace(/\s+/g, '') }); onPick(); }}>
          <span className="pdot go"><Navigation size={16} /></span>
          <span className="result-text">Go to {pc.replace(/\s*(\d[A-Z]{2})$/, ' $1')}<small>Plan a bus journey to this postcode</small></span>
        </button>
      )}
      {routes.map((r) => {
        const c = r.via[0] ? data.hubs.get(r.via[0])!.colour! : NEUTRAL;
        return (
          <button key={r.id} className="result" onClick={() => { openRoute(r.id); onPick(); }}>
            <span className="nbadge" style={{ background: c }}>{r.id}</span>
            <span className="result-text">{r.a} ↔ {r.b}</span>
          </button>
        );
      })}
      {places.map((h) => (
        <div key={h.id} className="result-wrap">
        <button className="result" onClick={() => { openPlace(h.id); onPick(); }}>
          <span className="pdot" style={{ background: h.major ? h.colour : 'var(--surface)', boxShadow: h.major ? undefined : 'inset 0 0 0 3px #8A9692' }} />
          <span className="result-text">{h.name}
            <span className="rbadges">
              {h.routes.filter((r) => !/^6\d\d$/.test(r)).slice(0, 7).map((r) => {
                const route = data.routes.get(r);
                return <span key={r} className="cbadge" style={{ background: route ? colourAt(route, h.id, data.hubs) : NEUTRAL }}>{r}</span>;
              })}
              {h.routes.length > 7 && <small>+{h.routes.length - 7}</small>}
            </span>
          </span>
        </button>
        <button className="gobtn" aria-label={`Directions to ${h.name}`} onClick={() => { openJourney({ name: h.name, lat: h.lat, lon: h.lon }); onPick(); }}>
          <Navigation size={18} /><span>Go</span>
        </button>
        </div>
      ))}
    </div>
  );
}

export function NearbySheet({ data, stopHub, pos, locState, stops, error, retry, arrivals, updated }: {
  data: Data; stopHub: Map<string, string>; pos: LatLon | null; locState: LocState;
  stops: NearbyStop[] | null; error: string | null; retry: () => void; arrivals: Arrival[] | null; updated: Date | null;
}) {
  const { setSheetInset, stack } = useStore();
  const top = stack[stack.length - 1];
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const on = () => setVh(window.innerHeight); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const snaps = useMemo(() => [`${PEEK_PX}px`, `${Math.round(vh * 0.46)}px`, `${vh - HEADER_PX - 64}px`], [vh]);
  const [snap, setSnap] = useState<string | number | null>(snaps[1]);
  const [q, setQ] = useState('');

  useEffect(() => {
    const px = parseInt(String(snap ?? snaps[1]), 10);
    setSheetInset(Math.min(px, Math.round(vh * 0.46)));
  }, [snap, snaps, vh, setSheetInset]);

  useEffect(() => { if (top.type !== 'nearby' && snap === snaps[0]) setSnap(snaps[1]); }, [stack.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearbyLines = useMemo(() => [...new Set((stops ?? []).flatMap((s) => s.lines))], [stops]);
  const cards = useMemo(() => (pos && stops ? buildCards(data, stopHub, pos, stops, arrivals) : []), [data, stopHub, pos, stops, arrivals]);
  const time = updated?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <Drawer.Root open snapPoints={snaps} activeSnapPoint={snap} setActiveSnapPoint={setSnap} modal={false} dismissible={false} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Content className="nsheet" style={{ height: vh - HEADER_PX - 64 }} aria-describedby={undefined}>
          <Drawer.Handle className="handle" />
          {top.type !== 'nearby' && <Drawer.Title className="sr-only">{top.type === 'route' ? `Route ${top.id}` : top.type === 'journey' ? 'Journey' : top.type === 'updates' ? 'Service updates' : 'Stop'}</Drawer.Title>}
          {top.type === 'route' && <RouteScreen key={`r-${top.id}-${stack.length}`} data={data} stopHub={stopHub} id={top.id} dir={top.dir} focusHub={top.focusHub} />}
          {top.type === 'journey' && <JourneyScreen key={`j-${stack.length}`} data={data} pos={pos} to={top.to} plan={top.planId ? loadPlans().find((x) => x.id === top.planId) : undefined} />}
          {top.type === 'updates' && <UpdatesScreen data={data} nearbyLines={nearbyLines} />}
          {top.type === 'place' && <PlaceScreen key={`p-${top.hub}-${stack.length}`} data={data} stopHub={stopHub} hub={top.hub} />}
          {top.type === 'nearby' && <>
          <div className="nsearch">
            <Search size={20} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => { setSnap(snaps[2]); warmPlanner(); }}
              placeholder="Where to? Stops, places, routes, postcodes"
              aria-label="Search stops, places, routes or postcodes"
              enterKeyHint="search"
            />
            {q && <button className="iconbtn ghost" aria-label="Clear search" onClick={() => setQ('')}><X size={18} /></button>}
          </div>
          <div className="nband">
            <Drawer.Title className="nband-title">{q ? 'Search' : 'Nearby'}</Drawer.Title>
            {!q && <span className="nband-meta">{time ? <><LiveIcon /> Live<span className="dot" aria-hidden="true" />{time}</> : 'Loading live times…'}</span>}
          </div>
          <div className="nlist">
            {q ? <SearchResults data={data} q={q} onPick={() => { setQ(''); setSnap(snaps[1]); }} /> : (
              <>
                {['denied', 'outside', 'unsupported', 'slow'].includes(locState) && (
                  <p className="notice"><MapPin size={16} aria-hidden="true" />
                    {locState === 'outside' ? 'You’re outside London, so this shows Trafalgar Square.'
                      : locState === 'slow' ? 'Still finding your location, so this shows Trafalgar Square for now.'
                      : 'Location is off, so this shows Trafalgar Square. Allow location in your browser settings to see buses near you.'}
                  </p>
                )}
                {error && (
                  <div className="notice errbox">
                    <span>Couldn’t load nearby stops: {error}.</span>
                    <button className="retry" onClick={retry}>Retry</button>
                  </div>
                )}
                {!pos && !error && <p className="empty">Getting your location…</p>}
                {pos && !stops && !error && <p className="empty">Finding bus stops near you…</p>}
                {stops && !stops.length && <p className="empty">No bus stops within 400 m.</p>}
                <HomeExtras data={data} nearbyLines={nearbyLines} />
                {cards.length > 0 && <h4 className="sec">Buses near you</h4>}
                {cards.map((c) => <CardView key={c.line} card={c} />)}
              </>
            )}
          </div>
          </>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
