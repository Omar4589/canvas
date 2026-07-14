# Deploy runbook — the WS0–WS3 remediation release

Written for the **Heroku web dashboard + Run console**, which is how you actually work. CLI equivalents
are in the last section if you ever want them.

| Fact | Value |
|---|---|
| Heroku app | **`canvass`** |
| Branch to deploy | **`sharedVoters`** |
| Apps | **ONE.** API + web are the same dyno (`server/src/app.js:79-90` serves `client/dist`) |
| Dynos | `web`, `worker` |
| `autoIndex` in prod | **OFF** — indexes never appear on their own |

> ### One app, one deploy. There is no separate "web deploy".
> `heroku-postbuild` builds `client/dist` and the server serves it. **Server and web front-end go live in
> the same instant.** That's why the new-code/old-schema window is real, and why maintenance mode exists.

> ### Where things live in the dashboard
> | What you need | Where |
> |---|---|
> | Run a script | **More ▾** (top right) → **Run console** |
> | Maintenance mode | **Settings** → *Maintenance Mode* → toggle |
> | Dyno formation (worker!) | **Resources** → dyno list |
> | Deploy | **Deploy** tab → *Manual deploy* |
> | Releases / rollback | **Activity** tab → *Roll back to here* |
> | Scheduler | **Resources** → *Heroku Scheduler* |

> ### In the Run console, type the command BARE
> No `heroku run`, no `-a canvass`. The console is already scoped to the app. Exactly like the
> `seed:demo` runs you've already done:
> ```
> npm run migrate:platform-roles -- --apply
> ```
> **The Run console works while maintenance mode is ON.** That's the whole trick — the site is closed to
> the public, and you can still run migrations.

> ### All three migrations are DRY-RUN BY DEFAULT
> Nothing writes without `--apply`. **Run the dry run. Read it. Then apply.** Don't paste both at once.

---

# STEP 0 — The gate. Not a step. A gate.

### 0a. Commit and push the code

Nothing below exists on Heroku until the code is there.

### 0b. Note your rollback point

**Activity** tab → note the current release number (`v###`).

### 0c. ⚠️ The backup. This is the single most important line in this document.

`migrate:persons-org-scope --apply` is **irreversible**. It drops indexes, **deletes orphan Persons**,
and **deletes pending edit proposals**. There is no down-migration — and past that point, **rolling the
code back will NOT save you**: the old code cannot read the new Person shape, so reverting code without
restoring the database leaves you worse off than either clean state.

On your data this migration is nearly a no-op (the audit found zero shared Persons — it will stamp
`organizationId` and split nothing). **"Nearly a no-op" plus "irreversible" is exactly the combination
where people skip the backup because it feels unnecessary.**

> 🛑 **You are on Atlas Free (M0), which is *physically incapable* of being backed up.** Not "backups are
> off" — the feature does not exist on the tier. MongoDB's docs: *"You can't enable backups on Free
> clusters."* The Backup tab shows you an upsell page, not a button.
>
> **So the snapshot gate below cannot be satisfied until you upgrade.** The upgrade is therefore part of
> this deploy, not a side quest — see **STEP 1b**.

**Take the dump now, from the M0, before anything moves.** Get `MONGODB_URI` from Heroku → Settings →
Config Vars → *Reveal*.

```
mongodump --uri="<MONGODB_URI>" --archive=$HOME/doorline-preflight.archive.gz --gzip
```

**Then prove it restores.** A dump file you have never restored is not a backup, it is a hope.

```
./verify-backup.sh $HOME/doorline-preflight.archive.gz
```

*It spins up a throwaway local mongod, **actually restores the archive**, and then recomputes — from the
backup, using the same aggregation the migration itself uses — **exactly what
`migrate:persons-org-scope --apply` will do.** A missing collection is a hard failure, not a `0`.*

**Result on 2026-07-13 — the one-way door turns out to destroy nothing:**

| | |
|---|---|
| **STAMP** `organizationId` | **75,760** (all of them) |
| **SPLIT** across orgs | **0** ✅ matches the cross-org audit |
| **DELETE** orphan Persons | **0** |
| **DELETE** pending proposals | **0** |
| Voters with no `personId` | **0** — a clean 1:1 |

*So step 4 is a pure stamping operation plus an index swap. **It deletes zero documents.** The backup is
still the gate — but you now know what's behind the door.*

> **Cross-check at step 4.** The migration prints these same three numbers in its own dry run. **If prod
> disagrees with this backup, something WROTE to the database in between — stop.** That is precisely what
> a still-running worker dyno looks like, which is the whole reason for the next step.

---

# STEP 0d — 🛑 Drain the queue, while you still can

**Open [`/admin/queues`](https://doorline.app/admin/queues) (Bull Board) NOW, before maintenance.**
Confirm **`import-queue`** and **`turf-queue`** have **zero** active / waiting / delayed jobs.

***Do this first because you cannot do it later.*** *Bull Board is mounted on the **web** dyno
([`app.js:77`](../server/src/app.js#L77)) — the moment maintenance goes on, it serves the maintenance page
like everything else.*

---

# STEP 1 — Maintenance ON, **and the worker OFF**

**Settings** → **Maintenance Mode** → **ON**.
**Resources** → the **`worker`** dyno → toggle it **OFF**.

> ### ⚠️ Maintenance mode does NOT stop the worker. Both toggles are required.
> Heroku maintenance mode only 503s the **web** router. The `worker` dyno keeps draining BullMQ out of
> Redis the entire time — **and the import hazard lives on the worker**
> ([`importProcessor.js:155`](../server/src/services/import/importProcessor.js#L155) →
> `reconcileIdentityFromImport` → **creates Person documents**).
>
> Any import job still sitting in Redis survives the maintenance toggle, survives the Atlas rebuild, and
> executes the instant the STEP 2 deploy reboots the worker — new code, unstamped Persons, old global
> unique indexes still in place. That is exactly the window this step exists to close.
>
> **And step 4 would then delete its work.** `migratePersonsOrgScope` snapshots the voter→person linkage
> ([`:59-63`](../server/src/migrations/migratePersonsOrgScope.js#L59)) and then runs
> `Person.deleteMany({_id: {$nin: linkedIds}})` ([`:148`](../server/src/migrations/migratePersonsOrgScope.js#L148)).
> A Person created by a concurrent import **after** that snapshot isn't in `linkedIds` — so the
> irreversible migration **deletes it**, stranding a freshly-imported Voter with a dangling `personId`.

*Atlas requires the write freeze too: "**halt write operations to your cluster for the duration of your
scale operation.**" **The Run console keeps working** — that's the whole trick.*

*The migration hazard, stated plainly: between the deploy and the migrations, new code runs against the
old schema. Existing `Person` docs have no `organizationId`, so the new matcher won't find them — an
import in that window would duplicate Persons or fail on the old unique index.*

> ### 📱 And tell the crews
> **Run this window when nobody is knocking.** Heroku's maintenance page is a **503**, and until the
> mobile fix in this release reaches phones over-the-air, a phone **with signal** that hits it gets
> *"Action not saved"* and the pin reverts — **the knock is lost, not queued.** (A phone with **no**
> signal queues fine; already-queued knocks are safe.) If crews must be out, tell them **airplane mode**
> for the duration.

---

# STEP 1b — ⚠️ Atlas: Free → M10. **Has downtime. Do it inside this window.**

This is **not a resize** — Atlas rebuilds the cluster on dedicated nodes and copies your data across
(*"requires an initial sync"*). **Budget 10–20 minutes.**

**Atlas → your cluster → Edit Configuration.** In that one dialog:

| Setting | Value | Why |
|---|---|---|
| Tier | **M10** | The floor for dedicated. There is nothing between Flex and M10. |
| Cloud provider / region | **the same one you're on now** | Don't move regions during a migration. |
| **Turn on Cloud Backup** | **ON** | This is the entire point of the upgrade. |
| **Storage auto-scaling** | **ON** (leave checked) | Fires at 90% disk. Free insurance; you'll never hit it. |
| **Cluster tier auto-scaling** | **🛑 OFF — uncheck it** | See below. This is the one that bites. |

> ### Why compute auto-scaling comes OFF
> M10/M20 are **burstable** instances, and Atlas measures their CPU against *baseline*, not 100%. From
> the docs: *"The 90% Relative System CPU Utilization threshold equals **18% absolute CPU** (90% of 20%)."*
>
> **An M10 can trip a scale-up at 18% real CPU.** A CSV voter import pegging one core for twenty minutes
> sits squarely in that zone. Scale-*down* then requires CPU under 45% for the last 10 minutes **and** the
> last 4 hours, with no scale event in 24h — so a twenty-minute import can buy you **a day or more at M20
> rates** ($147/mo vs $57). You are buying a tripwire, not headroom.

### 1c. Diff the connection string. Expect it to be identical.

When the cluster reports healthy: **Atlas → Connect → Drivers**, copy the `mongodb+srv://` string, and
compare it to `MONGODB_URI` in Heroku → Settings → Config Vars.

**It should be unchanged** — the SRV hostname is preserved; what changes is the **IPs behind it**. If it
*does* differ, update the config var now. (Twenty seconds of paranoia. MongoDB never states hostname
preservation in one sentence anywhere, so verify rather than trust.)

***The stale-DNS trap:*** *your running dynos now hold a driver topology pointed at dead IPs. Atlas is
explicit — "**you must restart your applications before connecting to the upgraded cluster.**" There are
forum threads of exactly this: URI correct, app hangs, redeploy fixes it.* **STEP 2 restarts every dyno,
so the deploy IS the restart.** That's why the upgrade goes here and not after.

*(Your `maxPoolSize` is already pinned at 20 per process in `config/db.js:10`, so you're immune to the
other classic surprise — M0's 500-connection ceiling lifting to 1500 and the driver suddenly opening far
more sockets.)*

### 1d. 🛑 NOW take the snapshot — and *look at it*

**Atlas → Backup → Take Snapshot Now.**

**Confirm it shows COMPLETED and restorable before you go on.** Not "clicked the button" — *saw it
finish*. This is the safety net for STEP 4, and STEP 4 is a one-way door.

---

# STEP 2 — Deploy

**Deploy** tab → **Manual deploy** → choose branch **`sharedVoters`** → **Deploy Branch**.

*(If your Deploy tab is wired to GitHub, the branch dropdown is there. If you deploy by git instead:
`git push heroku sharedVoters:main`.)*

Watch the build log finish. **~3–5 minutes** — this is the long pole of the whole deploy.

*This is the step that puts the migration scripts on the dyno. Hence the chicken-and-egg you spotted:
**deploy first, migrate second.** Your read was right.*

---

> ### ⚠️ The deploy may switch the `worker` back ON. Check Resources — it must still be OFF.
> Keep it off until **STEP 5b**. See STEP 1 for why: a queued import running against the half-migrated
> schema is the one thing that can turn step 4's harmless stamping run into an irreversible deletion.

---

# STEP 3 — Migration 1: grandfather yourself. **MUST BE FIRST.**

**More ▾ → Run console.** Dry run:

```
npm run migrate:platform-roles
```

Read it. It should list **your** super-admin account(s). Then apply:

```
npm run migrate:platform-roles -- --apply
```

**Confirm it says it granted break-glass before you move on.**

*`platformRole` defaults to `support`. Until this runs, **your own account cannot delete an organization,
promote staff, or edit canonical identity.** First, so you don't lock yourself out mid-deploy.*

---

# STEP 4 — Migration 2: split the Person graph  ⚠️ **IRREVERSIBLE**

Dry run — **and actually read it**:

```
npm run migrate:persons-org-scope
```

It prints three numbers. **They must match what STEP 0c computed from your backup:**

```
  linked from exactly 1 org  : 75,760   → stamp organizationId
  linked from ≥2 orgs        : 0        → SPLIT into one copy per org
  linked from no voter at all: 0        → delete (nothing references them)
```

> ## 🛑 The one number that must be zero: **SPLIT.**
> That is the number the cross-org audit actually predicts. It said zero. **If the dry run shows any
> Persons linked from ≥2 orgs, the audit and your data disagree — STOP.** The next command is a one-way
> door. Come back and we look at it together.
>
> ### 🛑 And if ANY number disagrees with your backup — STOP.
> The backup said `75,760 / 0 / 0`. If prod now says something else, **something wrote to the database
> after you took the dump.** That means the worker dyno is still draining its queue, and step 4 is about
> to delete the Persons it just created. Go back to STEP 1 and turn the worker off.
>
> ### ⚠️ Orphans are NOT a stop condition — even though they're a deletion.
> *I had this wrong.* Orphan Persons are produced by an ordinary, supported operation:
> [`deleteCampaign.js:40`](../server/src/services/campaigns/deleteCampaign.js#L40) deletes a campaign's
> Voters, and `Person` is **absent from its cascade list** — so every campaign you've ever deleted left
> orphan Persons behind. The cross-org audit never measured orphans and makes **no prediction** about
> them. On your data it's currently **0**. If it's ever non-zero, sanity-check that it's plausible for
> the campaigns you've deleted, then proceed — nothing references them.

If it matches:

```
npm run migrate:persons-org-scope -- --apply
```

---

# STEP 5 — Migration 3: build the new indexes. **This one is not optional.**

> **Step 4 just dropped the legacy global unique indexes. Until this step runs, nothing enforces Person
> uniqueness at all.** Skip it and you are — in your own rollback section's words — *"not corrupt, you are
> unprotected."* `autoIndex` is off in production, so it **never self-heals**.

Dry run:

```
npm run migrate:build-indexes
```

Read it. Then apply — **separately**:

```
npm run migrate:build-indexes -- --apply
```

**It must say: `Done — built missing indexes across N models.`**

Now run the bare command **one more time**. It must now say:

```
All declared indexes are already present. Nothing to build.
```

***Don't skip that last re-run.*** *The Run console takes **one** command. If you paste both lines at
once, only the dry run executes — and its output ("N declared index(es) not present. Re-run with --apply
to build them.") reads like a perfectly normal success. Nothing downstream catches it: the verification
below audits **data**, not indexes, and step 4 just made the data clean, so it prints a happy green result
in exactly the broken state.*

*Creates the org-scoped uniques plus the new `SupportAccessGrant` / `AccessLog` / `RetentionRun` /
`OrgDeletionRequest` indexes. `--apply` uses `createIndexes()` — **additive, never drops.** That's why
step 4 drops the legacy indexes itself, and why running this first wouldn't have helped.*

---

# STEP 5b — ✅ Turn the `worker` dyno back ON

**Resources** tab → **`worker`** → toggle **ON** → **Confirm**.

**This is where the worker comes back — not before.** The migrations are done, Persons are stamped, and
the org-scoped uniques exist. Any import still queued in Redis can now run safely.

***Why this isn't a formality.*** *The 180-day identity purge and the retention triggers are BullMQ
repeatable jobs **on this dyno**. At zero, they never fire — and **nothing fails.** No error, no alert, no
red build. You'd be right back in the state this whole release exists to end: a published legal promise
that silently isn't being kept.*

*This repo has form here — deploying a branch whose Procfile lacked a `worker` line once scaled the dyno
to 0 and Heroku never restored it. **Confirm it's up. Don't assume it.***

---

# STEP 6 — Maintenance OFF

**Settings** → **Maintenance Mode** → toggle **OFF**.

**Expected total downtime: ~20–35 minutes.** The two long poles are the **Atlas rebuild (10–20 min)** and
the **Heroku build (3–5 min)**. The migrations themselves are seconds on data this size.

*Then, while you're still in Atlas: set a **billing alert**. You're moving from $0/mo to ~$60/mo, and an
alert is how you find out if that ever stops being true.*

---

# STEP 7 — Delete the redundant Scheduler entry

**Resources** → **Heroku Scheduler** → find the row that reads exactly:

```
npm run purge:deleted-identities -- --apply
```

Click the **✕ on that row**. 🛑 **Look at the row before you click.** Scheduler lists all jobs together.
Leaving this one is harmless (the purge is idempotent); deleting the *wrong* one is not.

*The purge now runs inside the worker dyno, recorded in `RetentionRun`, with a test that fails if anyone
removes the schedule. A second, invisible enforcement path is exactly what we just removed.*

---

# STEP 8 — Reseed the demo tenant

Run console:

```
npm run seed:demo -- --reset --apply
```

*Restores the reviewer accounts and clean books. `internal` orgs are exempt from the new auto-purges, so
Meridian won't evaporate.*

---

# VERIFICATION — do it, don't assume it

> **The audit trail in this subsystem has already silently recorded nothing once.** The first `accessLog`
> mount matched the wrong path and logged **zero rows while the app worked perfectly**. A missing log row
> is a **rollback trigger**, not a nit.

### A. The AccessLog is live — walk it in the browser

1. **Platform → Support access.** Page loads. *(It's platform-scoped, so it works even when every
   org-scoped panel is 403ing — which is exactly when you'd need it.)*
2. **Org switcher → pick a customer org you are NOT a member of.** A modal appears: org name, a required
   reason, session length, and a plain warning that what you open is logged.
3. Type a real reason → **Start session**.
4. Open **Voters**.
5. Back to **Platform → Support access**. You must see:
   - an **open session**: your name, your reason, `1 record opened`
   - an **access log row**: timestamp, your name, the org, `GET voters`, **and your reason**
6. **End now** on the session → reload Voters → must **403 immediately**.

**If step 5 shows nothing: stop and roll back.**

### B. Your OWN org still works, and is NOT logged

Switch to an org where you hold a real membership. It must open **with no modal** — a member is a member,
not a vendor — and **must not** appear in the access log. *(This was the lockout bug fixed pre-deploy.
Confirm it in prod.)*

### C. Retention is wired — **check it tomorrow, and know what green now means**

**Platform → Support access** shows a retention banner. It will read **RED** right after deploy ("has
NEVER run") — **that is correct.**

It now watches **both** retention jobs and the worst one wins:

| job | runs | what it does |
|---|---|---|
| `purge-deleted-identities` | 03:17 UTC | the 180-day identity purge |
| `retention-triggers` | 04:41 UTC | **deletes organizations** — wind-down, dormancy, delete-on-request SLA |

**It goes green only once both have run. Check it tomorrow, after 04:41 UTC (11:41pm CT).**

*This was a real bug in the release, found by the pre-deploy audit and fixed before you deployed:
`retentionHealth()` hardcoded the purge's job name, so the banner could only ever see one of the two.
The triggers job — the one that honours **delete-on-request**, the promise with actual legal teeth —
could have thrown every night while the banner stayed reassuringly green off the purge beside it. Its
receipts were written and read by nothing. There is now a test that goes red on the old behaviour.*

### D. Nothing is unscoped

Run console:
```
npm run audit:cross-org-identity
```
*Must still print `cross-org identity contamination: 0 rows across 0 orgs.`*

### E. 🛑 LAST THING BEFORE YOU WALK AWAY

**Open `doorline.app` in a normal browser tab (not the dashboard). Confirm the site is actually up.**

*After bouncing between Atlas, the Run console and three dashboard tabs, the easiest mistake in this whole
sequence is finishing the migrations, doing the verification, and leaving your one live customer staring
at a maintenance page.*

---

# ROLLBACK — the honest answer

| Step | Reversible? |
|---|---|
| Atlas Free → M10 (**1b**) | **Effectively no.** The old M0 is destroyed. Your `mongodump` (**0c**) is the rollback — which is why you restore-tested it. |
| `migrate:platform-roles` | **Yes.** Sets a field. Nothing destroyed. |
| `migrate:persons-org-scope` | **NO. ONE-WAY.** Drops indexes, deletes orphan Persons, deletes pending edit proposals. **The Atlas snapshot (1d) is your only rollback.** |
| `migrate:build-indexes` | **Yes.** Additive. Safe to re-run. |

**If step 4 succeeds and step 5 fails** — the realistic bad case:
- Persons are stamped; the legacy indexes are **gone**; the new uniques are **not built**.
- **You are not corrupt — you are unprotected.** Dedup uniqueness is unenforced, so a concurrent import
  could create duplicate Persons within an org.
- **Recovery: just re-run step 5.** It's idempotent. **Keep maintenance ON until it succeeds** — that is
  precisely what the window is for.

**Code rollback (Activity tab → *Roll back to here*) reverts the app but NOT the database.** Past step 4,
the old code cannot correctly read the new Person shape. **Code rollback alone is not a recovery path
after step 4.** That is the entire reason for the snapshot.

---

# CLI equivalents (if you ever want them)

```
heroku releases -a canvass | head -3
heroku maintenance:on  -a canvass
git push heroku sharedVoters:main
heroku ps -a canvass                 # worker.1 must be up
heroku ps:scale worker=1 -a canvass
heroku run -a canvass "npm run migrate:platform-roles -- --apply"
heroku run -a canvass "npm run migrate:persons-org-scope -- --apply"
heroku run -a canvass "npm run migrate:build-indexes -- --apply"
heroku maintenance:off -a canvass
```
*Note the quoting: unquoted, `-a canvass` can be swallowed by the script's own argv. The Run console has
no such problem — it's already scoped to the app.*
