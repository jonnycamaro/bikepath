/** What a tapped place can become in the plan (half-ring menu, components/TapMenu.tsx). */
export type TapAction = 'start' | 'via' | 'end' | 'info' | 'delete';

/** name of a tapped place while its address is still being looked up */
export const PLACE_LOADING = 'Ort wird ermittelt …';

/** Fan on a point of the route itself: show it, or take it out of the route. */
export const WAYPOINT_ACTIONS: TapAction[] = ['info', 'delete'];
/** Fan on any other place, left to right. */
export const PLACE_ACTIONS: TapAction[] = ['start', 'via', 'end', 'info'];

/** Which actions make sense for the current plan; the others are shown grey. */
export function enabledActions(s: { waypoints: unknown[]; loop: unknown }, loading: boolean): Record<TapAction, boolean> {
  const ready = !loading;
  return {
    start: ready, // in a round trip this moves its start
    via: ready && (!!s.loop || s.waypoints.length >= 2), // a stop needs a route to sit on
    end: ready && !s.loop, // a round trip ends where it starts
    info: true,
    delete: true,
  };
}

/** "Start", "Zwischenziel 2", "Ziel" – how a route point is shown in its card */
export function waypointRole(i: number, n: number, loop: boolean): string {
  if (i === 0) return loop ? 'Start der Rundtour' : 'Start';
  if (i === n - 1 && !loop) return 'Ziel';
  return loop ? `Zwischenstopp ${i}` : `Zwischenziel ${i}`;
}
