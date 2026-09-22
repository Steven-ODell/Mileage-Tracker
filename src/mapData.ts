import { pointsForLeg, type Leg } from './db';
import { isUsable, legMeters, metersToMiles, trackPoints, type Fix } from './geo';

// Same order as COLORS in map/map.html, so a leg's pin matches its line.
export const COLORS = ['#1b7f3b', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00'];

export type LngLat = [number, number];

export type Payload = {
  legs: { no: number; open: boolean; points: LngLat[]; cut: LngLat[]; dropped: LngLat[] }[];
  pins: { lng: number; lat: number; label: string; color: string }[];
  now: LngLat | null;
};

// Points that count for a leg: on the filtered track and not trimmed off.
export function keptPoints(leg: Leg, track: Fix[]): Fix[] {
  return track.filter((p) => leg.trim_end_ts == null || p.ts <= leg.trim_end_ts);
}

export function buildPayload(legs: Leg[], mode: 'leg' | 'day') {
  let used = 0;
  let dropped = 0;
  let meters = 0;
  const payload: Payload = { legs: [], pins: [], now: null };

  legs.forEach((l, i) => {
    const pts = pointsForLeg(l.id);
    const track = trackPoints(pts);
    const kept = keptPoints(l, track);
    const cut = l.trim_end_ts == null ? [] : track.filter((p) => p.ts >= l.trim_end_ts!);
    used += pts.filter(isUsable).length;
    dropped += pts.filter((p) => !isUsable(p)).length;
    meters += legMeters(kept);
    payload.legs.push({
      no: l.leg_no,
      open: l.end_time == null,
      points: kept.map((p) => [p.lng, p.lat]),
      cut: mode === 'leg' ? cut.map((p) => [p.lng, p.lat]) : [],
      dropped: pts.filter((p) => !isUsable(p)).map((p) => [p.lng, p.lat]),
    });
    const color = COLORS[i % COLORS.length];
    if (mode === 'leg') {
      if (l.from_lat != null && l.from_lng != null) payload.pins.push({ lat: l.from_lat, lng: l.from_lng, label: 'From', color: '#333' });
      if (l.to_lat != null && l.to_lng != null) payload.pins.push({ lat: l.to_lat, lng: l.to_lng, label: 'To', color });
    } else {
      if (i === 0 && l.from_lat != null && l.from_lng != null) {
        payload.pins.push({ lat: l.from_lat, lng: l.from_lng, label: 'Start', color: '#333' });
      }
      // Stop N is where leg N ended.
      if (l.to_lat != null && l.to_lng != null) payload.pins.push({ lat: l.to_lat, lng: l.to_lng, label: String(l.leg_no), color });
    }
    if (l.end_time == null && kept.length) {
      const last = kept[kept.length - 1];
      payload.now = [last.lng, last.lat];
    }
  });

  const summary =
    `${metersToMiles(meters).toFixed(1)} mi tracked · ${used} GPS points` +
    (dropped ? `, ${dropped} ignored (poor accuracy)` : '');
  return { payload, summary, live: legs.some((l) => l.end_time == null) };
}
