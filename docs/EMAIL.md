# Transactional email

Every email Doorline sends: what triggers it, who receives it, how long emailed links last, and
the machinery underneath (Resend, the dormant switch, the delivery-gated deletion warnings).

- **Part 1 — For everyone** is the catalog: the complete list of emails, their triggers and
  recipients, link lifetimes, and the things an email will never do.
- **Part 2 — Technical reference** is for developers (and Claude): the mailer modes and env vars,
  the recipient rule, token mechanics, the test transport, and the invariants tests enforce.

Related: [USERS.md](USERS.md) (passwords, resets, session revocation), [OPERATIONS.md](OPERATIONS.md)
(the go-live switch, retention-warning knobs), [BILLING.md](BILLING.md) (billingAccess admins),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the code-verified privacy record; Resend is a
disclosed subprocessor — DPA §6 + the privacy policy's service-providers paragraph).

---

# Part 1 — For everyone

## Every email we send, and why

| # | Email | When it goes out | Who gets it |
| --- | --- | --- | --- |
| 1 | **Password reset** | Someone taps **Forgot password?** on the sign-in page (real, active account only) | That person |
| 2 | **Invite + set-password link** | An admin creates a **new** user on the Users page | The new user |
| 3 | **Invite + set-password link** (also names the campaign) | A lead/admin creates a new canvasser inline from a campaign's **Team** page | The new canvasser |
| 4 | **"You've been added"** (no link, no credentials) | An **existing** account is linked into another org (Users page or Team page) | That person |
| 5 | **Added to campaign** | A Team-page add of an existing member — genuinely-new roster rows only | That member |
| 6 | **Welcome + set-password link** | A super admin provisions a new client org with its first admin | That admin |
| 7 | **Support-access notice** | Doorline staff opens a **new** support-access grant into an org | **Billing admins only** (see below) |
| 8 | **Wind-down warning** | The nightly sweep finds a canceled org within ~30 days of data deletion — sent once, and the deletion **cannot proceed without it** | **Billing admins only** |
| 9 | **Dormancy warning** | The nightly sweep finds a non-paying org nearing the ~30-month inactivity boundary — sent once; any recorded canvassing cancels the deletion | **Billing admins only** |

**Billing admins only** (emails 7–9, an owner decision): these billing-grade notices go to the
admins who hold **Billing access**, or — only when an org has none — to the **billing contact**
on file. They are never sent to every admin. Every provisioned org's first admin starts with
Billing access, and the console **refuses to remove the last billing admin**
(`LAST_BILLING_ADMIN` — see [BILLING.md](BILLING.md)), so a normally-created org always has a
recipient.

## Emailed links: how long they last

- A **password-reset link** works **once** and expires after **1 hour**. Requesting a new one
  silently replaces the old.
- An **invite / set-password link** (emails 2, 3, 6) works once and lasts **72 hours** — the same
  window as a typed temporary password.
- A link dies early if the person sets a password any other way, or the account is deactivated.
- An expired or used link shows "This link is invalid or has expired" with a one-tap way to
  request a fresh one. A too-weak new password does **not** burn the link — fix it and resubmit.

## The install links in a canvasser's invite

A canvasser works entirely in the mobile app, but the set-password link in their invite opens a
**browser** — so without help, someone could set a password and never learn the app exists. Their
invite therefore carries an **install block**: a link to the App Store, a link to Google Play, and
one line telling them to search for **Doorline** if a link doesn't open (a store link tapped from a
desktop mail client often can't hand off to a phone's store).

Only canvassers see it. Admins and team leads work in the web console and are never told to install
a field app. The three emails that carry it are the two invites and the added-to-a-campaign notice.

Both apps have been publicly listed since **2026-07-28**; the app is free. If a store link ever
needs to change, it is a config change rather than a code release — which matters because an email
already sent cannot be recalled, so the fix has to reach *future* mail immediately.

## What an email will never do

- **Never contain a password.** Invites carry a set-password link; typed temporary passwords are
  handed over in person and never emailed.
- **Never reveal whether an account exists.** Requesting a reset for any address — registered or
  not — shows the same confirmation; only real accounts actually receive mail.
- **Never fire from a silent side-effect.** Handing someone a book (which quietly adds them to
  the campaign roster) sends nothing; only deliberate adds notify.
- **Never spam repeats.** Re-adding an existing roster member, re-entering a live support grant,
  and re-running the nightly sweep against an already-warned org all send nothing.
- Suspending or canceling an org sends no email by itself — only the later wind-down warning
  does, and no wind-down or dormancy deletion ever happens without its warning first.

---

# Part 2 — Technical reference

## The mailer (`server/src/services/mail/`)

- **`mailer.js`** — `sendMail({to, subject, html, text, kind})`, the single chokepoint. POSTs to
  Resend's REST API with global fetch (no mailer npm dependency), AbortController timeout
  (`MAIL_TIMEOUT_MS`, default 10000). **Never throws; the return is honest**: `{sent: true}` ONLY
  on a Resend 2xx, `{sent: false, disabled: true}` while dormant, `{sent: false, error}` on any
  failure — the retention warning markers depend on this contract. Subjects and the From display
  name strip `\r\n\t` (customer-typed org/campaign names). Live-mode logs mask recipients
  (`o***@…`).
- **Dormant switch**: BOTH `RESEND_API_KEY` and `MAIL_FROM` must be set to send. Unset (every
  test, local dev): no network — sends are logged and pushed to the exported in-memory `outbox`
  (ring buffer, last 100), the tests' assertion surface. Setting the key is a **DPA §6
  subprocessor go-live** — see OPERATIONS.md for the gate.
- **Test transport**: `RESEND_API_KEY='test:accept'` / `'test:reject'` (+ any `MAIL_FROM`)
  emulates a 2xx / a failure with no network, still pushing to `outbox` — the only way tests can
  exercise delivery-gated callers. Loud warning if it ever runs.
- **`templates.js`** — 8 templates, each `{subject, html, text}`. One shared table-based light
  theme (all-inline CSS), `esc()` on every customer-typed string, long-form en-US dates in UTC.
  The brand row is the logomark PNG (served from `doorline.app/apple-touch-icon.png` — SVG and
  data: URIs are stripped by Gmail) beside the TEXT wordmark, inside the white card (the PNG has
  a white background); clients that block remote images still show the text.
- **`recipients.js`** — `billingNotifyEmails(orgId)`: active admin Memberships with
  `billingAccess: true` → their live Users' emails; if none, `Subscription.billingContact.email`;
  deduped/lowercased; may be `[]`. **Deliberately no all-admins tier** (owner decision
  2026-07-18) — used by the grant notice and both deletion warnings.

## Send sites (the complete set)

`routes/auth.js` (passwordReset) · `routes/admin/memberships.js` (invite / addedToOrg) ·
`routes/admin/leadCrew.js` (ONE combined invite/addedToOrg naming the campaign) ·
`routes/admin/assignments.js` (addedToCampaign — `upsertedCount`-new rows only, skips
`mustChangePassword` holders) · `routes/superAdmin/organizations.js` (provisioningWelcome) ·
`routes/superAdmin/access.js` (supportGrantNotice — only when `createGrant` reports
`created: true`) · `services/retention/triggers.js` (windDownWarning / dormancyWarning via
`deliverWarning`). All route sends are fire-and-forget (sendMail never rejects); token issuance
is awaited first.

### Role-aware copy — canvassers are pointed at the app, not the console

`inviteSetPassword`, `addedToOrg` and `addedToCampaign` take a **`role`**. When it is
`'canvasser'` they carry an **install block** (both store links + a one-line store-search fallback);
otherwise they render the console wording unchanged. `provisioningWelcome` never does — it is always
an org's first admin.

This exists because a canvasser's whole job is in the mobile app, but their set-password link is a
**web** URL: they set a password in a browser, land on the web login, and (before this) hit a
dead-end error naming roles they don't have. Nothing told them the app existed. See
[ROLES.md](ROLES.md) for the matching `/select-org` hand-off.

The gate is `role === 'canvasser'`, deliberately **not** `!isConsoleRole(role)` — that helper is
client-side only, and explicit equality means a call site that forgets to pass `role` renders today's
email byte-for-byte. Fails safe: an admin is never told to install a field app.

Role reaches the three send sites without new queries: `memberships.js` already has `data.role`;
`leadCrew.js` only ever creates canvassers (hard-coded); `assignments.js` builds a `userId → role`
map from the `memberships` array **it already loaded** for the is-a-member check.

Install URLs live in [`config/storeLinks.js`](../server/src/config/storeLinks.js) →
`installLinks()`, overridable per-platform with `MOBILE_INSTALL_URL_IOS` /
`MOBILE_INSTALL_URL_ANDROID` and defaulting to the public store listings. **These are not
`MOBILE_STORE_URL_*`** — those override where the in-app *update* button sends someone who already
has the app ([mobile/README.md](../mobile/README.md)), and their absent-means-null is load-bearing
there. The web mirror is [`client/src/lib/appLinks.js`](../client/src/lib/appLinks.js) (no shared
module in this repo — keep the two in sync; `storeLinks.js` carries the full four-location map).

**Post-launch state (both stores went public 2026-07-28).** Both `MOBILE_INSTALL_URL_*` are set in
Heroku. On **iOS** install and update converged on one App Store page, so `MOBILE_STORE_URL_IOS` is
now a no-op. On **Android** they have *not* converged and must not be forced to: a new person
installs `com.doorline.app` (the new Play org account) while the fielded fleet runs
`com.canvassapp.mobile`, so `MOBILE_STORE_URL_ANDROID` stays deliberately **unset** until the Play
cutover, when it becomes the lever that walks stragglers across.

The install block still ends with a short "search for Doorline if a link doesn't open" line rather
than promising a one-tap download — a store link opened from a desktop mail client or an in-app
webview frequently can't hand off to the phone's store. `services/campaignRoster.js`'s silent
auto-add is comment- and test-guarded to never email.

## Reset/invite tokens (`services/auth/passwordReset.js`)

`crypto.randomBytes(32)` base64url in the link; **sha256 hex** stored on
`User.passwordResetToken` + `passwordResetExpiresAt` (RESET 1h, INVITE 72h — matches
`TEMP_PASSWORD_TTL_HOURS`). One active token per user, last-wins. Consumed by
`POST /auth/reset-password` in one atomic `findOneAndUpdate` (single-use, race-safe); Zod
strength check runs BEFORE the lookup. Completing a reset (or change-password) stamps
`passwordChangedAt` — revoking every older session (`SESSION_REVOKED`, see USERS.md) — and
change-password also nulls any outstanding token.

## Deletion warnings are delivery-gated

`warnWindDownOrgs`/`warnDormantOrgs` stamp their marker (`windDownWarnedAt` /
`dormancyWarnedAt` + a persisted `…DeleteNotBefore` = max(natural deletion date, warn+14d))
ONLY on `sendMail → {sent: true}` or a genuinely-zero-recipient org; the purges refuse any org
without a marker or before its promised date. Dormant mail ⇒ warnings retry unstamped and no
purge fires. Knobs: `RETENTION_WARN_LEAD_DAYS` (30), `RETENTION_WARN_GRACE_DAYS` (14).

## Delivery truth (the Resend webhook)

`POST /api/webhooks/resend` (`routes/public/resendWebhook.js`) upgrades EmailLog rows from
"Resend accepted it" to what the inbox reported: **delivered · bounced · complained · delayed**.
Public by necessity, so auth IS the signature: Svix HMAC over the raw body (app.js keeps that
one path un-JSON-parsed) with `RESEND_WEBHOOK_SECRET`, ±5-minute replay window; no secret → 503
and nothing processed. The join key is `EmailLog.resendId`, captured from the send response
(the `test:accept` transport fabricates one, so the loop tests offline —
`test/resendWebhook.int.test.js`). bounced/complained are TERMINAL: a late 'delivered' never
repaints them. **Deliberately not consumed: open/click events** — that is behavioral tracking
of recipients, the privacy policy says we don't, and tracking stays off in Resend.
Setup: Resend dashboard → Webhooks → add `https://doorline.app/api/webhooks/resend`, select the
four delivery events, copy the signing secret into the `RESEND_WEBHOOK_SECRET` config var.

## The send log (`models/EmailLog.js` + the super-admin Emails page)

Every sendMail attempt writes one **metadata-only** row (kind, recipients, subject, outcome
`sent`/`failed`/`dormant`, error, org/user attribution, timestamp — **never the body**),
fire-and-forget from the chokepoint (skipped when mongoose is disconnected, so standalone
scripts can import the mailer). Org rows also snapshot the org NAME at send time, so a
deletion-warning row stays legible after the org is purged. Retention: ordinary rows expire via
TTL after `EMAIL_LOG_RETENTION_DAYS` (365); **windDownWarning / dormancyWarning rows never
expire** — they are the "we warned before we deleted" evidence. Served by
`GET /super-admin/emails` (super-admin only; paged, filterable by kind/outcome/org, with a
last-24h sent/failed rollup) and rendered on the web console's super-admin **Emails** page.
The TTL + query indexes are schema-declared — run `migrate:build-indexes --apply` after deploy.

## Previewing templates

`npm run mail:preview` (from the repo root or `server/`) renders **every template, and every role
variant of it**, into `.preview-emails/` (gitignored) — one scrollable index plus the HTML and
plain-text alternative per email. Nothing is sent: it imports `services/mail/templates.js` directly,
so what you see is byte-identical to what Resend receives. Sample data is deliberately awkward
(`O'Brien`, `Smith & Sons Consulting`) so `esc()` is visible rather than assumed.

It also **fetches the logo URL and reports whether it resolves**, in a green/red banner. That check
matters because the brand row loads `${WEB_ORIGIN}/apple-touch-icon.png` over the network: if
`WEB_ORIGIN` is ever wrong on the server, every email silently ships a broken image and nothing else
would tell you. Point it anywhere to verify:
`WEB_ORIGIN=http://localhost:5173 npm run mail:preview`. Add `-- --open` to open it (macOS).

(Resend's own dashboard preview pane blocks remote images, so the logo **always** looks broken
there. That is a preview artifact, not a bug — check it here or in a real inbox.)

## Guard tests

`test/mailTemplates.test.js` — **pure, no mongod, never skips.** Locks the role→install-links rule:
canvasser gets both URLs in HTML *and* text; admin, lead and an *absent* role get none;
`provisioningWelcome` never does; `addedToOrg` drops the console-only "switch into it" wording for a
canvasser; and the env override renders `&` escaped in HTML but raw in text. It also holds the
closing note to both halves independently — "App Store" and "Google Play" must each appear in the
HTML *and* the text, and the retired phrase `closed test` must appear in neither. Every other content
assertion in this file is an integration test that silently skips without `MONGODB_URI_TEST` —
which is precisely how the canvasser dead-end shipped.


`test/mailFlow.int.test.js` (reset flow: oracle parity, hashed storage, single-use, expiry,
throttles) · `test/mailTriggers.int.test.js` (every trigger fires exactly when specified;
temp passwords appear NOWHERE in any email; billing-only recipients incl. the
plain-admins-get-nothing pin; silent adds never email) · `test/retentionWarnings.int.test.js`
(never-delete-unwarned, delivery-gated stamps, grace, marker resets) ·
`test/sessionInvalidation.int.test.js` (reset/change revoke sessions; stale links die).
