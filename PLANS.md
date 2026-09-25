# Plans

Ideas Sao asked to keep on the list. Not built yet.

## Fuel cost estimate (requested 2026-09-21)

**Goal:** see what the driving actually cost in gas, not just miles.

**How:**
- Settings: average MPG for his truck (city driving), plus a gas price per gallon. Price can be typed in, or the latest fill-up price if fill-ups get logged later.
- Cost per leg = miles ÷ MPG × price. Show it on each leg, per day, and year-to-date next to the business miles.
- Keep the price that was in effect when the leg was driven (store price with the leg or keep a dated price history), so changing today's price doesn't rewrite last month.
- Optional later: log fill-ups (gallons + total $) to compute real MPG instead of the typed average.

**Test plan:**
- Unit test the math: 100 mi at 20 MPG and $3.50/gal = $17.50. Zero or missing MPG gives no cost rather than a crash or infinity.
- Change the price, confirm old legs keep their old cost.
- Compare a week's estimate against real fill-up receipts.
- Add a CSV column (`fuel_cost`) only if he wants it in the export. The current column list is fixed by the spec.

**Tax note (said once, his call):** with the IRS standard mileage rate, gas is not deducted on top of it; the rate covers gas. This estimate is for knowing real spend. It matters for the tax return only if he uses the actual-expense method instead.

## iPhone version (decided 2026-09-25)

**Decision:** likely to happen eventually, but not until enough people need it.
The trigger is a couple of coworkers with iPhones who want it, one of whom will
drive real workdays with test builds and report back. Until then the app stays
Android only.

**Cost:** Apple Developer Program, $99 every year (lapse and it stops
installing). No Mac needed: Expo's cloud builds (EAS) build iOS, and TestFlight
installs on testers' phones.

**What carries over:** all the JS/TS code (screens, SQLite, CSV, geo math,
tests) and the Expo libraries, which already have iOS versions.

**What's new work:**
- `modules/tracking-notification` is Android-only Kotlin. iOS has no pinned
  foreground-service notification; the equivalent is a Live Activity (lock
  screen / Dynamic Island), a SwiftUI widget extension with Mark stop / End day
  buttons through App Intents. The Swift module keeps the same JS interface
  (`show` / `hide`), so JS stays mostly unchanged.
- Background tracking: iOS keeps the app alive through background location
  (`allowsBackgroundLocationUpdates`, `pausesUpdatesAutomatically: false`),
  not a foreground service. Needs real drives on an iPhone to trust.
- Battery-optimization banner and `expo-intent-launcher` are Android concepts;
  hide them on iOS.
- Install and update flow: TestFlight instead of downloading an APK.
