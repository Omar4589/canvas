// WHERE A NEW PERSON GETS THE APP — the links we put in a canvasser's invite email.
//
// A canvasser's whole job lives in the mobile app; the web console is admins and team leads only
// (docs/ROLES.md). But the set-password link in their invite is a WEB url, so an invited canvasser
// sets a password in a browser and, without these links, has no way to discover the app exists.
//
// ── There are FOUR store-URL locations in this repo. They are not duplicates. ────────────────
//   1. HERE — where a NEW person INSTALLS. Currently the closed-beta join links.
//   2. client/src/lib/appLinks.js — the same two URLs for the web /select-org install card.
//      Mirrored by hand (no shared module in this repo; see client/src/lib/validators.js:57 and
//      client/src/components/ArchiveNudge.jsx for the same convention). Keep in sync.
//   3. mobile/lib/config.js STORE_URL — the PUBLIC listings, baked into the app, used by the
//      in-app update nag. Deliberately a different pair: that path is for someone who ALREADY
//      has the app, and the public listing is where an update comes from.
//   4. MOBILE_STORE_URL_IOS / _ANDROID (routes/public/buildStatus.js) — an optional override of
//      (3). Its absent-means-null is load-bearing there, so it must never be reused for install.
//
// At public launch these converge: SET MOBILE_INSTALL_URL_* to the public listings and UNSET
// MOBILE_STORE_URL_* (the update nag's baked-in default becomes correct). Opposite operations —
// which is exactly why install and update can't share one pair of vars.
//
// Env-overridable because email is the one surface you cannot take back: a broken TestFlight or
// Play tester link is fixed for all FUTURE mail with `heroku config:set`, no deploy.

export function installLinks() {
  return {
    // TestFlight public join links work for anyone (up to 10k testers) — no allow-list.
    ios: process.env.MOBILE_INSTALL_URL_IOS || 'https://testflight.apple.com/join/8ZHW2nXH',
    // Play INTERNAL testing requires the tester's Google account on an explicit list (100 max).
    // Someone not on it hits a wall, which is why the copy that renders these carries a short
    // "if a link doesn't work, reply to this email" line rather than promising a download.
    android:
      process.env.MOBILE_INSTALL_URL_ANDROID ||
      'https://play.google.com/apps/internaltest/4700118043777481693',
  };
}
