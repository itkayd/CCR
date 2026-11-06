import { useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import { Bus, MapPin, Search, X } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, routeSort, type Data } from '../lib/data';
import { useStore } from '../store/store';
import { distM, type Arrival, type LatLon, type LocState, type NearbyStop } from './api';

const HEADER_PX = 0; // no app header on the live map
const PEEK_PX = 148;

export interface DirRow { stop: NearbyStop; dest: string; etas: number[]; walkMin: number }
export interface Card { line: string; colour: string; rows: DirRow[]; nearest: number }

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
      rows.push({ stop, dest, etas: at.slice(0, 3).map((a) => a.eta), walkMin: Math.max(1, Math.round((dist.get(stopId) ?? 0) / 80)) });
    }
    if (!rows.length) {
      const stop = stops.filter((s) => s.lines.includes(line)).sort((a, b) => dist.get(a.id)! - dist.get(b.id)!)[0];
      if (!stop) continue;
      rows.push({ stop, dest: stop.towards ? `Towards ${stop.towards}` : '', etas: [], walkMin: Math.max(1, Math.round(dist.get(stop.id)! / 80)) });
    }
    rows.sort((a, b) => (a.etas[0] ?? 1e9) - (b.etas[0] ?? 1e9));
    const route = data.routes.get(line);
    const hub = stopHub.get(rows[0].stop.id);
    const colour = route && hub ? colourAt(route, hub, data.hubs) : route?.via[0] ? data.hubs.get(route.via[0])!.colour! : NEUTRAL;
    cards.push({ line, colour, rows: rows.slice(0, 2), nearest: Math.min(...rows.map((r) => dist.get(r.stop.id) ?? 1e9)) });
  }
  // nearest stop first, then soonest bus, then route number
  return cards.sort((a, b) => Math.round(a.nearest / 60) - Math.round(b.nearest / 60) || (a.rows[0].etas[0] ?? 1e9) - (b.rows[0].etas[0] ?? 1e9) || routeSort(a.line, b.line));
}

const fmtEtas = (etas: number[]) => etas.map((s) => (s < 60 ? 'Due' : String(Math.floor(s / 60)))).join(', ');

function LiveIcon() {
  return (
    <svg className="liveicon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path className="a1" d="M2 12a10 10 0 0 1 10-10" />
      <path className="a2" d="M2 12a6 6 0 0 1 6-6" />
      <circle cx="2.6" cy="11.4" r="1.6" />
    </svg>
  );
}

function CardView({ card }: { card: Card }) {
  const { route, setRoute } = useStore();
  const active = route === card.line;
  return (
    <article className={`ncard${active ? ' active' : ''}`}>
      <button className="ncard-head" onClick={() => setRoute(active ? null : card.line)} aria-pressed={active} aria-label={`Route ${card.line}, show on map`}>
        <Bus size={22} style={{ color: card.colour }} aria-hidden="true" />
        <span className="nbadge" style={{ background: card.colour }}>{card.line}</span>
      </button>
      {card.rows.map((r) => (
        <button key={r.stop.id + r.dest} className="nrow" onClick={() => setRoute(card.line)}>
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
          ) : <span className="nrow-eta none">No live times</span>}
        </button>
      ))}
    </article>
  );
}

function SearchResults({ data, q, onPick }: { data: Data; q: string; onPick: () => void }) {
  const { setRoute } = useStore();
  const qq = q.trim().toUpperCase();
  const routes = [...data.routes.values()].filter((r) => r.id.startsWith(qq)).sort((a, b) => routeSort(a.id, b.id)).slice(0, 8);
  const ql = q.trim().toLowerCase();
  const places = ql.length < 2 ? [] : [...data.hubs.values()].filter((h) => h.name.toLowerCase().includes(ql))
    .sort((a, b) => Number(b.major) - Number(a.major) || b.routes.length - a.routes.length).slice(0, 8);
  if (!routes.length && !places.length) return <p className="empty">No routes or stops match “{q}”.</p>;
  return (
    <div className="results">
      {routes.map((r) => {
        const c = r.via[0] ? data.hubs.get(r.via[0])!.colour! : NEUTRAL;
        return (
          <button key={r.id} className="result" onClick={() => { setRoute(r.id); onPick(); }}>
            <span className="nbadge" style={{ background: c }}>{r.id}</span>
            <span className="result-text">{r.a} ↔ {r.b}</span>
          </button>
        );
      })}
      {places.map((h) => (
        <button key={h.id} className="result" onClick={() => { const r = h.routes[0]; if (r) setRoute(r); onPick(); }}>
          <span className="pdot" style={{ background: h.major ? h.colour : 'var(--surface)', boxShadow: h.major ? undefined : 'inset 0 0 0 3px #8A9692' }} />
          <span className="result-text">{h.name}<small>{h.routes.length} routes</small></span>
        </button>
      ))}
    </div>
  );
}

export function NearbySheet({ data, stopHub, pos, locState, stops, error, arrivals, updated }: {
  data: Data; stopHub: Map<string, string>; pos: LatLon | null; locState: LocState;
  stops: NearbyStop[] | null; error: string | null; arrivals: Arrival[] | null; updated: Date | null;
}) {
  const { setSheetInset } = useStore();
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const on = () => setVh(window.innerHeight); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const snaps = useMemo(() => [`${PEEK_PX}px`, `${Math.round(vh * 0.46)}px`, `${vh - HEADER_PX - 64}px`], [vh]);
  const [snap, setSnap] = useState<string | number | null>(snaps[1]);
  const [q, setQ] = useState('');

  useEffect(() => {
    const px = parseInt(String(snap ?? snaps[1]), 10);
    setSheetInset(Math.min(px, Math.round(vh * 0.46)));
  }, [snap, snaps, vh, setSheetInset]);

  const cards = useMemo(() => (pos && stops ? buildCards(data, stopHub, pos, stops, arrivals) : []), [data, stopHub, pos, stops, arrivals]);
  const time = updated?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <Drawer.Root open snapPoints={snaps} activeSnapPoint={snap} setActiveSnapPoint={setSnap} modal={false} dismissible={false} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Content className="nsheet" style={{ height: vh - HEADER_PX - 64 }} aria-describedby={undefined}>
          <Drawer.Handle className="handle" />
          <div className="nsearch">
            <Search size={20} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSnap(snaps[2])}
              placeholder="Search routes or stops"
              aria-label="Search routes or stops"
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
                {locState !== 'ok' && locState !== 'locating' && (
                  <p className="notice"><MapPin size={16} aria-hidden="true" />
                    {locState === 'outside' ? 'You’re outside London, so this shows Trafalgar Square.' : 'Location is off, so this shows Trafalgar Square. Allow location to see buses near you.'}
                  </p>
                )}
                {error && <p className="notice">Couldn’t load nearby stops ({error}). Pull up to retry later.</p>}
                {!stops && !error && <p className="empty">Finding stops near you…</p>}
                {stops && !stops.length && <p className="empty">No bus stops within 400 m.</p>}
                {cards.map((c) => <CardView key={c.line} card={c} />)}
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
