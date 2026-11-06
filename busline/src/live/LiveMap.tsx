import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Compass, LocateFixed } from 'lucide-react';
import type { Data } from '../lib/data';
import { useMedia } from '../lib/useMedia';
import { resolvedTheme, useStore } from '../store/store';
import type { LatLon, NearbyStop } from './api';

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const FONT_BOLD = ['Noto Sans Bold'];
const INK = { light: '#16201E', dark: '#E6EEEB' };
const PAPER = { light: '#FFFFFF', dark: '#18201E' };
const ACCENT = { light: '#0B6E69', dark: '#4FC2B9' };

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });
const pt = (lon: number, lat: number, properties: Record<string, unknown> = {}): GeoJSON.Feature =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } });

let linesPromise: Promise<FC> | null = null;
let stopsPromise: Promise<FC> | null = null;
const loadLines = () => (linesPromise ??= fetch('/data/lines.json').then((r) => r.json()));
const loadStops = () => (stopsPromise ??= fetch('/data/stops.json').then((r) => r.json()).then((rows: [string, number, number, string][]) =>
  fc(rows.map(([id, lat, lon, hub]) => pt(lon, lat, { id, hub })))));

export function LiveMap({ data, pos, nearby }: { data: Data; pos: LatLon | null; nearby: NearbyStop[] | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(0); // bumps after each style (re)load
  const [bearing, setBearing] = useState(0);
  const { route, theme, sheetInset, recentre } = useStore();
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const mode = resolvedTheme(theme);
  void systemDark; // re-render on system theme change
  const centred = useRef(false);

  // create the map once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLES[mode],
      center: [pos?.lon ?? -0.1281, pos?.lat ?? 51.5081],
      zoom: 15,
      minZoom: 9,
      maxZoom: 19,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: false,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Powered by TfL Open Data' }), 'bottom-left');
    m.touchZoomRotate.enableRotation();
    m.on('rotate', () => setBearing(m.getBearing()));
    m.on('style.load', () => setReady((n) => n + 1));
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // switch base style with the theme
  const styleMode = useRef(mode);
  useEffect(() => {
    if (!map.current || styleMode.current === mode) return;
    styleMode.current = mode;
    map.current.setStyle(STYLES[mode]);
  }, [mode]);

  // add our sources + layers after every style load
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let cancelled = false;
    const t = styleMode.current;
    Promise.all([loadLines(), loadStops()]).then(([lines, stops]) => {
      if (cancelled || !m.getStyle()) return;
      const majors = fc([...data.hubs.values()].filter((h) => h.major).map((h) => pt(h.lon, h.lat, { id: h.id, name: h.name, c: h.colour, n: h.routes.length })));
      const add = (id: string, d: FC) => (m.getSource(id) ? (m.getSource(id) as GeoJSONSource).setData(d) : m.addSource(id, { type: 'geojson', data: d }));
      add('routes', lines);
      add('stops', stops);
      add('majors', majors);
      add('nearby', fc([]));
      add('me', fc([]));
      const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id; // keep road names above our lines
      const width = ['interpolate', ['linear'], ['zoom'], 10, 1, 13, 2, 16, 3.5, 18, 5] as unknown as number;
      if (!m.getLayer('routes-plain')) {
        m.addLayer({ id: 'routes-plain', type: 'line', source: 'routes', filter: ['==', ['get', 'm'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#8A9692', 'line-opacity': 0.4, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.5, 17, 2.5] } }, before);
        m.addLayer({ id: 'routes', type: 'line', source: 'routes', filter: ['==', ['get', 'm'], 1],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-opacity': 0.8, 'line-width': width } }, before);
        m.addLayer({ id: 'route-sel-case', type: 'line', source: 'routes', filter: ['==', ['get', 'r'], ''],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': PAPER[t], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 10] } });
        m.addLayer({ id: 'route-sel', type: 'line', source: 'routes', filter: ['==', ['get', 'r'], ''],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4.5, 17, 7] } });
        m.addLayer({ id: 'stops', type: 'circle', source: 'stops', minzoom: 15,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 18, 5], 'circle-color': '#8A9692', 'circle-stroke-color': PAPER[t], 'circle-stroke-width': 1 } });
        m.addLayer({ id: 'nearby', type: 'circle', source: 'nearby',
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 11], 'circle-color': PAPER[t], 'circle-stroke-color': ACCENT[t], 'circle-stroke-width': 2.5 } });
        m.addLayer({ id: 'nearby-letter', type: 'symbol', source: 'nearby', minzoom: 14.5,
          layout: { 'text-field': ['get', 'letter'], 'text-font': FONT_BOLD, 'text-size': 10, 'text-allow-overlap': true },
          paint: { 'text-color': ACCENT[t] } });
        m.addLayer({ id: 'majors', type: 'circle', source: 'majors',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 13, 6, 16, 9],
            'circle-color': ['get', 'c'], 'circle-stroke-color': PAPER[t],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 16, 3],
          } });
        m.addLayer({ id: 'majors-label', type: 'symbol', source: 'majors', minzoom: 11,
          layout: {
            'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14],
            'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
            'text-radial-offset': 0.9, 'symbol-sort-key': ['-', 0, ['get', 'n']], 'text-optional': true,
          },
          paint: { 'text-color': INK[t], 'text-halo-color': PAPER[t], 'text-halo-width': 1.6 } });
        m.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 18, 'circle-color': '#2F7CF6', 'circle-opacity': 0.16 } });
        m.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#2F7CF6', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 } });
      }
      applySelection(m, useStore.getState().route);
      setLayersReady((n) => n + 1);
    });
    return () => { cancelled = true; };
  }, [ready, data]);
  const [layersReady, setLayersReady] = useState(0);

  // user location dot
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady || !pos) return;
    (m.getSource('me') as GeoJSONSource | undefined)?.setData(fc([pt(pos.lon, pos.lat)]));
    if (!centred.current) { centred.current = true; m.jumpTo({ center: [pos.lon, pos.lat], zoom: 15 }); }
  }, [pos, layersReady]);

  // nearby stops ring
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady) return;
    (m.getSource('nearby') as GeoJSONSource | undefined)?.setData(fc((nearby ?? []).map((s) => pt(s.lon, s.lat, { id: s.id, letter: s.letter.length <= 3 ? s.letter : '' }))));
  }, [nearby, layersReady]);

  // keep the map's centre above the sheet
  useEffect(() => { map.current?.easeTo({ padding: { top: 0, bottom: sheetInset, left: 0, right: 0 }, duration: 250 }); }, [sheetInset]);

  // recentre on request
  useEffect(() => {
    if (!recentre || !pos) return;
    map.current?.flyTo({ center: [pos.lon, pos.lat], zoom: 15, bearing: 0, duration: 700 });
  }, [recentre]); // eslint-disable-line react-hooks/exhaustive-deps

  // selected route: highlight + fit
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady) return;
    applySelection(m, route);
    if (!route) return;
    loadLines().then((lines) => {
      const b = new maplibregl.LngLatBounds();
      for (const f of lines.features) if (f.properties?.r === route) for (const c of (f.geometry as GeoJSON.LineString).coordinates) b.extend(c as [number, number]);
      // map padding already reserves the sheet; this padding is added on top of it
      if (!b.isEmpty()) m.fitBounds(b, { padding: { top: 80, bottom: 24, left: 24, right: 24 }, duration: 700, maxZoom: 15 });
    });
  }, [route, layersReady]);

  const askRecentre = useStore((s) => s.askRecentre);
  return (
    <div className="livemap">
      <div ref={el} className="livemap-canvas" />
      <div className="mapbtns">
        {Math.abs(bearing) > 1 && (
          <button className="roundbtn" aria-label="Reset map to north" onClick={() => map.current?.easeTo({ bearing: 0, duration: 300 })}>
            <Compass size={22} style={{ transform: `rotate(${-bearing - 45}deg)` }} />
          </button>
        )}
        <button className="roundbtn" aria-label="Centre on my location" onClick={askRecentre}><LocateFixed size={22} /></button>
      </div>
    </div>
  );
}

function applySelection(m: MLMap, route: string | null) {
  if (!m.getLayer('routes')) return;
  const sel = route ?? '';
  m.setFilter('route-sel', ['==', ['get', 'r'], sel]);
  m.setFilter('route-sel-case', ['==', ['get', 'r'], sel]);
  m.setPaintProperty('routes', 'line-opacity', route ? 0.12 : 0.8);
  m.setPaintProperty('routes-plain', 'line-opacity', route ? 0.12 : 0.4);
}
