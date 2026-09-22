import { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { insertManualLeg, legById, localDate, updateLeg, type LegEdit } from './db';
import { PURPOSES } from './purposes';
import { Btn, Chip, Header, makeUi, type Palette, useColors, useStyles } from './ui';

function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Edits an existing leg (legId) or adds a hand-entered one (legId null).
export default function EditLegScreen(props: { legId: number | null; onBack: () => void; onSaved: (id: number) => void }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const ui = useStyles(makeUi);
  const leg = props.legId != null ? legById(props.legId) : null;
  const [date, setDate] = useState(leg?.date ?? localDate(Date.now()));
  const [from, setFrom] = useState(leg?.from_address ?? '');
  const [to, setTo] = useState(leg?.to_address ?? '');
  const [miles, setMiles] = useState(leg?.miles != null ? String(leg.miles) : '');
  const [purpose, setPurpose] = useState<string | null>(leg?.purpose ?? null);
  const [note, setNote] = useState(leg?.note ?? '');

  const save = () => {
    const m = Number(miles.replace(',', '.'));
    if (!validDate(date)) return Alert.alert('Check the date', 'Use YYYY-MM-DD, for example 2026-09-21.');
    if (!miles.trim() || !Number.isFinite(m) || m < 0) return Alert.alert('Check the miles', 'Enter a number like 12.4.');
    if (!purpose) return Alert.alert('Pick a purpose', 'Choose one of the purpose buttons.');
    const e: LegEdit = {
      date,
      from_address: from.trim() || null,
      to_address: to.trim() || null,
      miles: Math.round(m * 100) / 100,
      purpose,
      note: note.trim() || null,
    };
    if (leg) {
      updateLeg(leg.id, e);
      props.onSaved(leg.id);
    } else {
      props.onSaved(insertManualLeg(e));
    }
  };

  return (
    <KeyboardAvoidingView behavior="height" style={styles.screen}>
      <Header title={leg ? `Edit leg ${leg.leg_no}` : 'Add a drive'} onBack={props.onBack} />
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {!leg && <Text style={styles.hint}>For a drive you forgot to track.</Text>}
        {leg?.source === 'gps' && (
          <Text style={styles.hint}>
            From and To were filled from GPS. Changing miles here overrides the GPS miles. To cut off a drive you forgot to
            stop, use Trim end on the leg's map instead.
          </Text>
        )}
        <Text style={ui.label}>Date (YYYY-MM-DD)</Text>
        <TextInput style={ui.input} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
        <Text style={ui.label}>From</Text>
        <TextInput style={ui.input} value={from} onChangeText={setFrom} placeholder="Address or place" placeholderTextColor={c.muted} />
        <Text style={ui.label}>To</Text>
        <TextInput style={ui.input} value={to} onChangeText={setTo} placeholder="Address or place" placeholderTextColor={c.muted} />
        <Text style={ui.label}>Miles</Text>
        <TextInput style={ui.input} value={miles} onChangeText={setMiles} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor={c.muted} />
        <Text style={ui.label}>Purpose</Text>
        <View style={styles.chips}>
          {PURPOSES.map((p) => (
            <Chip key={p} label={p} selected={purpose === p} onPress={() => setPurpose(p)} />
          ))}
        </View>
        <Text style={ui.label}>Note (claim name or address)</Text>
        <TextInput style={ui.input} value={note} onChangeText={setNote} placeholder="Optional" placeholderTextColor={c.muted} />
        <Btn label="Save" onPress={save} testID="edit-save" style={{ marginTop: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  form: { paddingHorizontal: 16, paddingBottom: 48 },
  hint: { fontSize: 14, color: c.sub, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
