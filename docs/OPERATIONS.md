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

## Jobs that run themselves (set up once, then forget)

**A "scheduled job" is a robot that runs a command for you on a timer.** You set it up once on Heroku's
website and Heroku's own servers run it from then on — every day, forever. Your laptop can be closed. You
can be on vacation. You never touch it again.

There is currently **one** job:

| Job | How often | What it does |
| --- | --- | --- |
| `npm run purge:deleted-identities -- --apply` | Daily | Finishes off accounts that people deleted more than 180 days ago |

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

### Record which team knocked each door (ONE TIME — after the release that adds it)

Doors now remember **which team knocked them**, so a canvasser who later leaves the team keeps their doors
on it. New doors record this by themselves from the moment you deploy. **Doors knocked *before* that deploy
have no team on them yet** — this is the one-time job that fills them in.

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
- **No new index.** `CanvassActivity` already carries nine on the hottest write path; the team clause rides
  as a residual on `{campaignId, timestamp}`. **`migrate:build-indexes` is not part of this release.**

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
