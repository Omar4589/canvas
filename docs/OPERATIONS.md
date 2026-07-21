# Operations: scheduled jobs & one-off commands

Everything you have to run on the **server** rather than click in the app: the jobs Heroku runs on a
schedule for you, and the one-off commands you type into Heroku's Run console.

---

# Part 1 — For everyone

## Where you type these

On the Heroku website: open the app → **More ▸ Run console** (top right) → type the command → **Run**.
It opens a temporary machine with your real production database attached, runs the command, prints the
output, and shuts down. Nothing is installed on your computer, and closing the tab afterwards is fine.

The commands below are exactly what you type. Nothing else.

## ⚠️ The Run console starts you at the REPO ROOT, not in `server/`

This is the thing that will confuse you at 11pm. This is a **monorepo**: the scripts actually live in
[`server/package.json`](../server/package.json), but the Run console drops you in the *root* directory,
where [`package.json`](../package.json) only knows about the scripts it explicitly forwards.

So a script can exist, be committed, be deployed — and still come back **"Missing script"** — simply
because the root doesn't forward it.

**Two ways through it:**

1. **Use the short name** — it works if (and only if) the root forwards it. Every ops script is
   forwarded today; the list is in the root `package.json`.
   ```
   npm run migrate:build-indexes -- --apply
   ```
2. **Reach past the root** — always works, even for a script nobody forwarded:
   ```
   npm --prefix server run migrate:build-indexes -- --apply
   ```

**If you add a new script to `server/package.json`, add a forwarding line to the root `package.json`
too** — otherwise it's invisible from the Run console, which is the only place it's ever run in
production. The forwarding line is mechanical:

```jsonc
// root package.json
"my-script": "npm --prefix server run my-script --"
```

The trailing `--` is what lets `npm run my-script -- --apply` pass `--apply` all the way down. Leave it
off and your flags get eaten silently — the script runs in dry-run mode and you think it worked.

> Note `node src/utils/whatever.js` **will not work** from the Run console: that path is relative to
> `server/`, and you're at the root. It'd be `node server/src/utils/whatever.js`. Prefer the npm scripts —
> they're the ones we keep correct.

## ⚠️ Entering a customer's account now needs a reason

You can no longer switch into a customer organization silently. Doing so requires a **support access
grant**: you type why, it lasts **4 hours**, and every voter record you open is written to an audit log
against your name.

This is not a restriction on what you can do — it is a record that you did it. *"I can read any
customer's voter file and nobody, including me, could ever prove whether I did"* is not a position a
data processor can defend, to a customer or in a dispute.

- Start one: **Platform → Support access → Start session**, or `POST /api/super-admin/access/grants`.
- See who looked at what: `GET /api/super-admin/access/log?organizationId=…`.

There are two staff tiers now:

| Role | Can | Cannot |
| --- | --- | --- |
| **`support`** (default for new staff) | Platform metadata dashboard. Customer voter content **via a grant**. | Delete an organization · promote staff · edit canonical voter identity. |
| **`break_glass`** (you) | Everything. | Still needs a grant to enter a customer org, and is still logged. **No god mode = no *unlogged* mode.** |

Existing super-admins are grandfathered to `break_glass` by `migrate:platform-roles`. **New staff should
be created as `support`** — that split exists so that hiring someone doesn't mean handing them an
omniscient login.

## Jobs that run themselves (set up once, then forget)

**A "scheduled job" is a robot that runs a command for you on a timer.** You set it up once on Heroku's
website and Heroku's own servers run it from then on — every day, forever. Your laptop can be closed. You
can be on vacation. You never touch it again.

### These now run inside the app — delete the Heroku Scheduler entry

**The retention jobs moved into the worker dyno you already run.** They are BullMQ repeatable jobs in
`services/retention/scheduler.js`, they record every run, and a test fails if anyone removes the
schedule.

That is the whole point. The purge *was* running — via a Heroku Scheduler entry you typed into a web
form — but that entry was invisible to the code, uncovered by any test, and removable without a single
thing failing. A published legal promise cannot be enforced by something nobody can see.

> **Remove the old `purge:deleted-identities` Heroku Scheduler job after deploying.** Leaving it does
> no harm (the purge is idempotent), but it is now redundant and misleading.

| Job | When | What it does |
| --- | --- | --- |
| `purge-deleted-identities` | Daily 03:17 UTC | Removes the retained name of anyone who deleted their account >180 days ago |
| `platform-stats-reconcile` | Daily 03:47 UTC | Recomputes the Control Room lifetime counters' **live** bucket from real rows and stamps "last reconciled" (drift-corrector; **not** a retention job — the retention health banner deliberately does not watch it), **and rebuilds the `PlatformDaily` trend series in full from the same rows** (the sparklines' data; same job, no extra cron). Cron override: `PLATFORM_STATS_CRON`. Also runnable on demand from the Control Room's **Reconcile now** button (`POST /super-admin/access/platform-stats/reconcile` — same idempotent recompute). |
| `retention-triggers` | Daily 04:41 UTC | **Warns, then deletes organizations**: emails deletion warnings ~30 days ahead (wind-down + dormancy), then purges wind-down, dormancy, and due deletion requests. **Wind-down and dormancy never delete an unwarned org**: the purge requires a delivery-verified warning marker plus a grace period, so while email is unconfigured those two purges simply hold (data kept, never deleted unwarned). Delete-on-request is exempt — it *is* the customer's instruction. |

**Check they're alive:** `GET /api/super-admin/access/health/retention`. It goes **RED** when the last
successful run is >48h old — because a silently-dead scheduled job is indistinguishable from one that
had nothing to do, unless something is counting.

### The retention windows (yours to change, no deploy needed)

| Setting | Default | Meaning |
| --- | --- | --- |
| `RETENTION_WIND_DOWN_DAYS` | **60** | After a subscription is canceled, the customer has this long to export. Then their data is deleted. |
| `RETENTION_DORMANCY_MONTHS` | **30** | No canvassing activity for this long → a non-paying (canceled/suspended) org is purged. A single knock resets the clock (the clock *is* the last knock). |
| `RETENTION_DELETE_SLA_DAYS` | **30** | A deletion request is scheduled this far out — the window in which a mistaken or coerced request can be cancelled. |
| `DELETED_IDENTITY_RETENTION_DAYS` | **180** | How long a deleted user's name is kept for fraud attribution. |
| `SUPPORT_GRANT_HOURS` | **4** | How long a support access session lasts. |
| `RETENTION_WARN_LEAD_DAYS` | **30** | How far ahead of a wind-down/dormancy deletion the warning email goes out. |
| `RETENTION_WARN_GRACE_DAYS` | **14** | Minimum time between the warning actually being delivered and the deletion — even for an org already past its deadline when first warned. |

### Email (Resend) — the dormant/live switch

Transactional email (password resets, invites, org/campaign notices, support-grant notices,
deletion warnings) is **dormant until BOTH vars are set** — no key, no network calls, sends are
logged only:

| Setting | Meaning |
| --- | --- |
| `RESEND_API_KEY` | The Resend API key. **Setting this is the go-live switch — see the gate below.** |
| `MAIL_FROM` | The sender, e.g. `Doorline <notifications@doorline.app>`. Both vars required; key without from stays dormant (loud warning in the logs). |
| `MOBILE_INSTALL_URL_IOS` / `_ANDROID` | Where a **canvasser's invite email** sends them to INSTALL the app. Defaults to the closed-beta join links (TestFlight / Play internal test). Env-overridable because email can't be recalled — a broken tester link is fixed for all future mail with `heroku config:set`, no deploy. **Distinct from `MOBILE_STORE_URL_IOS`/`_ANDROID`** ([mobile/README.md](../mobile/README.md)), which override where the in-app *update* button sends someone who already has the app. At public launch: **set** `MOBILE_INSTALL_URL_*` to the store listings and **unset** `MOBILE_STORE_URL_*`. |
| `MAIL_TIMEOUT_MS` | Send timeout, default 10000. |
| `RESEND_WEBHOOK_SECRET` | Signing secret for the delivery webhook (Resend dashboard → Webhooks → add `https://doorline.app/api/webhooks/resend`, events: delivered / bounced / complained / delivery_delayed — never opened/clicked). Unset = delivery statuses simply stay blank on the Emails page. |

> 🛑 **Before setting the key (DPA §6 — contractual, not optional):** Resend is a new
> subprocessor (it receives recipients' names + email addresses). The DPA's subprocessor list and
> the privacy policy's service-providers paragraph must be updated and **customers notified
> BEFORE the first real email is sent.** Also verify the sending domain in Resend and publish
> SPF + DKIM first, or every mail bounces. While dormant, everything else works: the reset page
> exists (requests simply produce no email), and the retention warn stage attempts, logs, and
> retries next sweep — it never marks a customer "warned" off an undelivered email.

**Verify after go-live:** request a password reset to your own address; check the Resend
dashboard shows it delivered; after the next 04:41 UTC sweep, `heroku logs --dyno worker` should
show warn counts instead of `[retention] ... NOT delivered (mail dormant)` lines.

**The Emails page (Super-admin ▸ Emails)** is the in-app send log: every attempt with kind,
recipients, outcome (sent / failed / dormant) and a last-24h failure count — metadata only;
rendered content and bounce forensics stay in the Resend dashboard. Ordinary rows expire after
`EMAIL_LOG_RETENTION_DAYS` (**365**); wind-down/dormancy **warning rows are kept forever** as
the deletion-warning evidence trail (they survive the org's own deletion, with the org name
snapshotted at send time). Its indexes are schema-declared — the deploy needs
`migrate:build-indexes --apply`.

Orgs with subscription status **`internal`** (our demo/platform tenants) are **exempt from every
auto-purge** — the App Review demo tenant must not evaporate because nobody knocked a door in it.

### Why that job exists

When someone taps **Delete my account**, we immediately destroy their login, name, email, phone and
password. But **their knocks and GPS pins stay with the campaign** — that's the organization's data, and
removing it would change your counts and your bill.

That creates a problem: if we erased their name *everywhere*, you'd be left with a pile of GPS pins
belonging to nobody. Someone could fake a day of doors, delete their account, and you'd have no way to
prove who did it. So we keep **one hidden copy** of their name and email — invisible in the app, used only
for auditing — so you can still say *"those pins were Dave."*

We keep that hidden copy for **180 days (about six months)** — long enough to catch fraud and settle a
billing dispute — and then it has to go, because the app and the privacy policy both **promise the user**
we delete it. **This job is what keeps that promise.** If it never runs, we hold those names forever and
we're lying to people, which is the kind of thing that gets an app pulled.

Nothing will happen for the first six months — the job has nothing to clean up until somebody has been
deleted for 180 days. Set it up now anyway, so you don't forget.

### Setting it up (two minutes, once)

1. On the Heroku website, open your app → **Resources**.
2. In **Add-ons**, search for **Heroku Scheduler** and add it (the free plan is fine).
3. Click **Heroku Scheduler** in the add-on list → **Add Job**.
4. Set the command to:
   ```
   npm run purge:deleted-identities -- --apply
   ```
5. Set the frequency to **Daily**, pick any time (3:00 AM UTC is fine — it's a quiet job).
6. **Save Job.** Done. You are finished with this forever.

> **Daily isn't because it needs to be daily** — Heroku Scheduler's only choices are every 10 minutes,
> hourly, or daily, so daily is the *least* frequent option available. The job costs nothing: with nobody
> to clean up it does one quick lookup, finds nothing, and exits. Running it a week late would be
> completely harmless — nobody cares whether a name is deleted on day 180 or day 187.

## One-off commands

### Lock the store reviewers' demo account (do this before you submit)

An App Store or Play reviewer **will press "Delete my account"** — testing that button is literally what
Apple's guideline asks them to do. If your demo login is deletable, the reviewer destroys it on their way
through, and your **next** submission has no working credentials for anyone to review.

**But you cannot just lock everything.** A reviewer who can't complete a deletion *anywhere* will reject
you for "unable to verify account deletion" — the exact thing they came to check. So the demo tenant needs
**two** accounts:

| Account | Role | Locked? | Why |
| --- | --- | --- | --- |
| `review@doorline.app` | **admin** | 🔒 **Yes** | The keys to the demo tenant. An admin can also **switch to canvass mode**, so this one login demonstrates the whole app — admin screens *and* door-knocking. A lead or canvasser account sees strictly less. |
| `review-delete@doorline.app` | canvasser | 🔓 **No** | Exists purely to be deleted. Name it explicitly in the App Review notes as the account to use for testing deletion. Re-seed it before each submission. |

### Restage the demo tenant (run this before every submission)

**The seeder does all of it** — creates any missing review account, gives each one a clean unwalked
book, puts them on the campaign, and **locks the admins automatically**. It's also how you recover after
a reviewer deletes the disposable account: deletion releases the email, so re-running simply brings it
back with a fresh clean book.

Set these once as Heroku **Config Vars** (Settings ▸ Reveal Config Vars). All four are comma-separated,
and the passwords line up **positionally** with the emails — so Apple and Google can hold *different*
credentials, and a leak on one store's portal doesn't hand anyone the other's login:

```
SEED_DEMO_ADMIN_EMAIL        apple@review.com,android@review.com
SEED_DEMO_ADMIN_PASSWORD     <apple-admin-pw>,<google-admin-pw>
SEED_DEMO_CANVASSER_EMAIL    apple-delete@review.com,android-delete@review.com
SEED_DEMO_CANVASSER_PASSWORD <apple-canvasser-pw>,<google-canvasser-pw>
```

One password for several emails is fine too (everyone shares it). A count that's neither 1 nor N is a
typo, and the seeder exits rather than quietly seeding an account with a password you don't have.

Then, in the Run console:

```
npm run seed:demo -- --reset --apply
```

It prints exactly what to paste into App Store Connect and Play Console, including **which account is
the deletable one**. Passwords never expire and never force a password change — reviewers must be able
to log straight in.

`--reset` restages the demo's activity (a fresh demo day) and keeps the org, accounts, campaign and
voters. Drop it — `npm run seed:demo -- --apply` — to repair accounts *without* wiping the demo day,
e.g. if you're mid-demo for a real prospect.

### Honour a deletion request that came by email

The public page at **doorline.app/delete-account** tells anyone who has already uninstalled the app to
email `hello@doorline.app`, and **promises we'll delete their account within 30 days**. This is how you
keep that promise. (Google Play requires that page, so the promise isn't optional — and a public
commitment with nothing behind it is worse than no commitment.)

**Verify the request first.** Confirm the mail actually came from the address on the account. This
permanently destroys someone's login; treating an unverified email as authority makes it an
account-takeover tool.

```
npm run delete:account someone@example.com            # dry run — shows exactly what would happen
npm run delete:account someone@example.com -- --apply # do it
```

It runs the **same service as the in-app button**, so an operator deletion is identical to a
self-deletion: identity scrubbed, books released, memberships deactivated, knock ledger untouched
(counts and billing don't move), identity snapshot kept for the disclosed window.

There is **deliberately no `--force`**. If it refuses — they're the last admin, or the last bill-payer —
that's because deleting them breaks somebody *else*: the org would lose the only person who can run it,
or the only person who can pay for it, and would silently go read-only when the subscription lapsed. Hand
the org off properly, then re-run.

> **Make sure `hello@doorline.app` actually receives mail.** Google requires the deletion resource to be
> *functional*. A dead mailbox on that page is a broken pathway, and it's the kind of thing nobody notices
> until a reviewer emails it.

### Lock an account by hand (override / audit)

The seeder already locks the admin review logins, so you rarely need this. To check, or to lock
something else:

```
npm run lock:account review@doorline.app
```

Check what's locked at any time:

```
npm run lock:account
```

Undo it (you almost never need this):

```
npm run lock:account review@doorline.app --unlock
```

A locked account can't be self-deleted; the app tells the reviewer it's an app-review account and points
them at the disposable one. Everything else about it works normally.

> **Google Play's App access form takes up to five credential sets**, each with its own note — so you can
> hand over admin, lead and canvasser logins there if you want. Apple has one structured username/password
> field, plus a free-text **Notes** field that takes as many as you like. Extra role logins are cheap
> insurance, but they are not what gets you approved: **a demo tenant with real doors, a real campaign and
> an assigned walk list is.** An admin login into an empty org is a Guideline 2.1 rejection no matter how
> many roles you provide.

### Build database indexes (after a deploy that added one)

**Not routine.** Run it when a release adds or changes a database index — the release notes will say so.
It's harmless to run when nothing changed (it just finishes instantly), so "run it after every deploy" is
a fine habit if you'd rather not keep track.

```
npm run migrate:build-indexes -- --apply
```

**Why it isn't automatic:** production is deliberately configured *not* to build indexes on startup. If it
did, every deploy would try to rebuild indexes across your biggest collections at boot, which can lock up
the database while people are canvassing. So we build them on purpose, when we mean to.

### Stamp merge candidates with their organization (ONE TIME — batch-3 release)

Existing `PersonMergeCandidate` rows predate the `organizationId` field (new ones get it at write
time). Expected to report **0 rows** in production — no import has ever used a vendor `uidSource`,
so the collection is empty — but run it once for safety; it's idempotent and dry-runs by default.

```
npm run migrate:candidate-orgs -- --apply
```

### Refresh the platform numbers + trend series (optional, after the batch-3 deploy)

`npm run migrate:platform-stats -- --apply` now also **backfills the daily trend series** behind
the Control Room sparklines (full history from surviving rows' dates). If you skip it, the 03:47 UTC
job builds the same series that night — running it just means the charts have history immediately.

### Record which team knocked each door (ONE TIME — after the release that adds it)

Doors now remember **which team knocked them**, so a canvasser who later leaves the team keeps their doors
on it. New doors record this by themselves from the moment you deploy. **Doors knocked *before* that deploy
have no team on them yet** — this is the one-time job that fills them in.

> **This section is history — the one-time backfill, already run.** It is kept because the traps in it
> still bite. What it does *not* describe is the current rule: since 2026-07-20 a door's team follows
> the canvasser's **current** coordinator, and changing someone's coordinator re-stamps their whole
> history. See **[Re-attribution (`repairTeamStamps.js`)](#re-attribution-repairteamstampsjs)** below
> and [METRICS.md §F](METRICS.md#teams-coordinators--the-counting-contract). ⚠️ Note the two scripts
> key on **opposite** conditions on purpose (`$exists:false` here, `$ne: next` there) — don't
> reconcile them.

Until you run it, the Timeline simply **won't show the team filter or the by-team table**. That's on
purpose: half-filled-in data would show every team at nearly zero and "No team" as enormous, which looks
like a real answer instead of an error. So it hides rather than lies. Run these in order:

```
npm run migrate:activity-coordinator -- --preflight     # 1. LOOK ONLY. Changes nothing.
npm run migrate:activity-coordinator                    # 2. Dry run — shows what it would do.
npm run migrate:activity-coordinator -- --apply         # 3. Do it.
npm run audit:team-counts -- --campaign=<campaignId>    # 4. Prove the numbers add up.
```

**Step 1 is the one not to skip.** It lists every canvasser who has ever knocked and whether their team can
still be worked out. Deactivating someone, or taking them off a campaign, keeps their team. **Removing
someone from the *organisation* deletes it for good** — if anyone is in that state, this is your last chance
to say who they belonged to, and it tells you before anything is written.

**Step 4 is the gate.** It checks that every team's doors, survey doors and surveyed voters add up to the
campaign's totals, on your real data, and **fails loudly if they don't**. Run it before you give any team's
number to a client. It changes nothing.

Safe to re-run at any time — it only ever fills in doors that have no team yet, and it never touches a knock.

> It fills in history using **today's** teams, because nothing recorded who was on which team in the past.
> That's exactly right for anyone who has never switched teams. If someone *has* moved between teams, their
> older doors will be credited to their current team. The dry run lists every person and the team it will
> give them, so you can check before committing.

---

# Part 2 — Technical reference

## The scheduled job

[`purgeDeletedIdentities.js`](../server/src/migrations/purgeDeletedIdentities.js) — scrubs
`DeletedUserRecord` rows whose `retentionUntil` has passed (`firstName`/`lastName`/`email`/`phone` → empty,
`purgedAt` stamped). It keeps the row itself: the row is the evidence that a deletion happened and that we
honoured the window.

Idempotent, and dry-run by default — `--apply` is what makes it write. The window is
`DELETED_IDENTITY_RETENTION_DAYS` (default **180**), read at deletion time and frozen onto the record, so
changing the env var later only affects future deletions.

Without this on a schedule, the retention promise made in
[`DeleteAccountSheet`](../mobile/components/DeleteAccountSheet.jsx), on
[`/delete-account`](../client/src/pages/DeleteAccountPage.jsx) and in the privacy policy is not kept. See
[USERS.md § Account deletion](USERS.md) for why the snapshot exists at all (short version: scrubbing the
`User` row destroys the GPS audit's only join key, so a canvasser could otherwise delete their way out of a
fraud audit).

## One-off commands

| Command | When |
| --- | --- |
| `npm run lock:account <email>` | Before every store submission — sets `User.deletionLocked` on the reviewer demo login |
| `npm run lock:account` | Lists every deletion-locked account |
| `npm run migrate:build-indexes -- --apply` | Any deploy that adds or changes a schema index |
| `npm run purge:deleted-identities` | Dry run of the scheduled job, to see what it *would* do |
| `npm run migrate:activity-coordinator -- --preflight` | **Read-only.** Before the team-attribution backfill — who resolves to a team, and who can't |
| `npm run migrate:activity-coordinator -- --apply` | Once, after the release that adds `CanvassActivity.coordinatorId` |
| `npm run audit:team-counts -- --campaign=<id>` | **Read-only.** Proves Σ teams + no-team − cross-team == the campaign billable, column by column. Exits **1** on failure |
| `npm run repair:team-stamps -- --preflight` | **Read-only.** Per org, per person: how many doors would change team under the current-coordinator rule |
| `npm run repair:team-stamps -- --apply` | Conforms history to each member's current coordinator, and turns team surfaces on for any org stuck with `teamAttributionReadyAt` unset |
| `npm run repair:team-stamps -- --apply --ready-only` | Only sets the gate flag; examines no ledger rows |
| `npm run repair:orphaned-assignments` | Dry run — finds anyone still holding books on a campaign they're off the roster of |

### Team attribution (`migrateActivityCoordinator.js`)

[`migrateActivityCoordinator.js`](../server/src/migrations/migrateActivityCoordinator.js) stamps
`coordinatorId` onto `CanvassActivity` + `SurveyResponse` from each member's current
`Membership.coordinatorId`, then sets `Organization.teamAttributionReadyAt`.

Three things that are load-bearing:

- **The idempotency key is `{ coordinatorId: { $exists: false } }`, never `{ coordinatorId: null }`.** In
  Mongo `{field: null}` **also matches absent fields**, so a `null` key would re-stamp *deliberate* nulls on
  a second run — handing a candidate's own doors to a team. The migration would reintroduce the bug it
  exists to fix, and only on the re-run. (Same reason `migrate:ack-memberships` keys on `$exists: false`.)
- **`teamAttributionReadyAt` is a gate, not a marker.** `GET /admin/reports/team-breakdown` returns
  `ready: false` until it's set, and the client renders no team filter at all. Deploy order is not a
  safeguard — a half-run backfill is *plausible-looking*, not obviously broken.

  > 🐛 **This gate was stuck OFF for every org created after the team-attribution release.** The flag's
  > only writer was this migration, at a point *below* two `continue` guards — and a new org has
  > nothing to backfill, so the migration always skipped it. Those orgs silently showed no team
  > surfaces at all, forever. Fixed two ways: `Organization.teamAttributionReadyAt` now defaults to
  > now on the **schema** (there are two org-creation paths, so a route-level fix would have missed
  > `seedDemoOrg.js`), and `repair:team-stamps` sets it **unconditionally, above any `continue`**,
  > for orgs that already exist.
- **No new index.** `CanvassActivity` already carries nine on the hottest write path; the team clause rides
  as a residual on `{campaignId, timestamp}`. **`migrate:build-indexes` is not part of this release.**

### Re-attribution (`repairTeamStamps.js`)

Since teams follow the **current** coordinator, [`repairTeamStamps.js`](../server/src/migrations/repairTeamStamps.js)
brings the ledger into line with every member's `Membership.coordinatorId`. Three jobs in one script:

1. **Day-one conformance.** The rule only applies itself to people whose coordinator is edited after
   deploy; run this once so the documented invariant is true for everyone immediately.
2. **Drift repair.** `setMemberCoordinator` writes the membership first and the ledger second (that
   order is deliberate — the reverse would let every subsequent knock add more drift). If a ledger
   write ever fails, this closes the gap. Compensation is a **re-run, not a rollback**.
3. **The gate fix** above.

It calls the same `restampLedgerCoordinator` the routes call — an audit that can be wrong in the same
way as the thing it audits is worth nothing. Idempotent: a second run reports 0 everywhere.

**Review the `--preflight` output before applying.** It names every person and every door count, and
those team numbers *will* move. Nothing else moves: campaign totals, coverage, rates and invoices are
untouched, because billing is team-blind.

[`lockAccountDeletion.js`](../server/src/utils/lockAccountDeletion.js) takes the email as a bare positional
argument (not just `--email=`) because the Heroku web console is a single text box and `npm run x -- --flag
y` quoting is a footgun there.

## Why `autoIndex` is off in production

[`config/db.js`](../server/src/config/db.js) disables `autoIndex` outside development. Mongoose would
otherwise attempt to build every schema index on every boot; on large collections (`Household`,
`CanvassActivity`, `Voter`) that is a foreground build that can stall the database mid-deploy. The trade is
explicit: **new indexes never appear on their own** — [`buildIndexes.js`](../server/src/migrations/buildIndexes.js)
must be run with `--apply` on any release that adds one. Forgetting it doesn't break correctness, it just
means the new queries do collection scans — *except* for `unique` indexes, which are not enforced at all
until they're built.
