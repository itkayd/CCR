import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NEUTRAL } from '../lib/colour';
import { pathColours, routeSort, type Data } from '../lib/data';
import { useStore } from '../store/store';

interface VB { x: number; y: number; w: number; h: number }
const MIN_ZOOM = 0.2, MAX_ZOOM = 8;

/** Route lines: built once per data load, never on pan/zoom. */
const RouteLayer = memo(function RouteLayer({ data }: { data: Data }) {
  const { gradients, pieces } = useMemo(() => {
    const gradients: JSX.Element[] = [];
    const pieces: JSX.Element[] = [];
    let g = 0;
    for (const r of data.routes.values()) {
      const pts = r.path.map((id) => data.hubs.get(id)!);
      if (pts.length < 2) continue;
      const cols = pathColours(r, data.hubs);
      // split at major stations so each piece fades from one colour to the next
      const cuts = [0, ...r.path.map((id, i) => (data.hubs.get(id)!.major ? i : -1)).filter((i) => i > 0 && i < pts.length - 1), pts.length - 1];
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], b = cuts[k + 1];
        if (b <= a) continue;
        const seg = pts.slice(a, b + 1);
        const d = 'M' + seg.map((p) => `${p.x} ${p.y}`).join('L');
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
        pieces.push(<path key={`${r.id}-${k}`} d={d} stroke={stroke} data-route={r.id} vectorEffect="non-scaling-stroke" />);
      }
    }
    return { gradients, pieces };
  }, [data]);
  return (
    <>
      <defs>{gradients}</defs>
      <g className="routes" fill="none" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke">
        {pieces}
      </g>
    </>
  );
});

export function Map({ data }: { data: Data }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const vb = useRef<VB>({ x: 0, y: 0, w: 100, h: 100 });
  const fitVB = useRef<VB>({ x: 0, y: 0, w: 100, h: 100 });
  const [scale, setScale] = useState(1); // screen px per map unit
  const { station, route, selectStation, toggleRoute } = useStore();

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
    setScale((s) => (Math.abs(s - px) / px > 0.04 ? px : s));
  }, []);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const pad = 24;
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

  // Pointer pan + pinch
  const pointers = useRef(new globalThis.Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
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

  // Size things in screen pixels regardless of zoom
  const u = 1 / scale;
  const zoom = fitVB.current.w ? (svgRef.current?.clientWidth ?? 1) / scale / fitVB.current.w : 1;
  const showNums = zoom > 2.2;
  const sel = route ? data.routes.get(route) : null;

  const selPath = useMemo(() => {
    if (!sel) return null;
    const pts = sel.path.map((id) => data.hubs.get(id)!);
    return { d: 'M' + pts.map((p) => `${p.x} ${p.y}`).join('L'), pts };
  }, [sel, data]);

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
        <rect className="bg" x={bounds.x0 - 2000} y={bounds.y0 - 2000} width={bounds.x1 - bounds.x0 + 4000} height={bounds.y1 - bounds.y0 + 4000} fill="url(#grid)" />
        <g style={{ opacity: sel ? 0.13 : 1, transition: 'opacity .2s' }}>
          <RouteLayer data={data} />
        </g>
        {sel && selPath && (
          <g pointerEvents="none">
            <path d={selPath.d} fill="none" stroke="var(--paper)" strokeWidth={7} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            <SelectedRoute data={data} routeId={sel.id} />
            {selPath.pts.filter((p) => !p.major).map((p) => (
              <circle key={p.id} cx={p.x} cy={p.y} r={2.6 * u} fill="var(--surface)" stroke={NEUTRAL} strokeWidth={1.4 * u} />
            ))}
            {zoom > 3 && selPath.pts.filter((p) => !p.major).map((p) => (
              <text key={'t' + p.id} x={p.x + 5 * u} y={p.y + 3.5 * u} fontSize={10 * u} className="label" strokeWidth={3 * u} style={{ fontWeight: 600, fill: 'var(--muted)' }}>{p.name}</text>
            ))}
          </g>
        )}
        {stationHub && !stationHub.major && (
          <circle cx={stationHub.x} cy={stationHub.y} r={5 * u} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2 * u} pointerEvents="none" />
        )}
        <g>
          {majors.map((h) => {
            const faded = sel && !sel.path.includes(h.id);
            const nums = h.routes.filter((r) => !/^6\d\d$/.test(r)).sort(routeSort);
            const lines: string[] = [];
            for (let i = 0; i < nums.length; i += 7) lines.push(nums.slice(i, i + 7).join(' '));
            return (
              <g key={h.id} opacity={faded ? 0.25 : 1}
                onClick={(e) => { e.stopPropagation(); if (tapped()) selectStation(h.id); }}
                style={{ cursor: 'pointer' }}>
                <circle cx={h.x} cy={h.y} r={14 * u} fill="transparent" />
                <circle cx={h.x} cy={h.y} r={7.5 * u} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.3 * u} />
                <circle cx={h.x} cy={h.y} r={5.2 * u} fill={h.colour} />
                {station === h.id && <circle cx={h.x} cy={h.y} r={11 * u} fill="none" stroke="var(--ink)" strokeWidth={2 * u} />}
                {zoom > 0.9 && (
                  <text x={h.x + 10 * u} y={h.y + 4 * u} fontSize={12 * u} className="label" strokeWidth={3.5 * u}>{h.name}</text>
                )}
                {showNums && lines.map((l, i) => (
                  <text key={i} x={h.x + 10 * u} y={h.y + (17 + i * 12) * u} fontSize={10.5 * u} className="rnums" fill={h.colour} strokeWidth={3 * u}>{l}</text>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="zoomctl">
        <button className="iconbtn" aria-label="Zoom in" onClick={() => zoomBtn(1.5)}>+</button>
        <button className="iconbtn" aria-label="Zoom out" onClick={() => zoomBtn(1 / 1.5)}>−</button>
        <button className="iconbtn" aria-label="Fit map" onClick={fit} style={{ fontSize: 13 }}>Fit</button>
      </div>
    </div>
  );
}

function SelectedRoute({ data, routeId }: { data: Data; routeId: string }) {
  const r = data.routes.get(routeId)!;
  const pts = r.path.map((id) => data.hubs.get(id)!);
  const cols = pathColours(r, data.hubs);
  return (
    <g fill="none" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke">
      {pts.slice(1).map((p, i) => (
        <line key={i} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} stroke={cols[i]} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  );
}
