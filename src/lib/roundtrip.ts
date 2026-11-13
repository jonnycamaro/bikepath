import { destination, type LngLat } from './geo';

/**
 * Round-trip waypoints: a loop of roughly `distance` metres starting and ending at `start`,
 * heading out in `direction` (deg). Road distance is ~1.3x the polygon length, so the
 * polygon is scaled down. `variant` rotates/perturbs the loop for "neue Runde".
 */
export function roundTripWaypoints(start: LngLat, distance: number, direction: number, variant = 0, points = 4): LngLat[] {
  const circumference = distance / 1.3;
  const radius = circumference / (2 * Math.PI);
  const center = destination(start, radius, direction + variant * 23);
  const startAngle = (direction + variant * 23 + 180) % 360; // bearing from center back to start
  const out: LngLat[] = [start];
  for (let i = 1; i <= points; i++) {
    const wobble = 1 + 0.12 * Math.sin((variant + 1) * (i + 1) * 1.7);
    out.push(destination(center, radius * wobble, startAngle + (360 / (points + 1)) * i));
  }
  out.push(start);
  return out;
}
