// WHERE A NEW PERSON GETS THE APP — the links we put in a canvasser's invite email.
//
// A canvasser's whole job lives in the mobile app; the web console is admins and team leads only
// (docs/ROLES.md). But the set-password link in their invite is a WEB url, so an invited canvasser
// sets a password in a browser and, without these links, has no way to discover the app exists.
//
// ── There are FOUR store-URL locations in this repo. They are not duplicates. ────────────────
//   1. HERE — where a NEW person INSTALLS. The public store listings.
//   2. client/src/lib/appLinks.js — the same two URLs for the web /select-org install card.
//      Mirrored by hand (no shared module in this repo; see client/src/lib/validators.js:57 and
//      client/src/components/ArchiveNudge.jsx for the same convention). Keep in sync.
//   3. mobile/lib/config.js STORE_URL — the PUBLIC listings, baked into the app, used by the
//      in-app update nag. Deliberately a different pair: that path is for someone who ALREADY
//      has the app, and the public listing is where an update comes from.
//   4. MOBILE_STORE_URL_IOS / _ANDROID (routes/public/buildStatus.js) — an optional override of
//      (3). Its absent-means-null is load-bearing there, so it must never be reused for install.
//
// ── Install and update CONVERGED ON iOS, and have NOT on Android. ─────────────────────────────
// Both apps went public 2026-07-28. On iOS install and update are now the same App Store page, so
// MOBILE_STORE_URL_IOS is a no-op. On Android they still point at two DIFFERENT APPS: a new person
// installs com.doorline.app (the new Play org account), while the fielded fleet is running
// com.canvassapp.mobile and its baked-in (3) still names that older listing. They merge at the Play
// cutover, when MOBILE_STORE_URL_ANDROID walks the stragglers across — mobile/README.md → "The
// two-store window". Until then, do not "fix" one of these pairs to match the other.
//
// Env-overridable because email is the one surface you cannot take back: a wrong link is fixed for
// all FUTURE mail from the Heroku dashboard (Settings → Config Vars), no deploy.

export function installLinks() {
  return {
    ios: process.env.MOBILE_INSTALL_URL_IOS || 'https://apps.apple.com/app/doorline/id6764581850',
    // The new Play org account's listing — deliberately a different package from (3). See above.
    android:
      process.env.MOBILE_INSTALL_URL_ANDROID ||
      'https://play.google.com/store/apps/details?id=com.doorline.app',
  };
}
