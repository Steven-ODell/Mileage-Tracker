import * as Notifications from 'expo-notifications';
import TrackingNotification from '../modules/tracking-notification';
import { getSetting, setSetting } from './db';

// Notifications that drive tracking: the tracking notification that sits in
// the shade all day with Mark stop / End day buttons, and the still-parked
// nudge. No React in here: the background location task imports this file.

export const ACTION_CATEGORY = 'trackingControls'; // no ':' or '-' allowed
export const ACTION_MARK_STOP = 'markStop';
export const ACTION_END_DAY = 'endDay';

// Where 1.1.0 posted the buttons, as a second notification next to the
// tracking one. Dismissed once per process so an update doesn't leave it up.
const OLD_CONTROLS_ID = 'tracking-controls';
const NUDGE_ID = 'parked-nudge';
const NUDGE_AT = 'nudge_at'; // settings key: when the pending nudge will fire
const HANDLED = 'handled_action'; // settings key: taps already acted on, newest first

const CH_CONTROLS = 'tracking';
const CH_NUDGE = 'nudges';

// Parked this long with a leg still open and we ask whether he meant to Mark
// stop or End day. Long enough that an inspection or a supply run doesn't nag,
// short enough to catch a forgotten End day before he drives home.
const PARKED_MS = 30 * 60 * 1000;

// Re-arming the alarm on every GPS batch would be a write every 5 s, so while
// he's driving it only moves once it has drifted this far behind.
const NUDGE_SLACK_MS = 5 * 60 * 1000;

let setup: Promise<void> | null = null;

// Channels and the action buttons. Idempotent, and only paid for once per
// process; every entry point awaits it before posting anything.
export function prepare(): Promise<void> {
  if (!setup) {
    setup = (async () => {
      await Notifications.setNotificationChannelAsync(CH_CONTROLS, {
        name: 'Tracking controls',
        // DEFAULT keeps it out of the shade's "Silent" group, which some lock
        // screens hide; sound null and no vibration keep it quiet anyway.
        // Android locks a channel's importance after it's created, so changing
        // this later needs a new channel id, not an edit here.
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
        enableVibrate: false,
        showBadge: false,
      });
      await Notifications.setNotificationChannelAsync(CH_NUDGE, {
        name: 'Forgot to stop',
        importance: Notifications.AndroidImportance.HIGH, // he's not looking at the phone
      });
      await Notifications.setNotificationCategoryAsync(ACTION_CATEGORY, [
        // Both open the app: Mark stop needs the purpose picker, End day asks
        // to confirm. One tap from the lock screen either way.
        { identifier: ACTION_MARK_STOP, buttonTitle: 'Mark stop', options: { opensAppToForeground: true } },
        { identifier: ACTION_END_DAY, buttonTitle: 'End day', options: { opensAppToForeground: true } },
      ]);
      await Notifications.dismissNotificationAsync(OLD_CONTROLS_ID).catch(() => {});
    })().catch((e) => {
      setup = null; // let the next call try again
      throw e;
    });
  }
  return setup;
}

// ---------------------------------------------------------------- controls --

// Replaces expo-location's plain tracking notification with one that has the
// buttons (see modules/tracking-notification). Called on every GPS batch as
// well as from the app, since expo-location puts its own back whenever the
// service restarts. Cheap: the native side only reposts when something changed.
export async function showControls(
  legNo: number,
  startTime: number | null,
  state: { tracking: boolean } | { staleDate: string }
) {
  await prepare();
  const since = startTime
    ? new Date(startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  let title: string;
  let body: string;
  if ('staleDate' in state) {
    title = `The day from ${state.staleDate} was never ended`;
    body = 'Open the app to close it at the last GPS point.';
  } else if (state.tracking) {
    title = `Recording leg ${legNo}`;
    body = `Started ${since ?? 'today'}. Tap Mark stop when you park.`;
  } else {
    title = `Leg ${legNo} · tracking stopped`;
    body = 'Open the app to resume tracking or end the day.';
  }
  const recording = 'tracking' in state && state.tracking;
  TrackingNotification.show({
    title,
    body,
    channelId: CH_CONTROLS,
    // Only a live recording counts as an ongoing activity for Android 16's
    // Live Updates; the stopped and overnight states are plain notifications.
    promote: recording,
    chipText: recording ? `Leg ${legNo}` : null,
    actions: [
      { id: ACTION_MARK_STOP, title: 'Mark stop' },
      { id: ACTION_END_DAY, title: 'End day' },
    ],
  });
}

export async function hideControls() {
  TrackingNotification.hide();
}

// The buttons on the tracking notification open the app with this URL;
// n is when that notification was posted.
export function parseActionUrl(url: string | null): string | null {
  const m = url?.match(/^mileagelog:\/\/action\/(\w+)\?/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------- nudge --

// Called whenever the car actually moved: the nudge always sits PARKED_MS
// ahead of the last movement, so it only ever fires once he has stopped.
export async function bumpParkedNudge(now: number) {
  const target = now + PARKED_MS;
  const pending = Number(getSetting(NUDGE_AT) ?? 0);
  if (pending > now && target - pending < NUDGE_SLACK_MS) return;
  await prepare();
  await Notifications.scheduleNotificationAsync({
    identifier: NUDGE_ID,
    content: {
      title: 'Still parked?',
      body: 'The leg is still recording. Mark stop, or end the day if you\'re done.',
      categoryIdentifier: ACTION_CATEGORY,
      data: { nudge: true },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target, channelId: CH_NUDGE },
  });
  setSetting(NUDGE_AT, String(target));
}

// On every state change he made himself: Start day, Mark stop, End day.
export async function cancelParkedNudge() {
  setSetting(NUDGE_AT, '0');
  await Notifications.cancelScheduledNotificationAsync(NUDGE_ID).catch(() => {});
  await Notifications.dismissNotificationAsync(NUDGE_ID).catch(() => {});
}

// ------------------------------------------------------------------ action --

// The response that launched the app stays the "last" response for as long as
// the OS keeps it, so a Mark stop tapped at 10am would fire again every time
// the app is opened afterwards. Acting on one claims it first. Several kinds
// get claimed (nudge buttons, tracking buttons, the weekly reminder), so it
// remembers the last few rather than just one.
export function claimAction(id: string): boolean {
  const raw = getSetting(HANDLED);
  let seen: string[] = [];
  try {
    seen = JSON.parse(raw ?? '[]');
  } catch {
    seen = [raw!]; // 1.1.0 stored a single plain id
  }
  if (!Array.isArray(seen)) seen = [];
  if (seen.includes(id)) return false;
  setSetting(HANDLED, JSON.stringify([id, ...seen].slice(0, 20)));
  return true;
}
