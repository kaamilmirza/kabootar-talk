/**
 * Great-circle geometry for the kabootar's route.
 *
 * Everything here is pure and runs on-device — the server never learns where
 * either nest is. Coordinates are degrees; distances are kilometres.
 */

export const EARTH_RADIUS_KM = 6371.0088;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in kilometres (haversine). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing in degrees (0 = north) the pigeon holds when leaving `a` for `b`. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Point at fraction `t` (0..1) along the great circle from `a` to `b`.
 *
 * Spherical linear interpolation — this is the path a real homing pigeon
 * approximates, and it is what makes a Toronto->Hyderabad letter arc north
 * over Greenland rather than straight across the Atlantic.
 */
export function interpolate(a: LatLon, b: LatLon, t: number): LatLon {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const d = toRad(angularDistanceDeg(a, b));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };

  const sinD = Math.sin(d);
  const A = Math.sin((1 - t) * d) / sinD;
  const B = Math.sin(t * d) / sinD;

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  return {
    lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
    lon: toDeg(Math.atan2(y, x)),
  };
}

/** Angular separation in degrees — used internally by `interpolate`. */
export function angularDistanceDeg(a: LatLon, b: LatLon): number {
  return toDeg(distanceKm(a, b) / EARTH_RADIUS_KM);
}

/** Unit vector on the sphere, for feeding three.js. y is up (north pole). */
export function toVector3(p: LatLon, radius = 1): [number, number, number] {
  const phi = toRad(90 - p.lat);
  const theta = toRad(p.lon + 180);
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

/** Sample `steps + 1` evenly spaced points along the great circle. */
export function samplePath(a: LatLon, b: LatLon, steps = 96): LatLon[] {
  return Array.from({ length: steps + 1 }, (_, i) => interpolate(a, b, i / steps));
}
