import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { scheduleWeeklyReminder } from './src/backup';
import BackupScreen from './src/BackupScreen';
import DayMapScreen from './src/DayMapScreen';
import { businessMiles, isDone, legById, legsForDate, legsForDay, localDate, openDay, type Leg } from './src/db';
import EditLegScreen from './src/EditLegScreen';
import LegRow from './src/LegRow';
import LegScreen from './src/LegScreen';
import PurposeSheet from './src/PurposeSheet';
import { ACTION_END_DAY, ACTION_MARK_STOP, claimAction } from './src/notify';
import { askUnrestricted, isOptimized } from './src/power';
import {
  backfillAddresses, endDay, getStatus, isStale, markStop, resumeTracking, startDay,
  type PermResult, type Status,
} from './src/tracking';
import TripsScreen from './src/TripsScreen';
import { Btn, type Palette, place, time, useStyles } from './src/ui';

type Route =
  | { name: 'trips' }
  | { name: 'leg'; id: number }
  | { name: 'edit'; id: number | null }
  | { name: 'dayMap'; dayId: number }
  | { name: 'backup' };

// Show the weekly reminder even if it fires while the app is open. The
// controls notification is ambient, so it goes to the shade without a banner.
Notifications.setNotificationHandler({
  handleNotification: async (n) => ({
    shouldShowBanner: n.request.content.data?.controls !== true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function permMessage(p: PermResult) {
  if (p === 'no-foreground') return 'Location permission is off. Mileage Log needs it to track miles.';
  return 'Location must be set to "Allow all the time" so tracking keeps going with the screen off.';
}

export default function App() {
  const styles = useStyles(makeStyles);
  // Home is always mounted underneath (its polling and state survive);
  // everything else is a simple stack on top of it.
  const [stack, setStack] = useState<Route[]>([]);
  const push = (r: Route) => setStack((s) => [...s, r]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const replace = (r: Route) => setStack((s) => [...s.slice(0, -1), r]);
  const top = stack[stack.length - 1];

  useEffect(() => {
    scheduleWeeklyReminder().catch((e) => console.warn('reminder', e));
  }, []);

  // Tapping the weekly reminder opens Backup. Claimed like the action buttons
  // below, or every later launch would open Backup again.
  const tapped = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (tapped?.notification.request.content.data?.open !== 'backup') return;
    if (!claimAction(`${tapped.notification.date}|backup`)) return;
    setStack([{ name: 'backup' }]);
  }, [tapped]);

  useEffect(() => {
    if (!top) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [top]);

  let screen = null;
  if (top?.name === 'trips') {
    screen = (
      <TripsScreen
        onBack={pop}
        onOpenLeg={(id) => push({ name: 'leg', id })}
        onOpenDayMap={(dayId) => push({ name: 'dayMap', dayId })}
        onAdd={() => push({ name: 'edit', id: null })}
      />
    );
  } else if (top?.name === 'leg') {
    screen = <LegScreen key={top.id} legId={top.id} onBack={pop} onEdit={(id) => push({ name: 'edit', id })} />;
  } else if (top?.name === 'edit') {
    screen = (
      <EditLegScreen
        legId={top.id}
        onBack={pop}
        onSaved={(id) => (top.id == null ? replace({ name: 'leg', id }) : pop())}
      />
    );
  } else if (top?.name === 'dayMap') {
    screen = <DayMapScreen dayId={top.dayId} onBack={pop} />;
  } else if (top?.name === 'backup') {
    screen = <BackupScreen onBack={pop} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={[styles.screen, top && styles.hidden]}>
          <Home visible={!top} push={push} goHome={() => setStack([])} />
        </View>
        {screen}
        <ExpoStatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Home({ visible, push, goHome }: { visible: boolean; push: (r: Route) => void; goHome: () => void }) {
  const styles = useStyles(makeStyles);
  const [status, setStatus] = useState<Status | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [todayMiles, setTodayMiles] = useState(0);
  const [yearMiles, setYearMiles] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [permProblem, setPermProblem] = useState<PermResult | null>(null);
  const [picker, setPicker] = useState<Leg | null>(null);
  const [optimized, setOptimized] = useState(false);
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

  // Re-checked on every foreground, so the warning clears itself as soon as
  // he comes back from Android's dialog.
  const checkBattery = useCallback(async () => setOptimized(await isOptimized()), []);

  useEffect(() => {
    refresh().then(fillAddresses);
    checkBattery();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        refresh().then(fillAddresses);
        checkBattery();
      }
    });
    return () => sub.remove();
  }, [refresh, fillAddresses, checkBattery]);

  // Coming back from another screen: edits or deletes may have happened.
  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  // Live miles for the leg in progress.
  const dayOpen = !!status?.day;
  useEffect(() => {
    if (!dayOpen || !visible) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [dayOpen, visible, refresh]);

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

  // The closed leg's address may still be geocoding; the sheet shows
  // whatever is there now (coordinates at worst).
  const askPurpose = (legId: number | null) => {
    const l = legId != null ? legById(legId) : null;
    if (l) setPicker(l);
  };

  const onStart = () => run(async () => {
    const r = await startDay();
    setPermProblem(r === 'ok' ? null : r);
    if (r === 'ok') setNotice('Day started. Tracking is on.');
  });

  const onStop = () => run(async () => {
    const closed = await markStop();
    askPurpose(closed);
  });

  const onEnd = (atLastPoint = false) => {
    Alert.alert(
      atLastPoint ? 'Close day at last GPS point?' : 'End day here?',
      atLastPoint
        ? 'The last leg ends where GPS last recorded you. If that includes a drive home, use Trim end on the leg afterwards.'
        : 'The current leg ends here and tracking stops. The drive home is not recorded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End day',
          style: 'destructive',
          onPress: () => run(async () => {
            const closed = await endDay({ atLastPoint });
            setNotice('Day ended. Tracking is off.');
            askPurpose(closed);
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

  // Mark stop / End day tapped on the tracking notification or the parked
  // nudge. Both open the app, so the purpose picker and the End day
  // confirmation work exactly as they do from the buttons on this screen.
  const action = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!action) return;
    const which = action.actionIdentifier;
    if (which !== ACTION_MARK_STOP && which !== ACTION_END_DAY) return;
    // The launching response sticks around; only act on it the first time.
    if (!claimAction(`${action.notification.date}|${which}`)) return;
    goHome();
    // Left open overnight: either button means "close it", and only at the
    // last GPS point, or the drive home and the night end up in the leg.
    const d = openDay();
    if (d && isStale(d)) onEnd(true);
    else if (which === ACTION_MARK_STOP) onStop();
    else onEnd(false);
  }, [action]);

  if (!status) return null;

  const { day, leg } = status;
  const done = legs.filter(isDone);

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

        {optimized && (
          <View style={[styles.banner, styles.bannerAmber]}>
            <Text style={styles.bannerText}>
              Battery optimization is on for Mileage Log. Android can kill tracking with the screen off, which loses the
              rest of a leg without saying so.
            </Text>
            <Btn label="Allow background use" kind="outline" onPress={() => askUnrestricted().catch(() => {})} />
          </View>
        )}

        {day && status.stale && (
          <View style={[styles.banner, styles.bannerAmber]}>
            <Text style={styles.bannerText}>
              The day from {day.date} was never ended. Close it at the last GPS point, then use Trim end on its last leg if
              the drive home got recorded.
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

        {!day && <Btn testID="start-day" label="Start day" big onPress={onStart} disabled={busy} />}

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
            <Btn label="Map" kind="outline" onPress={() => push({ name: 'dayMap', dayId: day.id })} />
            <Btn testID="mark-stop" label="Mark stop" big onPress={onStop} disabled={busy} />
            <Btn testID="end-day" label="End day" kind="danger" onPress={() => onEnd(false)} disabled={busy} />
          </View>
        )}

        {notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={styles.sectionRow}>
          <Text style={styles.section}>{day ? `Day of ${day.date}` : 'Today'}</Text>
          {!day && done.some((l) => l.day_id != null) && (
            <Pressable onPress={() => push({ name: 'dayMap', dayId: done.find((l) => l.day_id != null)!.day_id! })}>
              <Text style={styles.link}>Map of day</Text>
            </Pressable>
          )}
        </View>
        {done.length === 0 && <Text style={styles.empty}>No legs yet.</Text>}
        {done.map((l) => (
          <LegRow key={l.id} leg={l} onPress={() => push({ name: 'leg', id: l.id })} />
        ))}

        <View style={styles.navRow}>
          <Btn label="All trips" kind="outline" onPress={() => push({ name: 'trips' })} style={{ flex: 1 }} />
          <Btn label="+ Add drive" kind="outline" onPress={() => push({ name: 'edit', id: null })} style={{ flex: 1 }} />
        </View>
        <Btn label="Backup / export CSV" kind="outline" onPress={() => push({ name: 'backup' })} />

        {!day && !optimized && (
          <Pressable onPress={() => Linking.openSettings()}>
            <Text style={styles.tip}>
              If tracking ever stops with the screen off, open App settings → Battery and choose Unrestricted.
            </Text>
          </Pressable>
        )}
      </ScrollView>
      {picker && (
        <PurposeSheet
          leg={picker}
          onDone={() => {
            setPicker(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  hidden: { display: 'none' },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: c.text },
  totals: { flexDirection: 'row', gap: 16, marginTop: 4, marginBottom: 20 },
  total: { fontSize: 15, color: c.sub },
  banner: { borderRadius: 12, padding: 14, marginBottom: 16, gap: 10 },
  bannerRed: { backgroundColor: c.bannerRed },
  bannerAmber: { backgroundColor: c.bannerAmber },
  bannerText: { fontSize: 15, color: c.text, lineHeight: 21 },
  card: { borderRadius: 16, backgroundColor: c.card, padding: 18, gap: 6, marginBottom: 8 },
  cardLabel: { fontSize: 15, color: c.sub },
  liveMiles: { fontSize: 44, fontWeight: '700', color: c.accent },
  cardSub: { fontSize: 14, color: c.sub },
  flag: { fontSize: 13, color: c.amber, marginTop: 4, fontWeight: '600' },
  notice: { marginTop: 12, fontSize: 15, color: c.accent },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 28, marginBottom: 8 },
  section: { fontSize: 18, fontWeight: '700', color: c.text },
  link: { fontSize: 15, color: c.accent, fontWeight: '700' },
  empty: { color: c.muted, fontSize: 15 },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  tip: { fontSize: 13, color: c.muted, marginTop: 32, lineHeight: 18 },
});
