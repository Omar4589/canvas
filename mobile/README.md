# Canvass Mobile

Expo SDK 54 app. Uses `@rnmapbox/maps`, so it cannot run in Expo Go — you need a Dev Client build.

## Three build flavors

`eas.json` defines three profiles:

| Profile | What it is | Use for |
|---|---|---|
| `development` | Dev Client + dev server | Day-to-day coding (`npx expo start`) |
| `preview` | Signed but internal | Sharing with your 3 canvassers via TestFlight + Play Internal |
| `production` | Signed for stores | App Store / Google Play release |

You can build any of these **locally** (Xcode / Android Studio) or in the **EAS cloud**. EAS is recommended for `preview` and `production` because it handles iOS signing certificates and Android keystores for you.

---

## One-time setup

### 1. Mapbox download token

`@rnmapbox/maps` needs a **secret** Mapbox token with `DOWNLOADS:READ` scope to fetch the native SDK at build time. (This is *only used during build* — it's not bundled into the runtime app.)

1. Create the token at https://account.mapbox.com/access-tokens/ → check `DOWNLOADS:READ`.
2. **For local builds:**
   ```bash
   export RNMAPBOX_MAPS_DOWNLOAD_TOKEN=sk.xxxxx
   ```
   Add that line to your `~/.zshrc` so it's set in every terminal.
3. **For EAS cloud builds:**
   ```bash
   eas secret:create --scope project --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN --value sk.xxxxx
   ```

### 2. EAS account

```bash
npm install -g eas-cli
eas login
cd mobile
eas init        # links this directory to a new EAS project, sets the project ID in app.json
```

### 3. Set your API URL in eas.json

Open `mobile/eas.json` and replace the placeholders:

- `development.env.EXPO_PUBLIC_API_BASE_URL` → your Mac's LAN IP for hot-reload dev (e.g. `http://192.168.1.42:4000`). Find with `ipconfig getifaddr en0`.
- `preview.env.EXPO_PUBLIC_API_BASE_URL` → your API URL (e.g. `https://api.doorline.app`)
- `production.env.EXPO_PUBLIC_API_BASE_URL` → same API URL

The Mapbox public token is already pre-filled with yours.

### 4. Submit setup (only for `eas submit`)

In `eas.json` `submit.production` block, fill in:

- `ios.appleId` — your Apple Developer email
- `ios.appleTeamId` — find it at https://developer.apple.com/account → Membership
- `ios.ascAppId` — App Store Connect numeric ID (after you create the app there)
- `android.serviceAccountKeyPath` — path to a Google Play service account JSON ([guide](https://docs.expo.dev/submit/android/#creating-a-service-account))

You can skip this for now and only fill it in when you're ready to push to the stores.

---

## Day-to-day commands

### Local dev (after first Dev Client install)

```bash
cd mobile
npm install --legacy-peer-deps
npm start                       # opens Metro; scan QR with the Dev Client app
```

### First-time Dev Client install

Pick one path:

**Option A — local build (need Xcode/Android Studio):**

```bash
export RNMAPBOX_MAPS_DOWNLOAD_TOKEN=sk.xxxxx
npx expo run:ios                # one time — installs the Dev Client on simulator/device
npx expo run:android            # one time — same for Android
```

**Option B — cloud build (no Xcode needed):**

```bash
eas build --profile development --platform ios
eas build --profile development --platform android
# Each build takes ~10 min. EAS emails you a link to install on your device.
```

### Building for TestFlight + Google Play Internal

```bash
# iOS preview (TestFlight)
eas build --profile preview --platform ios
eas submit --profile production --platform ios --latest

# Android preview (Play Internal track)
eas build --profile preview --platform android
eas submit --profile production --platform android --latest
```

`eas submit` uploads the build to App Store Connect / Play Console. From there:

- **TestFlight:** Apple does a quick automated review (usually < 1 hour). Once approved, add internal testers in App Store Connect → TestFlight.
- **Google Play Internal:** Available immediately to testers you've added in Play Console → Internal testing.

### Production release

Same as preview but with `--profile production`. EAS auto-increments the version number.

---

## Shipping an OTA (and why it might reach nobody)

`npm run ota:production` pushes a new **JavaScript bundle** to phones that already have the app — no
store review, no reinstall. It cannot ship native code. The rule:

> **JS / assets only → OTA. Anything that touches a native input → new build + store release.**

### The trap: `runtimeVersion`

`app.json` sets `runtimeVersion: { policy: "fingerprint" }`. Every `eas update` is stamped with a
fingerprint, and **a phone only downloads a bundle whose fingerprint exactly matches the one baked into
its installed binary.** The fingerprint is a hash of your *native* inputs:

`app.json` · `eas.json` · `package.json` · `patches/` · autolinked native modules — **but never your
app JS**, which is the whole point.

So editing *anything* in those files silently orphans every phone in the field. `eas update` still
prints **"success"** — it just published a bundle nobody can download, and nothing tells you.

This has already bitten us. Two examples, both of which changed the hash while changing **nothing** in
the binary:

- bumping `app.json` `version` `0.1.0 → 1.0.0` — inert, because `eas.json` sets
  `appVersionSource: "remote"` (the store version comes from EAS, not this field);
- adding `ascAppId` to `eas.json` — read only by `eas submit`, never compiled into anything.

The cost was real: **Android build vc16 shipped with a fingerprint no update was ever published under,
so it can never receive an OTA. Ever.** Its only exit is a store update.

### The guard: `ota:check` (automatic)

`npm run ota:production` now refuses to publish into the void: it runs `scripts/ota-check.mjs`
first, which compares the tree's fingerprint against the newest finished production build per
platform and **exits non-zero on a mismatch** — before `eas update` ever runs. To see exactly
which sources diverged:

```bash
npx eas build:list --platform android --limit 3      # get the build id + its runtimeVersion
npx eas fingerprint:compare --build-id <BUILD_ID>    # names the files/fields that moved
```

Deliberate override (e.g. you just cut a build and EAS hasn't listed it as finished yet):
`OTA_ALLOW_MISMATCH=1 npm run ota:production` — it warns loudly and proceeds.

### The tamed inputs: `fingerprint.config.js`

Two inert edits used to strand the fleet, and no longer move the fingerprint:

- **`app.json` `version`** — skipped via `ExpoConfigVersions` (it's inert here because
  `appVersionSource: "remote"` means the store version comes from EAS, not that field);
- **`eas.json`'s `submit` block** (ascAppId, appleId, Play track) — stripped from the hash by a
  file transform before hashing; **build profiles still count** (channel/env reach the binary).

**Editing `fingerprint.config.js` itself changes every fingerprint** — only touch it in a commit
that ships a native build. `ota:check` catches it loudly if you forget.

### The two-store window (Play relaunch)

We are relaunching on a new Google Play organization account, which needs a **new Android
applicationId** (`com.doorline.app`, permanent once uploaded). The rename is a native change (new
fingerprint), so it lives on branch **`play-org-launch`** — not here.

> **Field hotfixes ship from `sharedVoters`. `play-org-launch` exists ONLY to build for the new
> store account. Merge it into `sharedVoters` at cutover, and only after all canvassers have
> migrated to the new store app.**

**`play-org-launch` = `sharedVoters` + exactly one commit** (the id + `lib/config.js` Android
store URL + a `playorg` build profile in `eas.json` + the at-action-only location copy). Keep it
current by rebasing the single commit forward:

```bash
git fetch origin
git checkout sharedVoters && git merge --ff-only origin/sharedVoters
git rebase sharedVoters play-org-launch
git push --force-with-lease origin play-org-launch
```

> **Hazard:** every rebase that pulls a hashed input from `sharedVoters` (anything in `app.json`,
> `eas.json`, `package.json` scripts, native deps) **silently moves the branch fingerprint and
> strands the already-cut `playorg` test build** — `eas update --branch playorg` is ungated and
> reaches nobody with no error. **After any such rebase, cut a fresh `playorg` build.**

**Internal-testing loop for the new store app** (from `play-org-launch`):

1. Build once — first run is interactive (EAS mints a new Android keystore for the new id):
   `eas build --platform android --profile playorg`
2. Upload that first AAB **manually** in the new org's Play Console (internal track). `eas submit`
   works only after the app exists there and the org's service account is wired.
3. Iterate JS onto testers, gated against the `playorg` builds (not the fleet):
   `npm run ota:check -- --build-profile=playorg --platform=android && eas update --branch playorg --environment production`
4. Add the `playorg` build's Runtime Version to `MOBILE_CURRENT_RUNTIME_ANDROID` (comma-separated)
   so testers don't get nagged.

**The gate protects the fleet by construction:** `ota:production` from `sharedVoters` compares
against the newest **production-profile** build (the fleet) and passes; from `play-org-launch` it
**fails loudly** (`FINGERPRINT MISMATCH — reach NOBODY`) and refuses to publish. This holds ONLY
while new-store builds use `--profile playorg` — **never build the new app with `--profile
production` before cutover**, or it becomes `ota:check`'s comparison target and breaks the fleet gate.

**Cutover** (once the fleet has migrated off the old app):

1. Final rebase, then `git checkout sharedVoters && git merge --ff-only play-org-launch`.
2. Build **Android AND iOS** under `--profile production` from merged HEAD — **iOS is mandatory**:
   the per-platform fingerprint hashes the whole config, so the Android rename moved iOS's
   fingerprint too, and iOS OTAs strand without a fresh build.
3. Submit/upload both; re-point `MOBILE_CURRENT_RUNTIME_ANDROID`/`_IOS` (see the nag section below).
4. Set `MOBILE_STORE_URL_ANDROID` to the new listing so the nag walks stragglers to the new app
   (`soft`, later `hard`). Optional: `eas channel:edit playorg --branch production` so lingering
   test builds keep receiving production updates.
5. Same fingerprint-rollover commit is the free moment to harden: add `'PackageJsonScriptsAll'` to
   `fingerprint.config.js` (stops future script edits from being native-grade changes), and update
   the stale old-id references: `client/src/marketing/MarketingFooter.jsx` Android beta URL and
   `PROJECT_BRIEF.md`.

### The migration-window dual publish (do this NOW, until the fleet updates)

Independent of the relaunch: the newest finished **production** builds are the `allowBackup`
builds (19/23-era), so a plain `npm run ota:production` from `sharedVoters` reaches only phones
that already installed them — **un-updated vc18/vc22 phones receive nothing, silently** (the gate
validates against the newest build, not the installed base). Until that population drains, a fleet
hotfix needs **two** publishes:

1. On clean `sharedVoters` HEAD, delete the single line `"allowBackup": false,` from `app.json`
   (**working tree only — never commit**). This restores the 18/22 fingerprint exactly (verified:
   it is the only hashed-input change since those builds).
2. Confirm: `npx expo-updates fingerprint:generate --platform android` equals build 18's Runtime
   Version (and iOS vs 22) — get those from `eas build:list -p android --build-profile production
   --status finished --limit 5 --json --non-interactive`.
3. Publish to the old fleet with the loud override (the gate correctly sees a mismatch vs 19/23):
   `OTA_ALLOW_MISMATCH=1 npm run ota:production`
4. `git checkout -- mobile/app.json`, then plain `npm run ota:production` to publish the same JS
   under the new fingerprint for 19/23 installers. Order doesn't matter — updates coexist per
   runtimeVersion on the branch.

Retire this once the build stamps / `MOBILE_CURRENT_RUNTIME_*` monitoring show the 18/22
population at ≈ zero.

### Telling old builds to update (the nag)

Phones ask `GET /api/build-status` (public, env-driven) whether their **binary** is current.
Unset = feature off. To flip it, set Heroku config vars — Dashboard → your API app → Settings →
**Reveal Config Vars** (changing one restarts the dyno; takes effect in seconds):

| Var | Value |
|---|---|
| `MOBILE_CURRENT_RUNTIME_ANDROID` | the current Android build's **Runtime Version** (from `eas build:list`, or the expo.dev build page); comma-separate to allow several |
| `MOBILE_CURRENT_RUNTIME_IOS` | same for iOS — each platform is independent |
| `MOBILE_UPDATE_MODE` | `soft` (default) = dismissible banner · `hard` = blocking "Update Doorline" wall |
| `MOBILE_UPDATE_NOTE` | optional one-line custom message shown on the nag |
| `MOBILE_STORE_URL_IOS` / `_ANDROID` | optional override of where the Update button goes. Needed for iOS **until the app is publicly released**: the baked-in URL is the public App Store page, which doesn't exist during the TestFlight-only era — point it at TestFlight (e.g. `https://beta.itunes.apple.com/v1/app/6764581850`, or your TestFlight public invite link), then delete it at launch. Play needs no override — internal-testing releases serve through the normal store page. |

Builds whose runtimeVersion isn't listed show the nag; everyone else sees nothing. Everything
fails open — server unreachable, endpoint erroring, var typo'd to nonsense → **no nag**, never a
wrong wall. Don't flip `hard` until you've eyeballed the wall once on a real device: it blocks
the entire app (login included) until the store update is installed.

### Reading it off a phone

**Profile → the build stamp at the bottom** prints `v<runtimeVersion> · <channel> · update <id> · <date>`,
or `embedded build` if no OTA has ever landed. That one line tells you which binary a device has and
whether it is receiving updates.

### Applying it

Default expo-updates behavior is **download in the background, apply on the *next* launch**. So after
publishing: open the app, wait ~30s, force-quit, reopen. Relaunching once and seeing the old bundle
proves nothing.

---

## How the API URL gets wired up

`mobile/lib/config.js` reads `EXPO_PUBLIC_API_BASE_URL` from `process.env` (set by EAS at build time per profile), falling back to `app.json` `extra.apiBaseUrl` for plain `expo start`. So each build profile points at a different backend without you touching code.

## What's in the app

| File | Purpose |
|---|---|
| `app/_layout.jsx` | Auth gate, providers |
| `app/login.jsx` | Login (token in SecureStore) |
| `app/(app)/map.jsx` | Mapbox map, all households as a single GeoJSON ShapeSource + CircleLayer + SymbolLayer |
| `app/(app)/household/[id].jsx` | Voter list + Not Home / Wrong Address |
| `app/(app)/voter/[id]/survey.jsx` | Voter-level survey |
| `lib/offlineQueue.js` | AsyncStorage queue + flush, marks `wasOfflineSubmission: true` |
| `lib/cache.js` | Bootstrap cached for offline map use |
| `lib/location.js` | GPS required, throws if denied |

Pin colors per the locked plan: gray=unknocked, blue=not_home, green=surveyed, red=wrong_address.
