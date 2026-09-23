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

// If this many fixes in a row are "impossibly far" from the anchor but agree
// with each other, the anchor is the bad one (a wild first fix, or one that
// slipped through after a long gap), so drop it and follow them instead.
const REANCHOR_RUN = 3;

function tooFast(a: Fix, b: Fix): boolean {
  const dt = (b.ts - a.ts) / 1000;
  return dt > 0 && haversineMeters(a, b) / dt > MAX_SPEED_MPS;
}

function moved(a: Fix, b: Fix): boolean {
  return haversineMeters(a, b) >= Math.max(MIN_MOVE_M, (accuracyOf(a) + accuracyOf(b)) / 2);
}

// The fixes the mileage is measured along. Anchor-based drift filter: a fix
// only counts once it is clearly away from the last counted fix, so jitter
// while parked never accumulates; jumps faster than MAX_SPEED_MPS are GPS
// glitches. The map and the trim slider draw exactly these points, so what
// you see is what was counted. Input may be unsorted.
export function trackPoints(points: Fix[]): Fix[] {
  const usable = points.filter(isUsable).sort((a, b) => a.ts - b.ts);
  if (!usable.length) return [];
  const track: Fix[] = [usable[0]];
  let run: Fix[] = [];
  for (let i = 1; i < usable.length; i++) {
    const p = usable[i];
    const anchor = track[track.length - 1];
    if (!moved(anchor, p)) {
      run = [];
      continue; // parked drift; anchor stays
    }
    if (!tooFast(anchor, p)) {
      run = [];
      track.push(p);
      continue;
    }
    // Glitch, or the anchor was the glitch. Collect consistent rejects.
    if (run.length && tooFast(run[run.length - 1], p)) run = [];
    run.push(p);
    if (run.length < REANCHOR_RUN) continue;
    while (track.length && tooFast(track[track.length - 1], run[0])) track.pop();
    for (const r of run) {
      if (!track.length || moved(track[track.length - 1], r)) track.push(r);
    }
    run = [];
  }
  return track;
}

// Distance driven through the fixes, in meters.
export function legMeters(points: Fix[]): number {
  const t = trackPoints(points);
  let total = 0;
  for (let i = 1; i < t.length; i++) total += haversineMeters(t[i - 1], t[i]);
  return total;
}

// Meters to miles, rounded to 2 decimals.
export function metersToMiles(m: number): number {
  return Math.round((m / METERS_PER_MILE) * 100) / 100;
}

// A hole in the recording where the car moved: 2+ minutes with no points and
// 500+ m between the points either side. Sitting at a light produces no points
// but doesn't move, so it never trips this. A killed service, a phone restart
// or a long GPS dropout does, and the leg's miles across the hole are only a
// straight-line guess. This is the reliable signal: when the app is reopened
// after being killed, Android restarts tracking before we can notice it stopped.
const GAP_MS = 2 * 60 * 1000;
const GAP_M = 500;

export function findGap(raw: Fix[]): { from: number; to: number } | null {
  const pts = trackPoints(raw); // a lone glitch isn't a hole in the recording
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.ts - a.ts > GAP_MS && haversineMeters(a, b) > GAP_M) return { from: a.ts, to: b.ts };
  }
  return null;
}

// Did any of these fixes leave the anchor, or is this all parked jitter? Same
// threshold trackPoints() counts by, so "moving" here means "miles are being
// added". Used to push the still-parked nudge back while he's driving.
export function anyMovement(anchor: Fix | null, fixes: Fix[]): boolean {
  if (!anchor || !isUsable(anchor)) return false;
  return fixes.some((f) => isUsable(f) && moved(anchor, f) && !tooFast(anchor, f));
}
