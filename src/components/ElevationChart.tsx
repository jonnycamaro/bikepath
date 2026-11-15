import maplibregl from 'maplibre-gl';
import { useMemo, useRef, useState } from 'react';
import { formatDistance } from '../lib/geo';
import { gradeColor, grades } from '../lib/routeStyle';
import type { Route } from '../lib/routing';
import { useStore } from '../store';
import { mapRef } from './MapView';

let hoverMarker: maplibregl.Marker | null = null;
function showHover(p: [number, number] | null) {
  const map = mapRef.current;
  if (!map) return;
  if (!p) {
    hoverMarker?.remove();
    hoverMarker = null;
    return;
  }
  if (!hoverMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#fff;border:4px solid #0a2540;box-shadow:0 1px 4px rgba(0,0,0,.4)';
    hoverMarker = new maplibregl.Marker({ element: el });
  }
  hoverMarker.setLngLat(p).addTo(map);
}

interface Props {
  route: Route;
  height?: number;
  /** current position along the route (navigation) */
  position?: number;
  /** only show this window [from, to] metres */
  window?: [number, number];
  compact?: boolean;
}

export default function ElevationChart({ route, height = 120, position, window: win, compact }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const padL = compact ? 4 : 34;
  const padB = compact ? 4 : 18;
  const padT = 8;

  const data = useMemo(() => {
    const { coords, cum } = route;
    const from = win?.[0] ?? 0;
    const to = win?.[1] ?? route.distance;
    const g = grades(route);
    // downsample to ~300 points
    const idx: number[] = [];
    const step = Math.max(1, Math.floor(coords.length / 300));
    for (let i = 0; i < coords.length; i += step) if (cum[i] >= from && cum[i] <= to) idx.push(i);
    if (idx[idx.length - 1] !== coords.length - 1 && cum[coords.length - 1] <= to) idx.push(coords.length - 1);
    const eles = idx.map((i) => coords[i][2] ?? 0);
    let min = Math.min(...eles);
    let max = Math.max(...eles);
    if (max - min < 40) {
      const mid = (max + min) / 2;
      min = mid - 20;
      max = mid + 20;
    }
    return { idx, eles, min, max, from, to: Math.max(to, from + 1), g };
  }, [route, win?.[0], win?.[1]]);

  if (data.idx.length < 2) return null;
  const x = (d: number) => padL + ((d - data.from) / (data.to - data.from)) * (W - padL - 4);
  const y = (e: number) => padT + (1 - (e - data.min) / (data.max - data.min)) * (H - padT - padB);
  const pts = data.idx.map((i, k) => [x(route.cum[i]), y(data.eles[k])] as const);
  const bottom = H - padB;

  const polys = [];
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k];
    polys.push(<polygon key={k} points={`${x0},${bottom} ${x0},${y0} ${x1},${y1} ${x1},${bottom}`} fill={gradeColor(data.g[data.idx[k]])} opacity={0.85} />);
  }
  const line = pts.map((p) => p.join(',')).join(' ');

  const onMove = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * W;
    const d = data.from + ((fx - padL) / (W - padL - 4)) * (data.to - data.from);
    const clamped = Math.max(data.from, Math.min(data.to, d));
    setHover(clamped);
    useStore.setState({ chartHover: clamped });
    let i = route.cum.findIndex((c) => c >= clamped);
    if (i < 0) i = route.coords.length - 1;
    showHover([route.coords[i][0], route.coords[i][1]]);
  };
  const end = () => {
    setHover(null);
    useStore.setState({ chartHover: null });
    showHover(null);
  };

  let hoverInfo = null;
  if (hover != null) {
    let i = route.cum.findIndex((c) => c >= hover);
    if (i < 0) i = route.coords.length - 1;
    const e = route.coords[i][2] ?? 0;
    hoverInfo = { x: x(hover), y: y(e), e, d: hover, g: data.g[i] };
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: 'block', touchAction: 'none' }}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={end}
        onTouchStart={(e) => onMove(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={end}
        data-testid="elevation-chart"
      >
        {!compact && [0, 0.5, 1].map((f) => {
          const e = data.min + (data.max - data.min) * f;
          return (
            <g key={f}>
              <line x1={padL} x2={W} y1={y(e)} y2={y(e)} stroke="#e2e8f0" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={2} y={y(e) + 4} fontSize={11} fill="#5b6b7f">{Math.round(e)}</text>
            </g>
          );
        })}
        {polys}
        <polyline points={line} fill="none" stroke="#0a2540" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        {position != null && position >= data.from && position <= data.to && (
          <line x1={x(position)} x2={x(position)} y1={padT} y2={bottom} stroke="#0b6bd6" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
        )}
        {hoverInfo && <line x1={hoverInfo.x} x2={hoverInfo.x} y1={padT} y2={bottom} stroke="#0a2540" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {!compact && (
          <>
            <text x={padL} y={H - 3} fontSize={11} fill="#5b6b7f">{formatDistance(data.from)}</text>
            <text x={W - 4} y={H - 3} fontSize={11} fill="#5b6b7f" textAnchor="end">{formatDistance(data.to)}</text>
          </>
        )}
      </svg>
      {hoverInfo && (
        <div style={{ position: 'absolute', top: 0, left: `${(hoverInfo.x / W) * 100}%`, transform: 'translateX(-50%)', background: '#0a2540', color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {formatDistance(hoverInfo.d)} · {Math.round(hoverInfo.e)} m · {hoverInfo.g.toFixed(0)} %
        </div>
      )}
    </div>
  );
}
