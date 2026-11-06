import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bus, Repeat2, Star } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, routeSort, type Data, type Route } from '../lib/data';
import { modeLabels } from '../lib/modes';
import { useStore } from '../store/store';
import { useArrivals, useNearby } from './api';
import { buildCards, CardView, LiveIcon } from './NearbySheet';

// ---------------------------------------------------------------- data hooks
export interface RouteDetail { id: string; a: string; b: string; dirs: { dir: string; to: string; stops: [string, string, string, number, number][] }[] }
const detailCache = new Map<string, Promise<RouteDetail | null>>();
export function loadRouteDetail(id: string) {
  if (!detailCache.has(id)) detailCache.set(id, fetch(`/data/r/${encodeURIComponent(id)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return detailCache.get(id)!;
}
function useRouteDetail(id: string) {
  const [d, setD] = useState<RouteDetail | null | undefined>(undefined);
  useEffect(() => { let live = true; setD(undefined); loadRouteDetail(id).then((x) => live && setD(x)); return () => { live = false; }; }, [id]);
  return d;
}

export interface Vehicle { vehicle: string; stop: string; dir: string; dest: string; eta: number }
function useVehicles(id: string) {
  const [v, setV] = useState<Vehicle[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => document.visibilityState === 'visible' &&
      fetch(`/api/line?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => live && d.vehicles && setV(d.vehicles)).catch(() => {});
    setV(null); load();
    const t = window.setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  return v;
}

const isSchool = (id: string) => /^6\d\d$/.test(id);
const mins = (s: number) => (s < 60 ? 'due' : `${Math.floor(s / 60)} min`);

function Badge({ route, hub, data, onClick }: { route: Route | undefined; hub: string; data: Data; onClick?: () => void }) {
  if (!route) return null;
  const c = colourAt(route, hub, data.hubs);
  const El = onClick ? 'button' : 'span';
  return <El className="cbadge" style={{ background: c }} onClick={onClick} aria-label={onClick ? `Route ${route.id}` : undefined}>{route.id}</El>;
}

function Header({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="shead">
      <button className="iconbtn ghost" aria-label="Back" onClick={onBack}><ArrowLeft size={22} /></button>
      <div className="shead-main">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- route screen
export function RouteScreen({ data, stopHub, id, dir, focusHub }: { data: Data; stopHub: Map<string, string>; id: string; dir?: string; focusHub?: string }) {
  const { back, openRoute, openPlace, setOverlay } = useStore();
  const route = data.routes.get(id);
  const detail = useRouteDetail(id);
  const vehicles = useVehicles(id);
  const [di, setDi] = useState(0);
  useEffect(() => {
    if (!detail) return;
    const i = detail.dirs.findIndex((d) => d.dir === dir);
    setDi(i >= 0 ? i : 0);
  }, [detail, dir]);
  const d = detail?.dirs[di];

  const rows = useMemo(() => {
    if (!d || !route) return [];
    let prevHub = '';
    return d.stops.map(([naptan, name, letter, lat, lon]) => {
      const hubId = stopHub.get(naptan) ?? '';
      const hub = data.hubs.get(hubId);
      const colour = hubId ? colourAt(route, hubId, data.hubs) : NEUTRAL;
      const first = hubId !== prevHub;
      prevHub = hubId;
      const connections = !first || !hub ? [] : hub.routes
        .filter((r) => r !== id && !isSchool(r) && (route.night || !/^N\d/.test(r)))
        .map((r) => data.routes.get(r)).filter(Boolean) as Route[];
      // routes that reach major stations first: that's where the network opens up
      connections.sort((a, b) => Number(b.via.length > 0) - Number(a.via.length > 0) || routeSort(a.id, b.id));
      return { naptan, name, letter, lat, lon, hubId, hub, colour, major: !!hub?.major, connections };
    });
  }, [d, route, stopHub, data, id]);

  const busAt = useMemo(() => {
    const m = new Map<string, Vehicle[]>();
    for (const v of vehicles ?? []) if (v.dir === d?.dir) (m.get(v.stop) ?? m.set(v.stop, []).get(v.stop)!).push(v);
    return m;
  }, [vehicles, d]);
  const liveCount = [...busAt.values()].reduce((t, l) => t + l.length, 0);

  // best places to change: most connecting routes
  const interchanges = useMemo(() => [...rows].filter((r) => r.connections.length >= 3)
    .sort((a, b) => Number(b.major) - Number(a.major) || b.connections.length - a.connections.length).slice(0, 4), [rows]);

  // map overlay: this direction's stops + live buses
  useEffect(() => {
    if (!rows.length) return;
    setOverlay({
      stops: rows.map((r) => ({ lon: r.lon, lat: r.lat, c: r.colour, hub: r.hubId })),
      buses: rows.flatMap((r) => (busAt.get(r.naptan) ?? []).map(() => ({ lon: r.lon, lat: r.lat, c: r.colour, label: id }))),
    });
  }, [rows, busAt, id, setOverlay]);
  useEffect(() => () => setOverlay(null), [setOverlay]);

  const list = useRef<HTMLOListElement>(null);
  const scrollTo = (hubId: string) => list.current?.querySelector(`[data-hub="${CSS.escape(hubId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  useEffect(() => { if (focusHub && rows.length) setTimeout(() => scrollTo(focusHub), 150); }, [focusHub, rows.length]);

  if (!route) return <Header onBack={back}><b>Route {id} not found</b></Header>;
  const head = rows[0]?.colour ?? NEUTRAL;
  return (
    <>
      <Header onBack={back}>
        <span className="nbadge" style={{ background: head }}>{id}</span>
        <span className="shead-text">
          <b>{route.a} ↔ {route.b}</b>
          <small>{rows.length} stops{vehicles ? <> <span className="dot" /> <LiveIcon /> {liveCount} bus{liveCount === 1 ? '' : 'es'} live</> : ''}</small>
        </span>
      </Header>
      {detail && detail.dirs.length > 1 && (
        <div className="dirtabs" role="tablist" aria-label="Direction">
          {detail.dirs.map((x, i) => (
            <button key={x.dir} role="tab" aria-selected={i === di} onClick={() => setDi(i)}>To {x.to}</button>
          ))}
        </div>
      )}
      <div className="nlist">
        {interchanges.length > 0 && (
          <section className="ichanges">
            <h4><Repeat2 size={16} aria-hidden="true" /> Best places to change</h4>
            <div className="ichips">
              {interchanges.map((r) => (
                <button key={r.naptan} className="ichip" onClick={() => scrollTo(r.hubId)}>
                  <i style={{ background: r.colour }} />{r.hub?.name ?? r.name}<small>{r.connections.length} routes</small>
                </button>
              ))}
            </div>
          </section>
        )}
        {detail === undefined && <p className="empty">Loading stops…</p>}
        {detail === null && <p className="empty">No stop list for this route.</p>}
        <ol className="timeline" ref={list}>
          {rows.map((r, i) => {
            const buses = busAt.get(r.naptan) ?? [];
            const shown = r.connections.slice(0, 8);
            return (
              <li key={r.naptan + i} data-hub={r.hubId} className={`tl${r.major ? ' major' : ''}${i === 0 ? ' first' : ''}${i === rows.length - 1 ? ' last' : ''}`} style={{ ['--c' as string]: r.colour }}>
                <span className="tl-rail" aria-hidden="true"><span className="tl-dot" /></span>
                <div className="tl-body">
                  {buses.length > 0 && (
                    <span className="busnow"><Bus size={14} aria-hidden="true" /> Bus {mins(Math.min(...buses.map((b) => b.eta)))} away</span>
                  )}
                  <button className="tl-name" onClick={() => r.hubId && openPlace(r.hubId)}>
                    {r.name}{r.letter && <span className="letter">{r.letter}</span>}
                  </button>
                  {r.major && r.hub && (
                    <span className="tl-tag"><Star size={12} aria-hidden="true" /> Interchange{r.hub.rail?.length ? <><span className="dot" />{modeLabels(r.hub.rail).join(', ')}</> : ''}</span>
                  )}
                  {shown.length > 0 && (
                    <div className="tl-conn">
                      <span className="tl-conn-label">Change for</span>
                      {shown.map((c) => <Badge key={c.id} route={c} hub={r.hubId} data={data} onClick={() => openRoute(c.id, undefined, r.hubId)} />)}
                      {r.connections.length > shown.length && (
                        <button className="cmore" onClick={() => openPlace(r.hubId)}>+{r.connections.length - shown.length}</button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- place screen
export function PlaceScreen({ data, stopHub, hub }: { data: Data; stopHub: Map<string, string>; hub: string }) {
  const { back, openRoute, setFocus } = useStore();
  const h = data.hubs.get(hub);
  const pos = useMemo(() => (h ? { lat: h.lat, lon: h.lon } : null), [h]);
  const { stops } = useNearby(pos);
  const here = useMemo(() => {
    const own = (stops ?? []).filter((s) => stopHub.get(s.id) === hub);
    return own.length ? own : stops ?? [];
  }, [stops, stopHub, hub]);
  const ids = useMemo(() => here.slice(0, 12).map((s) => s.id), [here]);
  const { arrivals } = useArrivals(ids, true);
  useEffect(() => { if (h) setFocus({ lat: h.lat, lon: h.lon, zoom: 16.3 }); }, [h, setFocus]);

  if (!h || !pos) return <Header onBack={back}><b>Unknown place</b></Header>;
  const cards = stops ? buildCards(data, stopHub, pos, here, arrivals) : [];
  const routes = (h.routes.map((r) => data.routes.get(r)).filter(Boolean) as Route[]).sort((a, b) => routeSort(a.id, b.id));
  return (
    <>
      <Header onBack={back}>
        <span className={`disc${h.major ? '' : ' minor'}`} style={{ background: h.colour }} />
        <span className="shead-text">
          <b>{h.name}</b>
          <small>{routes.length} route{routes.length === 1 ? '' : 's'}{h.rail?.length ? <><span className="dot" />{modeLabels(h.rail).join(' · ')}</> : ''}</small>
        </span>
      </Header>
      <div className="nlist">
        <h4 className="sec">Live departures</h4>
        {!stops && <p className="empty">Loading live times…</p>}
        {stops && !cards.length && <p className="empty">No live departures right now.</p>}
        {cards.map((c) => <CardView key={c.line} card={c} />)}
        <h4 className="sec">All routes here</h4>
        <div className="results">
          {routes.map((r) => (
            <button key={r.id} className="result" onClick={() => openRoute(r.id, undefined, hub)}>
              <Badge route={r} hub={hub} data={data} />
              <span className="result-text">{r.a} ↔ {r.b}
                {r.via.length > 0 && <small>{r.via.slice(0, 4).map((v) => data.hubs.get(v)!.name).join(' → ')}{r.via.length > 4 ? ' …' : ''}</small>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
