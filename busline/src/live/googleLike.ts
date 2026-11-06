// A Google-Maps-like look on free OpenFreeMap data: restyle the Liberty style's
// layers with a soft grey/white palette (day) or a blue-grey night palette.
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

interface Palette {
  land: string; residential: string; park: string; wood: string; water: string; waterLabel: string;
  building: string; minor: string; minorCase: string; secondary: string; secondaryCase: string;
  primary: string; primaryCase: string; motorway: string; motorwayCase: string; rail: string;
  path: string; roadLabel: string; placeLabel: string; poiLabel: string; halo: string; hospital: string; school: string;
}

const DAY: Palette = {
  land: '#F5F5F2', residential: '#F1F1EE', park: '#CDEBD3', wood: '#C3E5CA', water: '#A9D3F5', waterLabel: '#3F7AB5',
  building: '#E8E8E6', minor: '#FFFFFF', minorCase: '#DCDCDA', secondary: '#FFFFFF', secondaryCase: '#D2D2CF',
  primary: '#FDE6A0', primaryCase: '#EDC872', motorway: '#F9C85C', motorwayCase: '#DDA23A', rail: '#C9C9C6', path: '#FFFFFF',
  roadLabel: '#5F6368', placeLabel: '#3C4043', poiLabel: '#6B6F73', halo: '#FFFFFF', hospital: '#F9E4E2', school: '#EFEDE6',
};
const NIGHT: Palette = {
  land: '#242F3E', residential: '#26303F', park: '#263C3F', wood: '#25393B', water: '#17263C', waterLabel: '#5D7FA3',
  building: '#2C3646', minor: '#38414E', minorCase: '#212A37', secondary: '#3F4958', secondaryCase: '#212A37',
  primary: '#5C5646', primaryCase: '#1F2835', motorway: '#746855', motorwayCase: '#1F2835', rail: '#3A4452', path: '#3A4452',
  roadLabel: '#9CA5B3', placeLabel: '#D2D6DC', poiLabel: '#8C96A3', halo: '#1B2330', hospital: '#2F3443', school: '#2A3342',
};

type Rule = [RegExp, (p: Palette) => Record<string, unknown>];
const RULES: Rule[] = [
  [/^background$/, (p) => ({ 'background-color': p.land })],
  // residential sits above parks in Liberty, so keep it see-through
  [/^landuse_residential$/, (p) => ({ 'fill-color': p.residential, 'fill-opacity': 0.5 })],
  [/^(park|landcover_grass|landuse_pitch|landuse_track|landuse_cemetery)$/, (p) => ({ 'fill-color': p.park, 'fill-opacity': 1 })],
  [/^park_outline$/, (p) => ({ 'line-color': p.park })],
  [/^landcover_wood$/, (p) => ({ 'fill-color': p.wood, 'fill-opacity': 1 })],
  [/^landuse_hospital$/, (p) => ({ 'fill-color': p.hospital })],
  [/^landuse_school$/, (p) => ({ 'fill-color': p.school })],
  [/^water$/, (p) => ({ 'fill-color': p.water })],
  [/^waterway_/, (p) => ({ 'line-color': p.water })],
  [/^(waterway_line_label|water_name_)/, (p) => ({ 'text-color': p.waterLabel, 'text-halo-color': p.halo })],
  [/^building$/, (p) => ({ 'fill-color': p.building, 'fill-outline-color': p.building })],
  [/_(motorway|motorway_link)_casing$/, (p) => ({ 'line-color': p.motorwayCase })],
  [/_(motorway|motorway_link)$/, (p) => ({ 'line-color': p.motorway })],
  [/_(trunk_primary|link)_casing$/, (p) => ({ 'line-color': p.primaryCase })],
  [/_(trunk_primary|link)$/, (p) => ({ 'line-color': p.primary })],
  [/_secondary_tertiary_casing$/, (p) => ({ 'line-color': p.secondaryCase })],
  [/_secondary_tertiary$/, (p) => ({ 'line-color': p.secondary })],
  [/_(minor|street|service_track)_casing$/, (p) => ({ 'line-color': p.minorCase })],
  [/_(minor|street|service_track)$/, (p) => ({ 'line-color': p.minor })],
  [/_(major_rail|transit_rail)(_hatching)?$/, (p) => ({ 'line-color': p.rail })],
  [/_path_pedestrian(_casing)?$/, (p) => ({ 'line-color': p.path })],
  [/^highway-name/, (p) => ({ 'text-color': p.roadLabel, 'text-halo-color': p.halo, 'text-halo-width': 1.5 })],
  [/^poi_/, (p) => ({ 'text-color': p.poiLabel, 'text-halo-color': p.halo })],
  [/^(label_|airport)/, (p) => ({ 'text-color': p.placeLabel, 'text-halo-color': p.halo, 'text-halo-width': 1.5 })],
];

export function googleLike(style: StyleSpecification, mode: 'light' | 'dark'): StyleSpecification {
  const p = mode === 'dark' ? NIGHT : DAY;
  const layers = style.layers
    // no 3D blocks or relief raster: keep it flat and calm like Google's default view
    .filter((l) => l.type !== 'fill-extrusion' && l.type !== 'raster')
    .map((l) => {
      const rule = RULES.find(([re]) => re.test(l.id));
      if (!rule) return l;
      // only keep properties that belong to this layer type (e.g. text-* for symbols)
      const prefix = l.type === 'symbol' ? 'text-' : `${l.type}-`;
      const paint = Object.fromEntries(Object.entries(rule[1](p)).filter(([k]) => k.startsWith(prefix)));
      return { ...l, paint: { ...(l as { paint?: object }).paint, ...paint } } as LayerSpecification;
    });
  return { ...style, layers };
}

/** Red rounded-square bus-stop icon (drawn once, no image files). */
export function busStopIcon(): { width: number; height: number; data: Uint8ClampedArray } {
  const s = 40, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#FFFFFF';
  g.beginPath(); g.roundRect(1, 1, s - 2, s - 2, 10); g.fill();
  g.fillStyle = '#D93A2B';
  g.beginPath(); g.roundRect(4, 4, s - 8, s - 8, 8); g.fill();
  // bus glyph
  g.fillStyle = '#FFFFFF';
  g.beginPath(); g.roundRect(11, 9, 18, 19, 4); g.fill();
  g.fillStyle = '#D93A2B';
  g.fillRect(13.5, 12, 13, 7);
  g.beginPath(); g.arc(15, 23.5, 1.7, 0, Math.PI * 2); g.arc(25, 23.5, 1.7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#FFFFFF';
  g.fillRect(12.5, 28, 3.5, 3); g.fillRect(24, 28, 3.5, 3);
  const img = g.getImageData(0, 0, s, s);
  return { width: s, height: s, data: img.data };
}
