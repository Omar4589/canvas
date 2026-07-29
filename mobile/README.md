# Canvass Mobile

Expo SDK 54 app. Uses `@rnmapbox/maps`, so it cannot run in Expo Go — you need a Dev Client build.

## Four build flavors

`eas.json` defines four profiles. The two that matter day to day are `staging` and `production` —
they are the **test lane** and the **live lane**, and the thing that separates them is the
**channel** baked into each binary, never the store or the track.

| Profile | Channel | What it is | Goes to |
|---|---|---|---|
| `development` | `development` | Dev Client + dev server | Day-to-day coding (`npx expo start`) |
| `preview` | `preview` | Signed, internal distribution | Ad-hoc installs; iOS needs registered device UDIDs |
| `staging` | `staging` | Signed for stores | **TestFlight** + **Play internal track** — where you try things first |
| `production` | `production` | Signed for stores | **App Store** + **Play production track** — real users |

`staging` is `extends: production`, so the two are byte-identical apart from the channel: same
signing, same `EXPO_PUBLIC_API_BASE_URL` (the real API — there is only one backend; test against the
demo org). Because they come from the same tree they share a **fingerprint**, which is exactly what
lets one commit serve both lanes.

You can build any of these **locally** (Xcode / Android Studio) or in the **EAS cloud**. EAS is
recommended for everything but `development` because it handles iOS signing certificates and Android
keystores for you.

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

In `eas.json`'s `submit.production` **and** `submit.staging` blocks (they carry the same Apple
identity and differ only in the Android track), fill in:

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

### Cutting builds for both lanes

You only need new **binaries** when a native input changes (see `fingerprint.config.js` below).
Everything else ships as an OTA. When you do need them, cut all four from the same commit:

```bash
# live lane first
eas build --profile production --platform ios     && eas submit --profile production --platform ios --latest
eas build --profile production --platform android && eas submit --profile production --platform android --latest

# test lane LAST — see the version-code note
eas build --profile staging --platform ios     && eas submit --profile staging --platform ios --latest
eas build --profile staging --platform android && eas submit --profile staging --platform android --latest
```

> **Build the staging pair LAST.** `autoIncrement` bumps the version code per build, and Google Play
> serves a tester whichever build has the highest code they qualify for. If production ends up above
> internal, your internal testers silently receive the production build instead.

Where each lands, and what it costs:

| Submit | Lands in | Review |
|---|---|---|
| `production` iOS | App Store | Full App Store review |
| `production` Android | Play **production** track | Play review |
| `staging` iOS | TestFlight | Beta App Review for *external* testers (~a day); internal testers, none |
| `staging` Android | Play **internal** track | None — live in minutes |

`submit.production.android.track` is `production` and `submit.staging.android.track` is `internal`,
so the profile you build with is the profile you submit with. Don't cross them.

Everything already installed keeps working while any of this is in review.

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

Three inert edits used to strand the fleet, and no longer move the fingerprint:

- **`app.json` `version`** — skipped via `ExpoConfigVersions` (it's inert here because
  `appVersionSource: "remote"` means the store version comes from EAS, not that field);
- **`eas.json`'s `submit` block** (ascAppId, appleId, Play track) — stripped from the hash by a
  file transform before hashing; **build profiles still count** (channel/env reach the binary);
- **every npm script in `mobile/package.json`** — skipped via `PackageJsonScriptsAll`. Scripts are
  build-time tooling and never compile into a binary. Added 2026-07-28 after a `test` script moved
  both fingerprints and blocked a publish. Native **dependencies** are unaffected — they reach the
  hash through autolinking, so adding a native module still moves it, correctly.

**Editing `fingerprint.config.js` itself changes every fingerprint** — only touch it in a commit
that ships a native build. `ota:check` catches it loudly if you forget.

### Two lanes: test first, then live

**The branch you publish from decides who gets it.** `main` is the live lane; a feature branch is
the test lane. Both produce the same fingerprint as long as you only change JS — which is why one
commit can serve both.

```bash
# on a feature branch — reaches TestFlight + Play internal only
npm run ota:staging

# after merging to main — reaches the App Store + Play production
npm run ota:production
```

Each script gates itself first (`ota:check` against that lane's newest finished build) and refuses
to publish an update no installed binary can accept.

**Why the lanes can't leak into each other:** a binary only reads its own **channel**, and the
channel is compiled in at build time from `eas.json`. A `staging` build reads branch `staging`; a
`production` build reads branch `production`. Nothing you type at publish time can cross that line —
the worst a mistake does is reach nobody.

**The one case that needs new builds:** if your feature branch touches a hashed input — `app.json`,
`eas.json`, a native dependency, an icon — its fingerprint diverges from the builds you cut, and
`ota:staging` will refuse. That refusal is the signal to cut a fresh set of four, not something to
override.

### History: the Play relaunch (closed 2026-07-28)

Kept because two branches and a tag still exist and it explains why.

Doorline relaunched Android on a new Play organization account, which required a new
`applicationId` (`com.canvassapp.mobile` → `com.doorline.app`, permanent once uploaded). That rename
was a native change, so it lived on branch `play-org-launch` while the old app stayed shippable from
`sharedVoters`. Both stores approved on 2026-07-28; `main` was then fast-forwarded to
`play-org-launch`, and the `playorg` build profile was repurposed as `staging`.

Two frozen refs remain, and **neither should ever be moved**:

| Ref | Tree fingerprints to | Why it exists |
|---|---|---|
| `sharedVoters` (`685969b`), tagged `legacy-android-lifeline` | android `444667d0` | The only tree that can still OTA the **legacy** `com.canvassapp.mobile` app. Not actively supported — an escape hatch if a straggler crew hits something urgent mid-migration. |
| `play-org-launch` (`3255eb6`) | android `bc62990a` | The tree the first `com.doorline.app` Play builds were cut from. Its channel is `playorg`, which no new build uses. |

To reach either population, check the ref out and publish from there; from `main` the fingerprint no
longer matches and `ota:check` will correctly refuse. Once the legacy Android install base reaches
zero, both refs can be deleted.

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
| `MOBILE_STORE_URL_IOS` / `_ANDROID` | optional override of where the Update button goes; absent → the app's baked-in `STORE_URL`. **iOS: leave unset** — since the public App Store release the baked-in URL is correct. **Android: set it** while the legacy `com.canvassapp.mobile` fleet still exists, because their baked-in URL points at the app being retired, not at `com.doorline.app`. |

Builds whose runtimeVersion isn't listed show the nag; everyone else sees nothing. Everything
fails open — server unreachable, endpoint erroring, var typo'd to nonsense → **no nag**, never a
wrong wall. Don't flip `hard` until you've eyeballed the wall once on a real device: it blocks
the entire app (login included) until the store update is installed.

> **The nag can't tell your lanes apart.** It keys on platform + runtimeVersion only, and a
> `staging` build shares its fingerprint with the `production` build cut from the same commit. So
> list **both** lanes' runtime versions as current, or testers get nagged toward a store page that
> offers them something they already have.

⚠️ **Android migration note.** `com.doorline.app` is a different `applicationId`, so installing it
does **not** replace `com.canvassapp.mobile` — the two coexist with separate storage, and anything
still queued offline in the old app is lost if someone stops opening it. Keep `MOBILE_UPDATE_MODE`
on `soft` and use `MOBILE_UPDATE_NOTE` to say "open Doorline once on wifi to sync, then install the
new app." Set `MOBILE_STORE_URL_ANDROID` **before** narrowing `MOBILE_CURRENT_RUNTIME_ANDROID`, or
the nag walks people back to the listing you're retiring.

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
