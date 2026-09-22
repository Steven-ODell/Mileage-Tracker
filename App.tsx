import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AppState, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import MapScreen, { type MapTarget } from './src/MapScreen';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { businessMiles, legsForDate, legsForDay, localDate, type Leg } from './src/db';
import {
  backfillAddresses, endDay, getStatus, markStop, resumeTracking, startDay,
  type PermResult, type Status,
} from './src/tracking';

const GREEN = '#1b7f3b';
const RED = '#b3261e';
const AMBER = '#8a5a00';

function time(ts: number | null) {
  if (ts == null) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function place(addr: string | null, lat: number | null, lng: number | null) {
  if (addr) return addr;
  if (lat == null || lng == null) return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function permMessage(p: PermResult) {
  if (p === 'no-foreground') return 'Location permission is off. Mileage Log needs it to track miles.';
  return 'Location must be set to "Allow all the time" so tracking keeps going with the screen off.';
}

export default function App() {
  const [map, setMap] = useState<MapTarget | null>(null);

  useEffect(() => {
    if (!map) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMap(null);
      return true;
    });
    return () => sub.remove();
  }, [map]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        {/* Home stays mounted under the map so its polling and state survive. */}
        <View style={[styles.screen, map && styles.hidden]}>
          <Home onOpenMap={setMap} />
        </View>
        {map && <MapScreen target={map} onBack={() => setMap(null)} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Home({ onOpenMap }: { onOpenMap: (t: MapTarget) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [todayMiles, setTodayMiles] = useState(0);
  const [yearMiles, setYearMiles] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [permProblem, setPermProblem] = useState<PermResult | null>(null);
  const geocoding = useRef(false);

  const refresh = useCallback(async () => {
    const s = await getStatus();
    const today = localDate(Date.now());
    setStatus(s);
    setLegs(s.day ? legsForDay(s.day.id) : legsForDate(today));
    setTodayMiles(businessMiles(today, today));
    setYearMiles(businessMiles(`${today.slice(0, 4)}-01-01`, today));
  }, []);

  const fillAddresses = useCallback(async () => {
    if (geocoding.current) return;
    geocoding.current = true;
    try {
      if (await backfillAddresses()) await refresh();
    } finally {
      geocoding.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    refresh().then(fillAddresses);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh().then(fillAddresses);
    });
    return () => sub.remove();
  }, [refresh, fillAddresses]);

  // Live miles for the leg in progress.
  const dayOpen = !!status?.day;
  useEffect(() => {
    if (!dayOpen) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [dayOpen, refresh]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh();
      fillAddresses();
    }
  };

  const onStart = () => run(async () => {
    const r = await startDay();
    setPermProblem(r === 'ok' ? null : r);
    if (r === 'ok') setNotice('Day started. Tracking is on.');
  });

  const onStop = () => run(async () => {
    const n = status?.leg?.leg_no;
    await markStop();
    setNotice(`Leg ${n} saved. Leg ${(n ?? 0) + 1} started.`);
  });

  const onEnd = (atLastPoint = false) => {
    Alert.alert(
      atLastPoint ? 'Close day at last GPS point?' : 'End day here?',
      atLastPoint
        ? 'The last leg ends where GPS last recorded you. Fix its miles later if they are short.'
        : 'The current leg ends here and tracking stops. The drive home is not recorded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End day',
          style: 'destructive',
          onPress: () => run(async () => {
            await endDay({ atLastPoint });
            setNotice('Day ended. Tracking is off.');
          }),
        },
      ]
    );
  };

  const onResume = () => run(async () => {
    const r = await resumeTracking();
    setPermProblem(r === 'ok' ? null : r);
    if (r === 'ok') setNotice('Tracking resumed.');
  });

  if (!status) return null;

  const { day, leg } = status;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Mileage Log</Text>
        <View style={styles.totals}>
          <Text style={styles.total}>Today {todayMiles.toFixed(1)} mi</Text>
          <Text style={styles.total}>{new Date().getFullYear()} {yearMiles.toFixed(1)} mi</Text>
        </View>

        {permProblem && (
          <View style={[styles.banner, styles.bannerRed]}>
            <Text style={styles.bannerText}>{permMessage(permProblem)}</Text>
            <Btn label="Open settings" kind="outline" onPress={() => Linking.openSettings()} />
          </View>
        )}

        {day && status.stale && (
          <View style={[styles.banner, styles.bannerAmber]}>
            <Text style={styles.bannerText}>
              The day from {day.date} was never ended. Close it before starting today.
            </Text>
            <Btn label="Close at last GPS point" kind="outline" onPress={() => onEnd(true)} disabled={busy} />
          </View>
        )}

        {day && !status.stale && status.interrupted && (
          <View style={[styles.banner, styles.bannerAmber]}>
            <Text style={styles.bannerText}>
              Tracking stopped{status.lastFixTs ? ` after ${time(status.lastFixTs)}` : ''}. The app was closed or
              the phone restarted. Miles for leg {leg?.leg_no} may be short; this leg is flagged so you can fix it.
            </Text>
            <Btn label="Resume tracking" onPress={onResume} disabled={busy} />
            <Btn label="End day at last GPS point" kind="outline" onPress={() => onEnd(true)} disabled={busy} />
          </View>
        )}

        {!day && (
          <Btn testID="start-day" label="Start day" big onPress={onStart} disabled={busy} />
        )}

        {day && leg && !status.stale && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Leg {leg.leg_no} · since {time(leg.start_time)}</Text>
            <Text style={styles.liveMiles}>{status.liveMiles.toFixed(1)} mi</Text>
            <Text style={styles.cardSub}>From {place(leg.from_address, leg.from_lat, leg.from_lng)}</Text>
            <Text style={styles.cardSub}>
              {status.tracking ? 'Tracking' : 'Not tracking'}
              {status.lastFixTs ? ` · last GPS ${time(status.lastFixTs)}` : ''}
            </Text>
            {leg.interrupted ? (
              <Text style={styles.flag}>
                {status.gap
                  ? `No GPS recorded ${time(status.gap.from)}–${time(status.gap.to)} while moving. `
                  : 'Tracking was interrupted during this leg. '}
                Miles may be short; check them after you stop.
              </Text>
            ) : null}
            <Btn label="Map" kind="outline" onPress={() => onOpenMap({ kind: 'day', dayId: day.id })} />
            <Btn testID="mark-stop" label="Mark stop" big onPress={onStop} disabled={busy} />
            <Btn testID="end-day" label="End day" kind="danger" onPress={() => onEnd(false)} disabled={busy} />
          </View>
        )}

        {notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={styles.sectionRow}>
          <Text style={styles.section}>{day ? `Day of ${day.date}` : 'Today'}</Text>
          {!day && legs.some((l) => l.end_time != null && l.day_id != null) && (
            <Pressable onPress={() => onOpenMap({ kind: 'day', dayId: legs[legs.length - 1].day_id! })}>
              <Text style={styles.link}>Map of day</Text>
            </Pressable>
          )}
        </View>
        {legs.filter((l) => l.end_time != null).length === 0 && (
          <Text style={styles.empty}>No legs yet.</Text>
        )}
        {legs.filter((l) => l.end_time != null).map((l) => (
          <Pressable key={l.id} style={styles.leg} onPress={() => onOpenMap({ kind: 'leg', legId: l.id })}>
            <View style={styles.legTop}>
              <Text style={styles.legNo}>Leg {l.leg_no}</Text>
              <Text style={styles.legTime}>{time(l.start_time)}–{time(l.end_time)}</Text>
              <Text style={styles.legMiles}>{(l.miles ?? 0).toFixed(1)} mi</Text>
            </View>
            <Text style={styles.legPlace}>{place(l.from_address, l.from_lat, l.from_lng)}</Text>
            <Text style={styles.legPlace}>→ {place(l.to_address, l.to_lat, l.to_lng)}</Text>
            {l.interrupted ? <Text style={styles.flag}>Interrupted: check these miles</Text> : null}
          </Pressable>
        ))}

        {!day && (
          <Pressable onPress={() => Linking.openSettings()}>
            <Text style={styles.tip}>
              If tracking ever stops with the screen off, open App settings → Battery and choose Unrestricted.
            </Text>
          </Pressable>
        )}
      </ScrollView>
      <ExpoStatusBar style="dark" />
    </>
  );
}

function Btn(props: {
  label: string;
  onPress: () => void;
  big?: boolean;
  kind?: 'solid' | 'outline' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  const kind = props.kind ?? 'solid';
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.btn,
        props.big && styles.btnBig,
        kind === 'solid' && styles.btnSolid,
        kind === 'outline' && styles.btnOutline,
        kind === 'danger' && styles.btnDanger,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          props.big && styles.btnTextBig,
          kind === 'outline' && { color: GREEN },
          kind === 'danger' && { color: RED },
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  hidden: { display: 'none' },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 28, marginBottom: 8 },
  link: { fontSize: 15, color: GREEN, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700' },
  totals: { flexDirection: 'row', gap: 16, marginTop: 4, marginBottom: 20 },
  total: { fontSize: 15, color: '#444' },
  banner: { borderRadius: 12, padding: 14, marginBottom: 16, gap: 10 },
  bannerRed: { backgroundColor: '#fde7e5' },
  bannerAmber: { backgroundColor: '#fff3d6' },
  bannerText: { fontSize: 15, color: '#222', lineHeight: 21 },
  card: { borderRadius: 16, backgroundColor: '#f2f7f3', padding: 18, gap: 6, marginBottom: 8 },
  cardLabel: { fontSize: 15, color: '#444' },
  liveMiles: { fontSize: 44, fontWeight: '700', color: GREEN },
  cardSub: { fontSize: 14, color: '#555' },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  btnBig: { paddingVertical: 24, borderRadius: 16 },
  btnSolid: { backgroundColor: GREEN },
  btnOutline: { borderWidth: 2, borderColor: GREEN, backgroundColor: '#fff' },
  btnDanger: { borderWidth: 2, borderColor: RED, backgroundColor: '#fff' },
  pressed: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  btnTextBig: { fontSize: 24 },
  notice: { marginTop: 12, fontSize: 15, color: GREEN },
  section: { fontSize: 18, fontWeight: '700' },
  empty: { color: '#777', fontSize: 15 },
  leg: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  legTop: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  legNo: { fontSize: 16, fontWeight: '700' },
  legTime: { fontSize: 14, color: '#555', flex: 1 },
  legMiles: { fontSize: 16, fontWeight: '700' },
  legPlace: { fontSize: 14, color: '#333', marginTop: 2 },
  flag: { fontSize: 13, color: AMBER, marginTop: 4, fontWeight: '600' },
  tip: { fontSize: 13, color: '#777', marginTop: 32, lineHeight: 18 },
});
