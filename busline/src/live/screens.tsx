import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bus, MapPin, Navigation, Repeat2, Star } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { colourAt, routeSort, type Data, type Route } from '../lib/data';
import { modeLabels } from '../lib/modes';
import { useStore } from '../store/store';
import { useArrivals, useNearby } from './api';
import { loadOperators, loadStopsDb } from './stopsdb';
import { buildCards, CardView, LiveIcon } from './NearbySheet';
import { RouteIssues } from './home';

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
  const { back, openRoute, openPlace, setOverlay, openVehicle } = useStore();
  const route = data.routes.get(id);
  const detail = useRouteDetail(id);
  const vehicles = useVehicles(id);
  const operator = useOperator(id);
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
      buses: rows.flatMap((r) => (busAt.get(r.naptan) ?? []).map((b) => ({ lon: r.lon, lat: r.lat, c: r.colour, label: id, v: b.vehicle, line: id }))),
    });
  }, [rows, busAt, id, setOverlay]);
  useEffect(() => () => setOverlay(null), [setOverlay]);

  // you're near one of this route's stops: mark it and say what's next
  const me = useStore((x) => x.me);
  const here = useMemo(() => {
    if (!me || !rows.length) return -1;
    let bi = -1, bd = 200;
    rows.forEach((r, i) => { const d = Math.hypot((r.lon - me.lon) * 69400, (r.lat - me.lat) * 111200); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }, [me, rows]);
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
          <small>{operator && <>{operator}<span className="dot" /></>}{rows.length} stops{vehicles ? <> <span className="dot" /> <LiveIcon /> {liveCount} bus{liveCount === 1 ? '' : 'es'} live</> : ''}</small>
        </span>
      </Header>
      <div className="routeissues-wrap"><RouteIssues line={id} /></div>
      {detail && detail.dirs.length > 1 && (
        <div className="dirtabs" role="tablist" aria-label="Direction">
          {detail.dirs.map((x, i) => (
            <button key={x.dir} role="tab" aria-selected={i === di} onClick={() => setDi(i)}>To {x.to}</button>
          ))}
        </div>
      )}
      <div className="nlist" data-vaul-no-drag>
        {here >= 0 && (
          <button className="herebar" onClick={() => list.current?.querySelector('.tl.here')?.scrollIntoView({ block: 'center', behavior: 'smooth' })} aria-live="polite">
            <MapPin size={17} aria-hidden="true" />
            <span><b>You’re near {rows[here].name}</b>{here < rows.length - 1 ? <small>Next: {rows[here + 1].name}<span className="dot" />{rows.length - 1 - here} stops to {rows[rows.length - 1].name}</small> : <small>Last stop</small>}</span>
          </button>
        )}
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
              <li key={r.naptan + i} data-hub={r.hubId} className={`tl${r.major ? ' major' : ''}${i === 0 ? ' first' : ''}${i === rows.length - 1 ? ' last' : ''}${i === here ? ' here' : ''}`} style={{ ['--c' as string]: r.colour }}>
                <span className="tl-rail" aria-hidden="true"><span className="tl-dot" /></span>
                <div className="tl-body">
                  {buses.length > 0 && (
                    <button className="busnow" onClick={() => openVehicle(buses.slice().sort((a, b) => a.eta - b.eta)[0].vehicle, id)} aria-label={`Track the bus ${mins(Math.min(...buses.map((b) => b.eta)))} away`}>
                      <Bus size={14} aria-hidden="true" /> Bus {mins(Math.min(...buses.map((b) => b.eta)))} away<span className="track">Track</span>
                    </button>
                  )}
                  <button className="tl-name" onClick={() => r.hubId && openPlace(r.hubId)}>
                    {r.name}{r.letter && <span className="letter">{r.letter}</span>}{i === here && <span className="youhere">You’re here</span>}
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
export function PlaceScreen({ data, stopHub, hub, stop }: { data: Data; stopHub: Map<string, string>; hub: string; stop?: { id: string; lat: number; lon: number } }) {
  const { back, openRoute, setFocus, openJourney } = useStore();
  const h = data.hubs.get(hub);
  // distances from the stop you tapped (or the place's centre)
  const pos = useMemo(() => (stop ? { lat: stop.lat, lon: stop.lon } : h ? { lat: h.lat, lon: h.lon } : null), [h, stop]);
  // live times start straight away for this place's own stops (known locally), in parallel
  // with the stop names/lines lookup, so tapping a stop shows times in one round trip
  const [ownIds, setOwnIds] = useState<string[]>(stop ? [stop.id] : []);
  useEffect(() => {
    loadStopsDb().then(({ byHub }) => {
      const list = (byHub.get(hub) ?? []).slice().sort((a, b) => (pos ? Math.hypot(a.lat - pos.lat, a.lon - pos.lon) - Math.hypot(b.lat - pos.lat, b.lon - pos.lon) : 0));
      const ids = list.map((x) => x.id);
      if (stop && !ids.includes(stop.id)) ids.unshift(stop.id);
      setOwnIds(ids.slice(0, 12));
    });
  }, [hub, stop, pos]);
  const { stops } = useNearby(pos);
  const { arrivals } = useArrivals(ownIds, true);
  const here = useMemo(() => {
    const own = (stops ?? []).filter((s) => ownIds.includes(s.id) || stopHub.get(s.id) === hub);
    return own.length ? own : stops ?? [];
  }, [stops, stopHub, hub, ownIds]);
  useEffect(() => { if (pos) setFocus({ lat: pos.lat, lon: pos.lon, zoom: 16.6 }); }, [pos, setFocus]);

  if (!h || !pos) return <Header onBack={back}><b>Unknown place</b></Header>;
  const cards = stops ? buildCards(data, stopHub, pos, here, arrivals) : [];
  const routes = (h.routes.map((r) => data.routes.get(r)).filter(Boolean) as Route[]).sort((a, b) => routeSort(a.id, b.id));
  return (
    <>
      <Header onBack={back}>
        <span className={`disc${h.major ? '' : ' minor'}`} style={{ background: h.colour }} />
        <span className="shead-text">
          <b>{h.name}</b>
          <small>{routes.length} route{routes.length === 1 ? '' : 's'}{h.rail?.length ? <><span className="dot" />{modeLabels(h.rail).join(', ')}</> : ''}</small>
        </span>
      </Header>
      <div className="nlist" data-vaul-no-drag>
        <button className="directions" onClick={() => openJourney({ name: h.name, lat: h.lat, lon: h.lon })}>
          <Navigation size={18} aria-hidden="true" /> Directions to {h.name}
        </button>
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

/** Which company runs a route, e.g. "Stagecoach London". */
export function useOperator(route: string | null | undefined) {
  const [op, setOp] = useState<string | null>(null);
  useEffect(() => { if (route) loadOperators().then((o) => setOp(o[route.toUpperCase()] ?? null)); }, [route]);
  return route && /^TRAM$/i.test(route) ? 'Tram Operations Ltd' : op;
}

// ---------------------------------------------------------------- track one bus
interface VehicleStop { stop: string; name: string; letter: string; eta: number }
export function VehicleScreen({ data, stopHub, id, line }: { data: Data; stopHub: Map<string, string>; id: string; line: string }) {
  const { back, openPlace, setOverlay, setFocus } = useStore();
  const operator = useOperator(line);
  const [v, setV] = useState<{ dest: string; stops: VehicleStop[]; at: number } | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let on = true;
    const load = () => document.visibilityState === 'visible' && fetch(`/api/vehicle?id=${encodeURIComponent(id)}`).then((r) => r.json())
      .then((d) => { if (!on) return; if (d.error) { setError(true); return; } setError(false); setV({ dest: d.dest, stops: d.stops ?? [], at: Date.now() }); })
      .catch(() => on && setError(true));
    load();
    const t = window.setInterval(load, 15_000);
    return () => { on = false; clearInterval(t); };
  }, [id]);
  const route = data.routes.get(line);
  const colour = (hub: string) => (route && hub ? colourAt(route, hub, data.hubs) : NEUTRAL);
  const head = v?.stops[0] ? colour(stopHub.get(v.stops[0].stop) ?? '') : NEUTRAL;
  // map: bus at its next stop, upcoming stops as markers
  const [pos, setPos] = useState<Map<string, { lat: number; lon: number }>>(new Map());
  useEffect(() => { loadStopsDb().then(({ byId }) => setPos(new Map([...byId].map(([k, x]) => [k, { lat: x.lat, lon: x.lon }])))); }, []);
  const firstPos = v?.stops[0] ? pos.get(v.stops[0].stop) : undefined;
  useEffect(() => {
    if (!v || !pos.size) return;
    const pts = v.stops.map((s) => ({ s, p: pos.get(s.stop) })).filter((x) => x.p);
    setOverlay({
      stops: pts.map(({ s, p }) => ({ lon: p!.lon, lat: p!.lat, c: colour(stopHub.get(s.stop) ?? ''), hub: stopHub.get(s.stop) ?? '' })),
      buses: pts.length ? [{ lon: pts[0].p!.lon, lat: pts[0].p!.lat, c: head, label: line }] : [],
    });
  }, [v, pos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setOverlay(null), [setOverlay]);
  const centred = useRef(false);
  useEffect(() => { if (firstPos && !centred.current) { centred.current = true; setFocus({ ...firstPos, zoom: 15.5 }); } }, [firstPos, setFocus]);

  const age = v ? (now - v.at) / 1000 : 0;
  const eta = (s: number) => { const left = s - age; return left < 45 ? 'due' : `${Math.round(left / 60)} min`; };
  const clock = (s: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date((v?.at ?? now) + s * 1000));
  return (
    <>
      <Header onBack={back}>
        <span className="nbadge" style={{ background: head }}>{line}</span>
        <span className="shead-text">
          <b>{v?.dest ? `To ${v.dest}` : 'Tracking bus'}</b>
          <small>{operator && <>{operator}<span className="dot" /></>}Bus {id}{v && <><span className="dot" /><LiveIcon /> live</>}</small>
        </span>
      </Header>
      <div className="nlist" data-vaul-no-drag>
        {!v && !error && <p className="empty">Finding this bus…</p>}
        {error && <p className="notice">This bus has no live position right now. It may have finished its trip.</p>}
        {v && v.stops.length > 0 && (
          <section className="busnext" aria-live="polite">
            <span className="muted">Next stop</span>
            <b>{v.stops[0].name}</b>
            <span>{eta(v.stops[0].eta)}{v.stops.length > 1 ? <><span className="dot" />then {v.stops[1].name}</> : ''}</span>
          </section>
        )}
        <ol className="timeline">
          {v?.stops.map((s, i) => {
            const hubId = stopHub.get(s.stop) ?? '';
            const hub = data.hubs.get(hubId);
            return (
              <li key={s.stop} className={`tl${hub?.major ? ' major' : ''}${i === 0 ? ' first here' : ''}${i === v.stops.length - 1 ? ' last' : ''}`} style={{ ['--c' as string]: colour(hubId) }}>
                <span className="tl-rail" aria-hidden="true"><span className="tl-dot" /></span>
                <div className="tl-body row-eta">
                  <button className="tl-name" onClick={() => hubId && openPlace(hubId, pos.get(s.stop) ? { id: s.stop, ...pos.get(s.stop)! } : undefined)}>
                    {s.name}{s.letter && <span className="letter">{s.letter}</span>}
                  </button>
                  <span className="tl-eta"><b>{eta(s.eta)}</b><small>{clock(s.eta)}</small></span>
                </div>
              </li>
            );
          })}
        </ol>
        {v && <p className="fineprint">Live from TfL, updated every 15 seconds.</p>}
      </div>
    </>
  );
}
