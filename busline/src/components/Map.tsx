import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { NEUTRAL } from '../lib/colour';
import { pathColours, routeSort, type Data, type Hub } from '../lib/data';
import { prefersReducedMotion } from '../lib/useMedia';
import { useStore } from '../store/store';

interface VB { x: number; y: number; w: number; h: number }
const MIN_ZOOM = 0.2, MAX_ZOOM = 8;
const FIT_PAD = 0.02; // must match scripts/lib/spread.ts
// Major marker at all zoom levels, in screen px (outer ring diameter 12 px).
const R_OUTER = 6, R_INNER = 4.2, RING = 1.2;
const LABEL_PX = 12, NUM_PX = 10.5, NUM_LINE = 12, NUMS_PER_LINE = 7;
const ZOOMCTL_H = 3 * 44 + 2 * 8; // three 44 px buttons, 8 px gaps

/** Route lines: built once per data load, never on pan/zoom. */
const RouteLayer = memo(function RouteLayer({ data }: { data: Data }) {
  const { gradients, coloured, plain } = useMemo(() => {
    const gradients: JSX.Element[] = [];
    const coloured: JSX.Element[] = [];
    const plain: JSX.Element[] = [];
    let g = 0;
    for (const r of data.routes.values()) {
      const pts = r.path.map((id) => data.hubs.get(id)!);
      if (pts.length < 2) continue;
      if (!r.via.length) {
        plain.push(<path key={r.id} d={'M' + pts.map((p) => `${p.x} ${p.y}`).join('L')} data-route={r.id} vectorEffect="non-scaling-stroke" />);
        continue;
      }
      const cols = pathColours(r, data.hubs);
      // split at major stations so each piece fades from one colour to the next
      const cuts = [0, ...r.path.map((id, i) => (data.hubs.get(id)!.major ? i : -1)).filter((i) => i > 0 && i < pts.length - 1), pts.length - 1];
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], b = cuts[k + 1];
        if (b <= a) continue;
        const seg = pts.slice(a, b + 1);
        let stroke = cols[a];
        if (cols[a] !== cols[b]) {
          const id = `g${g++}`;
          gradients.push(
            <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={seg[0].x} y1={seg[0].y} x2={seg[seg.length - 1].x} y2={seg[seg.length - 1].y}>
              <stop offset="0" stopColor={cols[a]} />
              <stop offset="1" stopColor={cols[b]} />
            </linearGradient>,
          );
          stroke = `url(#${id})`;
        }
        coloured.push(<path key={`${r.id}-${k}`} d={'M' + seg.map((p) => `${p.x} ${p.y}`).join('L')} stroke={stroke} data-route={r.id} vectorEffect="non-scaling-stroke" />);
      }
    }
    return { gradients, coloured, plain };
  }, [data]);
  return (
    <>
      <defs>{gradients}</defs>
      <g fill="none" stroke={NEUTRAL} strokeOpacity={0.4} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round">{plain}</g>
      <g fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round">{coloured}</g>
    </>
  );
});

// ---- label collision -------------------------------------------------------
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
type Box = [number, number, number, number]; // x0 y0 x1 y1 in screen px
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function numberLines(h: Hub) {
  const nums = h.routes.filter((r) => !/^6\d\d$/.test(r)).sort(routeSort);
  const lines: string[] = [];
  for (let i = 0; i < nums.length; i += NUMS_PER_LINE) lines.push(nums.slice(i, i + NUMS_PER_LINE).join(' '));
  return lines;
}

/** Greedy placement: stations with more routes win; a label is hidden if it
 *  would overlap a label already placed or any other station's marker. */
function placeLabels(majors: Hub[], scale: number, withNums: boolean, fontsReady: number, view: { x: number; y: number; W: number; H: number }, keepOut: Box[]) {
  void fontsReady;
  const sx0 = (h: Hub) => (h.x - view.x) * scale, sy0 = (h: Hub) => (h.y - view.y) * scale;
  const markers: Box[] = majors.map((h) => [sx0(h) - R_OUTER - 1, sy0(h) - R_OUTER - 1, sx0(h) + R_OUTER + 1, sy0(h) + R_OUTER + 1]);
  const placed: Box[] = [];
  const show = new globalThis.Map<string, 'r' | 'l'>();
  const inside = (b: Box) => b[0] >= 2 && b[1] >= 2 && b[2] <= view.W - 2 && b[3] <= view.H - 2;
  const order = majors.map((h, i) => ({ h, i })).sort((a, b) => b.h.routes.length - a.h.routes.length);
  for (const { h, i } of order) {
    const sx = sx0(h), sy = sy0(h);
    if (sx < -50 || sy < -50 || sx > view.W + 50 || sy > view.H + 50) continue;
    let w = textWidth(h.name, `800 ${LABEL_PX}px Overpass`);
    let hgt = LABEL_PX + 2;
    if (withNums) {
      const lines = numberLines(h);
      for (const l of lines) w = Math.max(w, textWidth(l, `700 ${NUM_PX}px "Overpass Mono"`));
      hgt += lines.length * NUM_LINE;
    }
    const y0 = sy - LABEL_PX / 2 - 2, y1 = sy - LABEL_PX / 2 + hgt;
    const right: Box = [sx + R_OUTER + 3, y0, sx + R_OUTER + 5 + w, y1];
    const left: Box = [sx - R_OUTER - 5 - w, y0, sx - R_OUTER - 3, y1];
    const free = (box: Box) => inside(box) && !keepOut.some((k) => hit(k, box)) && !placed.some((b) => hit(b, box)) && !markers.some((m, j) => j !== i && hit(m, box));
    const side = free(right) ? 'r' : free(left) ? 'l' : null;
    if (!side) continue;
    placed.push(side === 'r' ? right : left);
    show.set(h.id, side);
  }
  return show;
}

// ---- map -------------------------------------------------------------------
export function Map({ data }: { data: Data }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const vb = useRef<VB>({ x: 0, y: 0, w: 100, h: 100 });
  const fitVB = useRef<VB>({ x: 0, y: 0, w: 100, h: 100 });
  const [scale, setScale] = useState(1); // screen px per map unit
  const [fontsReady, setFontsReady] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, W: 1, H: 1 });
  const viewTimer = useRef(0);
  const { station, route, sheetInset, selectStation, toggleRoute } = useStore();

  useEffect(() => { document.fonts?.ready.then(() => setFontsReady((n) => n + 1)); }, []);

  const majors = useMemo(() => [...data.hubs.values()].filter((h) => h.major), [data]);
  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of data.routes.values()) for (const id of r.path) {
      const h = data.hubs.get(id)!; x0 = Math.min(x0, h.x); y0 = Math.min(y0, h.y); x1 = Math.max(x1, h.x); y1 = Math.max(y1, h.y);
    }
    return { x0, y0, x1, y1 };
  }, [data]);

  const apply = useCallback(() => {
    const v = vb.current, svg = svgRef.current;
    if (!svg) return;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    const px = svg.clientWidth / v.w;
    setScale((s) => (Math.abs(s - px) / px > 0.03 ? px : s));
    clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(() => setView({ x: v.x, y: v.y, W: svg.clientWidth, H: svg.clientHeight }), 120);
  }, []);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const pad = (bounds.x1 - bounds.x0) * FIT_PAD;
    const bw = bounds.x1 - bounds.x0 + pad * 2, bh = bounds.y1 - bounds.y0 + pad * 2;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    let w = bw, h = bw / aspect;
    if (h < bh) { h = bh; w = bh * aspect; }
    const v = { x: (bounds.x0 + bounds.x1) / 2 - w / 2, y: (bounds.y0 + bounds.y1) / 2 - h / 2, w, h };
    fitVB.current = v; vb.current = { ...v }; apply();
  }, [bounds, apply]);

  useLayoutEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current!, v = vb.current;
      const aspect = el.clientWidth / Math.max(1, el.clientHeight);
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      v.h = v.w / aspect; v.x = cx - v.w / 2; v.y = cy - v.h / 2; apply();
    });
    ro.observe(wrapRef.current!);
    return () => ro.disconnect();
  }, [apply]);

  /** Zoom by factor k around a screen point. */
  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    const svg = svgRef.current!, v = vb.current;
    const fw = fitVB.current.w;
    const newW = Math.min(fw / MIN_ZOOM, Math.max(fw / MAX_ZOOM, v.w / k));
    k = v.w / newW;
    const mx = v.x + (sx / svg.clientWidth) * v.w, my = v.y + (sy / svg.clientHeight) * v.h;
    v.w /= k; v.h /= k; v.x = mx - (sx / svg.clientWidth) * v.w; v.y = my - (sy / svg.clientHeight) * v.h;
    apply();
  }, [apply]);

  // Keep the selected station centred in the part of the map above the sheet.
  const anim = useRef(0);
  useEffect(() => {
    const h = station ? data.hubs.get(station) : null;
    const svg = svgRef.current;
    if (!h || !svg) return;
    const W = svg.clientWidth, H = svg.clientHeight;
    const v = vb.current;
    const minZoomOnSelect = 1.6;
    const targetW = Math.min(v.w, fitVB.current.w / minZoomOnSelect);
    const targetH = targetW * (H / W);
    const visibleH = Math.max(80, H - sheetInset);
    const to = { w: targetW, h: targetH, x: h.x - targetW / 2, y: h.y - (visibleH / 2 / H) * targetH };
    const from = { ...v };
    cancelAnimationFrame(anim.current);
    const t0 = performance.now(), dur = prefersReducedMotion() ? 0 : 280;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const e = 1 - (1 - k) ** 3;
      vb.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e };
      apply();
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(anim.current);
  }, [station, sheetInset, data, apply]);

  // Pointer pan + pinch
  const pointers = useRef(new globalThis.Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    cancelAnimationFrame(anim.current);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = 0;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const svg = svgRef.current!, v = vb.current, rect = svg.getBoundingClientRect();
    if (ps.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      if (moved.current > 6) (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      v.x -= (dx / svg.clientWidth) * v.w; v.y -= (dy / svg.clientHeight) * v.h;
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      apply();
    } else if (ps.size === 2) {
      const [a, b] = [...ps.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved.current += 10;
      if (d0 > 0) zoomAt(d1 / d0, (e.clientX + other.x) / 2 - rect.left, (e.clientY + other.y) / 2 - rect.top);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) setDragging(false);
  };
  const onWheel = (e: React.WheelEvent) => {
    cancelAnimationFrame(anim.current);
    const rect = svgRef.current!.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  };
  const tapped = () => moved.current < 6;

  const onMapClick = (e: React.MouseEvent) => {
    if (!tapped()) return;
    const t = e.target as Element;
    const rid = t.getAttribute('data-route');
    if (rid) { toggleRoute(rid); return; }
    if (t.tagName === 'svg' || t.classList.contains('bg')) toggleRoute(null);
  };

  const zoomBtn = (k: number) => { const s = svgRef.current!; zoomAt(k, s.clientWidth / 2, s.clientHeight / 2); };

  const u = 1 / scale; // one screen px in map units
  const zoom = fitVB.current.w ? (svgRef.current?.clientWidth ?? 1) / scale / fitVB.current.w : 1;
  const showNums = zoom > 2.2;
  const sel = route ? data.routes.get(route) : null;
  // keep labels clear of the sheet and of the zoom buttons
  const labelView = useMemo(() => ({ ...view, H: Math.max(1, view.H - sheetInset) }), [view, sheetInset]);
  const keepOut = useMemo<Box[]>(() => [[view.W - 72, view.H - sheetInset - ZOOMCTL_H - 20, view.W, view.H - sheetInset]], [view, sheetInset]);
  const labels = useMemo(() => placeLabels(majors, scale, showNums, fontsReady, labelView, keepOut), [majors, scale, showNums, fontsReady, labelView, keepOut]);

  const selPts = useMemo(() => (sel ? sel.path.map((id) => data.hubs.get(id)!) : null), [sel, data]);
  const stationHub = station ? data.hubs.get(station) : null;

  return (
    <div
      ref={wrapRef}
      className={`mapwrap${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <svg ref={svgRef} onClick={onMapClick} role="img" aria-label="Bus network map">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <rect className="bg" x={bounds.x0 - 4000} y={bounds.y0 - 4000} width={bounds.x1 - bounds.x0 + 8000} height={bounds.y1 - bounds.y0 + 8000} fill="url(#grid)" />
        <g style={{ opacity: sel ? 0.13 : 1, transition: 'opacity .2s' }}>
          <RouteLayer data={data} />
        </g>
        {sel && selPts && (
          <g pointerEvents="none">
            <path d={'M' + selPts.map((p) => `${p.x} ${p.y}`).join('L')} fill="none" stroke="var(--paper)" strokeWidth={8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            <SelectedRoute data={data} routeId={sel.id} />
            {selPts.filter((p) => !p.major).map((p) => (
              <circle key={p.id} cx={p.x} cy={p.y} r={2.6 * u} fill="var(--surface)" stroke={NEUTRAL} strokeWidth={1.4 * u} />
            ))}
            {zoom > 3 && selPts.filter((p) => !p.major).map((p) => (
              <text key={'t' + p.id} x={p.x + 5 * u} y={p.y + 3.5 * u} fontSize={10 * u} className="label minor" strokeWidth={3 * u}>{p.name}</text>
            ))}
          </g>
        )}
        {stationHub && !stationHub.major && (
          <circle cx={stationHub.x} cy={stationHub.y} r={5 * u} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2 * u} pointerEvents="none" />
        )}
        <g>
          {majors.map((h) => {
            const faded = sel && !sel.path.includes(h.id);
            const side = labels.get(h.id) ?? (station === h.id ? 'r' : null);
            const showLabel = !!side;
            const tx = side === 'l' ? h.x - (R_OUTER + 4) * u : h.x + (R_OUTER + 4) * u;
            const anchor = side === 'l' ? 'end' : 'start';
            return (
              <g key={h.id} data-hub={h.id} opacity={faded ? 0.25 : 1}
                onClick={(e) => { e.stopPropagation(); if (tapped()) selectStation(h.id); }}
                style={{ cursor: 'pointer' }}>
                <circle cx={h.x} cy={h.y} r={16 * u} fill="transparent" />
                <circle cx={h.x} cy={h.y} r={R_OUTER * u} fill="var(--paper)" stroke="var(--ink)" strokeWidth={RING * u} />
                <circle cx={h.x} cy={h.y} r={R_INNER * u} fill={h.colour} />
                {station === h.id && <circle cx={h.x} cy={h.y} r={10 * u} fill="none" stroke="var(--ink)" strokeWidth={2 * u} />}
                {showLabel && (
                  <text x={tx} y={h.y + 4 * u} textAnchor={anchor} fontSize={LABEL_PX * u} className="label" strokeWidth={3.5 * u}>{h.name}</text>
                )}
                {showLabel && showNums && numberLines(h).map((l, i) => (
                  <text key={i} x={tx} textAnchor={anchor} y={h.y + (4 + LABEL_PX + 1 + i * NUM_LINE) * u} fontSize={NUM_PX * u} className="rnums" fill={h.colour} strokeWidth={3 * u}>{l}</text>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="zoomctl" style={{ bottom: `calc(${sheetInset}px + 16px)` }}>
        <button className="iconbtn" aria-label="Zoom in" onClick={() => zoomBtn(1.5)}><Plus size={20} /></button>
        <button className="iconbtn" aria-label="Zoom out" onClick={() => zoomBtn(1 / 1.5)}><Minus size={20} /></button>
        <button className="iconbtn" aria-label="Fit whole network" onClick={() => { cancelAnimationFrame(anim.current); fit(); }}><Maximize2 size={18} /></button>
      </div>
    </div>
  );
}

function SelectedRoute({ data, routeId }: { data: Data; routeId: string }) {
  const r = data.routes.get(routeId)!;
  const pts = r.path.map((id) => data.hubs.get(id)!);
  const cols = pathColours(r, data.hubs);
  return (
    <g fill="none" strokeWidth={4} strokeLinecap="round">
      {pts.slice(1).map((p, i) => (
        <line key={i} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} stroke={cols[i]} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  );
}
