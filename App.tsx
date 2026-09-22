import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mileage Log</Text>
      <Pressable
        testID="start-day"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={() => {}}
      >
        <Text style={styles.buttonText}>Start day</Text>
      </Pressable>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 48 },
  button: { backgroundColor: '#1b7f3b', paddingVertical: 24, paddingHorizontal: 48, borderRadius: 16, minWidth: 240, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 24, fontWeight: '700' },
});
