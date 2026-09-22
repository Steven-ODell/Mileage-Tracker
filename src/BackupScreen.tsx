import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { exportCsv, exportSummary, importCsv, lastExport, REMINDER_TEXT, type ImportReport } from './backup';
import { Btn, dayLabel, Header, time, useStyles, type Palette } from './ui';
import { localDate } from './db';

function when(ts: number | null) {
  if (ts == null) return 'never';
  return `${dayLabel(localDate(ts))}, ${time(ts)}`;
}

export default function BackupScreen({ onBack }: { onBack: () => void }) {
  const styles = useStyles(makeStyles);
  const [summary, setSummary] = useState(exportSummary);
  const [last, setLast] = useState(lastExport);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const year = new Date().getFullYear();

  const onExport = async () => {
    setBusy(true);
    try {
      await exportCsv();
      setLast(lastExport());
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setBusy(true);
    setReport(null);
    try {
      const r = await importCsv();
      if (!r.cancelled) setReport(r);
      setSummary(exportSummary());
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Header title="Backup" subtitle="Export and restore your log as CSV" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Export</Text>
        <Text style={styles.body}>
          Every leg since Jan 1, {year}: {summary.count} legs, {summary.miles.toFixed(1)} mi (all purposes). Opens the
          share sheet so you can save it to Drive or email it.
        </Text>
        <Btn label="Export CSV" onPress={onExport} disabled={busy} testID="export" />
        <Text style={styles.meta}>Last exported: {when(last)}</Text>

        <Text style={styles.section}>Import</Text>
        <Text style={styles.body}>
          Restore from a Mileage Log CSV, for example on a new phone. Legs already on this phone are skipped, so importing
          the same file twice is safe.
        </Text>
        <Btn label="Import CSV" kind="outline" onPress={onImport} disabled={busy} testID="import" />
        {report && (
          <View style={styles.report}>
            <Text style={styles.reportMain}>
              Added {report.added} leg{report.added === 1 ? '' : 's'}.
              {report.skipped ? ` Skipped ${report.skipped} already on this phone.` : ''}
            </Text>
            {report.errors.length > 0 && (
              <>
                <Text style={styles.reportErr}>
                  {report.errors.length} row{report.errors.length === 1 ? '' : 's'} couldn't be read:
                </Text>
                {report.errors.slice(0, 10).map((e) => (
                  <Text key={e.line} style={styles.reportErrLine}>
                    Line {e.line}: {e.message}
                  </Text>
                ))}
                {report.errors.length > 10 && <Text style={styles.reportErrLine}>…and {report.errors.length - 10} more</Text>}
              </>
            )}
          </View>
        )}

        <Text style={styles.section}>Reminder</Text>
        <Text style={styles.body}>A notification reminds you to export every week: {REMINDER_TEXT}.</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: 16, paddingBottom: 48 },
    section: { fontSize: 18, fontWeight: '700', color: c.text, marginTop: 20, marginBottom: 6 },
    body: { fontSize: 15, color: c.sub, lineHeight: 21 },
    meta: { fontSize: 14, color: c.muted, marginTop: 8 },
    report: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: c.card, gap: 4 },
    reportMain: { fontSize: 15, fontWeight: '600', color: c.text },
    reportErr: { fontSize: 14, color: c.amber, fontWeight: '600', marginTop: 4 },
    reportErrLine: { fontSize: 13, color: c.sub },
  });
