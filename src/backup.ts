import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { csvToLegs, dedupeKey, toCsv } from './csv';
import { getSetting, importLegs, legsSince, localDate, setSetting } from './db';

// ------------------------------------------------------------------ export --

export function exportSummary() {
  const today = localDate(Date.now());
  const legs = legsSince(`${today.slice(0, 4)}-01-01`);
  return { count: legs.length, miles: legs.reduce((s, l) => s + (l.miles ?? 0), 0) };
}

// Every leg since Jan 1 of this year (not just new ones), handed to the
// Android share sheet so it can go to Drive, email, etc.
export async function exportCsv(): Promise<number> {
  const today = localDate(Date.now());
  const legs = legsSince(`${today.slice(0, 4)}-01-01`);
  const file = new File(Paths.cache, `mileage-log-${today}.csv`);
  if (file.exists) file.delete();
  file.create();
  file.write(toCsv(legs));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    dialogTitle: `Mileage log ${today.slice(0, 4)} (${legs.length} legs)`,
    UTI: 'public.comma-separated-values-text',
  });
  // shareAsync resolves once the share sheet closes; Android can't tell us
  // whether a target was actually picked, so this means "last shared".
  setSetting('last_export', String(Date.now()));
  return legs.length;
}

export function lastExport(): number | null {
  const v = getSetting('last_export');
  return v ? Number(v) : null;
}

// ------------------------------------------------------------------ import --

export type ImportReport = {
  added: number;
  skipped: number;
  errors: { line: number; message: string }[];
  cancelled?: boolean;
};

export async function importCsv(): Promise<ImportReport> {
  const pick = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/csv', 'application/vnd.ms-excel'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (pick.canceled || !pick.assets?.length) return { added: 0, skipped: 0, errors: [], cancelled: true };
  const text = await new File(pick.assets[0].uri).text();
  const parsed = csvToLegs(text);
  const { added, skipped } = importLegs(parsed.legs.map((p) => p.leg), dedupeKey);
  return { added, skipped, errors: parsed.errors };
}

// ---------------------------------------------------------------- reminder --

const REMINDER_ID = 'weekly-export';
export const REMINDER_TEXT = 'Fridays at 5:00 PM';

// Idempotent: replaces any earlier schedule, so it's safe on every launch.
export async function scheduleWeeklyReminder() {
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'Export reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: 'Back up your mileage log',
      body: 'Tap to export this year\'s legs to Drive or email.',
      data: { open: 'backup' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      channelId: 'reminders',
      weekday: 6, // 1 = Sunday, so 6 = Friday
      hour: 17,
      minute: 0,
    },
  });
}
