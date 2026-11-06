import { useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { colourAt, routeSort, type Data, type Hub, type Route } from '../lib/data';
import { modeLabels } from '../lib/modes';
import { useMedia } from '../lib/useMedia';
import { useStore } from '../store/store';

const CHAIN_MAX = 4;
const PEEK_PX = 136;
const HEADER_PX = 52;

function RouteRow({ r, hub, data }: { r: Route; hub: Hub; data: Data }) {
  const { route, toggleRoute } = useStore();
  const [open, setOpen] = useState(false);
  const shown = open ? r.via : r.via.slice(0, CHAIN_MAX);
  const more = r.via.length - CHAIN_MAX;
  return (
    <div className="row" data-active={route === r.id}>
      <button className="rowmain" aria-pressed={route === r.id} onClick={() => toggleRoute(r.id)}>
        <span className="badge" style={{ background: colourAt(r, hub.id, data.hubs) }}>{r.id}</span>
        <span className="termini">{r.a} ↔ {r.b}</span>
      </button>
      {r.via.length > 0 && (
        <div className="chain">
          {shown.map((v, i) => {
            const m = data.hubs.get(v)!;
            return <span key={v + i}><i style={{ background: m.colour }} />{m.name}{i < shown.length - 1 || (!open && more > 0) ? ' →' : ''}</span>;
          })}
          {more > 0 && (
            <button className="more" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Show less' : `+${more} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function useStation(data: Data) {
  const { station } = useStore();
  return useMemo(() => {
    const hub = station ? data.hubs.get(station) : undefined;
    if (!hub) return null;
    const routes = (hub.routes.map((id) => data.routes.get(id)).filter(Boolean) as Route[]).sort((a, b) => routeSort(a.id, b.id));
    return {
      hub,
      routes,
      day: routes.filter((r) => !r.night && !r.school),
      night: routes.filter((r) => r.night),
      school: routes.filter((r) => r.school),
    };
  }, [station, data]);
}

function Header({ hub, count, titleAs: Title }: { hub: Hub; count: number; titleAs: React.ElementType }) {
  const { selectStation, toggleRoute } = useStore();
  return (
    <header className="sheethead">
      <span className={`disc${hub.major ? '' : ' minor'}`} style={{ background: hub.colour }} />
      <div className="sheettitle">
        <Title className="h2">{hub.name}</Title>
        <div className="sub">
          {[`${count} route${count === 1 ? '' : 's'}`, ...modeLabels(hub.rail)].map((t, i, all) => (
            <span key={t} className="item">{t}{i < all.length - 1 && <span className="sep" aria-hidden="true">·</span>}</span>
          ))}
        </div>
      </div>
      <button className="iconbtn close" aria-label="Close" onClick={() => { selectStation(null); toggleRoute(null); }}><X size={20} /></button>
    </header>
  );
}

function Body({ data, s }: { data: Data; s: NonNullable<ReturnType<typeof useStation>> }) {
  return (
    <div className="body">
      {s.day.length > 0 && <><h3>Day buses</h3>{s.day.map((r) => <RouteRow key={r.id} r={r} hub={s.hub} data={data} />)}</>}
      {s.night.length > 0 && <><h3>Night buses</h3>{s.night.map((r) => <RouteRow key={r.id} r={r} hub={s.hub} data={data} />)}</>}
      {s.school.length > 0 && <><h3>School / limited service</h3>{s.school.map((r) => <RouteRow key={r.id} r={r} hub={s.hub} data={data} />)}</>}
    </div>
  );
}

export function Sheet({ data }: { data: Data }) {
  const desktop = useMedia('(min-width: 900px)');
  const s = useStation(data);
  const { setSheetInset, selectStation } = useStore();
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const on = () => setVh(window.innerHeight); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);

  const snaps = useMemo(() => [`${PEEK_PX}px`, `${Math.round(vh * 0.5)}px`, `${vh - HEADER_PX}px`], [vh]);
  const [snap, setSnap] = useState<string | number | null>(snaps[1]);
  // Every new station opens at half height.
  useEffect(() => { if (s) setSnap(snaps[1]); }, [s?.hub.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (desktop || !s) { setSheetInset(0); return; }
    const px = parseInt(String(snap ?? snaps[1]), 10);
    setSheetInset(px >= vh - HEADER_PX ? 0 : px);
  }, [desktop, s, snap, snaps, vh, setSheetInset]);

  if (desktop) {
    if (!s) return null;
    return (
      <aside className="panel" aria-label={`${s.hub.name} routes`}>
        <Header hub={s.hub} count={s.routes.length} titleAs="h2" />
        <Body data={data} s={s} />
      </aside>
    );
  }

  return (
    <Drawer.Root
      open={!!s}
      onOpenChange={(o) => { if (!o) selectStation(null); }}
      snapPoints={snaps}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      modal={false}
      dismissible={false}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Content className="drawer" style={{ height: vh - HEADER_PX }} aria-describedby={undefined}>
          <Drawer.Handle className="handle" />
          {s && (
            <>
              <Header hub={s.hub} count={s.routes.length} titleAs={Drawer.Title} />
              <Body data={data} s={s} />
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
