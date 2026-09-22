import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { setPurpose, type Leg } from './db';
import { PURPOSES } from './purposes';
import { Btn, Chip, makeUi, type Palette, place, useColors, useStyles } from './ui';

// Shown right after Mark stop / End day for the leg that just closed.
// Common path: tap a purpose, tap Save.
export default function PurposeSheet({ leg, onDone }: { leg: Leg; onDone: () => void }) {
  const c = useColors();
  const styles = useStyles(makeStyles);
  const ui = useStyles(makeUi);
  const [purpose, setP] = useState<string | null>(leg.purpose);
  const [note, setNote] = useState(leg.note ?? '');

  const save = () => {
    setPurpose(leg.id, purpose, note.trim() || null);
    onDone();
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onDone}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onDone} />
        <View style={styles.sheet}>
          <Text style={styles.title}>
            Leg {leg.leg_no} · {(leg.miles ?? 0).toFixed(1)} mi
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            to {place(leg.to_address, leg.to_lat, leg.to_lng)}
          </Text>
          <Text style={ui.label}>Purpose</Text>
          <View style={styles.chips}>
            {PURPOSES.map((p) => (
              <Chip key={p} label={p} selected={purpose === p} onPress={() => setP(p)} />
            ))}
          </View>
          <Text style={ui.label}>Note (claim name or address)</Text>
          <TextInput
            style={ui.input}
            value={note}
            onChangeText={setNote}
            placeholder="Optional"
            placeholderTextColor={c.muted}
            returnKeyType="done"
          />
          <Btn label="Save" onPress={save} disabled={!purpose} testID="purpose-save" />
          <Pressable onPress={onDone} style={styles.later}>
            <Text style={styles.laterText}>Later</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.backdrop },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '700', color: c.text },
  sub: { fontSize: 14, color: c.sub, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  later: { alignItems: 'center', paddingTop: 14 },
  laterText: { fontSize: 15, color: c.muted },
});
