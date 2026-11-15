import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { Place } from '../lib/geocode';
import { useStore } from '../store';
import { enabledActions, PLACE_ACTIONS, PLACE_LOADING, WAYPOINT_ACTIONS, type TapAction as Action } from '../lib/tapActions';
import { mapRef } from './MapView';
import { GLYPHS, SYMBOL_COLOR, SYMBOL_OFF } from './routeSymbols';

const COLOR = SYMBOL_COLOR;
const OFF = SYMBOL_OFF;
const LABEL: Record<Action, string> = { start: 'Als Start', via: 'Als Zwischenziel', end: 'Als Ziel', info: 'Informationen', delete: 'Aus der Route entfernen' };

const R0 = 38; // inner radius (px)
const R1 = 100; // outer radius
const CY = 16; // ring centre above the pin tip (a route point's round marker: centred on it, 0)
const GAP = 5; // px between two segments
const EDGE = 8; // free space to the left and right of the fan
const EDGE_TOP = 72; // free space above the fan (search button, status bar)

const pt = (r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180; // 0° = up, clockwise
  return [r * Math.cos(a), r * Math.sin(a)];
};
/**
 * Ring segment from a0 to a1 (degrees) with a straight gap of GAP px to its neighbours: the
 * angle to cut off depends on the radius (asin(gap/2 / r)), so the gap is as wide at the inner
 * edge as at the outer one instead of widening outwards.
 */
function sector(a0: number, a1: number): string {
  const cut = (r: number) => (Math.asin(GAP / 2 / r) * 180) / Math.PI;
  const [x0, y0] = pt(R1, a0 + cut(R1));
  const [x1, y1] = pt(R1, a1 - cut(R1));
  const [x2, y2] = pt(R0, a1 - cut(R0));
  const [x3, y3] = pt(R0, a0 + cut(R0));
  return `M${x0} ${y0}A${R1} ${R1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${R0} ${R0} 0 0 0 ${x3} ${y3}Z`;
}

function menuSvg(actions: Action[], enabled: Record<Action, boolean>, cy: number): string {
  const size = (R1 + 8) * 2;
  let s = `<svg class="tap-ring" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" style="left:${-size / 2}px;top:${-size / 2 - cy}px">`;
  const span = 180 / actions.length; // the half ring split evenly
  actions.forEach((k, i) => {
    const a0 = -90 + i * span;
    const a1 = a0 + span;
    const on = enabled[k];
    const [ix, iy] = pt((R0 + R1) / 2, (a0 + a1) / 2);
    const c = on ? COLOR[k] : OFF;
    s += `<g class="tap-seg${on ? '' : ' off'}" data-action="${k}" role="button" aria-label="${LABEL[k]}" aria-disabled="${!on}" style="--seg:${c.bg};color:${c.fg}">`;
    s += `<path d="${sector(a0, a1)}" fill="var(--seg)"/>`;
    s += `<g transform="translate(${ix - 13} ${iy - 13}) scale(${26 / 24})">${GLYPHS[k]}</g></g>`;
  });
  return s + '</svg>';
}

const PIN =
  '<svg class="tap-pin" width="34" height="44" viewBox="-17 -40 34 44"><ellipse cx="0" cy="0" rx="6" ry="2.4" fill="rgba(10,37,64,.35)"/><path d="M0 0C-3 -9 -14 -16 -14 -28a14 14 0 0 1 28 0C14 -16 3 -9 0 0Z" fill="#e5383b" stroke="#fff" stroke-width="2.5"/><circle cy="-28" r="5.2" fill="#fff"/></svg>';

/**
 * Half-ring menu at a tapped place (map, planner and navigation tab): start, stop,
 * destination and info as segments around the pin; actions that make no sense are grey.
 */
export default function TapMenu({ place }: { place: Place }) {
  const waypointId = useStore((s) => s.selectedWaypoint);
  /** a point of the route itself: only info and delete */
  const onWaypoint = !!waypointId && place.kind === 'waypoint';
  const actions = onWaypoint ? WAYPOINT_ACTIONS : PLACE_ACTIONS;
  const waypoints = useStore((s) => s.waypoints);
  const loop = useStore((s) => s.loop);
  const marker = useRef<maplibregl.Marker | null>(null);
  const el = useRef<HTMLDivElement | null>(null);
  const loading = place.name === PLACE_LOADING;
  const enabled = enabledActions({ waypoints, loop }, loading);

  const act = (a: Action) => {
    const s = useStore.getState();
    const p = s.tapMenu;
    if (!p) return;
    useStore.setState({ tapMenu: null });
    if (a === 'info') return s.showPlace(p); // the route point stays highlighted while its card is open
    if (a === 'delete') {
      if (s.selectedWaypoint) s.removeWaypoint(s.selectedWaypoint);
      return useStore.setState({ selectedWaypoint: null });
    }
    s.placeAs(a, p);
    if (s.tab !== 'plan') s.setTab('plan');
  };

  // the marker element is created once per place and follows the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // the fan always opens above the pin; where it does not fit, the map moves the pin into view
    // (after a running fly-to, e.g. when the point was picked in the list)
    const fit = () => {
      const at = map.project(place.lngLat);
      const box = map.getContainer().getBoundingClientRect();
      const top = R1 + (onWaypoint ? 0 : CY) + EDGE_TOP;
      const dx = at.x < R1 + EDGE ? R1 + EDGE - at.x : at.x > box.width - R1 - EDGE ? box.width - R1 - EDGE - at.x : 0;
      const dy = at.y < top ? top - at.y : 0;
      if (dx || dy) map.panBy([-dx, -dy], { duration: 250 });
    };
    if (map.isMoving()) map.once('moveend', fit);
    else fit();
    const div = document.createElement('div');
    div.className = 'tap-menu';
    div.dataset.testid = 'tap-menu';
    // taps on the menu must not reach the map (which would close it)
    for (const ev of ['mousedown', 'touchstart', 'click', 'dblclick']) div.addEventListener(ev, (e) => e.stopPropagation());
    div.addEventListener('click', (e) => {
      const seg = (e.target as Element).closest('.tap-seg') as SVGGElement | null;
      if (seg && !seg.classList.contains('off')) act(seg.dataset.action as Action);
    });
    el.current = div;
    marker.current = new maplibregl.Marker({ element: div, anchor: 'center' }).setLngLat(place.lngLat).addTo(map);
    return () => {
      marker.current?.remove();
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.lngLat[0], place.lngLat[1]]);

  // redraw when what is possible changes (address found, plan changed)
  useEffect(() => {
    if (el.current) el.current.innerHTML = menuSvg(actions, enabled, onWaypoint ? 0 : CY) + (onWaypoint ? '' : PIN);
  });

  return null;
}
