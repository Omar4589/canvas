// Where a new person INSTALLS the Doorline app.
//
// Mirrors server/src/config/storeLinks.js — that file carries the full four-location map explaining
// why these differ from mobile/lib/config.js's STORE_URL (public listings, used by the in-app update
// nag). Duplicated by hand because this repo has no shared client/server module; same convention as
// client/src/lib/validators.js and client/src/components/ArchiveNudge.jsx. Keep the two in sync.
//
// Currently the closed-beta join links. At public launch, swap both files to the public listings
// and update the marketing badges (see MarketingFooter.jsx).

// TestFlight public join links work for anyone, no allow-list.
export const IOS_INSTALL_URL = 'https://testflight.apple.com/join/8ZHW2nXH';
// Play INTERNAL testing needs the tester's Google account on an explicit list (100 max) — someone
// not on it hits a wall, which is why the surfaces rendering this always offer a way to ask.
export const ANDROID_INSTALL_URL = 'https://play.google.com/apps/internaltest/4700118043777481693';
