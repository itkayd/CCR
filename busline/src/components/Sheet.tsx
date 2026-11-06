import { colourAt, routeSort, type Data, type Route } from '../lib/data';
import { useStore } from '../store/store';

export function Sheet({ data }: { data: Data }) {
  const { station, route, selectStation, toggleRoute } = useStore();
  if (!station) return null;
  const hub = data.hubs.get(station);
  if (!hub) return null;

  const routes = hub.routes.map((id) => data.routes.get(id)).filter(Boolean) as Route[];
  routes.sort((a, b) => routeSort(a.id, b.id));
  const day = routes.filter((r) => !r.night && !r.school);
  const night = routes.filter((r) => r.night);
  const school = routes.filter((r) => r.school);

  const Row = ({ r }: { r: Route }) => (
    <button className="row" aria-pressed={route === r.id} onClick={() => toggleRoute(r.id)}>
      <span className="badge" style={{ background: colourAt(r, hub.id, data.hubs) }}>{r.id}</span>
      <span>
        <div className="termini">{r.a} ↔ {r.b}</div>
        {r.via.length > 0 && (
          <div className="chain">
            {r.via.map((v, i) => {
              const m = data.hubs.get(v)!;
              return <span key={v + i}><i style={{ background: m.colour }} />{m.name}{i < r.via.length - 1 ? ' →' : ''}</span>;
            })}
          </div>
        )}
      </span>
    </button>
  );

  return (
    <aside className="sheet" aria-label={`${hub.name} routes`}>
      <header>
        <span className={`disc${hub.major ? '' : ' minor'}`} style={{ background: hub.colour }} />
        <div>
          <h2>{hub.name}</h2>
          <div className="sub">
            {routes.length} route{routes.length === 1 ? '' : 's'}
            {hub.rail?.length ? ` · interchange: ${hub.rail.join(', ').replace(/-/g, ' ')}` : ''}
          </div>
        </div>
        <button className="iconbtn close" aria-label="Close" onClick={() => { selectStation(null); toggleRoute(null); }}>×</button>
      </header>
      <div className="body">
        {day.length > 0 && <><h3>Day buses</h3>{day.map((r) => <Row key={r.id} r={r} />)}</>}
        {night.length > 0 && <><h3>Night buses</h3>{night.map((r) => <Row key={r.id} r={r} />)}</>}
        {school.length > 0 && <><h3>School / limited service</h3>{school.map((r) => <Row key={r.id} r={r} />)}</>}
      </div>
    </aside>
  );
}
