// Pure distance math for mileage. Zero imports: used by the app and by Node
// tests (Node runs this file via type stripping, so only erasable TS syntax).

export type Fix = { ts: number; lat: number; lng: number; accuracy: number | null }; // ts = epoch ms, accuracy = meters

export const METERS_PER_MILE = 1609.344;

// Fixes with a worse (larger) accuracy radius than this are dropped.
export const MAX_ACCURACY_M = 30;

// Accuracy assumed when a fix has none (emulator / mock fixes often omit it).
// Such fixes count as usable and use this value in the drift threshold.
const ASSUMED_ACCURACY_M = 15;

// A move shorter than this (or the two fixes' mean accuracy, if larger) is
// treated as parked drift and ignored. Raised from 20 to 50: parked jitter of
// +/-15 m per axis puts two fixes up to ~42 m apart, so 20 let an hour parked
// log 3.5 mi. 50 clears that and is still below one 5 s fix at 25 mph (56 m);
// slower crawling just gets counted in fewer, longer hops since the anchor stays.
const MIN_MOVE_M = 50;

// Faster than this between anchor and a fix (~134 mph) is a GPS glitch.
const MAX_SPEED_MPS = 60;

const EARTH_RADIUS_M = 6371008.8; // IUGG mean radius

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function accuracyOf(f: Fix): number {
  return f.accuracy == null ? ASSUMED_ACCURACY_M : f.accuracy;
}

// Usable = accuracy <= MAX_ACCURACY_M. A null accuracy is usable (assumed 15 m).
export function isUsable(f: Fix): boolean {
  return accuracyOf(f) <= MAX_ACCURACY_M;
}

// Distance driven through the fixes, in meters. Anchor-based drift filter:
// a fix only counts once it is clearly away from the last counted fix, so
// jitter while parked never accumulates. Input may be unsorted.
export function legMeters(points: Fix[]): number {
  const usable = points.filter(isUsable).sort((a, b) => a.ts - b.ts);
  if (usable.length < 2) return 0;

  let anchor = usable[0];
  let total = 0;
  for (let i = 1; i < usable.length; i++) {
    const p = usable[i];
    const d = haversineMeters(anchor, p);
    const threshold = Math.max(MIN_MOVE_M, (accuracyOf(anchor) + accuracyOf(p)) / 2);
    if (d < threshold) continue; // parked drift; anchor stays
    const dt = (p.ts - anchor.ts) / 1000;
    if (dt > 0 && d / dt > MAX_SPEED_MPS) continue; // glitch jump; anchor stays
    total += d;
    anchor = p;
  }
  return total;
}

// Meters to miles, rounded to 2 decimals.
export function metersToMiles(m: number): number {
  return Math.round((m / METERS_PER_MILE) * 100) / 100;
}
