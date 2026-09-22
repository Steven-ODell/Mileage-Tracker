import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { deleteLeg, legById, pointsForLeg, resetTrim, trimLeg, type Leg } from './db';
import { legMeters, metersToMiles, trackPoints, type Fix } from './geo';
import { buildPayload } from './mapData';
import { isBusiness } from './purposes';
import RouteMap from './RouteMap';
import { backfillAddresses } from './tracking';
import { Btn, dayLabel, Header, makeUi, type Palette, place, time, timeRange, useColors, useStyles } from './ui';

type Trim = { fixes: Fix[]; index: number };

export default function LegScreen(props: { legId: number; onBack: () => void; onEdit: (id: number) => void }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const ui = useStyles(makeUi);
  const [leg, setLeg] = useState<Leg | null>(() => legById(props.legId));
  const [trim, setTrim] = useState<Trim | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setLeg(legById(props.legId)), [props.legId]);

  // The filtered track the leg was measured along, including any trimmed-off
  // tail. Glitches and parked jitter aren't on it, so every slider step moves.
  const fixes = useMemo(() => (leg ? trackPoints(pointsForLeg(leg.id)) : []), [leg]);
  const untrimmedMiles = useMemo(() => metersToMiles(legMeters(fixes)), [fixes]);
  const map = useMemo(() => (leg && fixes.length ? buildPayload([leg], 'leg') : null), [leg, fixes]);

  if (!leg) {
    return (
      <View style={styles.screen}>
        <Header title="Leg not found" onBack={props.onBack} />
      </View>
    );
  }

  const canTrim = leg.source === 'gps' && leg.end_time != null && fixes.length > 1;

  const startTrim = () => {
    const cutAt = leg.trim_end_ts;
    const index = cutAt == null ? fixes.length - 1 : Math.max(0, fixes.findIndex((f) => f.ts >= cutAt));
    setTrim({ fixes, index });
  };

  const trimMiles = trim ? metersToMiles(legMeters(trim.fixes.slice(0, trim.index + 1))) : 0;

  const saveTrim = async () => {
    if (!trim) return;
    setBusy(true);
    const last = trim.index >= trim.fixes.length - 1;
    if (last) {
      if (leg.trim_end_ts != null) {
        // Back to the original end: the last point recorded, which is where Mark stop / End day was tapped.
        const raw = pointsForLeg(leg.id);
        resetTrim(leg.id, raw[raw.length - 1], untrimmedMiles);
      }
    } else {
      trimLeg(leg.id, trim.fixes[trim.index], trimMiles);
    }
    setTrim(null);
    reload();
    await backfillAddresses().catch(() => {});
    reload();
    setBusy(false);
  };

  const confirmDelete = () => {
    Alert.alert('Delete this leg?', `Leg ${leg.leg_no} on ${dayLabel(leg.date)}, ${(leg.miles ?? 0).toFixed(1)} mi. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            deleteLeg(leg.id);
            props.onBack();
          } catch (e) {
            Alert.alert('Can\'t delete', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <Header title={`Leg ${leg.leg_no} · ${dayLabel(leg.date)}`} subtitle={map?.summary} onBack={props.onBack} />

      {!trim ? (
        <View style={styles.info}>
          <View style={styles.topRow}>
            <Text style={styles.miles}>{(leg.miles ?? 0).toFixed(1)} mi</Text>
            <Text style={styles.times}>{leg.source === 'manual' ? 'Entered by hand' : leg.source === 'import' && leg.start_time == null ? 'Imported' : timeRange(leg.start_time, leg.end_time)}</Text>
          </View>
          <Text style={[styles.purpose, !leg.purpose && { color: c.red }, !isBusiness(leg.purpose) && styles.personal]}>
            {leg.purpose ?? 'No purpose yet'}
            {leg.note ? ` · ${leg.note}` : ''}
          </Text>
          <Text style={styles.place} numberOfLines={2}>From {place(leg.from_address, leg.from_lat, leg.from_lng)}</Text>
          <Text style={styles.place} numberOfLines={2}>To {place(leg.to_address, leg.to_lat, leg.to_lng)}</Text>
          {leg.trim_end_ts != null && (
            <Text style={styles.flag}>
              Trimmed: end moved back to {time(leg.trim_end_ts)} (was {untrimmedMiles.toFixed(1)} mi
              {leg.orig_end_time ? `, ended ${time(leg.orig_end_time)}` : ''})
            </Text>
          )}
          {leg.interrupted ? <Text style={styles.flag}>Interrupted: check these miles</Text> : null}
          <View style={styles.actions}>
            <Btn small label="Edit" kind="outline" onPress={() => props.onEdit(leg.id)} style={styles.action} />
            {canTrim && <Btn small label="Trim end" kind="outline" onPress={startTrim} style={styles.action} />}
            <Btn small label="Delete" kind="danger" onPress={confirmDelete} style={styles.action} />
          </View>
        </View>
      ) : (
        <View style={styles.info}>
          <Text style={styles.trimTitle}>
            New end {time(trim.fixes[trim.index].ts)} · {trimMiles.toFixed(1)} mi
          </Text>
          <Text style={styles.times}>
            Full recording: {untrimmedMiles.toFixed(1)} mi, ended {time(trim.fixes[trim.fixes.length - 1].ts)}.
            Everything after the new end stops counting (kept, so you can undo by dragging back to the end).
          </Text>
          <View style={styles.actions}>
            <Btn small label="Save" onPress={saveTrim} disabled={busy} style={styles.action} testID="trim-save" />
            <Btn small label="Cancel" kind="outline" onPress={() => setTrim(null)} style={styles.action} />
          </View>
        </View>
      )}

      {map ? (
        <RouteMap
          payload={map.payload}
          trim={trim ? { full: trim.fixes.map((f) => [f.lng, f.lat]), index: trim.index } : null}
          onTrim={(i) => setTrim((t) => (t ? { ...t, index: Math.max(0, Math.min(i, t.fixes.length - 1)) } : t))}
        />
      ) : (
        <Text style={styles.noMap}>{leg.source === 'manual' ? 'No GPS track for a hand-entered leg.' : leg.source === 'import' ? 'Imported from CSV: the GPS track isn\'t part of the export.' : 'No GPS points recorded.'}</Text>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  info: { paddingHorizontal: 16, paddingBottom: 12, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  miles: { fontSize: 30, fontWeight: '700', color: c.text },
  times: { fontSize: 14, color: c.sub, flexShrink: 1 },
  purpose: { fontSize: 16, fontWeight: '600', color: c.text },
  personal: { color: c.muted },
  place: { fontSize: 14, color: c.text2 },
  flag: { fontSize: 13, color: c.amber, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { flex: 1 },
  trimTitle: { fontSize: 20, fontWeight: '700', color: c.text },
  noMap: { padding: 24, color: c.muted, fontSize: 15, textAlign: 'center' },
});
