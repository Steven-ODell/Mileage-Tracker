# mileage-log

Android-only Expo app (SDK 57, RN 0.86, TypeScript): an IRS-quality mileage log
for Sao's 1099 roofing / insurance-claims field work around Phoenix. For his
own phone only. No Play Store, accounts, server, cloud sync, charts or auto
trip detection. Maps were out of the original spec; he asked for a route map on
2026-09-21, so a map preview now exists (see below). Build what the spec says; if something looks wrong, say
so in a sentence and build it as asked anyway.

## Status

| # | Milestone | State |
|---|---|---|
| 1 | Installable build showing a Start day button | Done 2026-09-21, confirmed on his phone (installed by downloading the APK) |
| 2 | Background tracking: Start day / Mark stop / End day, legs saved with miles + addresses | Done 2026-09-21, emulator-verified; awaiting his real drive |
| 2b | Route map preview (his add-on request) | Done 2026-09-21, emulator-verified; he tests 2 + 2b on 2026-09-22 with a coworker |
| 3 | Purpose picker, editing, manual entry, trip list + his adds: delete, full edit, AllTrails-style Trim end, dark mode (map stays light) | Done 2026-09-21, emulator-verified; he tests 2/2b/3 on 2026-09-22 |
| 4 | CSV export/import, weekly export reminder | Done 2026-09-21, emulator-verified (export read back, wipe + restore, reminder fired) |
| 5 | Post-field-test adds: Mark stop / End day notification buttons, battery-optimization warning, still-parked nudge, Canvassing purpose | Done 2026-09-22, emulator-verified |
| 6 | Bug-fix cleanup, v1.1.0 (versionCode 2): stale-day guard, CSV dedupe, trim flag, stale last-known fix, map on weak signal | Done 2026-09-22, emulator-verified; branch `opus-5.5-cleanup` |
| 7 | v1.2.0 (versionCode 3): one tracking notification with the buttons built in (was two), Android 16 Live Update request | Done 2026-09-23, emulator-verified on API 35 (upgrade from 1.1.0, warm and cold button taps, End day). On his Samsung the buttons work but no Live Update shows; he said to leave it (2026-09-23) |
| 8 | v1.3.0 (versionCode 4): Final walk preset, typed reason can stand in for a button | Done 2026-09-25 |

Ideas he asked to keep (not built): `PLANS.md` (fuel cost from MPG + gas price; iPhone version once enough coworkers need it).

**He field-tested 2026-09-22 and reported nothing wrong.** The four spec
milestones, his add-ons and the milestone 5 adds are all built. Of the
suggestions made that day he declined an odometer field (said it wasn't worth
it) and hasn't decided on the backup ideas (last-export age on the home
screen, auto-export to a Drive folder on End day). Don't start PLANS.md items
unless he asks.

Untested anywhere: whether the OEM battery flag on his actual phone was on.

Working rules: after any change, give exact install + test steps. He tests
tracking by driving; everything else gets verified on the emulator first
(install, launch, screenshot, check logcat for FATAL) before presenting. He
installs by downloading the APK; new builds must keep the same signing key.

## Spec

**Day flow**
- Start day: tapped after he leaves the gym. Tracking starts. Nothing before it is recorded.
- Mark stop: tapped after parking. Ends the current leg, opens the purpose picker, next leg starts here.
- End day: tapped after parking at the last stop. Closes the final leg (with picker), stops tracking. The drive home is never recorded.

**Purpose picker**: preset buttons Inspection, Final walk (his add, 2026-09-25,
after his promotion to project manager), Canvassing (his add, 2026-09-22),
Adjuster meeting, Office, Supply run, Personal, plus an optional note (claim name or address). One tap + save
is the common path. Tapping a lit button unlights it. With no button lit, the
text box is the reason: Save stores the typed text as the purpose and the note
stays null (`toPicker`/`fromPicker` in `src/purposes.ts`, used by both the
sheet and the edit screen), so the CSV purpose column is never blank for it.
Typed purposes count as business. Purpose and note are editable later. Personal legs are not
business miles.

**Manual entry**: date, from, to, miles, purpose, note, for drives he forgot to track.

**Trip list**: legs grouped by day, with daily and year-to-date business miles.

**Tracking**
- Must survive screen off + background for a whole workday: Android foreground
  service with a persistent notification (expo-location + expo-task-manager).
- Miles = sum of distances between GPS points. Drop low-accuracy points so
  drift while parked doesn't inflate miles.
- From/To stored as coordinates and a street address (on-device reverse geocode).
- All data in local SQLite (expo-sqlite).
- If the app is killed or the phone restarts mid-day, saved legs stay saved and
  the app shows the day was interrupted so he can fix it. Never lose data silently.

**Export / import**
- CSV of every leg since Jan 1 of the current year, through the share sheet.
- Columns, in order: `date, leg, start_time, end_time, from_address, to_address, miles, purpose, note, from_lat, from_lng, to_lat, to_lng`
- Import the same CSV on a new phone with no duplicates.
- Weekly local notification reminding him to export.

## Code map

- `index.ts` imports `src/tracking` first so the background task is defined before a headless start.
- `src/geo.ts`: pure distance math, zero imports (Node tests import it directly). Drift filter: drop fixes worse than 30 m accuracy; a fix only counts once it is 50 m+ from the last counted one; jumps over 60 m/s are glitches.
- `src/db.ts`: SQLite (`mileage.db`), tables `days`, `legs`, `points`. A leg row is inserted when the leg starts (`end_time` null while open), so a crash never loses a saved leg. Raw points are kept; miles are recomputed from them at leg close.
- `src/tracking.ts`: task definition, Start/Mark stop/End day, permissions, reverse geocode (filled after save, backfilled on app foreground), interruption detection. Android's last known position is only used as a start fix if under 2 min old (an older one can be home, which would count the drive in). A stale day (open from an earlier date) refuses Mark stop, the controls notification says so, and either notification button opens "Close at last GPS point".
- `src/MapScreen.tsx` + `map/map.html`: route map in a WebView running MapLibre GL v5 (v6 is ESM-only, can't inline) with OpenFreeMap tiles (free, no key). `scripts/gen-map-html.mjs` inlines MapLibre into `src/generated/mapHtml.ts` (gitignored; generated by `postinstall` and by `build-apk.sh`). RN pushes data with `window.setData(payload)`; live legs refresh every 5 s. Dropped low-accuracy points draw as grey dots. Layers are added on `style.load` (not `load`, which also waits for tiles). If the style doesn't load in 10 s, it falls back to a blank background so the route still draws (untested; the WebView cache kept tiles working in airplane mode).
- `src/geo.ts` `trackPoints()` is the single source of truth for what counts: map lines, the trim slider, `findGap` (also in geo.ts) and `legMeters` all use it. It re-anchors when 3 consistent fixes disagree with the anchor (a wild first fix, or a glitch that slipped in after a long gap).
- DB v2 (migration in `db.ts`): `legs.start_time` nullable (manual legs), `trim_end_ts` + `orig_end_time`. Trim is non-destructive; points past the cut stay, reset restores the last raw point as To. Trim and reset recompute `interrupted` from `findGap` over what still counts. An open GPS leg shows no Edit/Delete (its miles are recomputed at close). `renumber(date)` keeps `leg_no` gapless per date after add/delete/re-date.
- Screens: `App.tsx` holds a tiny stack (Home always mounted underneath). `TripsScreen` (year → days → legs), `LegScreen` (details, Edit/Trim end/Delete, map), `EditLegScreen` (edit + manual add), `DayMapScreen`, `PurposeSheet` (after Mark stop / End day).
- Theme: `src/ui.tsx` palette follows the phone (`useColorScheme`); styles are `makeStyles(c)` + `useStyles`. `app.json` `userInterfaceStyle: automatic` needs `expo-system-ui`. The map page is always light.
- `src/csv.ts`: pure CSV write/parse (zero imports, Node-tested). Times are local HH:MM; import also accepts M/D/YYYY and 12-hour times because Sheets rewrites them. `dedupeKey` = date, times, miles, coords at 4 dp (rounded from the exported 6 dp so phone and file agree), and addresses only for legs with no coords (a GPS leg's address can arrive after an export); purpose/note excluded so edits don't cause duplicates. Imported legs get `source = 'import'`, no points. `isDone(leg)` in db.ts is the "belongs in the log" test (not an open GPS leg).
- `src/notify.ts`: the notifications that drive tracking, no React so the background task can import it. expo-location's foreground-service notification can't have buttons, so `modules/tracking-notification` (a local Expo module, Kotlin) reposts it under the service's own notification id with Mark stop / End day on it, on the `tracking` channel. The service id starts at 481756 and goes up by one per service start within a process, so the module finds the notification flagged FOREGROUND_SERVICE rather than assuming the id; with no service running (tracking stopped, stale day) it posts under 481756. expo-location puts its plain version back whenever the service restarts, so the background task calls `showControls` on every GPS batch; the module compares a key stored in the notification's extras and only reposts on a change. While recording it sets `requestPromotedOngoing` (Android 16 Live Update, needs POST_PROMOTED_NOTIFICATIONS and a non-colorized card) with chip text "Leg N". Its buttons are PendingIntents naming MainActivity directly with `mileagelog://action/<id>?n=<posted at>` (no URL scheme is registered), which reach JS through RN `Linking`. Both buttons open the app (Mark stop needs the purpose picker, End day the confirm). The parked nudge's buttons still go through expo-notifications. Launching taps and responses are claimed in `settings.handled_action` (JSON list of the last 20) so they aren't replayed on every later launch (the weekly reminder's tap-to-open-Backup is claimed the same way). 1.1.0's separate `tracking-controls` notification is dismissed in `prepare()`. Channel importance is frozen by Android once created: changing it needs a new channel id.
- Still-parked nudge: the background task calls `bumpParkedNudge` on every batch with real movement (`anyMovement` in geo.ts, same threshold the miles are counted by), which keeps a one-shot notification sitting 30 min past the last movement. So it can only fire once the car has stopped, and a leg that has never moved (parked at a job after Mark stop) never arms one. Start day / Mark stop / End day cancel it. Force-stopping the app drops the alarm and both notifications until it's opened again, same as the weekly reminder.
- `src/power.ts`: `isOptimized()` (expo-battery) drives the amber home-screen banner; `askUnrestricted()` opens Android's own one-tap dialog via expo-intent-launcher, which needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in `app.json`. Re-checked on every foreground, so the banner clears itself.
- `src/backup.ts`: export (cache file → expo-sharing), import (document picker → `importLegs`, one transaction), weekly reminder (expo-notifications WEEKLY trigger, Fridays 17:00, rescheduled idempotently on every launch; tapping it opens Backup). DB v3 adds a `settings` key/value table (`last_export`).
- `App.tsx`: home screen; the map opens from the live card's Map button, a tapped leg row, or "Map of day". Purpose is null on a GPS leg until he picks one; `businessMiles` counts null purpose as business.

Interruption detection: after the app is killed, reopening it makes Android restart the location task before our code runs, so "service not running" is unreliable. The real signal is `findGap`: 2+ min without points while moving 500+ m. Flagged legs have `interrupted = 1`.

## Testing

- `npm test`: Node's built-in runner over `tests/*.test.ts` (geo math, gap detection, CSV).
- `scripts/emu-drive.sh`: emulator harness. `boot | install | launch | texts | tap "<text>" | shot <file> | fix <lat> <lng> | drive <lat1> <lng1> <lat2> <lng2> <mph> <interval_s> | park <lat> <lng> <s> <interval_s> | logs | kill`. `install` pre-grants every permission. Emulator fixes always report 5 m accuracy, so the accuracy filter can't be exercised there. The emulator repeats the last fix about once a second while anything listens.
- `install` also battery-whitelists the app, so testing the battery banner means removing it first: `adb shell dumpsys deviceidle whitelist -com.sao.mileagelog`.
- Notification buttons: `adb shell cmd statusbar expand-notifications`, then `emu-drive.sh tap "Mark stop"` (the tracking notification is the top one and shows expanded; the nudge may need its Expand chevron tapped, bounds from a uiautomator dump). `adb shell dumpsys notification --noredact` shows the extras (`mileagelog.controlsKey`, `android.requestPromotedOngoing`); `dumpsys activity services com.sao.mileagelog` shows which notification the service owns.
- Installing over a running day kills the process; reopening the app showed "Tracking" but no foreground service (seen 2026-09-23 upgrading 1.1.0 → 1.2.0). End day and Start day brought it back. Install updates with no day open. To fire the parked nudge, read its time out of `adb shell dumpsys alarm` and jump the clock the same way as the weekly reminder.
- Milestone 2 verification route (Mesa, Main St east from 33.4152,-111.8315): 1.00 mi screen-off drive + parking → leg of 1.0 mi; a 3 min force-stop mid-leg → leg flagged with the gap window.

Verifying an export on the emulator: release builds aren't debuggable, so `run-as` can't read the cache. Add `debuggable true` to the release block in `android/app/build.gradle` temporarily, `./gradlew assembleRelease`, install, export, then `adb shell run-as com.sao.mileagelog cat cache/mileage-log-*.csv`. Remove the line afterwards. To fire the reminder: `adb root`, `adb shell settings put global auto_time 0`, `adb shell 'date -s "YYYY-MM-DD 16:59:50"'`; restore `auto_time 1` after. Force-stopping the app cancels its alarms until it is opened again.

## Build and run

- `./scripts/build-apk.sh` → `build/mileage-log.apk` (release build, debug-signed, standalone; no Metro needed).
- `android/` is generated by `expo prebuild` and gitignored. Config lives in
  `app.json`; never hand-edit `android/`.
- JDK 17 comes from `.mise.toml`. SDK is `~/Android/Sdk` (install.sh in
  Omarchy-merge has an `android sdk` step that recreates it).
- Emulator AVD `mileage` lives in `~/.config/.android/avd`, so launching needs
  `ANDROID_AVD_HOME=~/.config/.android/avd`. Headless:
  `emulator -avd mileage -no-window -no-audio -no-snapshot -gpu swiftshader_indirect`.
  Kill it when done: `adb emu kill`.
- The APK is signed with React Native's standard debug keystore (SHA-256 fac61745…), identical across prebuilds, so new builds install over old ones and keep data. Never switch keys without warning him: a signature change forces an uninstall, which wipes the database.
- Don't `pkill -f` with a pattern that appears in a running build's command
  line; it killed the build once.

## Phone install

He installs by downloading the APK onto the phone and opening it. USB `adb
install -r` also works if USB debugging is on.
