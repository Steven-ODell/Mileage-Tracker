import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import {
  closeDay, closeLeg, createDay, createLeg, db, insertPoints, lastPoint, legsMissingAddress,
  localDate, markInterrupted, openDay, openLeg, pointsForLeg, setAddress,
  type Day, type Leg,
} from './db';
import { anyMovement, findGap, legMeters, metersToMiles, type Fix } from './geo';
import { bumpParkedNudge, cancelParkedNudge, hideControls, showControls } from './notify';

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
  const fixes = data.locations.map(toFix);
  const anchor = lastPoint(leg.id);
  insertPoints(leg.id, fixes);
  // Still driving, so push the still-parked nudge back. It only ever fires
  // once the car has been sitting with a leg open.
  if (anyMovement(anchor, fixes)) await bumpParkedNudge(Date.now());
  // Puts the buttons back if the service restarted and reposted its plain
  // notification. A no-op otherwise.
  const day = openDay();
  await showControls(leg.leg_no, leg.start_time, day && isStale(day) ? { staleDate: day.date } : { tracking: true })
    .catch((e) => console.warn('controls', e));
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
      // Android requires this one and expo-location can't put buttons on it.
      // It only shows until the first GPS batch, when showControls replaces
      // it with the version that has the Mark stop / End day buttons.
      notificationTitle: 'Mileage Log',
      notificationBody: 'Recording your route.',
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

// Android's last known position is only trusted if it's this fresh. An older
// one can be last night's spot at home, and starting a leg there would count
// the straight line from home to here as miles.
const KNOWN_MAX_AGE_MS = 2 * 60 * 1000;

// Where am I right now. A fresh fix is best; failing that the last point this
// leg recorded; failing that whatever Android last knew, if it's recent.
async function currentFix(legId?: number): Promise<Fix> {
  try {
    return toFix(await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 20000));
  } catch {}
  const last = legId != null ? lastPoint(legId) : null;
  if (last) return { ...last, ts: Date.now() };
  const known = await Location.getLastKnownPositionAsync({ maxAge: KNOWN_MAX_AGE_MS }).catch(() => null);
  if (known && Date.now() - known.timestamp <= KNOWN_MAX_AGE_MS) return toFix(known);
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
  await cancelParkedNudge();
  return 'ok';
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
  // A day left open overnight must be closed at its last GPS point. Marking a
  // stop now would put the drive home and the night into this leg.
  if (isStale(day)) throw new Error(`The day from ${day.date} was never ended. Close it at the last GPS point first.`);
  const fix = await currentFix(leg.id);
  const now = Date.now();
  db().withTransactionSync(() => {
    finishLeg(day, leg, fix, now);
    createLeg(day.id, leg.leg_no + 1, now, fix);
  });
  // He parked and said so. The next leg re-arms the nudge once it moves.
  await cancelParkedNudge();
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
  await cancelParkedNudge();
  await hideControls();
  return closedId;
}

export async function resumeTracking(): Promise<PermResult> {
  const perm = await ensurePermissions();
  if (perm !== 'ok') return perm;
  await startUpdates();
  return 'ok';
}

export function isStale(day: Day): boolean {
  return day.date !== localDate(Date.now());
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
  const stale = !!day && isStale(day);
  if (day && leg) await showControls(leg.leg_no, leg.start_time, stale ? { staleDate: day.date } : { tracking });
  else await hideControls();
  return {
    day,
    leg,
    tracking,
    interrupted,
    stale,
    liveMiles: metersToMiles(legMeters(pts)),
    lastFixTs: pts.length ? pts[pts.length - 1].ts : null,
    gap,
  };
}
