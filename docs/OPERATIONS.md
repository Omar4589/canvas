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
| `purge-deleted-identities` | Daily 03:17 UTC | Removes the retained name of anyone whose account was deleted >180 days ago — by themselves, by an org admin, or by Doorline — and unpairs that account from FbTime (its FbTime links go, and nothing is left tying it to an FbTime person). It first settles any account deletion a crash left half-done (the same sweep as the 15-minute job below), and it never purges a record whose account isn't actually deleted — it skips and counts those. One record at a time: a record that fails stays due for the next night while the rest are purged, and a run with a failure doesn't count as a success — so a record that keeps failing turns the health check below red. |
| `deletion-lock-sweep` | Every 15 minutes (:07, :22, :37, :52) | **Settles an account deletion that a crash interrupted** (since 2026-10-24): finishes one that died after the account was scrubbed, or switches back on the memberships of one that died before it and frees the account for another try. Also re-scrubs the email log for accounts deleted in the last week, for mail logged after the deletion. Quiet unless it did something. Writes no run record of its own — the nightly purge runs the same sweep and records its counts — and the retention health banner deliberately doesn't watch it. Cron override: `DELETION_SWEEP_CRON`. |
| `platform-stats-reconcile` | Daily 03:47 UTC | Recomputes the Control Room lifetime counters' **live** bucket from real rows and stamps "last reconciled" (drift-corrector; **not** a retention job — the retention health banner deliberately does not watch it), **and rebuilds the `PlatformDaily` trend series in full from the same rows** (the sparklines' data; same job, no extra cron). Cron override: `PLATFORM_STATS_CRON`. Also runnable on demand from the Control Room's **Reconcile now** button (`POST /super-admin/access/platform-stats/reconcile` — same idempotent recompute). |
| `reconcile-campaign-stats` | Daily 04:07 UTC | **Re-checks every campaign's stored all-time counts** (`Campaign.stats` — what the campaigns list and the All-time dashboards read) against the knock and survey records, and writes back the true numbers. Same code as `npm run migrate:campaign-stats -- --apply`. When it had to repair something, the worker log carries a warning naming each campaign and count; a campaign that needs repairing every night is a bug in the counters. Cron override: `CAMPAIGN_STATS_CRON`. Not a retention job; the retention health banner deliberately does not watch it. |
| `retention-triggers` | Daily 04:41 UTC | **Warns, then condemns organizations**: emails deletion warnings ~30 days ahead (wind-down + dormancy), then hands each due org (wind-down, dormancy, due deletion requests) to **`org-delete-queue`** — one job per org, so a failure is isolated to that org instead of aborting the sweep, and the worker does the destroying minutes later. **Wind-down and dormancy never delete an unwarned org**: the purge requires a delivery-verified warning marker plus a grace period, so while email is unconfigured those two purges simply hold (data kept, never deleted unwarned). Delete-on-request is exempt — it *is* the customer's instruction. The run receipt reports `enqueued`; `purged` is 0 because this job no longer destroys anything itself. |
| `client-report-row-sweep` | Daily 05:31 UTC | **Deletes client-report map rows nothing needs any more** (since the client reports upgrade, 2026-10-24): the door pins and area cells of reports that were deleted, of reports whose map is off (which includes old drafts from before the upgrade, whose maps are never shown), of builds that died or were replaced, and pre-upgrade rows of reports that have been rebuilt since. It never touches a report's live map, a build still running or new numbers waiting for review, and nothing a build started after the sweep read. Logs `[maintenance] client-report-row-sweep: N orphan, N map-off, N legacy, N stale row(s) over N report(s)`. Since 2026-10-25 it first re-checks the duplicate-report guard's index and builds it if it's missing (see *Release: client reports, simpler start*; silent when it's there). Cron override: `CLIENT_REPORT_SWEEP_CRON`. Not a retention job; the retention health banner deliberately does not watch it. |
| `sweep-stale-imports` | Daily 05:53 UTC | **Fails stuck imports and deletes orphaned upload files.** Expires import jobs whose worker died mid-run (no heartbeat for minutes) with a clear failure message, then deletes the **raw uploaded voter files** left behind by finished, failed, or vanished imports older than 24h — a crashed import used to keep the complete uploaded file forever — plus stray worker temp files. Cron override: `IMPORT_SWEEP_CRON`. Not a retention job; the retention health banner deliberately does not watch it. |

**Check they're alive:** `GET /api/super-admin/access/health/retention`. It goes **RED** when the last
successful run is >48h old — because a silently-dead scheduled job is indistinguishable from one that
had nothing to do, unless something is counting.

### The retention windows (yours to change, no deploy needed)

| Setting | Default | Meaning |
| --- | --- | --- |
| `RETENTION_WIND_DOWN_DAYS` | **60** | After a subscription is canceled, the customer has this long to export. Then their data is deleted. |
| `RETENTION_DORMANCY_MONTHS` | **30** | No canvassing activity for this long → a non-paying (canceled/suspended) org is purged. A single knock resets the clock (the clock *is* the last knock). |
| `RETENTION_DELETE_SLA_DAYS` | **30** | A deletion request is scheduled this far out — the window in which a mistaken or coerced request can be cancelled. |
| `DELETED_IDENTITY_RETENTION_DAYS` | **180** | How long a deleted user's name is kept for fraud attribution. **Never set it below 121:** the purge's FbTime step relies on a deleted account's shifts being older than FbTime's 120-day re-pull by the time it runs ([FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md) → *Account deletion and the 180-day purge*). |
| `SUPPORT_GRANT_HOURS` | **4** | How long a support access session lasts. |
| `RETENTION_WARN_LEAD_DAYS` | **30** | How far ahead of a wind-down/dormancy deletion the warning email goes out. |
| `RETENTION_WARN_GRACE_DAYS` | **14** | Minimum time between the warning actually being delivered and the deletion — even for an org already past its deadline when first warned. |
| `ORG_DELETE_JOB_CONCURRENCY` | **1** | How many organization cascades the worker runs at once. Leave at 1 — it is the heaviest job on that dyno, and two at once starve each other's heartbeat into looking dead. |
| `ORG_DELETE_ENQUEUE_TIMEOUT_MS` | **5000** | How long a delete request waits on Redis before answering 503 rather than hanging. |
| `ORG_DELETE_CHUNK` | **5000** | Batch size for the identity purge inside the org cascade. A test-only knob; there is no reason to change it in production. |
| `CAMPAIGN_DELETE_JOB_CONCURRENCY` | **1** | Same, for campaign deletes. |
| `CLIENT_REPORT_JOB_CONCURRENCY` | **2** | How many client-report builds (a draft's numbers, Refresh numbers, Switch to areas) the worker runs at once, on their own `client-report-queue`. Each build holds one batch of households in memory, whatever the campaign's size, and a build waiting for another change on its campaign (an answer edit, an unknock) gives up its slot while it waits. |
| `CLIENT_REPORT_BATCH` | **2000** | How many households a client-report build reads at a time. Smaller uses less memory and takes longer; there is no reason to change it in production. |
| `CLIENT_REPORT_MAP_CACHE_MB` | **64** | How much of the **web** dyno's memory may hold ready-made client report maps (since code review round 1 of the client reports upgrade, 2026-10-24). A map is built once and kept compressed, so a client opening a big report again, or several people opening it at once, doesn't rebuild it; each copy is served for at most 15 minutes and dropped from memory within about 16 (a sweep runs every minute). `0` turns it off. Leave it at 64 unless the web dyno runs short of memory. Holds door positions, statuses and answers already on the client's map, never addresses ([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 38(j)). |

### Email (Resend) — the dormant/live switch

Transactional email (password resets, invites, org/campaign notices, support-grant notices,
deletion warnings) is **dormant until BOTH vars are set** — no key, no network calls, sends are
logged only:

| Setting | Meaning |
| --- | --- |
| `RESEND_API_KEY` | The Resend API key. **Setting this is the go-live switch — see the gate below.** |
| `MAIL_FROM` | The sender, e.g. `Doorline <notifications@doorline.app>`. Both vars required; key without from stays dormant (loud warning in the logs). |
| `MOBILE_INSTALL_URL_IOS` / `_ANDROID` | Where a **canvasser's invite email** sends them to INSTALL the app. Defaults to the public store listings. Env-overridable because email can't be recalled — a wrong link is fixed for all future mail from the Heroku dashboard (Settings → Config Vars), no deploy. **Distinct from `MOBILE_STORE_URL_IOS`/`_ANDROID`** ([mobile/README.md](../mobile/README.md)), which override where the in-app *update* button sends someone who already has the app. Both stores went public 2026-07-28: both install vars are set, `MOBILE_STORE_URL_IOS` is now a no-op, and `MOBILE_STORE_URL_ANDROID` stays **set** to the `com.doorline.app` listing while the legacy `com.canvassapp.mobile` fleet still exists, because that app's built-in update link points at the listing being retired. |
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

When someone taps **Delete my account** — or, since 2026-10-24, an org admin deletes a member's account —
we immediately destroy their login, name, email, phone and password. But **their knocks and GPS pins stay
with the campaign** — that's the organization's data, and removing it would change your counts and your
bill.

That creates a problem: if we erased their name *everywhere*, you'd be left with a pile of GPS pins
belonging to nobody. Someone could fake a day of doors, delete their account, and you'd have no way to
prove who did it. So we keep **one copy of their name** — never their email or phone — shown only to the
organizations whose records carry them, on their reports, team labels, GPS audit and exports, so you can
still say *"those pins were Dave."*

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

### Repair a round's door mirror after cutting a future round

`Household.turfId`/`walkOrder` mirror the **latest cut anywhere in the campaign**, so cutting a
draft round (the walk-packet prep flow) moves them off the live round's books. Book membership,
assignments and knock history are untouched — but the phone's list-view sort reads `walkOrder`,
so restore the mirror after any cut of a non-live round:

```
npm run remirror:pass -- --pass <livePassId>            # dry run: counts, writes nothing
npm run remirror:pass -- --pass <livePassId> --apply
```

Idempotent — it rewrites each member door's mirror from its own book's stored order, only for
the named pass's published books. (The admin cut map and Add-as-new-book no longer read the
mirror at all, so they need no repair.)

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

### Clean up stuck imports and orphaned upload files (once after the import-fix release; safe anytime)

The nightly `sweep-stale-imports` job (table above) handles this from now on, but the orphans it
exists to prevent **accumulated before the fix**: every import that ever crashed left its complete
uploaded voter file sitting in the database with nothing to delete it. Run this once after deploying
the release to purge that backlog immediately instead of waiting for the night:

```
npm run sweep:raw-imports
```

It prints how many stuck import jobs it expired and how many orphaned raw uploads it deleted. It's the
same code the nightly job runs — idempotent, safe to run whenever an import looks wedged and you don't
want to wait.

> That release also adds a database index (`ImportJob {status, heartbeatAt}` — what the sweep and the
> stuck-import timeout query). Indexes never build themselves in production, so the deploy needs
> `npm run migrate:build-indexes -- --apply` (next section).

### Deploying the leading-zero matching release (October 2026)

Server plus web in the one deploy, as always; no migration, no index build, nothing for the phones.
Before: `npm run audit:mobile-api` from the repo root (expect the three changed routers to read
"mobile calls 0 endpoints"). After: `npm run audit:voter-id-spellings` from the Run console once, as
the baseline. Rollback is a plain dashboard rollback; the new fields on upload records are inert under
the previous code. What changes for admins, in one line each: uploads match voter IDs with or without
leading zeros; Early Voting and Do Not Contact show and let you change the matched column; Do Not
Contact asks which state the list is for; a voter file that lost its zeros is refused at import instead
of doubling the campaign.

### Check voter IDs for leading-zero trouble (read-only, safe any time)

Some states write voter IDs with zeros in front (Georgia: `08719967`), and Excel strips them the
moment a file is opened and saved. The app compares IDs as exact text, so a list that lost its zeros
matches nobody and a re-sent voter file that lost them imports everyone a second time. This tells you,
per campaign, whether that has happened and which campaigns it *could* happen to. It changes nothing.

```
npm run audit:voter-id-spellings                    # every organization
npm run audit:voter-id-spellings -- --org <slug>    # one organization
```

Reading it: **Exposure per campaign** says how each campaign's IDs are spelled, and so whether a
list from another source could spell them differently. **exposed: padded** means the IDs start with 0
(a list that lost its zeros would not match); **exposed: unpadded** means plain sequential numbers of
several lengths with no zeros (a list that pads them, such as the state's own file, would not match);
**safe** means one width with no zeros, or IDs that carry letters, so a spelling cannot differ;
**CHECK** means padded IDs with some shorter rows, the sign that rows already lost their zeros. A
campaign with no voters yet is listed as such. The sections below are findings, and a clean run says
so in one line. **STOP** marks the same digits in campaigns in two different states (two people; never
merge), **CHECK** marks a name or birth date that differs. What each finding means and what to do
about it: [PROPOSAL_VOTER_ID_KEYS.md](PROPOSAL_VOTER_ID_KEYS.md).

### Release "Not a target voter" — and the switch that withdraws it (October 2026)

**Not a target voter** is a door button for when a canvasser talks to someone who isn't one of the
voters on the list and won't give their name. It is off on every campaign until an org admin turns it
on, and no org admin can until Doorline **releases** it — which you do here, once the app update is on
the phones. What it is and how it counts: [PROPOSAL_NOT_TARGET_OUTCOME.md](PROPOSAL_NOT_TARGET_OUTCOME.md).

**The release is one config var, `OPT_IN_OUTCOMES`** (**Settings ▸ Reveal Config Vars**). The server
checks it on every request, and saving it restarts the dynos — no deploy.

| `OPT_IN_OUTCOMES` | What happens |
| --- | --- |
| **Unset** — how the deploy ships | Not released. App Customization has no switch for it, nobody can turn it on, no phone shows the button, and a tap that arrives anyway is refused. |
| **`not_target`** | Released. App Customization gains an **Off until you turn it on** section on survey campaigns, which only org admins can switch. No campaign has the button until one of them does. |
| **Unset again**, after a release | **The Doorline-wide off switch.** Every campaign's button goes — on an online phone within about 30 seconds of being on the map, on an offline one when it reconnects — and new taps are refused. Doors already recorded keep counting, a tap made offline still syncs and counts, and every campaign keeps its setting: an org admin sees **Paused by Doorline** and can still turn it off. |

**Setting it again brings the button back on every campaign still set on, all at once. Tell org admins
before you re-release.**

**To release it, in this order.** Before you start, confirm item 25 in
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): it needs no policy text change, but it is yours to sign
off before the production deploy. If production does not yet run `4d1276a` (the campaign Voters tab; the
**Activity** tab shows the commit production runs), this deploy ships that release too: confirm item 24
as well, and in step 1 run the audit against the commit production runs instead of `4d1276a`.

1. **Deploy server and web from `main`** (**Deploy** tab ▸ **Manual deploy**) with `OPT_IN_OUTCOMES`
   unset. The button ships dormant; everything else is live at once. Things customers can notice
   that day: Contact % counts each door once per round, so a re-downloaded per-round file can read
   lower than a copy sent earlier — only where one canvasser surveyed a door and another recorded
   Refused there in the same round; the Timeline's **No solicit** column, which has always read 0,
   starts showing each canvasser's real count; the web campaign History shows an Add-person policy
   change in plain words instead of the raw setting; and two downloads gain a column for every org (`canvassers.csv` ends with
   **Not a target**, the Door Outcomes download with **Offline**). No index build, no
   client-version bump: on your computer, `npm run audit:mobile-api -- 4d1276a` from the repo root
   flags the phone-facing route files this release touches, and none of them removes or renames
   anything the shipped app reads.

2. **Required, straight after the deploy**, in the Run console:

   ```
   npm run migrate:campaign-stats              # dry run — lists what it would change, writes nothing
   npm run migrate:campaign-stats -- --apply   # recompute and save every campaign's stored counts
   ```

   The release adds a stored count of the doors where someone answered, which existing campaigns
   don't have yet. **The dry run should list every campaign that had a survey or refusal before the
   deploy, each naming `contactKnockCount` and nothing else:**

   ```
   DRIFTED   <campaign name> — contactKnockCount 0→<N>
   ```

   That is the new count being filled in for the first time, so run `--apply`. A campaign whose
   surveys and refusals all came after the deploy is already exact and isn't listed, and neither is
   one an office action has recomputed since (a desk restrict or an unknock, for example). If
   canvassers have recorded doors since the deploy, the number before the arrow may not be 0 — it can even be below
   zero — and it means the same thing. **Any other count named on a line is real drift:** `--apply`
   repairs it too, but write down which campaign and count, and look into it. Afterwards, a re-run of the dry run prints
   `All campaign stats match the ledgers. Nothing to do.` (All three were checked from the repo root
   against a throwaway database set up the way the deploy leaves production.) No screen reads the new
   count, so nobody sees a wrong number while it waits; skip this and the nightly
   `reconcile-campaign-stats` job (04:07 UTC, in the jobs table above) fills it in at its next run, with
   a warning in the worker log naming every campaign it repaired.

3. **Ship the phone update.** On your computer, in `mobile/`: `npm run ota:check`, then
   `npm run ota:staging`; check it on TestFlight and Play internal; then `npm run ota:production` from
   `main`. It is JavaScript plus one new map-pin image — no store build. The staging apps talk to
   production, where the button isn't released yet, so it can't appear there. What you can check, on a
   test campaign: changing a door's result now asks first ("Change this door's result?"), and turning an
   existing outcome off on App Customization takes its button off a phone within about 30 seconds of the
   map being open.

4. **Before releasing, make sure every phone either has the update or is being told to get one.** Give
   the production update time to land — a phone downloads it the next time the app is opened or
   brought back, then runs it from the fresh start after that, or straight away if someone accepts the
   **Restart** the app then offers (never shown on a door or survey screen). Then check the builds that
   update can **never** reach, however long you wait: builds on an older fingerprint, the `playorg`
   channel, and the retired `com.canvassapp.mobile` app (their runtime versions: `eas build:list`, the
   expo.dev build pages, or *Where things stood at the lane split* in
   [mobile/README.md](../mobile/README.md)). Open this for each one (`platform=ios` for an iPhone build):

   ```
   https://api.doorline.app/api/build-status?platform=android&runtimeVersion=<runtime version>
   ```

   Every one must answer `"status":"outdated"`. If any answers `ok`, narrow
   `MOBILE_CURRENT_RUNTIME_ANDROID` / `MOBILE_CURRENT_RUNTIME_IOS` to the runtime versions of the current
   production and staging builds (an unset var answers `ok` for every build), so those phones get the
   existing soft "update available" nag. **Before narrowing the Android list, make sure
   `MOBILE_STORE_URL_ANDROID` is set** (it should already be) to the `com.doorline.app` listing,
   `https://play.google.com/store/apps/details?id=com.doorline.app` — without it the nag sends the legacy
   app's users back to the listing being retired (mobile/README.md). Keep `MOBILE_UPDATE_MODE` on `soft`:
   `hard` blocks the whole app, and whatever the legacy app has queued offline is lost if people stop
   opening it. This is why the release waits: an old build draws a teammate's Not a target voter door
   as an unknocked (near-black) house labelled "Unknown".

5. **Release:** set `OPT_IN_OUTCOMES` to `not_target` (**Settings ▸ Reveal Config Vars**). The section
   appears in every org; only org admins can switch it.

**Roll forward only, once any campaign has used it.** After the first Not a target voter door is
recorded, never roll the server back past this release (**Activity** tab ▸ *Roll back to here*): the
phones' Not a target voter taps would be refused and any waiting in an offline queue thrown away; older
code doesn't count those doors as knocked; and a release old enough not to know the status fails any
save of those doors — even an unrelated pin fix, whose error then holds up that lead's offline queue.
To take the button away, unset `OPT_IN_OUTCOMES` and fix forward.

### Release: homes that share a map spot are placed by address (October 2026)

Imports now look up the homes a voter file stamped with one shared coordinate, and place each one by its
own address ([IMPORTS.md](IMPORTS.md) → *Homes that share a map spot with other addresses*). Nothing runs
by itself after the deploy; do these in order:

1. **Build the new index** (Run console). The Pin Fixes list and its sidebar badge read it:

   ```
   npm run migrate:build-indexes -- --apply
   ```

2. **Check two config vars** (Heroku dashboard → Settings → Reveal Config Vars): `GEOCODE_ENABLED` is
   `true` and `GEOCODIO_API_KEY` is set. With either missing, imports still mark these homes and list them
   in Pin Fixes, but look nothing up.
3. **Import the Nye file again** from the campaign's Import page. Its status reads **Checking map pins**
   while it works, and the line under the file then says how many homes were placed by address, how many
   were confirmed at their spot, and how many wait in Pin Fixes.
4. **Leads work Pin Fixes** until it's empty for Nye. Since Pin Fixes at scale (below), start with the cards
   at the top: **Look up by address** on each card, **Start checking** the approximate pins, **Place along
   the street** for the rest, and **Set aside** any home nobody can place.
5. **Turf.** If **Remove apartments** was used on the round before this release, press **Re-include**, use
   Remove apartments again (it now takes only real apartments), then cut.

**If the line under the file says the pins weren't placed, or weren't checked:** import the same file again.
Nothing already placed is undone, and an address already looked up is answered from the cache for free.

`PIN_PLACEMENT_MAX_HOMES` (config var, default 25,000) is the most homes one import will look up; any more
stay marked in Pin Fixes, and importing the file again looks up the rest.

### Release: Pin Fixes at scale (October 2026)

Imports refuse coordinates that can't be real (0,0, outside the state) and catch pins far from their
street; the lookup uses one answer rule everywhere and recognises condo complexes; homes nobody can place
wait at a holding spot instead of being dropped; Pin Fixes groups its work by cause with **Look up by
address**, **Place along the street** and **Set aside**; the cut leaves flagged homes out unless told
otherwise ([IMPORTS.md](IMPORTS.md), [MAPS.md](MAPS.md), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)).
Everything is additive: no new index, no client-version bump, no store build. In order:

1. **Check two config vars** (Heroku dashboard → Settings → Reveal Config Vars): `GEOCODE_ENABLED` is
   `true` and `GEOCODIO_API_KEY` is set. Optional: `PIN_INTERP_MIN_ACCURACY` (the confidence an estimate
   needs to replace a shared or far pin; default 0.8 — step 4 measures it).
2. **Deploy server and web from `main`**, outside field hours.
3. **Run console — confirm there is nothing to build:**

   ```
   npm run migrate:build-indexes
   ```

   It is a dry run; it must report nothing new.
4. **Run console — measure the estimates once** (about thirty cents of lookups; it looks up a sample of the
   campaign's ordinary vendor pins and prints how far Geocodio's answers land from them, by answer type,
   with the street estimates split at the confidence floor):

   ```
   npm run pins:measure-estimates -- --campaign=<campaignId> --sample=300
   ```

   If the 90th-percentile error at confidence 0.8 and above is over about 60 m (200 ft), set
   `PIN_INTERP_MIN_ACCURACY` higher in the dashboard; otherwise leave the default.
5. **In Pin Fixes, per campaign with a backlog:** **Look up by address** on the *Share one spot* card (the
   complexes become one row each, and a 0,0 home with an answer leaves the ocean); that first lookup also
   marks far homes campaign-wide, so click **Look up by address** on the *Pinned far* card next. Then **Start
   checking** the approximate pins, **Place along the street** for what remains, **Set aside** the ones
   nobody can place, and cut with **Leave out N homes without a reliable map spot** ticked.

**If a lookup says another pin check is running or couldn't finish:** click **Look up by address** again in a
minute. Marks stand, and an address already looked up is free.

### Release "Door counts to FbTime" — and the switch that stops it (October 2026)

**Door counts to FbTime** sends each linked canvasser's doors per day to the customer's own FbTime, so
FbTime's doors-per-hour page fills itself. It is off in every organization until an org admin turns it
on, and no org admin can until Doorline **releases** it — which you do here, last. What it is and how it
behaves: [FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md); the design and the owner's rulings:
[PROPOSAL_FBTIME_DOOR_COUNTS.md](PROPOSAL_FBTIME_DOOR_COUNTS.md).

**The release is one config var, `FBTIME_DOOR_COUNTS`** (**Settings ▸ Reveal Config Vars**). The server
reads it every time it needs it, and saving it restarts the dynos — no deploy. **Never name it to
customers.**

| `FBTIME_DOOR_COUNTS` | What happens |
| --- | --- |
| **Unset** — how the deploy ships | Not released. No **Door counts to FbTime** card anywhere, nobody can turn it on, nothing is sent and nothing is cleared. The rest of the release — the account-deletion fixes, and keeping a returning canvasser's old hours measured — is live regardless. |
| **`on`** (`true` or `1` work too, in any case) | Released. Every connected organization's Integrations page shows the card, Off; only that organization's own admin can turn it on — Doorline staff under a support session are refused, by design. |
| **Unset again**, after a release | **The Doorline-wide off switch.** Every organization's sends and clears stop at once; a card that was on reads **Paused** ("Doorline has paused door counts for everyone"), and its admin can still turn it off. What was already sent stays on FbTime. Setting it again resumes every organization still switched on — tell their admins first. |

**To release it, in this order:**

1. **Deploy server and web from `main`** (**Deploy** tab ▸ **Manual deploy**) with the var unset. Before
   that, on your computer, `npm run audit:mobile-api` from the repo root: it flags the campaigns,
   integrations and memberships route files — all additive for the phone (the door-count block on
   `GET /admin/integrations/fbtime`, a `kept` flag on the member list and the profile stats), except that a
   campaign time zone outside the listed US zones is now refused, which no screen offers. No index build,
   no client-version bump.
2. **Required, straight after the deploy**, in the Run console:

   ```
   npm run migrate:fbtime-deletion-gaps              # dry run — counts per step, writes nothing
   npm run migrate:fbtime-deletion-gaps -- --apply   # writes
   npm run migrate:fbtime-deletion-gaps              # again: every count should now read 0
   ```

   It removes emails that outlived deleted accounts — the copy on their FbTime links and the copy in the
   link history — and unpairs from FbTime any account already past its 180-day purge (expected 0). Keep
   the first run's counts: the privacy record's entry for this release is completed from them. Safe to
   re-run any time; a record it couldn't process is printed and a re-run retries it. (All three were run
   from the repo root against a throwaway database seeded with pre-fix rows: the dry run counted them,
   `--apply` cleared them, the re-run read 0.)
3. **The owner approves the privacy wording** — the door-count sentence for the Privacy Policy and DPA §6
   ([PROPOSAL_FBTIME_DOOR_COUNTS.md](PROPOSAL_FBTIME_DOOR_COUNTS.md) §M) — and the live Privacy Policy is
   updated. Until then they say Doorline sends FbTime only date ranges. (Approving it before step 1 lets it
   ship in the same deploy.)
4. **FbTime's side is deployed** ("Doorline decides" and the four rules that followed it — FbTimeApp
   commit 561327a, deployed 2026-10-09). Doorline checks for it by itself — FbTime's `/ping` must list
   `doors:reported-wins`, or nothing is sent — but confirm that FbTime's key-creation text and its
   doors-per-hour help describe the new rules; no check can see stale wording.
5. **Check, then set the var.** Open the live Privacy Policy and confirm the door-count sentence, and
   confirm `docs/DPA.md` §6 on `main`. Then **Settings ▸ Reveal Config Vars** → `FBTIME_DOOR_COUNTS` = `on`
   (the dynos restart). Confirm the card appears on an organization's Integrations page.
6. **Ship the phone copy** — the FbTime row under **More** names the door-count state. Check what else is
   unreleased under `mobile/` on `main` (`ota:production` publishes the whole tree), then `npm run
   ota:staging` from `mobile/`, check it, then `npm run ota:production` from `main`. Older apps simply
   ignore the new fields.

Each organization then turns it on itself — an org admin who is a member of the organization: a key from
FbTime with **Also let it fill in door counts** ticked → **Integrations → Settings → Replace key** → **Turn
on** on the card → revoke the old key in FbTime ([FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md) → *Turning
door counts on*). The card says **Sending** within a few minutes.

**Run exactly one `worker` dyno** (**Resources** tab). The maintenance queue — the FbTime hours sync, with
the door counts that ride on it — runs one job at a time on one worker. A second worker dyno could run two
door-count passes for the same organization at once; the checks before each request narrow what that
could do, but don't remove it.

**Two kill switches:** unset `FBTIME_DOOR_COUNTS` (every organization at once, no deploy), or **Turn off**
on one organization's card.

### Release: the phone keeps running after an error — and the switch that turns it off (October 2026)

**What ships:** when something a canvasser taps fails, the phone app no longer goes to a flat gray screen
(Android) or closes (iPhone). It keeps running and shows a one-line *"Something went wrong"* banner with
**Restart**; a door screen that crashes is replaced by its own card; errors pouring in off the doors bring
up the full crash screen with **Restart Doorline** first. What it is and how it behaves:
[CANVASSER_APP.md](CANVASSER_APP.md) → *When something goes wrong* and *Error recovery*; the design:
[PROPOSAL_ERROR_RECOVERY.md](PROPOSAL_ERROR_RECOVERY.md). JavaScript only — no store build.

**The off switch is one config var, `MOBILE_ERROR_RECOVERY`** (**Settings ▸ Reveal Config Vars**). The
server reads it on every request; saving it restarts the dynos — no deploy.

| `MOBILE_ERROR_RECOVERY` | What happens |
| --- | --- |
| **Unset** — how the deploy ships | On. |
| **`off`** (any case) | Phones stop catching the JavaScript errors that escape a tap or a timer, and those go back to the old behavior: no banner, no loop takeover. A phone picks it up when Doorline is opened or brought back to the screen (at most once every 15 minutes), or within four hours while it stays on screen, and remembers it across restarts. A phone sitting on a crash screen doesn't check until its Restart or Reset is tapped. The door cards, the crash screen for a screen that fails to draw, the time-zone fallback and the map guards stay — they are ordinary code, not behind the switch. |
| **Unset again** | On again, on the same schedule. |

**To release it, in this order:**

1. **Deploy server and web from `main`** (**Deploy** tab ▸ **Manual deploy**), so the switch exists before
   any phone has the new code. `npm run audit:mobile-api` flags `server/src/routes/public/buildStatus.js` —
   one added field (`errorRecovery`), which older apps ignore. No index build, no client-version bump. The
   Help Center article *The phone app says "Something went wrong" — did I lose anything?* goes live with this
   deploy.
2. **Staging:** `npm run ota:staging` from `mobile/`. On a TestFlight or Play-internal phone, long-press the
   build stamp on **Profile** and run the test rows with the log open ([mobile/README.md](../mobile/README.md)
   → *Reading it off a phone*; the full checklist is the proposal's §E).
3. **Production:** `npm run ota:production` from `mobile/` on `main` — `ota:production` publishes the whole
   tree, so check what else is unreleased under `mobile/` first. For a cautious first day:
   `npm run ota:production -- --rollout-percentage=20` (the `--` is what passes the flag through; without
   it the update goes to everyone). Then, from `mobile/`, raise it to everyone with
   `eas update:edit <group id> --rollout-percentage 100`, or back it out with
   `eas update:revert-update-rollout --group <group id>` — the publish prints the group id, and
   `eas update:list --branch production` lists it. Once per platform if the publish made one group each.

**If something looks wrong after release:** set `MOBILE_ERROR_RECOVERY` = `off` first (no deploy; the
server takes it in seconds, and phones as described above). To take the phone code back out entirely, republish the previous update ([mobile/README.md](../mobile/README.md)
→ *Undoing an OTA*).

### Release: Edit survey answers on Door Outcomes (October 2026)

Door Outcomes gains **Edit answers…**: an org admin takes out, changes or clears single survey answers
while every voter stays surveyed, priced in a review first and undone as one change; every admin edit,
there or on the voter profile, now keeps the earlier answers ([CAMPAIGNS.md](CAMPAIGNS.md),
[SURVEYS.md](SURVEYS.md) §N, [VOTERS.md](VOTERS.md)). The six correction-safety fixes ship in the same
deploy, and so do the fixes from the code reviews that followed it (the follow-up to `589c1c0`). No
config var, no client-version bump. In order:

1. **Deploy server and web from `main`**, outside field hours. The worker restarts with the new
   `answer-edit-queue` and builds the two answer-edit collections' indexes itself at boot.
2. **Run console — the dry run, then the build** (it lists the two new indexes on the earlier-answer
   copies, which a large undo or a change's Details page reads, and the four on the new conversion
   records Restore reads):

   ```
   npm run migrate:build-indexes
   npm run migrate:build-indexes -- --apply
   ```

3. **Run console — record older removals, once.** Restore now reads which visits a Surveyed → Not
   home change took answers from out of the change's own record, and which visits an undone unknock
   could not put back; removals made before this deploy get theirs from what they left behind. It also
   marks an older unknock that stopped part-way (one that took entries or answers off the record before
   it stopped, where no later unknock or survey conversion took them) as stopped part-way, so its
   **Undo** is offered, and lists it in Campaign History at the moment it began. Dry run first (it says
   how many of each it would record or mark — the same number the real run marks), then for real —
   harmless to run again (a second run also writes any History line a first run was cut off before
   writing):

   ```
   npm run migrate:removal-strikes
   npm run migrate:removal-strikes -- --apply
   ```

4. **Run console — tidy what the first build stored, once.** If `589c1c0` ran in production, its
   answer-edit runs may hold a voter's own written words in their pick counts and canvassers' names in
   their undo notes; this rewrites both (it changes nothing a screen relies on). Dry run, then for real
   — harmless when there is nothing to tidy:

   ```
   npm run repair:answer-edit-words
   npm run repair:answer-edit-words -- --apply
   ```

5. **Phone, when convenient:** the History sentence, the *Edited by* line on the map's door and ping
   sheets, "—" for an empty pick-several, the response detail's *Can't restore here* hint, that screen
   refreshing after a refused Restore, and that screen saying who set earlier answers aside and how
   (*Removed by*, *Changed by*, *Set aside by* — not *Overwritten by another canvasser*) ride the next
   over-the-air update — on your machine, in
   `mobile/`: `npm run ota:staging`, check it on a staging build, then `npm run ota:production` from
   `main`. Released phones already work with this server.

**Client report drafts** show the builder's internal notes (answers entered at a desk, answers edited)
after their next **Recompute**; the notes had never appeared before this release. Published reports keep
what they froze.

**Nothing to run for the rest — the worker does it.** The same deploy adds a nightly cleanup at 05:37,
*the nightly deleted-round snapshot sweep*: snapshots of rounds already deleted are removed (deleting a
round now removes its snapshots itself). And the nightly identity purge now also takes a deleted
canvasser's name off Door Outcomes change lines once their 180 days are up — including for accounts
purged before this release, on its first run. Both log what they did on the worker
(`[maintenance] sweep-orphan-snapshots: …`, `[maintenance] purge-deleted-identities: … names off run lines N`).

### Release: admins can delete a member's account (October 2026)

An org admin can now delete a member's account from the person's profile, on the web and the phone,
behind two confirmations ([USERS.md](USERS.md) → *Deleting a member's account*). The same deploy lets a
paused organization still delete an account, **Deactivate** and **Remove from org**
([BILLING.md](BILLING.md)); makes Remove from org of someone with billing access need billing access;
keeps a deleted person's name on eight more report screens for the 180 days; and stops the email send log
showing a deleted person's address on their own mail ([EMAIL.md](EMAIL.md)). No config var, no index
build, no client-version bump, no native build. The phone's clean-up of a deleted account's unsent doors is
**not** in this release; it comes after Election Day. The leak fix and the staff-roster fix it builds on
are already committed (`aa01027`). In order:

1. **Before committing, on the combined working tree:** `npm run audit:mobile-api` (it reads uncommitted
   files, so it must run before the commit), read its flagged diffs plus the `entitlement.js` and
   `middleware/auth.js` diffs by hand, and run every suite CI runs. Then the one `git add -A` commit, with
   the sessions' messages combined.
2. **Deploy server and web from `main`** (Heroku dashboard → **Deploy → Manual deploy**). The worker
   registers the new 15-minute `deletion-lock-sweep` job itself when it starts.
3. **Run console — take deleted people's addresses off their own past mail, once.** Accounts deleted before
   this release still show their address on their own invites, password resets and added-to notices in the
   send log (Super-admin ▸ Emails). Dry run first — it counts the accounts and rows — then for real.
   Harmless to run again:

   ```
   npm run migrate:scrub-deleted-email-log
   npm run migrate:scrub-deleted-email-log -- --apply
   ```

   Run any other session's console steps in their own order.
4. **Phone, staging first** — the delete sheet rides an over-the-air update. On your machine, in `mobile/`:
   check `git status --short mobile/` prints nothing (an update bundles whatever is on disk), then
   `npm run ota:staging`, then the staging check below on a staging build, then `git status --short
   mobile/` again, then `npm run ota:production` from `main`. Until a phone has the update, admins delete
   from the web; released phones keep working with this server.

**The staging check (the delete sheet only).** **Staging builds talk to production**, so this is a real
deletion. Never delete the store-review logins or the demo's review and background canvassers (if one is
deleted, re-run `npm run seed:demo -- --apply`).

1. As a break-glass super admin in the internal demo organization, add a throwaway canvasser to a demo
   campaign. Don't sign in as it on any phone.
2. On a staging phone, signed in as a demo-org admin who is **not** a review login (those are told
   "App-review demo logins can't delete accounts"): **More → Users** → the throwaway (from a campaign's
   list, **Manage profile ›** first) → **Account** → **More options** → **Delete account…**
3. The review names the person and says they have no door results or surveys on your records and will
   disappear from the Users list. (There is no "open the app with signal" line: that shows only for an
   account somebody has used, and this one never signed in.)
4. **Continue**, type a wrong email (**Delete permanently** stays grey), go **Back** (the field clears),
   then **Continue** again, type it right and delete.
5. The row is gone on the phone and on the web. Deleting the same person again from a profile still open
   elsewhere closes with "<Name> is no longer in your organization.", since an unused account's row is
   removed outright.
6. Do the delete on **both** an iPhone and an Android staging phone: the profile closes and the Users list
   comes back without flashing "User not found", with the deleted notice on it.
7. **Remove from org on the phone:** add a second throwaway to a demo campaign, open its profile →
   **Account** → **Remove from org** → **Remove**. The profile closes and the list says they're no longer
   in the organization; a quick double tap on the button still asks only once.

Don't try the leftover-doors behaviour here: in production it would put a door under the wrong account.

### Release: client reports upgrade (October 2026)

The Client Reports tab, its links and the client's pages, rebuilt ([CLIENT_PORTAL.md](CLIENT_PORTAL.md);
plan and *As built* in [PROPOSAL_CLIENT_REPORTS_UPGRADE.md](PROPOSAL_CLIENT_REPORTS_UPGRADE.md)): visibility
enforced on the server, numbers built on the worker, Publish that freezes the preview, Edit and Refresh
numbers on published reports, Take down, team reports, area view, hardened links, per-link opens, the
report logo and the tab's own History. A server deploy plus the web build; **no OTA, no client-version
bump, no config var to set** (the phone calls none of these routes, and its campaign History is
unchanged; the new settings above, `CLIENT_REPORT_MAP_CACHE_MB` included, are optional). In order:

1. **Before committing, on the combined working tree:** `npm run audit:mobile-api` (the campaign history
   route changed; its default response, which the phone reads, is the same as before).
2. **Deploy server and web from `main`** (Heroku dashboard → **Deploy → Manual deploy**). The web and the
   worker build the three new collections' indexes when they start (report series, area cells, report
   branding); the worker starts the new `client-report-queue` (2 builds at a time,
   `CLIENT_REPORT_JOB_CONCURRENCY`) and registers the nightly `client-report-row-sweep` (05:31 UTC) itself.
3. **Run console — the two new indexes on existing collections.** Dry run first; it should list
   `ClientReportMapPoint {"clientReportId":1,"snapshotId":1,"seq":1}` and `CampaignChange
   {"campaignId":1,"clientReportId":1}`. Then for real:

   ```
   npm run migrate:build-indexes
   npm run migrate:build-indexes -- --apply
   ```

4. **Run console — bring the existing reports and links up to date, once.** Dry run first, and read it:
   - Step 0 says how many surveys get their follow-up record and the survey version that record starts
     at, then names any survey with answers given under an older version (`0. surveys: … survey(s) with
     answers older than that version (those versions' conditions can't be known — the builder warns):
     …`). Doorline can't know what an old version's follow-up conditions were. The report builder warns
     wherever those answers could reach a map beside a hidden chart: *Before you publish* on a draft, and
     the **Worth a look** box on a published report. If a survey is listed, open that campaign's published
     client reports and look for the warning (take a question off the map with **Edit** if it could have
     been a follow-up of the hidden one).
   - Step 1 lists any already-made report whose builder had **every** survey question unticked (that used
     to show every chart; it now shows none).
   - Step 2 lists any walk-list name that matches a canvasser's name, for you to look at.
   - Steps 3 to 5 treat old **drafts** differently from published reports: a draft from before the
     release has no map until its numbers are built again, so its stored map rows lose their answers
     (step 5) and the nightly sweep deletes them; only published reports' map lists are narrowed (step 4).

   Steps 4 and 5 discard information (a narrowed map-question list; the stored map rows of reports whose
   map is off), so decide on step 1 before the real run. Then for real, adding `--keep-legacy-all` only if
   you decided to keep those reports' charts. If you add the flag after a run without it, step 1 says
   "charts only: its map answers were already discarded" next to a published report that already went
   through steps 3 to 5: its charts come back, its map answers can't. Harmless to run again:

   ```
   npm run migrate:client-report-visibility
   npm run migrate:client-report-visibility -- --apply
   npm run migrate:client-report-visibility -- --apply --keep-legacy-all
   ```

   (The last line instead of the second, not after it.) Everything works before this runs, so it can wait
   for a quiet moment; old reports' door details work from the first time their map is opened.

**Tell your users:** a draft made before this release needs its numbers built again before it can be
published (it starts when the draft is opened); a report unpublished under the old code is a draft and
comes back the same way; existing links keep working, and a link whose password turns out to be shorter
than 12 characters is flagged the next time it's used.

**The checks after it's live:** turn the map off on an existing published report (the client's page shows
no map); an existing link still unlocks and its report's map still shows door details; a team report beside
the Timeline's team numbers (a home both teams visited counts in both); a password change signs out an open
client tab; Take down and Put back up; Refresh numbers with an addition to the map.

### Release: automatic pause — and the switch that stops it (October 2026)

Doorline pauses a canvasser's recording when their doors come in faster than anyone could knock them,
emails the people the organization chose, and lays the doors out for review on the Audit page — it never
removes or hides a door ([AUDIT.md](AUDIT.md) → *Automatic pause*; design, real-data replay and the owner's
decisions in [PROPOSAL_PACE_PAUSE.md](PROPOSAL_PACE_PAUSE.md)). Server, web and an over-the-air phone
update. No native build and no client-version bump (every new field, endpoint and refusal code is an
addition). No index build of its own: the new collection's indexes build when the dynos start.

**The switch is one config var, `PACE_PAUSE`** (**Settings ▸ Reveal Config Vars**). The server reads it on
every request; saving it restarts the dynos — no deploy.

| `PACE_PAUSE` | What happens |
| --- | --- |
| **Unset** — how the deploy ships — or **`off`** | Nothing is judged and nobody is paused. The review screens and the Users-page card work; the card says *Automatic pause isn't running for your organization right now.* |
| **`orgs:<slug>,<slug>`** | Only those organizations, internal ones allowed — for the device check below. A mistyped slug does nothing, so check that organization's card no longer says it isn't running. |
| **`on`** | Every customer organization whose own setting is on (the default; a billing admin can turn theirs off). Doorline's internal organizations are never paused. |
| Anything else | Off, with one warning in the log. |

**The rule's numbers** are config vars too, all optional — leave them unset unless you decide to tune, and
try a change with the replay first (step 4): `PACE_DOOR_SEC` (15), `PACE_SURVEY_SEC` (45),
`PACE_TRAVEL_MPS` (11.2 m/s = 25 mph), `PACE_WINDOW` (20), `PACE_FAILS_TO_PAUSE` (8), `PACE_SAME_VISIT_SEC`
(600) — a value that isn't a positive number falls back to its default with a warning ([AUDIT.md](AUDIT.md)
§G.1); and `PACE_ALERT_SEND_GAP_MS` (600, the gap between alert emails; `0` sends them back to back).

**To release it, in this order:**

1. **Before committing, on the combined working tree:** every suite CI runs, and `npm run audit:mobile-api`
   with no argument. For this work it flags `routes/admin/pacePauses.js` (new), `routes/mobile/canvass.js`
   and `routes/mobile/bootstrap.js` (an added `pace` field, the new `GET /mobile/pace`, and the 403
   `PACE_PAUSED` refusal), `routes/admin/memberships.js` (a role change moves the pause count's restart
   point) and `routes/admin/reports.js` (an added `openPacePauses`): all additions.
2. **Deploy server and web from `main`** (**Deploy → Manual deploy**) with `PACE_PAUSE` unset. Nothing
   blocks; the Help Center articles go live; the indexes build as the dynos start.
3. **Run console:** `npm run migrate:build-indexes` (the pause indexes show as already built), then
   `npm run migrate:build-indexes -- --apply` for whatever else the deploy added. Run every other session's
   console steps in their own order.
4. **Look before switching on.** Late in the evening (it reads every customer's history), in the Run
   console:

   ```
   npm run replay:pace-pause
   npm run replay:pace-pause -- --since=2026-08-01 --door=20
   ```

   Counts per organization only — never a name — and a count under 3 prints as *fewer than 3*. The
   second line shows how to try other numbers: `--door`, `--survey`, `--travel`, `--window`, `--fails`,
   `--visit`, and `--since=<YYYY-MM-DD>`. Nothing is changed.
5. **Phone, staging.** On your machine, in `mobile/`: check `git status --short mobile/` prints nothing
   (an update bundles whatever is on disk), `npm run ota:staging`, run the device check below, then
   `git status --short mobile/` again. The same update carries any other session's phone screens; run
   their staging checks too.
6. **The device check.** **Staging builds talk to production**, so use a test organization:
   - as a super admin, create one from the web console's **New organization** dialog (a trial org; any
     slug), with a survey campaign of made-up single-family addresses (apartments are never judged), a
     published book assigned to a test canvasser account, and a test admin to unpause;
   - set `PACE_PAUSE` = `orgs:<that slug>` (a quiet hour — it restarts the dynos);
   - on a staging phone as the test canvasser, save eight different doors seconds apart from one spot, and
     check: the alert *That door was saved. Recording is now paused for review…*, the greyed buttons, the
     red banner and **Check again**, a survey opened while paused (a wall), an unpause from the test admin
     reaching the door screen, and an offline upload while paused; on a production-lane phone still on the
     old app, check that an online save is refused in an *Action not saved* alert;
   - unset `PACE_PAUSE`, and delete the test organization.
7. **Phone, production:** `npm run ota:production` from `main`.
8. **Tell both customer organizations** (the text is in [PROPOSAL_PACE_PAUSE.md](PROPOSAL_PACE_PAUSE.md)
   §J).
9. **Leave time** for phones to take the update — an old app still lets doors saved offline through while
   paused.
10. **Switch on:** `PACE_PAUSE` = `on`, **early in the morning before shifts start** — doors saved earlier
    that day count toward the first pauses.

**If something looks wrong:** set `PACE_PAUSE` = `off`. Nothing blocks on the server at once, and phones
clear on their next check (the banner's 30-second poll, **Check again**, the map's update). Pauses left
open block again the moment it is switched back on — so before then (also before shifts), if they were
false alarms, resolve them:

```
npm run pace:resolve-open
npm run pace:resolve-open -- --apply
```

The first is a dry run (how many, per organization, no names); the second lifts them all and starts each
person's count over.

**The preview that took the web server down (2026-10-25).** The release first shipped an in-product
preview on each campaign's Audit page, *What automatic pause would have done*. The day after, a 22-day
preview of a busy campaign worked out each door's day once for every day of the range, building a new date
formatter each time — millions of them — and the 1 GB web dyno reached about 4 GB and crashed
(`PACE_PREVIEW_ROW_CAP` = `1` kept it up until the fix). The fix shares one formatter per time zone in
`utils/timezone.js` — every report that groups by day got faster too — and the same preview on a copy of the
data went from 22.9 s and 1,955 MB to 2.4 s and 214 MB (measured with the real route on a throwaway database;
`server/test/timezone.test.js` pins it). Once the test pause on the demo had worked, the owner had the preview
removed the same day. `PACE_PREVIEW_ROW_CAP` does nothing now — delete it from Config Vars if it's still there.

### Release: client reports, simpler start (October 2026)

The Client Reports page's How it works guide, report dates on your organization's report week, links to just
one report with a Share button on every published report, and a guard against two reports for the same tab
and dates ([CLIENT_PORTAL.md](CLIENT_PORTAL.md); plan and *As built* in
[PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md](PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md)). A server deploy plus the web
build; **no console step, no migration, no config var, no OTA, no client-version bump**: every new field
reads as its default when it's missing (an organization's report week is Monday to Sunday until an admin
changes it), and the new duplicate-guard index on client reports builds itself when the web and the worker
start. `npm run audit:mobile-api` before committing should find no phone call on the changed routes (the
phone calls none of them).

**The guard index looks after itself — nothing to run.** It builds at every start of the web dyno and the
worker, and the nightly `client-report-row-sweep` (05:31 UTC) checks it again first. A build that succeeds
logs nothing. What you might see in the logs, and what each means:

- `ClientReport report_period_guard: a duplicate key failed the build; N report(s) sharing a tab and dates
  with an earlier one now sit outside the guard, as second reports (…) — building it again` — two reports for
  the same tab and dates got in while the index was missing; the later ones are now ordinary second reports
  (nothing is deleted, and New report still finds them), then it builds;
- `… index built` (after that) or `… index built on retry N` — it's in place;
- `… index failed — retry N of 4 in 5 s: <error>` (then 30 s, 120 s, 600 s) — a database hiccup; it tries
  again by itself;
- `… index failed — no retries left; the next boot tries again: <error>` — still nothing to do: the next
  restart or the next nightly sweep builds it, and meanwhile New report still checks for an existing report
  before making one.

**Optional, read-only, before or after:** how many report tabs will show New report's week nudge ("Your last
Whole campaign report ran Wednesday – Tuesday. Your organization's report weeks run Monday – Sunday."), per
organization, from the Heroku dashboard → **More → Run console**:

```
npm run report:tab-weeks
```

It prints counts and organization names only, for example "Acme — report weeks Monday – Sunday / 6 open
tab(s) with reports · 2 will show the week nudge / their weeks: Sunday – Saturday: 1 · Wednesday – Tuesday: 1",
and ends "Nothing was changed." It reads each organization's week exactly as the app does, and a tab's
latest report the way New report picks it (the newest last day, then the newest made). Nothing to do with
the answer: each tab's next New report offers **Move this tab to Monday – Sunday weeks**, and an admin can
instead set the organization's week there.

### Build database indexes (after a deploy that added one)

**Not routine.** Run it when a release adds or changes a database index — the release notes will say so.
It's harmless to run when nothing changed (it just finishes instantly), so "run it after every deploy" is
a fine habit if you'd rather not keep track.

**2026-09-30 — the voters-directory release adds two `Voter` indexes:** right after that deploy, in a
quiet moment, run `npm run migrate:build-indexes` once as the dry run and then
`npm run migrate:build-indexes -- --apply`, because until they exist the Voters page of an organization
with more than one campaign keeps doing the slow work that release was meant to end.

```
npm run migrate:build-indexes -- --apply
```

**Why it isn't automatic:** production is deliberately configured *not* to build indexes on startup. If it
did, every deploy would try to rebuild indexes across your biggest collections at boot, which can lock up
the database while people are canvassing. So we build them on purpose, when we mean to.

### Redraw the book shapes on the cut map (ONE TIME — after the containment release)

The Turf Cutting map's book shapes now **contain every one of their houses** (a stray door gets a
small pocket of its book's color instead of sitting outside the shape). New cuts, any book edit, and
any pin move draw the new shapes automatically; **books cut before the release keep their old shapes
until you run this once.** (It is also the fallback for a pin move whose redraw was skipped — a round
over the inline cap, `TURF_REHULL_INLINE_MAX_DOORS`, default 60,000 booked doors — or failed.) It rewrites only the drawn outlines — doors, canvasser assignments, and knocks are
untouched, so it is safe to run in the middle of a live round. Dry-runs by default; idempotent, so
re-running is harmless.

```
npm run recompute:territories -- --apply
```

Reload the web console afterwards — the Turf Cutting map picks the new shapes up immediately. Phones
don't need anything (the field app never receives these shapes).

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
> history **in that campaign** — since 2026-07-21 a crew is a per-campaign fact, so a re-stamp stops
> at the campaign boundary and changing a crew in one race moves no door in another. See
> **[Move every crew onto its campaign](#move-every-crew-onto-its-campaign-one-time--after-the-per-campaign-crews-release)**
> below and [METRICS.md §F](METRICS.md#teams-coordinators--the-counting-contract). ⚠️ Note this
> script and the re-stamp key on **opposite** conditions on purpose (`$exists:false` here,
> `$ne: next` there) — don't reconcile them.

Until you run it, the Timeline simply **won't show the team filter or the by-team table**. That's on
purpose: half-filled-in data would show every team at nearly zero and "No team" as enormous, which looks
like a real answer instead of an error. So it hides rather than lies. Run these in order:

```
npm run migrate:activity-coordinator -- --preflight     # 1. LOOK ONLY. Changes nothing.
npm run migrate:activity-coordinator                    # 2. Dry run — shows what it would do.
npm run migrate:activity-coordinator -- --apply         # 3. Do it.
npm run audit:team-counts                               # 4. Prove the numbers add up.
```

> **When to run the audit.** After a bulk write (`migrate:activity-coordinator --apply`,
> `migrate:campaign-coordinators --apply`), after a change to the fold/aggregation code, or if a
> `CoordinatorChange` row ever carries a `restampError` (a torn write; the campaign's History says
> *Didn't finish*). Since 2026-10-27 it also lists, under each person, rows that don't count for their
> crew and any crew change left unfinished — the checks that used to live in `repair:team-stamps`. **NOT** after every ordinary
> coordinator change in the console: the reconciliation identity holds *by construction* —
> `teamFoldStage` gives every row exactly one `team` and `$group` partitions on it, so a re-stamp
> changes which team a row lands in, never how many. A routine reassignment cannot break the sum.
>
> ⚠️ That last sentence is also the audit's **weakness**, and it is worth knowing before you trust a
> tick: the `doors` line is arithmetically incapable of failing. What to read instead is in
> **[The tick that cannot fail](#the-tick-that-cannot-fail-auditteam-counts)**.

**Step 1 is the one not to skip.** It lists every canvasser who has ever knocked and whether their team can
still be worked out. Deactivating someone, or taking them off a campaign, keeps their team. **Removing
someone from the *organisation* deletes it for good** — if anyone is in that state, this is your last chance
to say who they belonged to, and it tells you before anything is written.

**Step 4 is the gate.** It checks that every team's doors, survey doors and surveyed voters add up to the
campaign's totals, on your real data, and **fails loudly if they don't**. Run it before you give any team's
number to a client. It changes nothing. Read its output knowing that the **doors** line is the one check
in it that cannot fail — [the tick that cannot fail](#the-tick-that-cannot-fail-auditteam-counts).

Safe to re-run at any time — it only ever fills in doors that have no team yet, and it never touches a knock.

> It fills in history using **today's** teams, because nothing recorded who was on which team in the past.
> That's exactly right for anyone who has never switched teams. If someone *has* moved between teams, their
> older doors will be credited to their current team. The dry run lists every person and the team it will
> give them, so you can check before committing.

### Move every crew onto its campaign (ONE TIME — after the per-campaign crews release)

A **crew** used to be one fact per person per organisation: Dana was on Marcus's crew, everywhere, in
every race at once. It is now one fact per person **per campaign** — Dana can be on Marcus's crew in
the mayoral race and on Priya's in the council race, at the same time, and neither lead can disturb
the other.

That had to change because two team leads with a shared canvasser were **overwriting each other**.
There was only one slot, so the second lead to set a crew won it — and the re-stamp that follows any
crew change then dragged the *first* campaign's entire history onto the *second* lead's team. Nobody
did anything wrong; both leads were organising their own race.

This job copies each person's existing crew onto every campaign they are on, so the morning after the
deploy every campaign answers exactly what the organisation used to answer. From then on the answers
are free to diverge, which is the point.

**It writes nothing to the knock ledger — not one row.** No door changes hands because you ran this.

Run it in this order, and don't compress the steps:

```
npm run audit:team-counts                             # 1. BEFORE THE DEPLOY. Save the output.
                                                      #    ... then deploy ...
npm run migrate:build-indexes -- --apply              # 2. the campaign roster gained an index
npm run migrate:campaign-coordinators -- --preflight  # 3. LOOK ONLY. Changes nothing.
npm run migrate:campaign-coordinators                 # 4. Dry run — what it would seed.
npm run migrate:campaign-coordinators -- --apply      # 5. Do it.
npm run audit:team-counts                             # 6. Compare against step 1.
```

**Step 1 is before the deploy on purpose.** The audit script *itself* changes in this release — it
now works out who runs a crew per campaign instead of org-wide. Take the "before" picture while the
old code is still running, or your baseline has already been influenced by the thing you're checking.
Save the text somewhere you can diff it; the script has no memory between runs.

**Step 2 is not optional.** Production deliberately never builds indexes on its own (see
[Build database indexes](#build-database-indexes-after-a-deploy-that-added-one)), and the roster now
carries a `{campaign, coordinator}` index that "who is on this crew?" reads on every team screen.

**Step 3 tells you two things.** How many people have a crew to copy, and — the one worth reading —
anyone who has **knocked a campaign they hold no roster row for**. There is nothing to seed for those
people and nothing is lost (their doors keep the team already frozen on them), but no future crew
change can reach them either, so it is better to know now than to wonder later.

**Step 6 compares PER-TEAM ROWS, not the totals.** The campaign totals are team-blind: they cannot
move, so they will agree before and after and prove precisely nothing. What you are checking is each
team's own line — its doors, its survey doors, its surveys.

> **Some team rows are *expected* to move, and it is not the copy above that moves them.** Who counts
> as running a crew is now worked out **per campaign, from the ledger**. So somebody who runs a crew
> in one race but knocks in another **without** a crew there no longer folds onto their own team in
> the second race — they land in that campaign's **No team** row, which is the correct per-campaign
> answer and was not the org-wide one. If a row moved, that is the first explanation to check.

### Give every voter record its campaign (ONE TIME — after the per-campaign voters release)

Voter records used to be one row per person per **organisation**, pointed at a single door. Two
campaigns importing overlapping files therefore fought over the same rows — the second import
silently pulled each shared person onto *its* doors, and the first campaign's lists went quiet.
Records are now one row per person **per campaign**, and this job stamps every existing row with
the campaign its door already belongs to, then swaps the uniqueness rule to match.

**Run it immediately after the deploy — imports refuse to run until you do.** The new import code
guards on un-migrated rows and fails with a message naming this exact command (a clear error
instead of a half-written file). Deploy in a quiet moment and go straight to the console:

```
npm run migrate:voter-campaigns              # 1. Dry run — reports what it would stamp.
npm run migrate:voter-campaigns -- --apply   # 2. Stamp + swap the unique index.
npm run migrate:build-indexes -- --apply     # 3. Build the rest of the new indexes.
```

The apply step **verifies before it swaps** — if any row can't be resolved to a campaign, or a
duplicate would exist under the new rule, it aborts loudly and leaves the old index in place.
Every org has one campaign as of this release, so both checks are expected to pass trivially.

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

**Record by record, with an FbTime step** (since the door-counts release). The job and the CLI share
[`services/retention/purgeDeletedIdentities.js`](../server/src/services/retention/purgeDeletedIdentities.js):
each due record first runs `depairFbtimeAccount`
([`services/fbtime/purgePairing.js`](../server/src/services/fbtime/purgePairing.js) — the account's FbTime
links deleted, its kept and rejected entries removed, its pre-deletion shifts kept but stripped of the
FbTime person, its link history de-paired; [FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md) → *Account
deletion and the 180-day purge*), then gets its scrub and `purgedAt` stamp, all inside its own try/catch.
A record that throws is counted (`failed`), logged and left unstamped for the next run while the rest
proceed, and the run is recorded `RetentionRun { ok: false, failed, error }` — not a success, so
`retentionHealth()` reads red once 48 hours pass without a clean run, with the failure count in its
`lastError`. A dry run (the CLI without `--apply`) prints what the FbTime step would do and writes
**nothing** — not even a `RetentionRun` row, so a counting pass from the console can never make a dead job
read green (checked from the repo root against a throwaway database: zero rows after the dry run).
**`DELETED_IDENTITY_RETENTION_DAYS` must stay ≥ 121:** the FbTime step leaves a deleted account's
pre-deletion shifts with no FbTime person, and that holds only while they are older than the hours sync's
120-day re-pull when the purge reaches them — a younger shift would be re-pulled and re-paired.

**The deletion sweep and the purge guard (2026-10-24).** An account's deletion lock is its pending
`DeletedUserRecord` ([USERS.md](USERS.md) → *The deletion model*), so a crash can leave a record half-done,
and a record can briefly exist for a live account. `sweepDeletionLocks`
([deleteAccount.js](../server/src/services/users/deleteAccount.js)) settles them: it finishes a deletion
that died after the account was scrubbed, switches back on the memberships of one that died before it and
frees the lock, stamps a pre-lock record of a deleted account finished, deletes one left on a live account,
and re-scrubs the email log for accounts deleted in the last 7 days. It runs every 15 minutes as its own
job (`deletion-lock-sweep`, cron `7,22,37,52 * * * *`, override `DELETION_SWEEP_CRON`, in
`MAINTENANCE_JOBS` so the retention health banner doesn't watch it, and logging only when it did
something), and again as the purge's first step, whose `RetentionRun` records its counts
(`deletionsFinished`, `deletionsReleased`, `liveRecordsDeleted`, `legacyRecordsFinished`,
`emailRowsRescrubbed`) with failures folded into `failed`. The purge then **skips and counts
(`skippedLive`) any due record whose account isn't deleted** — "deleted" meaning `deletedAt` is set or there
is no User document at all — because its FbTime step deletes links and must never run for a live account.
A dry run (`npm run purge:deleted-identities`) runs the sweep counting only.

Without this on a schedule, the retention promise made in
[`DeleteAccountSheet`](../mobile/components/DeleteAccountSheet.jsx), on
[`/delete-account`](../client/public/delete-account.html) and in the privacy policy is not kept. See
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
| `npm run migrate:scrub-deleted-email-log` | **Read-only.** Counts the deleted accounts whose own mail rows (invites, resets, added-to notices — matched by the row's `userId`, never by address) still show an address, error or bounce text ([scrubDeletedEmailLog.js](../server/src/migrations/scrubDeletedEmailLog.js)) |
| `npm run migrate:scrub-deleted-email-log -- --apply` | **Once, after the admin account-deletion release.** Rewrites those rows' recipient to the account's tombstone address and clears their error and bounce text — the same `scrubAccountEmailLog` a deletion now runs itself. Deletion-warning and support-grant notice rows carry no `userId` and keep their recipients. Idempotent |
| `npm run migrate:client-report-visibility` | **Read-only.** What the client-reports migration would do, step by step ([clientReportVisibility.js](../server/src/migrations/clientReportVisibility.js); [CLIENT_PORTAL.md](CLIENT_PORTAL.md) → *Migration, deploy and old documents*): surveys whose follow-up record (and the version it starts at) it would seed, surveys with answers older than that version, legacy reports whose operator unticked every question, reports to put in a series (and walk-list names matching a canvasser's), backfills, the two steps marked as discarding information, the links' new fields, and open drafts that need a rebuild |
| `npm run migrate:client-report-visibility -- --apply` | **Once, after the client reports upgrade deploy** (add `--keep-legacy-all` to keep the charts of legacy reports whose operator unticked every question). Writes only what is still missing, so a second run, or one over documents the new code wrote, changes nothing |
| `npm run report:tab-weeks` | **Read-only, optional.** Per organization, how many open client-report tabs' latest report runs whole weeks on another weekday than the organization's report week — the tabs whose New report shows the week nudge ([reportTabWeeks.js](../server/src/migrations/reportTabWeeks.js); [CLIENT_PORTAL.md](CLIENT_PORTAL.md) → *Report weeks and the next period*). Counts and organization names only; refuses any extra argument; ends "Nothing was changed." |
| `npm run sweep:raw-imports` | Once after the import-fix release (purges the pre-fix backlog of orphaned raw voter-file uploads), or whenever an import looks wedged — same code as the nightly `sweep-stale-imports` job ([sweepStaleImports.js](../server/src/services/import/sweepStaleImports.js)) |
| `npm run migrate:activity-coordinator -- --preflight` | **Read-only.** Before the team-attribution backfill — who resolves to a team, and who can't |
| `npm run migrate:activity-coordinator -- --apply` | Once, after the release that adds `CanvassActivity.coordinatorId` |
| `npm run migrate:campaign-coordinators -- --preflight` | **Read-only.** Before the per-campaign crew seed — how many members hold a crew, and who has knocked a campaign they have no roster row for |
| `npm run migrate:campaign-coordinators -- --apply` | Once, after the release that moves the crew from `Membership.coordinatorId` to `CampaignAssignment.coordinatorId`. Touches **no** ledger row |
| `npm run audit:team-counts` | **Read-only.** Prints each team's row and checks Σ teams + no-team − cross-team == the campaign billable, column by column, for **every campaign**. Exits **1** if any column of any campaign fails. Narrow with `--org=<slug>` or `--campaign=<id>`. ⚠️ The `doors` column **cannot** fail — [see below](#the-tick-that-cannot-fail-auditteam-counts) |
| `npm run repair:team-stamps` | **Read-only.** Lists any organization whose team surfaces are switched off (`teamAttributionReadyAt` unset); `--org=<slug>` scopes it. Since 2026-10-27 that's all the script does — see [Re-attribution](#re-attribution-repairteamstampsjs) |
| `npm run repair:team-stamps -- --apply --ready-only` | Switches those organizations' team surfaces on; examines no ledger rows. Any other flag (the old `--apply`, `--preflight`) prints where the crew checks went and writes nothing |
| `npm run repair:orphaned-assignments` | Dry run — finds anyone still holding books on a campaign they're off the roster of |
| `npm run repair:import-pins` | **Read-only and free** (dry run, cache-only). Finds doors an import pinned in the wrong place — out of state, far from their own street, sharing an exact pin with doors from *other addresses* (vendor placeholder coordinates — different streets, or different house numbers on one street), or knocked from far away by 2+ canvassers — and re-checks each against the address. Narrow with `--campaign=<id>` / `--org=<slug>` |
| `npm run repair:import-pins -- --geocode` | Same, but lets unconfirmed suspects hit **Geocodio** (costs money; a cache-only dry run first prints exactly how many addresses it would pay for) |
| `npm run repair:import-pins -- --verify-all --campaign=<id>` | **Full audit** — checks *every* imported pin against its own address, not just the four signals' suspects. The only way to catch a pin that is wrong but **self-consistent**: a real building placed on the wrong lot, or a street whose every door sits on one wrong spot (it *is* its own cohort). Requires a `--campaign`/`--org` scope |
| `npm run repair:import-pins -- --apply --user=<userId>` | Commits the confirmed corrections. **`--user` is mandatory** — the audit row's `userId` is required, and without it a door would save and then fail its audit write |
| `npm run pins:measure-estimates -- --campaign=<id> --sample=300` | **Costs lookups** (about thirty cents for 300; the price prints first; cached answers are free). Once per release of the answer ladder: looks up a seeded sample of the campaign's ordinary vendor pins (unflagged, unvouched) and prints, per answer type, the median and 90th-percentile distance from Geocodio's answer to the vendor's pin — for `range_interpolation`, also at or above the current floor and the share the street test would refuse — so `PIN_INTERP_MIN_ACCURACY` is set from data. Writes no household; new answers land in the shared address cache, as with `repair:import-pins` ([measureEstimates.js](../server/src/migrations/measureEstimates.js)) |
| `npm run repair:city-suffix` | **Read-only.** Lists every campaign whose doors carry a city ending in `_addr` — a Data Trust–style file's vendor code (`HARLINGEN_addr`) imported as the city. One collection scan |
| `npm run repair:city-suffix -- --campaign=<id>` | **Read-only.** What `--apply` would change there: doors per city, doors left alone (one already stands under the corrected address — merge by hand; or nothing is left once the suffix is gone), do-not-knock requests to carry, round filters and saved searches to fix, and the campaign's Pin Fixes counts |
| `npm run repair:city-suffix -- --campaign=<id> --apply` | Renames the doors **in place** — same `_id`, so books, knocks, notes and pins stay put: `city` + `cityValue` lose `_addr`, `normalizedAddress` is rebuilt, do-not-knock requests move to the new key before any door does, `doNotKnock` is recomputed, round target filters and saved searches drop the suffix. Never re-import the file to fix a city: the city is in the door key, so that adds every address as a new door. Afterwards, Pin Fixes → **Look up by address** on each card. Safe to re-run ([repairCitySuffix.js](../server/src/migrations/repairCitySuffix.js); test `repairCitySuffix.int.test.js`) |
| `npm run audit:stale-overwrites` | **Read-only, no `--apply` by design.** Survey responses overwritten by another canvasser, where the archived row's note would be lost by an automatic restore |
| `npm run audit:voted-doors` | **Read-only.** Doors marked fully-voted, and whether they still reconcile |
| `npm run audit:voter-id-spellings` | **Read-only.** Per campaign: share of voter IDs starting with 0, ID widths (mixed widths = rows already lost zeros); per organization: one person stored under two spellings, the same person twice in one campaign, Person-directory keys that would collide once zeros are ignored, parked early-vote / do-not-contact IDs matching a voter only after ignoring zeros. `--org <slug>`, `--json`, `--samples N`. Rule in [`utils/voterIdKey.js`](../server/src/utils/voterIdKey.js); test `auditVoterIdSpellings.int.test.js` runs it as a child process over the real script |
| `npm run audit:gps-stamps` | **Read-only.** Stored GPS stamps the stamp rules in [PROPOSAL_GPS_UPGRADES.md](PROPOSAL_GPS_UPGRADES.md) §I refuse, store as unknown or judge differently for new stamps (its first production run, 2026-10-05, found none on any ledger): per ledger, negative, zero (by month and mock-location flag) and non-finite accuracies, non-finite, off-Earth and (0, 0) coordinates, each against the rows scanned; and what the read-side clamp changes (audit far reasons removed, severities that drop, the per-canvasser Far count and forgiven), measured by running the far rule with the old arithmetic and with the current one. Counts only, never a coordinate, name or id. One collection scan per ledger, so run it late in the evening. `-- --since=<time>` limits it to rows created at or after a full time with its UTC offset (`2026-10-13T23:45-05:00`) or a date read as 00:00 UTC; a time without an offset, an impossible date and a future time are refused. Test `auditGpsStamps.int.test.js` runs it as a child process over the real script |
| `npm run migrate:campaign-stats` | **Read-only.** Recomputes every campaign's `Campaign.stats` from the ledgers and lists the ones that differ (`DRIFTED`) or were never seeded (`UNSEEDED`) — [see below](#contactknockcount-and-the-required-recompute-migratecampaign-stats) |
| `npm run migrate:campaign-stats -- --apply` | **Once, straight after the Not-a-target release deploy** (seeds `contactKnockCount`); otherwise any time counter drift is suspected. Recomputes and stamps **every** campaign — the same code as the nightly `reconcile-campaign-stats` job |
| `npm run replay:pace-pause` | **Read-only, counts only.** Automatic pause's season replay across every customer organization: per org, canvassers and days scanned, the days and people it would have paused, pauses in total, the pattern mix (vehicle / one spot / walking), fails on long hops, and how often a visit began Not home and ended surveyed. Counts under 3 print as *fewer than 3*; no name, id, address or coordinate. Skips internal and deleting orgs. Flags: `--since=<YYYY-MM-DD>` and the rule's numbers (`--door --survey --travel --window --fails --visit`); an unknown flag exits 2. A full ledger scan — run it late ([replayPacePause.js](../server/src/migrations/replayPacePause.js)) |
| `npm run pace:resolve-open` | **Read-only.** How many automatic pauses are open, per organization, no names ([resolveOpenPacePauses.js](../server/src/migrations/resolveOpenPacePauses.js)) |
| `npm run pace:resolve-open -- --apply` | **Rollback only**, after `PACE_PAUSE` was set to `off` because pauses misfired: lifts every open pause (`resolvedVia: 'switch_off'`) and moves each person's restart point, so the old fails never count again |
| `npm run migrate:fbtime-deletion-gaps` | **Read-only.** Counts, per step, what the FbTime deletion-gaps backfill would change ([`backfillFbtimeDeletionGaps.js`](../server/src/migrations/backfillFbtimeDeletionGaps.js)) |
| `npm run migrate:fbtime-deletion-gaps -- --apply` | **Once, straight after the door-counts release deploy.** (1) nulls `fbtimeEmail` on FbTime links of deleted accounts; (2) strips `detail.userEmail` from **every** `link-created` integration event (nothing reads it, and a per-user match would miss rows whose `detail.userId` is stored upper-case); (3) runs the purge's FbTime step for records purged before it existed (expected 0 — the first default purge is around 2027-01-08). Idempotent; a record that fails is printed, the exit code is 1, and a re-run retries it |

Five notes on `repair:import-pins` specifically, because they surprise people:

- **It only touches pins that came from the file** (`coordSource: 'file'`), plus its own past
  repairs (below). A hand-dragged pin is field-verified truth; the geocoder's pins already came
  from the address. Neither is ever overwritten.
- **It distrusts the geocoder too, and reverts itself.** An answer may only overrule a pin if it is
  a *true* rooftop (`rooftop`/`point`, never `nearest_rooftop_match`), no *other* base address gets
  the identical point, and its matched ZIP equals the address's ZIP. Every run also re-checks the
  script's own past repairs against those gates (cache-only, free) and reverts any that fail — back
  to the file's pin, provenance reset to `'file'`. A pin whose latest move was human is never touched.
- **It does not move books — but it does redraw them.** A repaired door stays in whatever book was cut
  around its old location until that pass is re-cut; under `--apply` the script redraws the outlines of
  every live round whose doors it moved (repairs and reverts alike) once at the end of the run, so the
  shapes follow the corrected pins on their own. `npm run recompute:territories -- --apply` is only the
  fallback if an outline still looks wrong afterwards — it redraws outlines only, never membership. (A
  re-import that moves an *un*-corrected pin does not redraw; that outline follows on the next cut or
  the same fallback.)
- **Use `--geocode` on the FIRST apply.** The placeholder-pin signal is stack-based: once a pin's
  cached-answer neighbours move away, an uncached tail door there is a lone door with no signal, and
  a later `--geocode` pass can't find it. Adjudicate the whole stack in one run.
- **It changes historical Audit numbers.** A repaired door becomes `coordSource: 'corrected'`, which
  downgrades past "far from house" GPS flags there. That's the right outcome — the canvasser really was
  at the house — but the flag counts on the Audit page will drop after a run.

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
  > `seedDemoOrg.js`), and `repair:team-stamps -- --apply --ready-only` sets it **unconditionally,
  > above any `continue`**, for orgs that already exist.
- **No new index.** `CanvassActivity` already carries nine on the hottest write path; the team clause rides
  as a residual on `{campaignId, timestamp}`. **`migrate:build-indexes` is not part of this release.**

### Per-campaign crews (`migrateCampaignCoordinators.js`)

[`migrateCampaignCoordinators.js`](../server/src/migrations/migrateCampaignCoordinators.js) seeds
`CampaignAssignment.coordinatorId` from `Membership.coordinatorId` — a single `bulkWrite` carrying one
`updateMany` per member who has a crew. `Membership` is unique on `{userId, organizationId}` — one slot
— and `CampaignAssignment` is unique on `{campaignId, userId}`, which is the whole change: a canvasser
can now hold a different crew in every race they work.

- **It writes `CampaignAssignment` and nothing else.** Not one `CanvassActivity`, not one
  `SurveyResponse`. That is what makes it re-runnable and reversible-by-doing-nothing: every frozen
  team stamp stays exactly where it is, so no door changes hands as a result of running it.
- **The idempotency key is `{ coordinatorId: null }`, and here that is right** — the inverse of
  `migrateActivityCoordinator`'s `$exists: false` rule above, deliberately. On the ledger a `null`
  is a *deliberate* "no team" that a re-run must not clobber. On a roster row it is only ever "no crew
  chosen", because until this release nothing could choose one. Keying on `null` is also what stops a
  crew a lead has already set **after** the deploy from being overwritten by the stale org-level value.
- **New index, so `migrate:build-indexes -- --apply` is a gate.**
  `CampaignAssignment` gained `{campaignId: 1, coordinatorId: 1}` — "who is on this crew, in this
  campaign?", which is the roster grouping and the per-campaign lead set.
- **`Membership.coordinatorId` is deliberately left in place** and is no longer read by anything.
  Dropping it is a separate, later step: keeping it means that if a per-team row moves unexpectedly,
  the value it moved *from* is still on disk to compare against.

**Per-team rows can still move across this deploy**, for a reason that has nothing to do with the copy
above: `leadIdsForScope` ([`routes/admin/reports.js`](../server/src/routes/admin/reports.js)) now
derives the lead set **per campaign, from the ledger** — `distinct('coordinatorId')` over
`CanvassActivity` + `SurveyResponse` in scope. Neither of the alternatives works: `Membership` is
org-wide (so a lead folds onto their own team in campaigns where they run no crew at all), and
`CampaignAssignment` is a roster gate that is **hard-deleted** on removal (so a lead would lose their
own folded doors the moment their last crew member came off the roster — the 104-door bug, back
through the front door). The consequence to expect: somebody who runs a crew in campaign A and knocks
in campaign B *without* one no longer folds onto their own team in B, and correctly lands in B's
**No team** row. The campaign's own billable total is team-blind and cannot move either way.

### The tick that cannot fail (`audit:team-counts`)

`/team-breakdown` publishes a reconciliation identity — *Σ teams + no-team − `crossTeamDoors` == the
campaign billable* — and [`auditTeamCounts.js`](../server/src/migrations/auditTeamCounts.js) prints a
✓ against it. **On the `doors` column that ✓ is a tautology and proves nothing.**

The arithmetic, because this is the kind of thing that only looks obvious once someone writes it down:

- `crossTeamDoors` is not measured. It is `Math.max(0, teamSum − knocks)` — a subtraction, computed
  from the two numbers being compared.
- So the check evaluates `teamSum − max(0, teamSum − knocks) == knocks`, which holds for **any**
  `teamSum >= knocks`.
- And `teamSum >= knocks` always: `teamFoldStage` puts every row in exactly one `team`, and the
  per-team `$group` keys on `(householdId, passId, team)` while the campaign's `knocksPipeline` keys
  on `(householdId, passId)`. A refinement of a partition can only produce more groups, never fewer.

So the `doors` line prints ✓ over completely wrong per-team rows. What it actually detects is
`teamSum < knocks`, which cannot occur.

**What to read instead:**

1. **The `survey doors` and `surveys taken` columns.** Neither has a cross-team subtraction, so both
   are real equalities that can genuinely fail. Know what each fails *on*, though:
   - `survey doors` runs over by exactly the number of surveyed door-passes worked by two
     **different** teams — so check it against the `less cross-team doors` line before concluding
     there is a bug. A campaign with real cross-team overlap fails this column while being perfectly
     correct.
   - `surveys taken` runs *under*, and only in one way: the per-team survey counts are looked up
     against the teams found in the **door** aggregate, so a team holding survey responses but no
     knock rows is dropped from the sum entirely. That is the door and survey ledgers disagreeing
     about who is on a team, which is worth stopping for.
2. **A per-team ROW diff across the change.** Run the audit before and after, and compare each team's
   line. The script keeps no history and diffs nothing itself, so this means saving both outputs.
   Campaign totals are team-blind: they will agree either way, which is what makes them useless here.
3. **The ledger cross-check** it prints underneath — every canvasser who ever knocked in the campaign,
   with their state (`active` / `deactivated` / `REMOVED FROM ORG` / `account deleted`) and their crew
   read off **this campaign's** roster. Somebody who knocked here but is no longer rostered reads
   `off roster` rather than being silently relabelled `no team`, which would look identical to a
   genuine No-team canvasser. Under a rostered person it adds (2026-10-27):
   - `rows not on their crew: Dana Cruz 12, No team 3 · open Team → Pat Lee → Finish it` — drift. For
     someone on a real crew the fix is **Finish it** in their panel on the campaign's Team page (the
     panel offers it on its own), which runs the same crew job as any change. For someone with **no**
     crew the line says *possibly a departure; check before changing*: rows on a real team under a
     No-crew row are what every departure leaves (the 104-door rule), and moving them is a decision,
     not a repair.
   - `an unfinished crew change · open Team → Pat Lee → Finish it`, or `a crew change is running right
     now` while its hold lasts.

   Neither line makes the run fail; fixing one moves published team numbers, so each fix is the
   owner's call.

The audit derives its lead set the same way `leadIdsForScope` does — per campaign, from the ledger —
and imports the real `teamFoldStage` rather than re-implementing it. That sharing is the point: an
audit that can be wrong in the same way as the thing it audits is worth nothing. It was org-wide off
`Membership` until crews became per-campaign, which would now have reported campaign-correct totals
under campaign-wrong labels.

### Re-attribution (`repairTeamStamps.js`)

> **Since 2026-10-27 the script is gate-only** ([PROPOSAL_PEOPLE_PAGES.md](PROPOSAL_PEOPLE_PAGES.md)
> §B.8): a bare run lists organizations whose team surfaces are off, `-- --apply --ready-only` switches
> them on, and every other flag prints a pointer and writes nothing. Its crew checks moved into
> `npm run audit:team-counts` (read-only, per campaign; see *The tick that cannot fail* above), and a
> person's drift or unfinished change is fixed with **Finish it** on the campaign's Team page, through
> the same crew job as every change (`services/memberships/setCoordinator.js`). The note below records
> why the old script had to go.
>
> 🛑 **Out of service since crews became per-campaign — every mode except `--apply --ready-only`
> threw.** It scans `Membership`, which is org-wide, and calls `previewRestamp` /
> `restampFilter` **without a `campaignId`**; `restampFilter` now *requires* one and raises
> `restampCoordinator: campaignId is required` on the first member who has a coordinator. That
> refusal is the fix working, not a regression to route around: an omitted scope silently meaning
> "every campaign, all time" is precisely the bug the per-campaign change exists to close.
>
> It fails **before writing a single ledger row**. The one write that can land first is the
> `teamAttributionReadyAt` gate flag, which is set above the scan, per org — harmless and idempotent.
>
> **What replaces each of its three jobs:** day-one conformance is not needed (the copy in
> `migrateCampaignCoordinators` seeds the roster and moves nothing); drift repair is **Finish it** in
> the person's panel on the campaign's **Team** tab, which `audit:team-counts` points to; the gate fix
> survives as `--apply --ready-only`. (A rewrite as a per-campaign repair was considered and dropped:
> its `--apply` would re-stamp with no hold and no check of what the crew was, so it could overwrite a
> change made while it ran.)

The description that follows is **history**, from when a crew was an org-wide fact.

Since teams follow the **current** coordinator, [`repairTeamStamps.js`](../server/src/migrations/repairTeamStamps.js)
brings the ledger into line with every member's `Membership.coordinatorId`. Three jobs in one script:

1. **Day-one conformance.** The rule only applies itself to people whose coordinator is edited after
   deploy; run this once so the documented invariant is true for everyone immediately.
2. **Drift repair.** `setMemberCoordinator` writes the roster row first and the ledger second (that
   order is deliberate — the reverse would let every subsequent knock add more drift). If a ledger
   write ever fails, this closes the gap. Compensation is a **re-run, not a rollback**.
3. **The gate fix** above.

It calls the same `restampLedgerCoordinator` the routes call — an audit that can be wrong in the same
way as the thing it audits is worth nothing. Idempotent: a second run reports 0 everywhere.

**Review the `--preflight` output before applying.** It names every person, the team they'd move to,
and — indented under each — **which team currently holds those doors**, deduped to doors the same way
`/team-breakdown` counts them, so the sub-counts sum to the headline.

That source breakdown is the whole point of the preflight. The target side alone (*"→ Dana Whitfield:
443 doors"*) cannot distinguish a routine correction from a run that **empties a departed
coordinator's team**, and those want different decisions. A source whose `Membership` no longer exists
is flagged `⚠️ LEFT THE ORG`, with a summary warning at the end, because that move is **irreversible
in practice**: the usual undo is "set the coordinator back", and you cannot set it back to someone who
is no longer a member. Use `--org=<slug>` to apply the clean orgs first and decide on the rest
separately.

**Rows that move but aren't doors get their own line.** `restricted` and `note_added` are the only
actionTypes outside `KNOCK_ACTIONS`; they are re-stamped like everything else (a restricted mark
belongs to the same team as the walk that produced it) but the door headline can't count them. The
first production preflight printed *"40 door(s) (42 activity row(s))"* for a canvasser with two
restricted marks — so the preflight now says `also moving (not counted as doors): 2 restricted`, and
calls out that **restricted doors are billable for an org that opted in**. The campaign's own billable
total still cannot move: `knocksPipeline` dedupes to `(household, pass)` campaign-wide and never reads
`coordinatorId`, so a re-stamp shifts which *team segment* a restricted door sits in, never the
invoice.

Nothing else moves: campaign totals, coverage, rates and invoices are untouched, because billing is
team-blind.

[`lockAccountDeletion.js`](../server/src/utils/lockAccountDeletion.js) takes the email as a bare positional
argument (not just `--email=`) because the Heroku web console is a single text box and `npm run x -- --flag
y` quoting is a footgun there.

### The opt-in outcome release gate (`OPT_IN_OUTCOMES`)

[`availableOptInOutcomes()`](../server/src/services/canvass/outcomeToggles.js) reads
`process.env.OPT_IN_OUTCOMES` on every call — split on commas, trimmed, and filtered to the
`OPT_IN_OUTCOMES` constant (`['not_target']`), so an unknown key is ignored rather than released.
Nothing caches it; every reader calls it per request:

- **`GET /api/admin/campaigns`** returns it as the top-level `optInOutcomesAvailable`. App Customization
  (web and phone) shows the switch on a survey campaign when the key is in it, a turn-off-only "Paused by
  Doorline" row when it isn't but the campaign's `enabledOutcomes` still has it, and nothing otherwise.
- **The campaign PATCH** checks the release only for a key being turned **on** (400
  `OUTCOME_NOT_AVAILABLE`). Turning off, and re-sending a key already stored on, are always accepted, so
  a withdrawal never blocks saving the rest of the form.
- **Both phone wires** — the bootstrap campaign block and `/mobile/changes`' `doorConfig` block, one
  owner (`doorConfigFor` in [bootstrap.js](../server/src/routes/mobile/bootstrap.js)) — carry
  `enabledOutcomes` = on ∩ released ∩ survey campaign (`effectiveEnabledOutcomes`). `doorConfigStamp` is
  built from that effective list, so flipping the var changes the stamp of every survey campaign set
  on, and a phone folds the new `doorConfig` from its next 30-second `/mobile/changes` poll — no
  refetch.
- **The recording gate** (`recordHouseholdAction` in [canvass.js](../server/src/routes/mobile/canvass.js))
  refuses a fresh tap on a survey campaign with 400 `OUTCOME_DISABLED` unless the outcome is set on and
  released there (`isOutcomeEnabled`). A lit-drop door never reaches this gate: the route's survey-only
  check (`requireCampaignType: 'survey'`) answers first, with a plain 400
  `Action not valid for campaign type "lit_drop".` and no code. A replay
  (`wasOfflineSubmission: true`) is honored if the campaign has **ever** had it on
  (`outcomeEverEnabled` — `everEnabledOutcomes`, which ignores the release), so the off switch never
  rejects taps queued offline where it was on, and a campaign that never had it on refuses even a replay.
- **The Door Outcomes desk and survey conversion** (`validatePair` in
  [reclassifyOutcomes.js](../server/src/services/canvass/reclassifyOutcomes.js), and
  [surveyConversion.js](../server/src/services/canvass/surveyConversion.js)) accept Not a target voter as
  a "Change to" target only where `isOutcomeEnabled`, else 400 `TARGET_DISABLED`; the web Door Outcomes
  page builds its **Change to** list the same way from `optInOutcomesAvailable`. After a withdrawal,
  entries can still be changed away from it, but never to it.
- **`outcomeInUse`** (ever set on, or on now), behind the conditional columns, tiles and filter chips on
  the admin screens and the per-round CSV column, ignores the release too. The client report's
  breakdown row, the share-map chip and the coverage legends are gated on a non-zero count instead,
  which ignores it as well. Either way, history stays visible after a withdrawal.

**Why roll forward only.** Code without the route 404s `POST /api/mobile/households/:id/not-target`,
and [`offlineQueue.js`](../mobile/lib/offlineQueue.js) drops any 4xx that is not an auth failure (a 401
or the 403 `PASSWORD_CHANGE_REQUIRED`, which it holds until sign-in), this 404 included, so queued taps
are lost. `KNOCK_ACTIONS` before this release lacks `not_target`, so those rows stop counting as knocks. And the
`Household.status` enum accepts `not_target` only from `4d1276a` on (the value shipped with the
Voters-tab commit, ahead of the route): mongoose validates loaded paths on every `save()`, so on
anything older a write that never touches `status` — `updateHouseholdLocation`'s pin move is a
`save()` — fails with `` `not_target` is not a valid enum value for path `status` `` (checked on mongoose
8.23.1). That 500 is not dropped: a 5xx stays at the head of the queue for retry and holds up the lead's
queue behind it.

### The door-count release gate (`FBTIME_DOOR_COUNTS`)

[`doorCountsAvailable()`](../server/src/services/fbtime/doorCounts.js) reads
`process.env.FBTIME_DOOR_COUNTS` on every call — `on`, `true` or `1` after trimming, in any case; anything
else is off. Nothing caches it, and every reader calls it:

- **`GET /api/admin/integrations/fbtime`** returns it as `doors.available` (and `doorsAvailable` when not
  connected) — what the web card and the Replace-key form's door-count line are drawn from.
- **`PATCH /fbtime/doors`** refuses a turn-on and any clear with `409 DOORS_NOT_AVAILABLE`; Turn off and
  Cancel always work, so a withdrawal never strands an admin.
- **The door step** ([`doorPush.js`](../server/src/services/fbtime/doorPush.js)) checks it first among its
  gates: off → no request at all, and no write for an organization with nothing to do (an enabled one
  records `lastSkip: 'unavailable'`, and its card reads **Paused**). The deep job's scope refresh runs only
  while it is on.

Unsetting it loses nothing: the switch, the ledger of who was sent, waiting clears and kept accounts all
stay, and resume when it is set again.

**The one-worker rule.** The maintenance worker is `new Worker(QUEUE_NAMES.MAINTENANCE, …, { concurrency: 1
})` in [`worker.js`](../server/src/worker.js) — one job at a time **per process**. A second worker dyno is
a second process, so the 15-minute and nightly FbTime jobs (and the one-off org job) could run the door step
for the same organization twice at once. Every send and clear re-checks before each request (the key-filtered
ledger write, the reporter predicate, each person's set of accounts), which narrows what an interleaving
could do but doesn't make it safe — so the formation stays at one worker dyno.

### The automatic-pause switch (`PACE_PAUSE`)

[`paceSwitch()`](../server/src/services/audit/pacePause.js) reads `process.env.PACE_PAUSE` on every call
(`off`/unset, `on`, `orgs:<slug,…>`; anything else is off, warned once) and `switchCovers(org)` applies it:
`on` covers every org that isn't `isInternal`; `orgs:` covers exactly the slugs listed, internal ones
included. Everything that matters goes through `paceBlocks` (the one predicate — the switch, the org's own
`pacePause.enabled`, an active canvasser, an open pause), so the switch reaches:

- **the gate** — a fresh write from a paused canvasser is 403 `PACE_PAUSED`; off, nobody is refused;
- **every phone answer** — `pace.paused` on the bootstrap, `/changes`, every recording reply and
  `GET /mobile/pace`; off, it reads `false`, so updated phones stop blocking on their next check;
- **the live check** — off, `runPaceCheck` returns before reading anything, so no pause is created;
- **the badges** — `openPausesByCampaign` returns nothing for an org the switch doesn't cover.

Turning it off **resolves nothing**: open pauses stay open, simply not blocking (the review screens say
*Not blocking — automatic pause is switched off*), and block again when it comes back on. That is what
`pace:resolve-open -- --apply` is for. The org's own setting differs on purpose: a billing admin turning it
off resolves that org's open pauses at once (`setting_off`), and turning it back on stamps
`pacePause.enabledAt`, which restarts every count there. The console replay ignores the switch — it never
pauses anyone.

### `contactKnockCount` and the required recompute (`migrate:campaign-stats`)

The release adds `notTargetKnockCount` and `contactKnockCount` to `Campaign.stats` (declared with
default 0 in [Campaign.js](../server/src/models/Campaign.js)) and to `COUNTER_KEYS` in
[campaignCounters.js](../server/src/services/reports/campaignCounters.js), so the drift check compares
both. `contactKnockCount` is distinct household × pass with any `CONTACT_ACTIONS` row — the contact-rate
numerator, once per door per round. `notTargetKnockCount` is exact from day one (no rows predate it);
`contactKnockCount` is not. On an already-trusted campaign (`stats.reconciledAt` set) it is absent —
lean reads skip schema defaults — and the hot-path `$inc` moves it from nothing, so until a recompute it
is partial or even negative (a refusal recorded before the deploy and changed after it decrements it).
Its only reader is the stats-backed campaign-level `contactRate` on `/overview` and `/campaign-rollup`,
which no screen renders; both stats copies default it with `|| 0`, so the routes keep answering. Hence a
required one-time recompute rather than a version gate
([PROPOSAL_NOT_TARGET_OUTCOME.md §F](PROPOSAL_NOT_TARGET_OUTCOME.md#f-campaignstats)).

[`reconcileCampaignStats.js`](../server/src/migrations/reconcileCampaignStats.js) runs
`reconcileAllCampaignStats`, the same function the nightly `reconcile-campaign-stats` job runs with
`apply: true` ([scheduler.js](../server/src/services/retention/scheduler.js)). It recomputes every
campaign from the ledgers and prints `DRIFTED   <name> — <key> <stored>→<fresh>, …` for a trusted
campaign that differs (`lastActivityAt/canvasserIds differ` when only those do) and `UNSEEDED` for one
never stamped; `--apply` prints the same list, then recomputes and stamps **every** campaign. Checked
from the repo root against a throwaway mongod in the post-deploy state — exact stats with both new keys
`$unset`, on three campaigns: one holding a door where one canvasser surveyed and another recorded
Refused in the same round plus a refused door, one with only Not home, one lit drop. The dry run printed
`DRIFTED   Survey with contacts — contactKnockCount 0→2` and nothing else, `--apply` seeded it, and the
re-run printed `All campaign stats match the ledgers. Nothing to do.` Re-dispositioning the refused door
to Not home through the real hot-path delta before the recompute made the same line read
`contactKnockCount -1→1`. Skipped, the nightly job seeds it and warns once:
`[maintenance] reconcile-campaign-stats: repaired <D> drifted, seeded 0 of <M> campaign(s) — <name> (contactKnockCount 0→<N>); …`.

### The map-pin pass after every import (`placeStackedPins`)

[`placeStackedPins.js`](../server/src/services/households/placeStackedPins.js) runs inside the import worker
after the write (`ImportJob.phase: 'pins'`, its own 30 s heartbeat) — no scheduler entry and no script.
One pass per campaign at a time holds `Campaign.pinPass` (beat 30 s, taken over after 90 s stale); a second
import meanwhile marks only and stores `PIN_PASS_BUSY`. Lookups run only when `GEOCODE_ENABLED === 'true'`
and `GEOCODIO_API_KEY` is set, through `geocodeService.resolve` (shared cache and cost accounting), capped
per import by `PIN_PLACEMENT_MAX_HOMES` and ledgered in `ImportJob.pinProbedIds`. Failures are non-fatal:
the import completes, `pinPassError` carries the generic sentence and `pinPassCause` the reason
(super-admin Imports page only). The recovery is always the same import again — idempotent by design. The
new partial index `{ campaignId: 1, pinSuspect: 1 }` makes `migrate:build-indexes -- --apply` a gate:
without it the Pin Fixes list and the `pinsToFix` badge scan. Full rules: [IMPORTS.md](IMPORTS.md) §H.

## Why `autoIndex` is off in production

[`config/db.js`](../server/src/config/db.js) disables `autoIndex` outside development. Mongoose would
otherwise attempt to build every schema index on every boot; on large collections (`Household`,
`CanvassActivity`, `Voter`) that is a foreground build that can stall the database mid-deploy. The trade is
explicit: **new indexes never appear on their own** — [`buildIndexes.js`](../server/src/migrations/buildIndexes.js)
must be run with `--apply` on any release that adds one. Forgetting it doesn't break correctness, it just
means the new queries do collection scans — *except* for `unique` indexes, which are not enforced at all
until they're built.
