#!/usr/bin/env bash
# Drive the app on the headless `mileage` emulator: boot, install, tap buttons,
# and feed fake GPS so tracking can be tested without driving.
#
#   emu-drive.sh boot | install | launch | kill | logs | texts
#   emu-drive.sh tap "<text>"          exact text/content-desc, case-insensitive
#   emu-drive.sh shot <file.png>
#   emu-drive.sh fix <lat> <lng>
#   emu-drive.sh drive <lat1> <lng1> <lat2> <lng2> <mph> <interval_s>
#   emu-drive.sh park <lat> <lng> <seconds> <interval_s>   (±8 m jitter)
set -euo pipefail

cd "$(dirname "$0")/.."
HERE=scripts
PKG=com.sao.mileagelog
ACTIVITY=$PKG/.MainActivity
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.config/.android/avd}"
export ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
SCRATCH="${EMU_SCRATCH:-/tmp/claude-1000}"
mkdir -p "$SCRATCH"
LOG="$SCRATCH/emu.log"
DUMP="$SCRATCH/ui.xml"

die() { echo "emu-drive: $*" >&2; exit 1; }
adb() { "$ADB" "$@"; }
attached() { adb devices | grep -q '^emulator-[0-9]*[[:space:]]*device$'; }

wait_boot() {
  local i
  adb wait-for-device
  for i in $(seq 1 180); do
    [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && return 0
    sleep 1
  done
  die "boot timed out (see $LOG)"
}

ui_dump() {
  local i
  for i in 1 2 3; do
    # uiautomator dump fails with "could not get idle state" while animating.
    if adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 \
       && adb pull /sdcard/ui.xml "$DUMP" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "uiautomator dump failed"
}

cmd=${1:-}; shift || true
case "$cmd" in
  boot)
    if attached; then echo "emulator already attached"; else
      setsid nohup "$EMULATOR" -avd mileage -no-window -no-audio -no-snapshot \
        -gpu swiftshader_indirect >"$LOG" 2>&1 </dev/null &
      echo "emulator starting (log: $LOG)"
    fi
    wait_boot
    echo "booted"
    ;;
  install)
    [[ -f build/mileage-log.apk ]] || die "no build/mileage-log.apk; run scripts/build-apk.sh"
    adb install -r build/mileage-log.apk
    for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS; do
      # Fails if the manifest doesn't declare it (e.g. milestone 1); not fatal.
      adb shell pm grant "$PKG" "android.permission.$p" 2>/dev/null \
        && echo "granted $p" || echo "skip $p (not declared in manifest?)"
    done
    adb shell appops set "$PKG" ACCESS_BACKGROUND_LOCATION allow 2>/dev/null || true
    adb shell dumpsys deviceidle whitelist "+$PKG" >/dev/null
    echo "battery whitelist: $PKG"
    ;;
  launch)
    adb shell am start -W -n "$ACTIVITY" >/dev/null
    for _ in $(seq 1 30); do
      ui_dump
      if grep -q "package=\"$PKG\"" "$DUMP" && python3 "$HERE/emu_helper.py" texts "$DUMP" | grep -q .; then
        echo "launched"; exit 0
      fi
      sleep 1
    done
    die "app UI did not appear"
    ;;
  tap)
    [[ $# -eq 1 ]] || die 'usage: tap "<text>"'
    ui_dump
    xy=$(python3 "$HERE/emu_helper.py" find "$DUMP" "$1") || exit 1
    adb shell input tap $xy
    echo "tapped '$1' at $xy"
    ;;
  texts)
    ui_dump
    python3 "$HERE/emu_helper.py" texts "$DUMP"
    ;;
  shot)
    [[ $# -eq 1 ]] || die "usage: shot <file.png>"
    adb exec-out screencap -p >"$1"
    echo "saved $1"
    ;;
  fix)
    [[ $# -eq 2 ]] || die "usage: fix <lat> <lng>"
    adb emu geo fix "$2" "$1" >/dev/null   # longitude first
    echo "fix $1 $2"
    ;;
  drive)
    [[ $# -eq 6 ]] || die "usage: drive <lat1> <lng1> <lat2> <lng2> <mph> <interval_s>"
    python3 "$HERE/emu_helper.py" drive "$@"
    ;;
  park)
    [[ $# -eq 4 ]] || die "usage: park <lat> <lng> <seconds> <interval_s>"
    python3 "$HERE/emu_helper.py" park "$@"
    ;;
  kill)
    if attached; then adb emu kill; else echo "no emulator attached"; fi
    ;;
  logs)
    adb logcat -d -v brief | grep -E 'ReactNativeJS|FATAL|^E/AndroidRuntime' || true
    ;;
  *)
    sed -n '2,10p' "$0"; exit 2
    ;;
esac
