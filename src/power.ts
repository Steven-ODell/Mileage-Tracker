import * as Battery from 'expo-battery';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking } from 'react-native';

// Android's battery optimizer can kill a foreground service on a long day with
// the screen off, which loses the rest of a leg. Nothing warns you it happened,
// so the app checks the flag itself and offers the one dialog that clears it.

export async function isOptimized(): Promise<boolean> {
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false; // can't tell; don't nag
  }
}

// The system's own "Allow this app to run in the background?" dialog, which is
// one tap. Needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest and the
// package name as the intent data; if an OEM has neither, fall back to the
// optimization list, then to this app's settings page.
export async function askUnrestricted() {
  const pkg = Constants.expoConfig?.android?.package;
  if (pkg) {
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        { data: `package:${pkg}` }
      );
      return;
    } catch {}
  }
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    return;
  } catch {}
  await Linking.openSettings();
}
