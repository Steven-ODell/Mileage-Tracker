import * as Notifications from 'expo-notifications';
import { getSetting, setSetting } from './db';

// Notifications that drive tracking: the controls notification that sits in
// the shade all day with Mark stop / End day buttons, and the still-parked
// nudge. No React in here: the background location task imports this file.

export const ACTION_CATEGORY = 'trackingControls'; // no ':' or '-' allowed
export const ACTION_MARK_STOP = 'markStop';
export const ACTION_END_DAY = 'endDay';

const CONTROLS_ID = 'tracking-controls';
const NUDGE_ID = 'parked-nudge';
const NUDGE_AT = 'nudge_at'; // settings key: when the pending nudge will fire
const HANDLED = 'handled_action'; // settings key: the tap we already acted on

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
    })().catch((e) => {
      setup = null; // let the next call try again
      throw e;
    });
  }
  return setup;
}

// ---------------------------------------------------------------- controls --

let showing: string | null = null;

// The buttons expo-location's own foreground-service notification can't have.
// Cheap to call repeatedly: it only reposts when the text would change.
export async function showControls(legNo: number, startTime: number | null, tracking: boolean) {
  const key = `${legNo}|${tracking}`;
  if (showing === key) return;
  await prepare();
  const since = startTime
    ? new Date(startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  await Notifications.scheduleNotificationAsync({
    identifier: CONTROLS_ID,
    content: {
      title: tracking ? `Recording leg ${legNo}` : `Leg ${legNo} · tracking stopped`,
      body: tracking
        ? `Started ${since ?? 'today'}. Tap Mark stop when you park.`
        : 'Open the app to resume tracking or end the day.',
      categoryIdentifier: ACTION_CATEGORY,
      sticky: true, // can't be swiped away mid-day
      autoDismiss: false,
      color: '#1b7f3b',
      data: { controls: true },
    },
    trigger: { channelId: CH_CONTROLS },
  });
  showing = key;
}

export async function hideControls() {
  showing = null;
  await Notifications.dismissNotificationAsync(CONTROLS_ID).catch(() => {});
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
// the app is opened afterwards. Acting on one claims it first.
export function claimAction(id: string): boolean {
  if (getSetting(HANDLED) === id) return false;
  setSetting(HANDLED, id);
  return true;
}
