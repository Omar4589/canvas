# Getting started (a new campaign → canvassers knocking)

A click-by-click walkthrough that takes a brand-new campaign all the way to a live pass in the field.
The **Setup progress** card on the campaign's dashboard mirrors these steps and highlights your next
action, so you never have to remember the order.

- **Part 1 — For everyone** is the plain-language walkthrough, step by step.
- **Part 2 — Technical reference** is for developers (and Claude): where each step is enforced.

Related: [CAMPAIGNS.md](CAMPAIGNS.md) (managing/extending a campaign after setup),
[IMPORTS.md](IMPORTS.md) (voter import), [SURVEYS.md](SURVEYS.md) (build/attach a survey),
[EFFORTS.md](EFFORTS.md) (walk lists), [PASSES.md](PASSES.md) (passes: lifecycle + where they're
managed), [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (cutting books), [METRICS.md](METRICS.md) (the
numbers once you're live).

---

# Part 1 — For everyone

## The pieces

```
Campaign
  └─ Walk list        a parallel operation (an area or a team) — owns a disjoint set of doors
       └─ Pass        one billable sweep through that walk list's doors (Pass 1, Pass 2, …)
            └─ Book    a walkable slice of the pass (a canvasser's turf)
                 └─ Doors → Voters
```

You build top-down. Each step below is one screen; the dashboard's **Setup progress** card links
straight to each.

## The steps

### 1. Create the campaign
**Campaigns → New campaign.** Give it a name, a **type** (*survey* or *lit drop*), a **state**, and a
**timezone** (auto-fills from the state — it defines "a day" for reporting). A survey is **not**
required yet. After it's created you drill into it (the sidebar becomes that campaign's tabs) and
you're pointed at Voter Import.

### 2. Import voters
**Voter Import → upload a file.** If the file has latitude/longitude columns they're used as-is;
otherwise the app **geocodes** the addresses for you. The **preview** shows the split — new doors,
existing doors (updated in place, never duplicated), moved voters, near-duplicates — before you
commit. New addresses land in **Intake** (owned by no walk list yet). See [IMPORTS.md](IMPORTS.md).

### 3. Attach a survey *(survey campaigns only)*
On the campaign's **Survey** tab, pick an existing survey or build one. **Timing is flexible** — do
it any time before you activate a pass; the requirement is enforced at **activation**, not now.
Lit-drop campaigns skip this entirely. See [SURVEYS.md](SURVEYS.md).

### 4. Create a walk list and give it doors
**Walk Lists → New walk list.** Name it and pick its **Doors** source:
- **All remaining doors (Intake)** — the usual whole-district list (every unassigned door).
- **From a saved search** — only that saved search's unowned doors (e.g. one precinct, or a CSV you
  uploaded). Build saved searches on the **Saved Searches** tab.
- **None** — an empty list; claim doors later from the walk list's **Claim** panel.

Creating the walk list **auto-creates its Pass 1** — there's no separate "make a pass" step. The
success message reads *"Pass 1 is ready — Cut its books →"* and links straight to Turf Cutting. See
[EFFORTS.md](EFFORTS.md) and [PASSES.md](PASSES.md).

### 5. Cut and accept books
**Turf Cutting → pick the pass.** Generate books (geometrically, or by an attribute like precinct),
review them, then **Accept**. Accepting is what turns draft books into real, assignable turf. See
[PASSES_AND_TURF.md](PASSES_AND_TURF.md).

> **Gotcha — books before activation.** You **cannot activate a pass until it has at least one
> accepted book** (and, for survey campaigns, a survey attached). Generating alone isn't enough —
> you must **Accept**.

### 6. Assign canvassers
Still on **Turf Cutting**, assign each book to a canvasser. If you have no canvassers yet, add them
on the org **Users** page first. Assigning is what fills the walk list's crew automatically.

> **Gotcha — assign can come after activation.** Assigning canvassers is **not** a gate. You can
> activate first and assign later (you'll just get a "no one's assigned yet — activate anyway?"
> confirm). Canvassers only see books assigned to them, so nobody has work until you assign.

### 7. Activate the pass
Open the walk list (**Walk Lists → Manage**) → the **Passes** panel → **Activate**. The pass goes
**live** and the field app shows the work. Each walk list has **one active pass** at a time;
activating a later pass archives the previous one (other walk lists are untouched).

Once you're live, the dashboard shows a slim **"Setup complete — this campaign is live."** banner. It
disappears on its own once the first knock comes in — or dismiss it now with its **✕** (it stays
hidden for every admin).

## Running a follow-up (Pass 2 and beyond)
A pass is one sweep. To go again — a full re-knock, the not-homes only, or GOTV to your supporters —
add a **New pass** in the walk list's Passes panel, then cut its books (choosing all doors or a
targeted subset **at cut time** on the Turf page), assign, and activate. See [PASSES.md](PASSES.md).

---

# Part 2 — Technical reference

Where each step is enforced (all admin routes require an org **admin** role):

- **Setup readiness / the dashboard card.** `GET /admin/campaigns/:id/setup-status`
  ([setupStatus.js](../server/src/routes/admin/setupStatus.js)) derives the ordered chain via
  `deriveSetupSteps` ([setupSteps.js](../server/src/services/reports/setupSteps.js)): campaign →
  voters → survey → doors-in-a-walk-list → **pass created** → books cut & accepted → canvassers
  assigned → **pass activated**. Rendered by [SetupProgress.jsx](../client/src/components/SetupProgress.jsx).
- **The go-live banner is dismissible.** `POST /admin/campaigns/:id/setup-status/dismiss-live` stamps
  `Campaign.setupLiveDismissedAt`; the GET returns `liveDismissed`, and the card hides for every admin
  once set. It only silences the go-live confirmation — an incomplete campaign still shows the full
  checklist.
- **Auto Pass 1.** `POST /admin/campaigns/:id/efforts` ([efforts.js](../server/src/routes/admin/efforts.js))
  calls `createNextPass` ([createPass.js](../server/src/services/passes/createPass.js)) best-effort
  after claiming doors, and returns `{ effort, claimed, pass }`.
- **Books.** `POST …/turfs/generate` enqueues a job that writes `Turf`s with `status:'draft'`;
  `POST …/turfs/accept` flips them to `status:'published'` ([turfs.js](../server/src/routes/admin/turfs.js)).
- **Activation gate.** `POST …/passes/:id/activate` ([passes.js](../server/src/routes/admin/passes.js))
  requires ≥1 `Turf{status:'published'}` for the pass, and — for `campaign.type === 'survey'` — a
  `campaign.surveyTemplateId`. It archives the walk list's other active pass, then sets `active`.
- **Assignment is not gated.** No server check blocks a zero-assignment activation; the client's
  `ActivateButton` ([PassManager.jsx](../client/src/components/PassManager.jsx)) only shows a
  non-blocking "activate anyway" confirm.
