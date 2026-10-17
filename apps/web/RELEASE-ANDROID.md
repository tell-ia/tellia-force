# Ship the Android app to Google Play (private test)

Goal: give a tester (e.g. a teammate) the app through Play's **Internal testing**
track by email — no public listing.

The release build points at the **Railway API** (`.env.release`), not the local
dev API, so it works on any device. Local emulator builds (`pnpm build` + `cap
run`) keep using `.env` (`10.0.2.2`) and are unaffected.

## 1. One-time: create the upload keystore

Signing keys are **not** in git. Generate one (keep the passwords safe — losing
them means you can't update the app):

```bash
cd apps/web/android
keytool -genkey -v -keystore tellia-upload.keystore \
  -alias tellia-upload -keyalg RSA -keysize 2048 -validity 10000
```

Then create `apps/web/android/keystore.properties` from the example and fill in
the same passwords:

```bash
cp keystore.properties.example keystore.properties
# edit keystore.properties: storePassword + keyPassword
```

`gradle` reads it automatically; both files are git-ignored.

## 2. Build a signed release bundle

`.env.release` is git-ignored — create it once (fresh clones too):

```bash
cd apps/web
cat > .env.release <<'EOF'
VITE_API_URL=https://api-production-16996.up.railway.app
VITE_VAPI_PHONE_NUMBER=+12188456415
EOF
```

Then build:

```bash
cd apps/web
pnpm build:release          # web build -> Railway API (.env.release)
pnpm cap:sync               # copy dist into the Android project
cd android
./gradlew bundleRelease     # signed .aab for Play
# output: app/build/outputs/bundle/release/app-release.aab
```

Prefer an **.aab** (Play's format). Need a raw APK to sideload instead?
`./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.

Each new upload needs a higher `versionCode` — bump it in
`android/app/build.gradle` (`versionCode 1` → `2` → …) before building.

## 3. Play Console → private test

1. [play.google.com/console](https://play.google.com/console) → **Create app**
   (name "Tellia Force", app, free). One-time $25 developer account.
2. **Testing → Internal testing → Create new release**.
3. Upload `app-release.aab`. (First upload: let Google manage the app signing key
   — "Play App Signing" — and keep your upload key for future updates.)
4. **Testers** tab → create an email list → add the tester's Google account email.
5. Fill the few required bits Play asks for (short description, etc.), **Save**,
   **Review release → Roll out to Internal testing**.
6. Copy the **opt-in URL**, send it to the tester. They open it on their phone,
   accept, and install from Play.

Internal testing is live within minutes and stays private to the emails you add.

## Notes
- `capacitor.config.ts` still has `cleartext` / `allowMixedContent` (dev helpers
  for the plain-http local API). The Railway API is https, so they're unused in
  release; you can set both to `false` for a cleaner prod build if you like.
- The app id is `com.tellia.force` (fixed once the app is created on Play).
