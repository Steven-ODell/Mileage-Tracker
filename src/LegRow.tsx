import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Leg } from './db';
import { isBusiness } from './purposes';
import { makeUi, type Palette, place, timeRange, useColors, useStyles } from './ui';

export default function LegRow({ leg, onPress }: { leg: Leg; onPress: () => void }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const ui = useStyles(makeUi);
  const personal = !isBusiness(leg.purpose);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.leg, pressed && { backgroundColor: c.pressedBg }]}>
      <View style={styles.top}>
        <Text style={styles.no}>Leg {leg.leg_no}</Text>
        <Text style={styles.time}>{leg.source === 'manual' ? 'entered by hand' : timeRange(leg.start_time, leg.end_time)}</Text>
        <Text style={[styles.miles, personal && styles.dim]}>{(leg.miles ?? 0).toFixed(1)} mi</Text>
      </View>
      <Text style={[styles.purpose, !leg.purpose && { color: c.red }, personal && styles.dim]} numberOfLines={1}>
        {leg.purpose ?? 'No purpose, tap to add'}
        {leg.note ? ` · ${leg.note}` : ''}
      </Text>
      <Text style={styles.place} numberOfLines={1}>{place(leg.from_address, leg.from_lat, leg.from_lng)}</Text>
      <Text style={styles.place} numberOfLines={1}>→ {place(leg.to_address, leg.to_lat, leg.to_lng)}</Text>
      {leg.interrupted ? <Text style={styles.flag}>Interrupted: check these miles</Text> : null}
      {leg.trim_end_ts != null ? <Text style={styles.trimmed}>Trimmed</Text> : null}
    </Pressable>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  leg: { paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  no: { fontSize: 16, fontWeight: '700', color: c.text },
  time: { fontSize: 14, color: c.sub, flex: 1 },
  miles: { fontSize: 16, fontWeight: '700', color: c.text },
  dim: { color: c.muted },
  purpose: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 2 },
  place: { fontSize: 14, color: c.text2, marginTop: 2 },
  flag: { fontSize: 13, color: c.amber, marginTop: 4, fontWeight: '600' },
  trimmed: { fontSize: 13, color: c.muted, marginTop: 4 },
});
