import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Fix,
  METERS_PER_MILE,
  MAX_ACCURACY_M,
  haversineMeters,
  isUsable,
  legMeters,
  metersToMiles,
} from '../src/geo.ts';

// Deterministic PRNG (mulberry32) so jitter is the same every run.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAT0 = 33.45; // Phoenix
const LNG0 = -112.07;
const M_PER_DEG_LAT = 111_195;
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

// Offset a point by meters north/east.
function offset(lat: number, lng: number, north: number, east: number) {
  return { lat: lat + north / M_PER_DEG_LAT, lng: lng + east / mPerDegLng(lat) };
}

const MPH = 0.44704; // m/s
const STEP_S = 5;

// Drive due east from (lat,lng) for `meters` at `mph`, 5 s fixes, 5-10 m accuracy.
function drive(start: { ts: number; lat: number; lng: number }, meters: number, mph: number, rand: () => number): Fix[] {
  const v = mph * MPH;
  const n = Math.ceil(meters / (v * STEP_S));
  const out: Fix[] = [];
  for (let i = 0; i <= n; i++) {
    const along = Math.min(meters, i * v * STEP_S);
    const p = offset(start.lat, start.lng, (rand() - 0.5) * 6, along + (rand() - 0.5) * 6);
    out.push({ ts: start.ts + i * STEP_S * 1000, ...p, accuracy: 5 + rand() * 5 });
  }
  return out;
}

// Parked at (lat,lng) for `seconds`, ±15 m jitter per axis, 8-20 m accuracy.
function park(start: { ts: number; lat: number; lng: number }, seconds: number, rand: () => number): Fix[] {
  const out: Fix[] = [];
  for (let t = STEP_S; t <= seconds; t += STEP_S) {
    const p = offset(start.lat, start.lng, (rand() * 2 - 1) * 15, (rand() * 2 - 1) * 15);
    out.push({ ts: start.ts + t * 1000, ...p, accuracy: 8 + rand() * 12 });
  }
  return out;
}

const miles = (pts: Fix[]) => legMeters(pts) / METERS_PER_MILE;
const report = (name: string, pts: Fix[]) => {
  const mi = miles(pts);
  console.log(`# ${name}: ${mi.toFixed(4)} mi`);
  return mi;
};

test('haversine: 1 degree of latitude is about 111.2 km', () => {
  const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111_195) < 100, `got ${d}`);
  assert.equal(haversineMeters({ lat: LAT0, lng: LNG0 }, { lat: LAT0, lng: LNG0 }), 0);
});

test('isUsable: accuracy cutoff and null', () => {
  const f = (accuracy: number | null): Fix => ({ ts: 0, lat: 0, lng: 0, accuracy });
  assert.equal(isUsable(f(MAX_ACCURACY_M)), true);
  assert.equal(isUsable(f(MAX_ACCURACY_M + 0.1)), false);
  assert.equal(isUsable(f(80)), false);
  assert.equal(isUsable(f(null)), true);
});

test('metersToMiles rounds to 2 decimals', () => {
  assert.equal(metersToMiles(METERS_PER_MILE), 1);
  assert.equal(metersToMiles(2414.016), 1.5);
  assert.equal(metersToMiles(1000), 0.62);
});

test('straight 1-mile drive at 30 mph is within 2% of 1.00 mi', () => {
  const pts = drive({ ts: 0, lat: LAT0, lng: LNG0 }, METERS_PER_MILE, 30, rng(1));
  const mi = report('1 mile drive', pts);
  assert.ok(Math.abs(mi - 1) <= 0.02, `got ${mi}`);
});

test('1 hour parked with jitter adds < 0.02 mi', () => {
  const pts = park({ ts: 0, lat: LAT0, lng: LNG0 }, 3600, rng(2));
  const mi = report('1 hour parked', pts);
  assert.ok(mi < 0.02, `got ${mi}`);
});

test('low-accuracy (80 m) points are ignored', () => {
  const rand = rng(3);
  const pts = drive({ ts: 0, lat: LAT0, lng: LNG0 }, METERS_PER_MILE, 30, rand);
  // Add bad fixes scattered up to 300 m off the road between the good ones.
  const bad: Fix[] = pts.slice(0, -1).map((p) => ({
    ...offset(p.lat, p.lng, (rand() * 2 - 1) * 300, (rand() * 2 - 1) * 300),
    ts: p.ts + 2500,
    accuracy: 80,
  }));
  const clean = miles(pts);
  const mi = report('drive + 80 m fixes', [...pts, ...bad]);
  assert.equal(mi, clean);
});

test('a single glitch point 2 km off mid-drive does not inflate', () => {
  const pts = drive({ ts: 0, lat: LAT0, lng: LNG0 }, METERS_PER_MILE, 30, rng(4));
  const mid = pts[Math.floor(pts.length / 2)];
  const glitch: Fix = { ...offset(mid.lat, mid.lng, 2000, 0), ts: mid.ts + 2500, accuracy: 10 };
  const clean = miles(pts);
  const mi = report('drive + 2 km glitch', [...pts, glitch]);
  assert.ok(Math.abs(mi - clean) < 0.01, `clean ${clean}, got ${mi}`);
  assert.ok(Math.abs(mi - 1) <= 0.02, `got ${mi}`);
});

test('stop-and-go: drive, park 10 min, drive ~ sum of drives', () => {
  const rand = rng(5);
  const a = drive({ ts: 0, lat: LAT0, lng: LNG0 }, 2 * METERS_PER_MILE, 35, rand);
  const endA = a[a.length - 1];
  const stop = { ts: endA.ts, ...offset(LAT0, LNG0, 0, 2 * METERS_PER_MILE) };
  const parked = park(stop, 600, rand);
  const b = drive({ ts: stop.ts + 605_000, lat: stop.lat, lng: stop.lng }, 1.5 * METERS_PER_MILE, 25, rand);
  const mi = report('stop-and-go (2 + 1.5 mi)', [...a, ...parked, ...b]);
  assert.ok(Math.abs(mi - 3.5) <= 0.035 * 2, `got ${mi}`);
});

test('unsorted input gives the same result as sorted', () => {
  const pts = drive({ ts: 0, lat: LAT0, lng: LNG0 }, METERS_PER_MILE, 30, rng(6));
  const shuffled = [...pts];
  const rand = rng(7);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  report('unsorted 1 mile', shuffled);
  assert.equal(legMeters(shuffled), legMeters(pts));
});

test('empty and single point give 0', () => {
  assert.equal(legMeters([]), 0);
  assert.equal(legMeters([{ ts: 0, lat: LAT0, lng: LNG0, accuracy: 5 }]), 0);
  assert.equal(legMeters([{ ts: 0, lat: LAT0, lng: LNG0, accuracy: null }]), 0);
});
