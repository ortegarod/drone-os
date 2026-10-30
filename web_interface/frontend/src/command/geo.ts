// Map <-> drone coordinates.
// The fleet API works in meters north/east of each drone's home (its local origin).
// The map works in lat/lon. Each drone reports both, so its home on the map is
// its GPS position minus its local offset. Flat-earth math: fine at property scale.
import { FleetDrone } from '../api/fleet';

export interface LatLon { lat: number; lon: number }

const M_PER_DEG = 111320;

export function homeOf(d: FleetDrone | undefined): LatLon | null {
  if (!d || !d.gps.valid || d.gps.lat == null || d.gps.lon == null || !d.position.valid) return null;
  const lat = d.gps.lat - d.position.north / M_PER_DEG;
  const lon = d.gps.lon - d.position.east / (M_PER_DEG * Math.cos((d.gps.lat * Math.PI) / 180));
  return { lat, lon };
}

export function toLatLon(home: LatLon, north: number, east: number): LatLon {
  return {
    lat: home.lat + north / M_PER_DEG,
    lon: home.lon + east / (M_PER_DEG * Math.cos((home.lat * Math.PI) / 180)),
  };
}

export function toLocal(home: LatLon, p: LatLon): { north: number; east: number } {
  return {
    north: (p.lat - home.lat) * M_PER_DEG,
    east: (p.lon - home.lon) * M_PER_DEG * Math.cos((home.lat * Math.PI) / 180),
  };
}

export function distance(a: LatLon, b: LatLon): number {
  const { north, east } = toLocal(a, b);
  return Math.hypot(north, east);
}

/** Point in polygon (ray casting) in lat/lon: fine at property scale. */
export function insidePolygon(p: LatLon, poly: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, bi] = poly[i], [aj, bj] = poly[j];
    if ((bi > p.lon) !== (bj > p.lon) && p.lat < ((aj - ai) * (p.lon - bi)) / (bj - bi) + ai) hit = !hit;
  }
  return hit;
}
