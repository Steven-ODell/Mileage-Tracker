#!/usr/bin/env bash
# Builds a standalone release APK (signed with the debug key; fine for sideloading).
# Output: build/mileage-log.apk
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(mise env -s bash)"
npx expo prebuild --platform android --no-install >/dev/null
(cd android && ./gradlew assembleRelease -q)
mkdir -p build
cp android/app/build/outputs/apk/release/app-release.apk build/mileage-log.apk
echo "built build/mileage-log.apk ($(du -h build/mileage-log.apk | cut -f1))"
