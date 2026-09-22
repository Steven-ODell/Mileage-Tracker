import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

// Follows the phone's light/dark setting. The map page stays light in both.
const light = {
  bg: '#fff',
  text: '#111',
  text2: '#333',
  sub: '#555',
  muted: '#777',
  border: '#c4c4c4',
  card: '#f2f7f3',
  pressedBg: '#f0f0f0',
  bannerRed: '#fde7e5',
  bannerAmber: '#fff3d6',
  accent: '#1b7f3b', // green text, borders, links
  accentBg: '#1b7f3b', // solid green buttons
  onAccent: '#fff',
  red: '#b3261e',
  amber: '#8a5a00',
  backdrop: 'rgba(0,0,0,0.35)',
};
export type Palette = typeof light;

const dark: Palette = {
  bg: '#121212',
  text: '#ececec',
  text2: '#d0d0d0',
  sub: '#a8a8a8',
  muted: '#8a8a8a',
  border: '#3d3d3d',
  card: '#1a2a1f',
  pressedBg: '#222',
  bannerRed: '#3d1c1a',
  bannerAmber: '#3a2f14',
  accent: '#5cc07a',
  accentBg: '#1f8a41',
  onAccent: '#fff',
  red: '#f07167',
  amber: '#e3aa45',
  backdrop: 'rgba(0,0,0,0.6)',
};

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useStyles<T>(make: (c: Palette) => T): T {
  const c = useColors();
  return useMemo(() => make(c), [c, make]);
}

export function time(ts: number | null) {
  if (ts == null) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function timeRange(start: number | null, end: number | null) {
  if (start == null) return 'no times';
  return end == null ? `${time(start)}–now` : `${time(start)}–${time(end)}`;
}

export function place(addr: string | null, lat: number | null, lng: number | null) {
  if (addr) return addr;
  if (lat == null || lng == null) return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// "2026-09-21" -> "Mon, Sep 21"
export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function Btn(props: {
  label: string;
  onPress: () => void;
  big?: boolean;
  small?: boolean;
  kind?: 'solid' | 'outline' | 'danger';
  disabled?: boolean;
  testID?: string;
  style?: object;
}) {
  const kind = props.kind ?? 'solid';
  const c = useColors();
  const ui = useStyles(makeUi);
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        ui.btn,
        props.big && ui.btnBig,
        props.small && ui.btnSmall,
        kind === 'solid' && ui.btnSolid,
        kind === 'outline' && ui.btnOutline,
        kind === 'danger' && ui.btnDanger,
        (pressed || props.disabled) && ui.pressed,
        props.style,
      ]}
    >
      <Text
        style={[
          ui.btnText,
          props.big && ui.btnTextBig,
          props.small && ui.btnTextSmall,
          kind === 'outline' && { color: c.accent },
          kind === 'danger' && { color: c.red },
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  const ui = useStyles(makeUi);
  return (
    <View style={ui.header}>
      <Pressable onPress={onBack} style={ui.back} accessibilityRole="button">
        <Text style={ui.backText}>‹ Back</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={ui.headerTitle}>{title}</Text>
        {subtitle ? <Text style={ui.headerSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const ui = useStyles(makeUi);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [ui.chip, selected && ui.chipOn, pressed && ui.pressed]}
    >
      <Text style={[ui.chipText, selected && ui.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export const makeUi = (c: Palette) => StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', marginTop: 8 },
  btnBig: { paddingVertical: 24, borderRadius: 16 },
  btnSmall: { paddingVertical: 9, paddingHorizontal: 14, marginTop: 0 },
  btnSolid: { backgroundColor: c.accentBg },
  btnOutline: { borderWidth: 2, borderColor: c.accent, backgroundColor: c.bg },
  btnDanger: { borderWidth: 2, borderColor: c.red, backgroundColor: c.bg },
  pressed: { opacity: 0.6 },
  btnText: { color: c.onAccent, fontSize: 17, fontWeight: '700' },
  btnTextBig: { fontSize: 24 },
  btnTextSmall: { fontSize: 15 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  back: { paddingVertical: 8, paddingRight: 12 },
  backText: { fontSize: 18, color: c.accent, fontWeight: '700' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  headerSub: { fontSize: 13, color: c.sub, marginTop: 2 },
  chip: { borderWidth: 2, borderColor: c.border, borderRadius: 22, paddingVertical: 12, paddingHorizontal: 16 },
  chipOn: { borderColor: c.accentBg, backgroundColor: c.accentBg },
  chipText: { fontSize: 16, fontWeight: '600', color: c.text2 },
  chipTextOn: { color: c.onAccent },
  label: { fontSize: 14, fontWeight: '700', color: c.sub, marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, color: c.text, backgroundColor: c.bg,
  },
});
