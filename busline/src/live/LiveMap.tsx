import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Compass, LocateFixed } from 'lucide-react';
import type { Data } from '../lib/data';
import { useMedia } from '../lib/useMedia';
import { resolvedTheme, useStore } from '../store/store';
import type { LatLon, NearbyStop } from './api';
import { dropBaseBusStops, googleLike, stopIcon } from './googleLike';

const STOP_FALLBACK = '#D93A2B';
/** naptanId → marker colour, filled when stops.json loads */
const stopColour = new Map<string, string>();
const stopHubOf = new Map<string, string>();

/** Load a provider's style; the Google-like one is OpenFreeMap Liberty restyled in the browser. */
function applyStyle(m: MLMap, provider: Provider, mode: 'light' | 'dark') {
  const url = PROVIDERS[provider][mode];
  m.setStyle(url, {
    diff: false,
    transformStyle: (_prev, next) => {
      const base = dropBaseBusStops(next);
      return provider === 'google' ? googleLike(base, mode) : base;
    },
  });
}

// Two free, keyless providers; the user picks one from the sub-tabs.
export const PROVIDERS = {
  google: {
    label: 'Google-like',
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/liberty',
    bold: ['Noto Sans Bold'],
  },
  openfreemap: {
    label: 'OpenFreeMap',
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
    bold: ['Noto Sans Bold'],
  },
  versatiles: {
    label: 'VersaTiles',
    light: 'https://tiles.versatiles.org/assets/styles/colorful/style.json',
    dark: 'https://tiles.versatiles.org/assets/styles/colorful-dark/style.json',
    bold: ['noto_sans_bold'],
  },
} as const;
export type Provider = keyof typeof PROVIDERS;
const INK = { light: '#16201E', dark: '#E6EEEB' };
const PAPER = { light: '#FFFFFF', dark: '#18201E' };

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });
const pt = (lon: number, lat: number, properties: Record<string, unknown> = {}): GeoJSON.Feature =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } });

let linesPromise: Promise<FC> | null = null;
let stopsPromise: Promise<FC> | null = null;
const loadLines = () => (linesPromise ??= fetch('/data/lines.json').then((r) => r.json()));
const loadStops = () => (stopsPromise ??= fetch('/data/stops.json').then((r) => r.json()).then((rows: [string, number, number, string, string][]) => {
  for (const [id, , , hub, c] of rows) { stopColour.set(id, c); stopHubOf.set(id, hub); }
  return fc(rows.map(([id, lat, lon, hub, c]) => pt(lon, lat, { id, hub, c })));
}));

export function LiveMap({ data, pos, nearby }: { data: Data; pos: LatLon | null; nearby: NearbyStop[] | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(0); // bumps after each style (re)load
  const [bearing, setBearing] = useState(0);
  const { route, theme, sheetInset, recentre, provider, overlay, focus, searching, trip } = useStore();
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const mode = resolvedTheme(theme);
  void systemDark; // re-render on system theme change
  const centred = useRef(false);

  // create the map once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: { version: 8, sources: {}, layers: [] },
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
    // stop markers are drawn on demand, one image per colour ("stop-#RRGGBB")
    m.on('styleimagemissing', (e) => {
      if (!e.id.startsWith('stop-') || m.hasImage(e.id)) return;
      m.addImage(e.id, stopIcon(e.id.slice(5)), { pixelRatio: 2 });
    });
    applyStyle(m, provider, mode);
    map.current = m;
    (window as unknown as { __map: MLMap }).__map = m; // debugging
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // switch base style with the theme or provider
  const styleMode = useRef(mode);
  const styleProvider = useRef<Provider>(provider);
  useEffect(() => {
    if (!map.current || (styleMode.current === mode && styleProvider.current === provider)) return;
    styleMode.current = mode;
    styleProvider.current = provider;
    applyStyle(map.current, provider, mode);
  }, [mode, provider]);

  // add our sources + layers after every style load
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let cancelled = false;
    const t = styleMode.current;
    const FONT_BOLD = [...PROVIDERS[styleProvider.current].bold];
    // Stops (1 MB) first so markers and the location dot appear quickly;
    // route lines (5.7 MB) fill in when they arrive.
    loadStops().then((stops) => {
      if (cancelled || !m.getStyle()) return;
      const majors = fc([...data.hubs.values()].filter((h) => h.major).map((h) => pt(h.lon, h.lat, { id: h.id, name: h.name, c: h.colour, n: h.routes.length })));
      const add = (id: string, d: FC) => (m.getSource(id) ? (m.getSource(id) as GeoJSONSource).setData(d) : m.addSource(id, { type: 'geojson', data: d }));
      add('routes', fc([]));
      loadLines().then((lines) => { if (!cancelled && m.getSource('routes')) (m.getSource('routes') as GeoJSONSource).setData(lines); }).catch(() => {});
      add('stops', stops);
      add('majors', majors);
      add('nearby', fc([]));
      add('me', fc([]));
      add('route-stops', fc([]));
      add('buses', fc([]));
      add('trip', fc([]));
      add('trip-points', fc([]));
      // Draw routes above the whole base map: some styles (OpenFreeMap Dark) put road
      // casings after their first label layer, which hid the lines.
      const before = undefined;
      const width = ROUTE_WIDTH as unknown as number;
      if (!m.getLayer('routes-plain')) {
        m.addLayer({ id: 'routes-plain', type: 'line', source: 'routes', filter: ['==', ['get', 'm'], 0],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': t === 'dark' ? '#9AA7A3' : '#6F7C78', 'line-opacity': 0.75, 'line-width': width } }, before);
        m.addLayer({ id: 'routes', type: 'line', source: 'routes', filter: ['==', ['get', 'm'], 1],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-opacity': 0.8, 'line-width': width } }, before);
        m.addLayer({ id: 'route-sel-case', type: 'line', source: 'routes', filter: ['==', ['get', 'r'], ''],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': PAPER[t], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 10] } });
        m.addLayer({ id: 'route-sel', type: 'line', source: 'routes', filter: ['==', ['get', 'r'], ''],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4.5, 17, 7] } });
        // Every stop: a rounded square with a bus glyph in its route colour (red if none)
        m.addLayer({ id: 'stops', type: 'symbol', source: 'stops', minzoom: 14.5,
          layout: {
            'icon-image': ['concat', 'stop-', ['get', 'c']],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 14.5, 0.6, 16, 0.8, 18, 1.05],
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
          } });
        // Stops in the Nearby list: bigger, with their stop letter underneath
        m.addLayer({ id: 'nearby', type: 'symbol', source: 'nearby', minzoom: 12.5,
          layout: {
            'icon-image': ['concat', 'stop-', ['get', 'c']],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.6, 16, 1, 18, 1.25],
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
            'text-field': ['step', ['zoom'], '', 15, ['get', 'letter']], 'text-font': FONT_BOLD, 'text-size': 11,
            'text-anchor': 'top', 'text-offset': [0, 1.15], 'text-optional': true, // letters hide when they collide
          },
          paint: { 'text-color': INK[t], 'text-halo-color': PAPER[t], 'text-halo-width': 1.6 } });
        // selected route: its own stops at every zoom, and live buses on top
        m.addLayer({ id: 'route-stops', type: 'symbol', source: 'route-stops', minzoom: 11,
          layout: {
            'icon-image': ['concat', 'stop-', ['get', 'c']],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.45, 14, 0.7, 17, 1.05],
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
          } });
        m.addLayer({ id: 'buses-halo', type: 'circle', source: 'buses',
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 14], 'circle-color': '#FFFFFF', 'circle-opacity': 0.95 } });
        m.addLayer({ id: 'buses', type: 'circle', source: 'buses',
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7.5, 16, 12], 'circle-color': ['get', 'c'] } });
        m.addLayer({ id: 'buses-label', type: 'symbol', source: 'buses',
          layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 11], 'text-allow-overlap': true, 'text-ignore-placement': true },
          paint: { 'text-color': '#FFFFFF' } });
        // a planned journey: bus legs in route colour, walking legs dashed
        m.addLayer({ id: 'trip-case', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': PAPER[t], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 12] } });
        m.addLayer({ id: 'trip-walk', type: 'line', source: 'trip', filter: ['==', ['get', 'mode'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 5], 'line-dasharray': [0.1, 1.8] } });
        m.addLayer({ id: 'trip-bus', type: 'line', source: 'trip', filter: ['==', ['get', 'mode'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 8] } });
        m.addLayer({ id: 'trip-points', type: 'circle', source: 'trip-points',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'kind'], 'end'], 9, 6.5],
            'circle-color': ['case', ['==', ['get', 'kind'], 'end'], ['get', 'c'], PAPER[t]],
            'circle-stroke-color': ['case', ['==', ['get', 'kind'], 'end'], PAPER[t], ['get', 'c']],
            'circle-stroke-width': 3.5,
          } });
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
    loadStops().then(() => {
      (m.getSource('nearby') as GeoJSONSource | undefined)?.setData(fc((nearby ?? []).map((s) =>
        pt(s.lon, s.lat, { id: s.id, hub: stopHubOf.get(s.id) ?? '', letter: s.letter.length <= 3 ? s.letter : '', c: stopColour.get(s.id) ?? STOP_FALLBACK }))));
    });
  }, [nearby, layersReady]);

  // route overlay (stops of the shown direction + live buses)
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady) return;
    (m.getSource('route-stops') as GeoJSONSource | undefined)?.setData(fc((overlay?.stops ?? []).map((s) => pt(s.lon, s.lat, { c: s.c, hub: s.hub }))));
    // nudge buses slightly back from the stop they are approaching so they don't hide it
    (m.getSource('buses') as GeoJSONSource | undefined)?.setData(fc((overlay?.buses ?? []).map((b) => pt(b.lon, b.lat + 0.00012, { c: b.c, label: b.label }))));
    if (m.getLayer('stops')) m.setPaintProperty('stops', 'icon-opacity', overlay ? 0.35 : 1);
  }, [overlay, layersReady]);

  // journey search: light up the network group by group while TfL plans the trip
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady || !searching) return;
    const { from, to } = searching;
    if (to.lat !== undefined && to.lon !== undefined) {
      const b = new maplibregl.LngLatBounds([from.lon, from.lat], [from.lon, from.lat]).extend([to.lon, to.lat]);
      m.fitBounds(b, { padding: { top: 90, bottom: 40, left: 40, right: 40 }, duration: 900, maxZoom: 14 });
    } else m.flyTo({ center: [from.lon, from.lat], zoom: 11.5, duration: 900 });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ph = 0;
    const paint = () => {
      const lit = ['==', ['get', 'k'], ph], trail = ['==', ['get', 'k'], (ph + 7) % 8];
      for (const id of ['routes', 'routes-plain']) {
        if (!m.getLayer(id)) continue;
        m.setPaintProperty(id, 'line-opacity', reduce ? 0.8 : ['case', lit, 1, trail, 0.7, 0.2]);
        m.setPaintProperty(id, 'line-width', reduce ? ROUTE_WIDTH : ['interpolate', ['linear'], ['zoom'], 10, ['case', lit, 2.6, 1], 14, ['case', lit, 5, 2.4], 17, ['case', lit, 8, 3.5]]);
      }
      ph = (ph + 1) % 8;
    };
    paint();
    const timer = reduce ? 0 : window.setInterval(paint, 120);
    return () => {
      clearInterval(timer);
      for (const id of ['routes', 'routes-plain']) if (m.getLayer(id)) m.setPaintProperty(id, 'line-width', ROUTE_WIDTH);
      // a journey result may already be showing: keep the network faded behind it
      if (useStore.getState().trip) { m.setPaintProperty('routes', 'line-opacity', 0.1); m.setPaintProperty('routes-plain', 'line-opacity', 0.1); }
      else applySelection(m, useStore.getState().route);
    };
  }, [searching, layersReady]);

  // the chosen journey
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady) return;
    (m.getSource('trip') as GeoJSONSource | undefined)?.setData(fc((trip?.legs ?? []).filter((l) => l.path.length > 1).map((l) =>
      ({ type: 'Feature', properties: { mode: l.mode, c: l.c }, geometry: { type: 'LineString', coordinates: l.path } }))));
    (m.getSource('trip-points') as GeoJSONSource | undefined)?.setData(fc((trip?.points ?? []).map((p) => pt(p.lon, p.lat, { kind: p.kind, c: p.c }))));
    if (trip) {
      m.setPaintProperty('routes', 'line-opacity', 0.1);
      m.setPaintProperty('routes-plain', 'line-opacity', 0.1);
      const b = new maplibregl.LngLatBounds();
      for (const l of trip.legs) for (const c of l.path) b.extend(c);
      if (!b.isEmpty()) m.fitBounds(b, { padding: { top: 90, bottom: 30, left: 30, right: 30 }, duration: 700, maxZoom: 15.5 });
    } else if (!useStore.getState().searching) applySelection(m, useStore.getState().route);
  }, [trip, layersReady]);

  // fly to a place
  useEffect(() => {
    if (focus) map.current?.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom, duration: 700 });
  }, [focus]);

  // taps: stop or station → place screen; a line → route screen
  useEffect(() => {
    const m = map.current;
    if (!m || !layersReady) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const box: [[number, number], [number, number]] = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
      const layers = ['route-stops', 'nearby', 'stops', 'majors', 'route-sel', 'routes', 'routes-plain'].filter((l) => m.getLayer(l));
      const f = m.queryRenderedFeatures(box, { layers })[0];
      if (!f) return;
      const st = useStore.getState();
      if (f.layer.id === 'majors') st.openPlace(f.properties.id);
      else if (f.properties.hub) st.openPlace(f.properties.hub);
      else if (f.properties.r && f.properties.r !== st.route) st.openRoute(f.properties.r);
    };
    m.on('click', onClick);
    const hover = (e: maplibregl.MapMouseEvent) => {
      const box: [[number, number], [number, number]] = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
      const hitAny = m.queryRenderedFeatures(box, { layers: ['route-stops', 'nearby', 'stops', 'majors', 'routes', 'routes-plain'].filter((l) => m.getLayer(l)) }).length > 0;
      m.getCanvas().style.cursor = hitAny ? 'pointer' : '';
    };
    m.on('mousemove', hover);
    return () => { m.off('click', onClick); m.off('mousemove', hover); };
  }, [layersReady]);

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

const ROUTE_WIDTH = ['interpolate', ['linear'], ['zoom'], 10, 1, 13, 2, 16, 3.5, 18, 5];

function applySelection(m: MLMap, route: string | null) {
  if (!m.getLayer('routes')) return;
  const sel = route ?? '';
  m.setFilter('route-sel', ['==', ['get', 'r'], sel]);
  m.setFilter('route-sel-case', ['==', ['get', 'r'], sel]);
  m.setPaintProperty('routes', 'line-opacity', route ? 0.12 : 0.8);
  m.setPaintProperty('routes-plain', 'line-opacity', route ? 0.12 : 0.75);
}
