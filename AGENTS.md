This is an Android-only Expo/React Native app, sideloaded as a release APK onto one phone. `CLAUDE.md` has the spec, code map, and test and build steps; read it first.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm add — resolves SDK-compatible versions
npx tsc --noEmit            # typecheck
npm test                    # Node tests for the pure modules (geo, csv)
npx expo-doctor             # diagnose dependency and config issues
./scripts/build-apk.sh      # release APK -> build/mileage-log.apk
```

Run the typecheck and tests before declaring any task done.

## Rules

- Navigation is a small hand-rolled stack in `App.tsx`, not Expo Router. Don't add a router.
- Builds are local (`scripts/build-apk.sh`), not EAS, and must stay signed with the same debug key so installs keep the database.
- `android/` is generated (Continuous Native Generation). Never create or edit it by hand; configure native behavior in `app.json` and config plugins.
- Prefer Expo modules over third-party libraries. After adding a library with native code, rebuild the APK.
