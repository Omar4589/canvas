// The lowest mobile client contract version (CLIENT_API_VERSION in
// mobile/lib/config.js) this server still accepts. Bump this ONLY when a server
// change breaks older bundles in a way they can't tolerate — older clients then
// get routed to the in-app "Update required" wall instead of failing with
// cryptic 4xx errors. Reported to the client on login / from /auth/me.
export const MIN_CLIENT_API_VERSION = 1;
