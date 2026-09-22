import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MAP_HTML } from './generated/mapHtml';
import { legById, legsForDay, pointsForLeg, type Leg } from './db';
import { isUsable, legMeters, metersToMiles } from './geo';

export type MapTarget = { kind: 'leg'; legId: number } | { kind: 'day'; dayId: number };

// Same order as COLORS in map/map.html, so a leg's pin matches its line.
const COLORS = ['#1b7f3b', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00'];

type Payload = {
  legs: { no: number; open: boolean; points: [number, number][]; dropped: [number, number][] }[];
  pins: { lng: number; lat: number; label: string; color: string }[];
  now: [number, number] | null;
};

function load(target: MapTarget) {
  const legs: Leg[] =
    target.kind === 'leg' ? [legById(target.legId)].filter((l): l is Leg => !!l) : legsForDay(target.dayId);
  let used = 0;
  let dropped = 0;
  let meters = 0;
  const payload: Payload = { legs: [], pins: [], now: null };

  legs.forEach((l, i) => {
    const pts = pointsForLeg(l.id);
    const good = pts.filter(isUsable);
    used += good.length;
    dropped += pts.length - good.length;
    meters += legMeters(pts);
    payload.legs.push({
      no: l.leg_no,
      open: l.end_time == null,
      points: good.map((p) => [p.lng, p.lat]),
      dropped: pts.filter((p) => !isUsable(p)).map((p) => [p.lng, p.lat]),
    });
    const color = COLORS[i % COLORS.length];
    if (target.kind === 'leg') {
      if (l.from_lat != null && l.from_lng != null) payload.pins.push({ lat: l.from_lat, lng: l.from_lng, label: 'From', color: '#333' });
      if (l.to_lat != null && l.to_lng != null) payload.pins.push({ lat: l.to_lat, lng: l.to_lng, label: 'To', color });
    } else {
      if (i === 0 && l.from_lat != null && l.from_lng != null) {
        payload.pins.push({ lat: l.from_lat, lng: l.from_lng, label: 'Start', color: '#333' });
      }
      // Stop N is where leg N ended.
      if (l.to_lat != null && l.to_lng != null) payload.pins.push({ lat: l.to_lat, lng: l.to_lng, label: String(l.leg_no), color });
    }
    if (l.end_time == null && good.length) {
      const last = good[good.length - 1];
      payload.now = [last.lng, last.lat];
    }
  });

  const title =
    target.kind === 'leg' && legs[0] ? `Leg ${legs[0].leg_no} · ${legs[0].date}` : legs[0] ? `Day of ${legs[0].date}` : 'Map';
  const live = legs.some((l) => l.end_time == null);
  const summary =
    `${metersToMiles(meters).toFixed(1)} mi · ${used} GPS points` + (dropped ? `, ${dropped} ignored (poor accuracy)` : '');
  return { payload, title, summary, live };
}

export default function MapScreen({ target, onBack }: { target: MapTarget; onBack: () => void }) {
  const web = useRef<WebView>(null);
  const loaded = useRef(false);
  const [data, setData] = useState(() => load(target));

  const push = useCallback((p: Payload) => {
    if (loaded.current) web.current?.injectJavaScript(`window.setData(${JSON.stringify(p)}); true;`);
  }, []);

  // While a leg is still being driven, redraw as points come in.
  useEffect(() => {
    if (!data.live) return;
    const t = setInterval(() => setData(load(target)), 5000);
    return () => clearInterval(t);
  }, [data.live, target]);

  useEffect(() => push(data.payload), [data.payload, push]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{data.title}</Text>
          <Text style={styles.summary}>{data.summary}{data.live ? ' · live' : ''}</Text>
        </View>
      </View>
      <WebView
        ref={web}
        style={{ flex: 1 }}
        originWhitelist={['*']}
        source={{ html: MAP_HTML, baseUrl: 'https://localhost/' }}
        onLoadEnd={() => {
          loaded.current = true;
          push(data.payload);
        }}
        javaScriptEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  back: { paddingVertical: 8, paddingRight: 12 },
  backText: { fontSize: 18, color: '#1b7f3b', fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '700' },
  summary: { fontSize: 13, color: '#555', marginTop: 2 },
});
