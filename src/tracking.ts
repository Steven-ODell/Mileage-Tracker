import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import {
  closeDay, closeLeg, createDay, createLeg, db, insertPoints, lastPoint, legsMissingAddress,
  localDate, markInterrupted, openDay, openLeg, pointsForLeg, setAddress,
  type Day, type Leg,
} from './db';
import { haversineMeters, legMeters, metersToMiles, type Fix } from './geo';

export const TASK = 'mileage-tracking';

function toFix(l: Location.LocationObject): Fix {
  return { ts: l.timestamp, lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy ?? null };
}

// Must be defined at module scope so Android can run it headless after the UI
// is gone. Points go straight to SQLite, so nothing lives only in memory.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error) {
    console.warn('location task error', error.message);
    return;
  }
  const leg = openLeg();
  if (!leg || !data?.locations?.length) return;
  insertPoints(leg.id, data.locations.map(toFix));
});

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export type PermResult = 'ok' | 'no-foreground' | 'no-background';

export async function ensurePermissions(): Promise<PermResult> {
  let fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'no-foreground';
  let bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return 'no-background';
  // Without this the foreground-service notification is hidden on Android 13+.
  // Tracking still works if he says no, so don't block on it.
  await Notifications.requestPermissionsAsync().catch(() => {});
  return 'ok';
}

async function startUpdates() {
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 5000,
    distanceInterval: 10,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Mileage Log is tracking',
      notificationBody: 'Tap Mark stop in the app when you park.',
      notificationColor: '#1b7f3b',
      killServiceOnDestroy: false,
    },
  });
}

async function stopUpdates() {
  if (await isTracking()) await Location.stopLocationUpdatesAsync(TASK);
}

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false);
}

// Where am I right now. A fresh fix is best; failing that the last point this
// leg recorded; failing that whatever Android last knew.
async function currentFix(legId?: number): Promise<Fix> {
  try {
    return toFix(await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 20000));
  } catch {}
  const last = legId != null ? lastPoint(legId) : null;
  if (last) return { ...last, ts: Date.now() };
  const known = await Location.getLastKnownPositionAsync().catch(() => null);
  if (known) return toFix(known);
  throw new Error('No GPS fix yet. Step outside or wait a few seconds and try again.');
}

export function formatAddress(a: Location.LocationGeocodedAddress): string | null {
  const street = [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name;
  const stateZip = [a.region, a.postalCode].filter(Boolean).join(' ');
  const line = [street, a.city, stateZip].filter(Boolean).join(', ');
  return line || a.formattedAddress || null;
}

async function geocode(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await withTimeout(Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }), 15000);
    return r[0] ? formatAddress(r[0]) : null;
  } catch {
    return null;
  }
}

// Addresses are filled in after the leg is saved, so a slow or offline
// geocoder never holds up (or loses) a leg. Anything missing is retried
// whenever the app comes to the foreground.
export async function backfillAddresses(): Promise<boolean> {
  let changed = false;
  for (const leg of legsMissingAddress()) {
    if (leg.from_lat != null && leg.from_lng != null && !leg.from_address) {
      const a = await geocode(leg.from_lat, leg.from_lng);
      if (a) { setAddress(leg.id, 'from', a); changed = true; }
    }
    if (leg.to_lat != null && leg.to_lng != null && !leg.to_address) {
      const a = await geocode(leg.to_lat, leg.to_lng);
      if (a) { setAddress(leg.id, 'to', a); changed = true; }
    }
  }
  return changed;
}

export async function startDay(): Promise<PermResult> {
  if (openDay()) throw new Error('A day is already in progress.');
  const perm = await ensurePermissions();
  if (perm !== 'ok') return perm;
  const fix = await currentFix();
  await startUpdates();
  try {
    const now = Date.now();
    const d = db();
    d.withTransactionSync(() => {
      const dayId = createDay(now);
      createLeg(dayId, 1, now, fix);
    });
  } catch (e) {
    await stopUpdates();
    throw e;
  }
  return 'ok';
}

// A hole in the recording where the car moved: 2+ minutes with no points and
// 500+ m between the points either side. Sitting at a light produces no points
// but doesn't move, so it never trips this. A killed service, a phone restart
// or a long GPS dropout does, and the leg's miles across the hole are only a
// straight-line guess. This is the reliable signal: when the app is reopened
// after being killed, Android restarts tracking before we can notice it stopped.
const GAP_MS = 2 * 60 * 1000;
const GAP_M = 500;

export function findGap(pts: Fix[]): { from: number; to: number } | null {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.ts - a.ts > GAP_MS && haversineMeters(a, b) > GAP_M) return { from: a.ts, to: b.ts };
  }
  return null;
}

function finishLeg(day: Day, leg: Leg, to: Fix, now: number): number {
  insertPoints(leg.id, [to]);
  const pts = pointsForLeg(leg.id);
  const miles = metersToMiles(legMeters(pts));
  closeLeg(leg.id, now, to, miles);
  if (findGap(pts)) markInterrupted(day.id, leg.id);
  return miles;
}

// Ends the current leg here and starts the next one from the same spot.
// Returns the id of the leg that was just closed (for the purpose picker).
export async function markStop(): Promise<number> {
  const day = openDay();
  const leg = openLeg();
  if (!day || !leg) throw new Error('No day in progress.');
  const fix = await currentFix(leg.id);
  const now = Date.now();
  db().withTransactionSync(() => {
    finishLeg(day, leg, fix, now);
    createLeg(day.id, leg.leg_no + 1, now, fix);
  });
  return leg.id;
}

// atLastPoint: close at the last recorded GPS point instead of where the phone
// is now. Used when a day was interrupted or left open overnight.
export async function endDay(opts: { atLastPoint?: boolean } = {}): Promise<number | null> {
  const day = openDay();
  if (!day) return null;
  const leg = openLeg();
  let closedId: number | null = null;
  if (leg) {
    const last = lastPoint(leg.id);
    const fix = opts.atLastPoint && last ? last : await currentFix(leg.id);
    const now = opts.atLastPoint && last ? last.ts : Date.now();
    db().withTransactionSync(() => {
      finishLeg(day, leg, fix, now);
      closeDay(day.id, now);
    });
    closedId = leg.id;
  } else {
    closeDay(day.id, Date.now());
  }
  await stopUpdates();
  return closedId;
}

export async function resumeTracking(): Promise<PermResult> {
  const perm = await ensurePermissions();
  if (perm !== 'ok') return perm;
  await startUpdates();
  return 'ok';
}

export type Status = {
  day: Day | null;
  leg: Leg | null;
  tracking: boolean;
  interrupted: boolean; // day is open but the tracking service isn't running
  stale: boolean; // day was started on an earlier date
  liveMiles: number;
  lastFixTs: number | null;
  gap: { from: number; to: number } | null; // recording hole in the open leg
};

export async function getStatus(): Promise<Status> {
  const day = openDay();
  const leg = openLeg();
  const tracking = await isTracking();
  if (!day && tracking) await stopUpdates(); // orphaned service, nothing to record into
  const pts = leg ? pointsForLeg(leg.id) : [];
  const interrupted = !!day && !tracking;
  const gap = findGap(pts);
  if (day && leg && !leg.interrupted && (interrupted || gap)) {
    markInterrupted(day.id, leg.id);
    day.interrupted = 1;
    leg.interrupted = 1;
  }
  return {
    day,
    leg,
    tracking,
    interrupted,
    stale: !!day && day.date !== localDate(Date.now()),
    liveMiles: metersToMiles(legMeters(pts)),
    lastFixTs: pts.length ? pts[pts.length - 1].ts : null,
    gap,
  };
}
