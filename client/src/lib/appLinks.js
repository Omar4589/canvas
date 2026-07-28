// Where a new person INSTALLS the Doorline app.
//
// Mirrors server/src/config/storeLinks.js — that file carries the full four-location map explaining
// why these differ from mobile/lib/config.js's STORE_URL (public listings, used by the in-app update
// nag). Duplicated by hand because this repo has no shared client/server module; same convention as
// client/src/lib/validators.js and client/src/components/ArchiveNudge.jsx. Keep the two in sync.
//
// The public store listings — both apps went public 2026-07-28. Unlike the server twin these carry
// no env override, so a wrong value here can only be fixed by a deploy.

export const IOS_INSTALL_URL = 'https://apps.apple.com/app/doorline/id6764581850';
// The com.doorline.app listing (the new Play org account) — NOT the package the current Android
// fleet is running. Install and update deliberately point at different apps until the Play
// cutover; server/src/config/storeLinks.js explains why.
export const ANDROID_INSTALL_URL = 'https://play.google.com/store/apps/details?id=com.doorline.app';
