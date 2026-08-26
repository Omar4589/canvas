import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Folding a retired outcome's HISTORY into another one, over the REAL Express app + a throwaway
// mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/reclassify_test node --test test/reclassifyOutcomes.int.test.js
//
// The invariants this file exists to protect:
//   • THE MONEY INVARIANT — for a RATE-NEUTRAL pair, knocks, contactRate, connectionRate, billable
//     doors and every Campaign.stats counter are IDENTICAL before and after. For a money-moving
//     pair, the PREVIEWED after-figures equal the real ones once the run lands. That pairing is the
//     entire safety argument for letting a tool rewrite recorded dispositions, so both halves are
//     asserted field-by-field rather than described.
//   • Any door outcome may convert to any other, including refused and restricted — but a pair
//     touching either is priced first. (The old "rate-neutral only" and "the source must be
//     switched OFF first" rules were dropped by owner ruling 2026-08-16; requiring a toggle first
//     made correcting a live campaign's mistyped entry impossible.) The TARGET still may not be a
//     retired outcome.
//   • survey_submitted / lit_dropped are refused BY THIS MODULE, which has no answer composer and
//     no archive — a bare flip here would fabricate or orphan answers. The Surveyed direction is
//     handled by services/canvass/surveyConversion.js and covered by surveyConversion.int.test.js.
//   • Org admins only: a lead may toggle outcomes but never rewrite history.
//   • A dry run writes NOTHING.
//   • A conversion preserves GPS, timestamp, canvasser, pass and effort, stamps provenance, and
//     re-resolves door status.
//   • A stamped row is excluded from later runs (provenance stays one level deep).
//   • Revert restores exactly and is idempotent-safe (a second attempt 409s).
//   • Both the run and its revert land in the campaign history feed.
//   • The campaign delete cascade takes ReclassifyRun with it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-reclassify';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const makeHousehold = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Reclass Rd`,
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  normalizedAddress: `${n} reclass rd austin tx 78701`,
  location: { type: 'Point', coordinates: [-97.74 + n * 0.001, 30.26] },
  status: 'unknocked',
  isActive: true,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    CampaignChange, Effort, Pass, Household, CanvassActivity, ReclassifyRun, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Reclass Org', slug: 'reclass-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ra@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'rl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'rc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Reclass C', type: 'survey', state: 'TX',
    timeZone: 'America/Chicago', isActive: true,
    // no_soliciting is already retired — the state this tool is offered in.
    disabledOutcomes: ['no_soliciting'],
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: canv._id });
  await CampaignManager.create({ organizationId: org._id, campaignId: campaign._id, userId: lead._id, isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });
  const doors = await Household.insertMany([1, 2, 3, 4, 5].map((n) => makeHousehold(org._id, campaign._id, effort._id, n)));

  // The ledger under test. Doors 1–3 hold no_soliciting (the outcome being folded); door 4 holds a
  // refusal and door 5 a survey — the rows that MUST be untouched, and the ones that make the
  // money invariant meaningful (a contact rate of zero would prove nothing).
  const act = (household, actionType, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: household._id,
    userId: canv._id, actionType, effortId: effort._id, passId: pass._id,
    location: { lat: 30.26, lng: -97.74, accuracy: 5 },
    timestamp: new Date('2026-08-01T15:00:00Z'), ...extra,
  });
  await CanvassActivity.insertMany([
    act(doors[0], 'no_soliciting'),
    act(doors[1], 'no_soliciting'),
    act(doors[2], 'no_soliciting'),
    act(doors[3], 'refused'),
    act(doors[4], 'survey_submitted'),
  ]);
  for (const d of doors) {
    const status = { 0: 'no_soliciting', 1: 'no_soliciting', 2: 'no_soliciting', 3: 'refused', 4: 'surveyed' }[doors.indexOf(d)];
    await Household.updateOne({ _id: d._id }, { $set: { status } });
  }
  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, campaign, effort, pass, doors,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const url = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/reclassify-outcomes${suffix}`;

// The full set of figures a conversion must not move — read the way the product reads them.
async function moneyShot() {
  const stats = (await Campaign.findById(ctx.campaign._id).lean()).stats;
  // The rollup's org-level envelope is `cumulative` (scoped here to the one campaign) — the
  // same figures the campaign header and the invoice preview read.
  const rollup = await call('GET', `/admin/reports/campaign-rollup?campaignId=${ctx.campaign._id}`, asAdmin());
  const totals = rollup.json?.cumulative || {};
  return {
    stats: {
      activityCount: stats.activityCount,
      knockCount: stats.knockCount,
      surveyedKnockCount: stats.surveyedKnockCount,
      litKnockCount: stats.litKnockCount,
      refusedKnockCount: stats.refusedKnockCount,
      restrictedDoorCount: stats.restrictedDoorCount,
      litDroppedCount: stats.litDroppedCount,
      surveyCount: stats.surveyCount,
    },
    knocks: totals.knocks ?? totals.homesKnocked ?? null,
    contactRate: totals.contactRate ?? null,
    connectionRate: totals.connectionRate ?? null,
    billableDoors: totals.billableDoors ?? null,
  };
}

test('org admins only — a lead may toggle outcomes but never rewrite history', { skip }, async () => {
  assert.equal((await call('GET', url(), asLead())).status, 403);
  assert.equal(
    (await call('POST', url(), { ...asLead(), body: { from: 'no_soliciting', to: 'not_home' } })).status,
    403
  );
});

test('completion actions can NEVER be converted, in either direction', { skip }, async () => {
  // The one rule no page, role or setting can relax: a surveyed entry owns real SurveyResponse
  // answers, so converting into it fabricates answers and out of it orphans them. Enforced by
  // the enum, hence a 400 whichever side it appears on.
  for (const pair of [
    { from: 'survey_submitted', to: 'not_home' },
    { from: 'no_soliciting', to: 'survey_submitted' },
    { from: 'lit_dropped', to: 'not_home' },
    { from: 'not_home', to: 'lit_dropped' },
  ]) {
    const r = await call('POST', url(), { ...asAdmin(), body: pair });
    assert.equal(r.status, 400, `${pair.from} → ${pair.to} must be refused`);
  }
  const same = await call('POST', url(), { ...asAdmin(), body: { from: 'not_home', to: 'not_home' } });
  assert.equal(same.status, 400);
});

test('money-moving pairs are ALLOWED but priced — refused/restricted report their impact', { skip }, async () => {
  // Owner ruling 2026-08-16: any door outcome may be corrected, because a wrong button deserves
  // a real fix. The safety is that the effect is computed and shown first, never that the
  // conversion is forbidden. Dry runs here — nothing may be written yet.
  const r = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['refused'] }, dryRun: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.rateNeutral, false, 'refused → not_home moves the contact rate');
  assert.ok(r.json.impact, 'a money-moving pair must carry an impact preview');
  assert.equal(r.json.impact.moves, true);
  // 5 knocked doors, 2 of them contacts (1 survey + 1 refusal) = 40%. Folding the refusal away
  // leaves the survey alone as a contact = 20%. Exact numbers, so a preview that merely moved in
  // the right direction would still fail.
  assert.equal(r.json.impact.before.contactRate, 40);
  assert.equal(r.json.impact.after.contactRate, 20);
  // ...and it stays a knock either way, so knocks must NOT move.
  assert.equal(r.json.impact.before.knocks, r.json.impact.after.knocks);

  // A rate-neutral pair skips the simulation entirely and says so.
  const neutral = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['no_soliciting'] }, dryRun: true },
  });
  assert.equal(neutral.json.rateNeutral, true);
  assert.equal(neutral.json.impact, null, 'no simulation is run when nothing can move');

  assert.equal(await ReclassifyRun.countDocuments({}), 0, 'dry runs write nothing');
});

test('a live outcome is a legal source; a switched-OFF outcome is never a target', { skip }, async () => {
  // The old "source must be retired first" rule is gone (owner ruling 2026-08-16) — it made
  // correcting a live campaign's mistyped entry impossible.
  const live = await call('POST', url(), {
    ...asAdmin(), body: { from: 'wrong_address', to: 'not_home', dryRun: true },
  });
  assert.equal(live.status, 200, 'a still-enabled outcome may be corrected');

  // A target that is itself switched off is still refused — moving history INTO something the
  // campaign retired contradicts the retirement.
  await Campaign.updateOne({ _id: ctx.campaign._id }, { $set: { disabledOutcomes: ['no_soliciting', 'wrong_address'] } });
  const offTarget = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'wrong_address' } });
  assert.equal(offTarget.status, 400);
  assert.equal(offTarget.json.code, 'TARGET_DISABLED');
  await Campaign.updateOne({ _id: ctx.campaign._id }, { $set: { disabledOutcomes: ['no_soliciting'] } });
});

test('GET lists eligible sources with entry + door counts, and legal targets', { skip }, async () => {
  const r = await call('GET', url(), asAdmin());
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.counts), ['no_soliciting'], 'only the retired outcome is offered');
  assert.deepEqual(r.json.counts.no_soliciting, { entries: 3, doors: 3 });
  assert.ok(r.json.targets.includes('not_home'));
  assert.ok(!r.json.targets.includes('no_soliciting'), 'a switched-off outcome is never a target');
  assert.deepEqual(r.json.runs, []);
});

test('a dry run reports the numbers and writes NOTHING', { skip }, async () => {
  const before = await CanvassActivity.find({ campaignId: ctx.campaign._id }).lean();
  const r = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'not_home', dryRun: true } });
  assert.equal(r.status, 200);
  assert.deepEqual({ entries: r.json.entries, doors: r.json.doors }, { entries: 3, doors: 3 });

  const after = await CanvassActivity.find({ campaignId: ctx.campaign._id }).lean();
  assert.deepEqual(after.map((a) => a.actionType).sort(), before.map((a) => a.actionType).sort());
  assert.equal(await ReclassifyRun.countDocuments({}), 0);
});

test('THE MONEY INVARIANT: converting preserves every rate, counter and billable figure', { skip }, async () => {
  const before = await moneyShot();
  assert.ok(before.knocks > 0, 'the fixture must actually have knocks, or this proves nothing');
  assert.ok(before.contactRate > 0, 'and a non-zero contact rate');

  const r = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'not_home' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.run.count, 3);
  assert.equal(r.json.run.doorCount, 3);
  ctx.runId = r.json.run.id;

  await recomputeCampaignStats(ctx.campaign._id); // recompute from the ledger, don't trust counters
  const after = await moneyShot();
  assert.deepEqual(after, before, 'no knock, rate, counter or billable figure may move');
});

test('the converted rows keep their field data, carry provenance, and re-resolve door status', { skip }, async () => {
  const rows = await CanvassActivity.find({ campaignId: ctx.campaign._id, actionType: 'not_home' }).lean();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.reclassified.from, 'no_soliciting');
    assert.equal(String(row.reclassified.byUserId), String(ctx.admin._id));
    assert.equal(String(row.reclassified.runId), String(ctx.runId));
    assert.equal(row.location.lat, 30.26, 'GPS preserved');
    assert.equal(new Date(row.timestamp).toISOString(), '2026-08-01T15:00:00.000Z', 'timestamp preserved');
    assert.equal(String(row.userId), String(ctx.canv._id), 'canvasser preserved');
    assert.equal(String(row.passId), String(ctx.pass._id), 'pass preserved');
    assert.equal(String(row.effortId), String(ctx.effort._id), 'effort preserved');
  }
  // Status follows the new outcome (statusPrecedence maps each one to its own).
  for (const d of ctx.doors.slice(0, 3)) {
    assert.equal((await Household.findById(d._id).lean()).status, 'not_home');
  }
  // The untouched rows really are untouched.
  const others = await CanvassActivity.find({
    campaignId: ctx.campaign._id, actionType: { $in: ['refused', 'survey_submitted'] },
  }).lean();
  assert.equal(others.length, 2);
  assert.ok(others.every((o) => !o.reclassified));
});

test('a second run excludes already-stamped rows — provenance stays one level deep', { skip }, async () => {
  // no_soliciting now has zero convertible rows, so it drops off the offered list entirely.
  const listed = await call('GET', url(), asAdmin());
  assert.deepEqual(Object.keys(listed.json.counts), [], 'nothing left to fold');

  // Force the same pair again: it must convert nothing rather than re-stamp.
  const again = await call('POST', url(), { ...asAdmin(), body: { from: 'no_soliciting', to: 'not_home' } });
  assert.equal(again.status, 201);
  assert.equal(again.json.run.count, 0, 'stamped rows are not eligible again');
  const stamped = await CanvassActivity.find({ 'reclassified.from': 'no_soliciting' }).lean();
  assert.ok(stamped.every((s) => s.reclassified.from === 'no_soliciting'), 'no stamp was overwritten');
  await ReclassifyRun.deleteOne({ _id: again.json.run.id }); // tidy the empty run
});

test('both the run and its revert land in the campaign history feed', { skip }, async () => {
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'outcomeReclassify' }).lean();
  assert.ok(rows.length >= 1);
  const run = rows.find((r) => r.fromValue === 'no_soliciting' && r.toValue === 'not_home');
  assert.ok(run, 'the run is recorded source → target');
  assert.equal(run.source, 'outcome_reclassify', 'declared as a bulk path, not a human field edit');

  const feed = await call('GET', `/admin/campaigns/${ctx.campaign._id}/history`, asAdmin());
  assert.equal(feed.status, 200);
  assert.ok(feed.json.items.some((i) => i.field === 'outcomeReclassify'), 'it shows in the merged feed');
});

test('revert restores exactly, and a second revert is refused', { skip }, async () => {
  const before = await moneyShot();
  const r = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: ctx.runId } });
  assert.equal(r.status, 200);

  const restored = await CanvassActivity.find({ campaignId: ctx.campaign._id, actionType: 'no_soliciting' }).lean();
  assert.equal(restored.length, 3, 'every row came back');
  assert.ok(restored.every((x) => !x.reclassified), 'the stamp is gone, so the rows are eligible again');
  for (const d of ctx.doors.slice(0, 3)) {
    assert.equal((await Household.findById(d._id).lean()).status, 'no_soliciting', 'door status followed back');
  }
  await recomputeCampaignStats(ctx.campaign._id);
  assert.deepEqual(await moneyShot(), before, 'the revert moves no number either');

  const twice = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: ctx.runId } });
  assert.equal(twice.status, 409);
  assert.equal(twice.json.code, 'ALREADY_REVERTED');

  const listed = await call('GET', url(), asAdmin());
  assert.equal(listed.json.counts.no_soliciting.entries, 3, 'and the source is offered again');
  assert.ok(listed.json.runs.find((x) => x.id === ctx.runId).revertedAt, 'the run is kept, marked reverted');
});

test('a run id from another campaign reads as missing, never as something to undo here', { skip }, async () => {
  const other = await Campaign.create({
    organizationId: ctx.org._id, name: 'Other', type: 'survey', state: 'TX', isActive: true,
  });
  const foreign = await ReclassifyRun.create({
    organizationId: ctx.org._id, campaignId: other._id, from: 'no_soliciting', to: 'not_home', count: 1, doorCount: 1,
  });
  const r = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: String(foreign._id) } });
  assert.equal(r.status, 404);
  await Campaign.deleteOne({ _id: other._id });
  await ReclassifyRun.deleteOne({ _id: foreign._id });
});

// ── The Door Outcomes page: browsing entries and converting a SELECTION ─────────────────────
// Everything above drives the whole-outcome fold (the App Customization card). These drive the
// page: a filtered table, checkbox selections that may span outcomes, and pairs that move money.

const entriesUrl = (qs = '') => `/admin/campaigns/${ctx.campaign._id}/outcome-entries${qs}`;

test('the entries browser lists convertible rows with door, canvasser and round, plus facets', { skip }, async () => {
  const all = await call('GET', entriesUrl(), asAdmin());
  assert.equal(all.status, 200);
  // 3 no_soliciting + 1 refused + 1 survey = 5. The surveyed row IS listed and selectable, but it
  // routes to the survey-conversion endpoints (which can archive its answers), never to the
  // reclassify POST below — the table is a selector, not a promise about what each row can become.
  assert.equal(all.json.total, 5);
  assert.deepEqual(all.json.facets, { no_soliciting: 3, refused: 1, survey_submitted: 1 });

  // ...and asking THIS tool to convert one resolves to nothing rather than doing a bare flip.
  const surveyed = all.json.entries.find((e) => e.actionType === 'survey_submitted');
  const refusal = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', actionIds: [surveyed.id], dryRun: true },
  });
  assert.equal(refusal.status, 400);
  assert.equal(refusal.json.code, 'EMPTY_SELECTION');

  const row = all.json.entries.find((e) => e.actionType !== 'survey_submitted');
  assert.match(row.address, /Reclass Rd$/);
  assert.equal(row.canvasser, 'Cara Canvasser');
  assert.equal(row.round, 'R1');

  const filtered = await call('GET', entriesUrl('?outcomes=refused'), asAdmin());
  assert.equal(filtered.json.total, 1);
  // Facets ignore the outcome chips on purpose — you need to see what else is selectable.
  assert.deepEqual(filtered.json.facets, { no_soliciting: 3, refused: 1, survey_submitted: 1 });

  assert.equal((await call('GET', entriesUrl(), asLead())).status, 403);
});

// The date window, which the client is about to start sending for the first time. Every fixture
// row is stamped 2026-08-01T15:00:00Z, which is Aug 1 at 10:00 in the campaign's America/Chicago
// — so the campaign day and the UTC day agree on which date it is, and disagree about where that
// date STARTS. That is exactly the gap the old `new Date(ymd)` + `$lte` arithmetic fell into.
test('a date window is a whole campaign-tz day, inclusive at both ends', { skip }, async () => {
  // THE REGRESSION. from === to is what every single-day preset emits ("Yesterday" is
  // { from: d, to: d }). Under the old inclusive-$lte-on-UTC-midnight arithmetic this window had
  // ZERO width and the table came back empty — and a "Select all N matching" write scoped to it
  // resolved to nothing.
  const oneDay = await call('GET', entriesUrl('?dateFrom=2026-08-01&dateTo=2026-08-01'), asAdmin());
  assert.equal(oneDay.status, 200);
  assert.equal(oneDay.json.total, 5);

  // The day BEFORE is empty — proving the window really is bounded and not just permissive.
  const dayBefore = await call('GET', entriesUrl('?dateFrom=2026-07-31&dateTo=2026-07-31'), asAdmin());
  assert.equal(dayBefore.json.total, 0);

  // 15:00Z is 10:00 Central on Aug 1 but 09:00 Central on... no day but Aug 1. The UTC-anchored
  // reading would place the window's start at 2026-08-01T00:00Z = Jul 31 19:00 Central, so a
  // Jul 31 window would have swept these rows in. It doesn't.
  const julyOnly = await call('GET', entriesUrl('?dateTo=2026-07-31'), asAdmin());
  assert.equal(julyOnly.json.total, 0);

  // An open-ended start ("everything up to and including Aug 1") includes the whole day.
  const openStart = await call('GET', entriesUrl('?dateTo=2026-08-01'), asAdmin());
  assert.equal(openStart.json.total, 5);

  // Facets honour the window too — they strip only the outcome chips.
  assert.deepEqual(oneDay.json.facets, { no_soliciting: 3, refused: 1, survey_submitted: 1 });
  assert.deepEqual(dayBefore.json.facets, {});
});

test('a scoped run RECORDS the filter that produced it, frozen as people read it', { skip }, async () => {
  // Without this, "answered Opposed, Aug 1-7" and a whole-campaign fold stored identically and
  // the run list could not say which one an admin was about to undo.
  const list = await call('GET', entriesUrl('?outcomes=no_soliciting&dateFrom=2026-08-01&dateTo=2026-08-01'), asAdmin());
  const scope = { outcomes: ['no_soliciting'], dateFrom: '2026-08-01', dateTo: '2026-08-01' };
  const picked = [list.json.entries[0].id];
  const res = await call('POST', url(), { ...asAdmin(), body: { to: 'not_home', scope, actionIds: picked } });
  assert.equal(res.status, 201);

  const runs = await call('GET', url(), asAdmin());
  const run = runs.json.runs.find((r) => r.id === res.json.run.id);
  assert.equal(run.scopeSummary, 'No soliciting · Aug 1');
  assert.equal(run.byIds, true, 'hand-ticked rows are recorded as such');
  const doc = await ReclassifyRun.findById(res.json.run.id).lean();
  assert.deepEqual(doc.selection.scope, scope, 'the raw wire scope rides beside the human line');

  // Put the row back so the later selection/mixed tests see the fixture they expect.
  const undo = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: res.json.run.id } });
  assert.equal(undo.status, 200);
});

test('a selection straddling the surveyed boundary is REFUSED, never silently truncated', { skip }, async () => {
  // The pre-existing hole this closes: hand-tick door-outcome rows AND a surveyed row, and the
  // reclassify path used to quietly keep only the door outcomes — the bar said N, the run wrote
  // fewer, and nothing said so. (A selection spanning several DOOR outcomes stays fully legal —
  // that is the from:'mixed' feature, pinned elsewhere in this file.)
  const all = await call('GET', entriesUrl(), asAdmin());
  const surveyed = all.json.entries.find((e) => e.actionType === 'survey_submitted');
  const door = all.json.entries.find((e) => e.actionType !== 'survey_submitted');

  const spanning = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', actionIds: [surveyed.id, door.id], dryRun: true },
  });
  assert.equal(spanning.status, 409);
  assert.equal(spanning.json.code, 'SELECTION_SPANS_DIRECTIONS');

  // Entirely on the surveyed side is NOT a span — it keeps its long-standing refusal, because
  // this tool has no honest way to convert a surveyed row at all.
  const surveyedOnly = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', actionIds: [surveyed.id], dryRun: true },
  });
  assert.equal(surveyedOnly.status, 400);
  assert.equal(surveyedOnly.json.code, 'EMPTY_SELECTION');
});

test('the table reports doors beside entries, and the sort whitelist holds', { skip }, async () => {
  const all = await call('GET', entriesUrl(), asAdmin());
  assert.equal(all.json.total, 5);
  assert.equal(all.json.doors, 5);
  // Doors honour the chips (deliberately unlike the facets, which strip them).
  const chipped = await call('GET', entriesUrl('?outcomes=no_soliciting'), asAdmin());
  assert.equal(chipped.json.total, 3);
  assert.equal(chipped.json.doors, 3);
  // The whitelist: oldest is accepted, anything else falls back to newest rather than erroring
  // or reaching Mongo raw.
  const oldest = await call('GET', entriesUrl('?sort=oldest'), asAdmin());
  assert.equal(oldest.status, 200);
  assert.deepEqual(oldest.json.entries.map((e) => e.id).sort(), all.json.entries.map((e) => e.id).sort());
  const bogus = await call('GET', entriesUrl('?sort=address'), asAdmin());
  assert.equal(bogus.status, 200);
  assert.equal(bogus.json.total, 5);
});

test('an address search narrows the table AND the write, and refuses when capped', { skip }, async () => {
  // The fixture's doors are '1 Reclass Rd' … '5 Reclass Rd'.
  const one = await call('GET', entriesUrl(`?search=${encodeURIComponent('3 Reclass')}`), asAdmin());
  assert.equal(one.status, 200);
  assert.equal(one.json.total, 1);
  assert.equal(one.json.searchScope.matchedDoors, 1);

  // The invariant: the write's dry run sees the SAME set the table showed.
  const dry = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { search: '3 Reclass', outcomes: ['no_soliciting'] }, dryRun: true },
  });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.entries, 1);

  // A search that matches nothing selects NOTHING — never falls open.
  const none = await call('GET', entriesUrl('?search=zzz-no-such-street'), asAdmin());
  assert.equal(none.json.total, 0);

  // Capped resolution: browse reads as a lower bound, a scope-only write refuses, an id-scoped
  // one does not trip the refusal.
  process.env.ADDRESS_SEARCH_MAX_DOORS = '1';
  try {
    const capped = await call('GET', entriesUrl('?search=Reclass'), asAdmin());
    assert.equal(capped.status, 200);
    assert.equal(capped.json.searchScope.truncated, true);
    assert.equal(capped.json.totalIsLowerBound, true);

    const refused = await call('POST', url(), {
      ...asAdmin(),
      body: { to: 'not_home', scope: { search: 'Reclass', outcomes: ['no_soliciting'] }, dryRun: true },
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, 'SEARCH_SCOPE_TRUNCATED');

    const byIds = await call('POST', url(), {
      ...asAdmin(),
      body: { to: 'not_home', scope: { search: 'Reclass', outcomes: ['no_soliciting'] }, actionIds: [capped.json.entries[0].id], dryRun: true },
    });
    assert.notEqual(byIds.json.code, 'SEARCH_SCOPE_TRUNCATED');
  } finally {
    delete process.env.ADDRESS_SEARCH_MAX_DOORS;
  }
});

test('a malformed filter REFUSES — it never silently becomes "no filter"', { skip }, async () => {
  // The failure this replaces: a bad value was read as null, so the table listed every row while
  // the admin believed it was filtered — and "Select all N matching" would have written them.
  const badDate = await call('GET', entriesUrl('?dateFrom=2026-8-1'), asAdmin());
  assert.equal(badDate.status, 400);

  const badId = await call('GET', entriesUrl('?userId=not-an-object-id'), asAdmin());
  assert.equal(badId.status, 400);

  // The same refusal on the write path, from the same schema.
  const badBody = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { dateFrom: 'yesterday' }, dryRun: true },
  });
  assert.equal(badBody.status, 400);
});

test('the table and the write resolve the SAME rows from one scope', { skip }, async () => {
  // The invariant the whole scope collapse exists to protect: `qs` and `scope` are two encodings
  // of one object, so a filter honoured by the table must be honoured by the run it feeds. This
  // is the test that would have caught the two-memo split.
  const cases = [
    ['?outcomes=no_soliciting', { outcomes: ['no_soliciting'] }],
    ['?dateFrom=2026-08-01&dateTo=2026-08-01&outcomes=no_soliciting', { outcomes: ['no_soliciting'], dateFrom: '2026-08-01', dateTo: '2026-08-01' }],
    ['?dateFrom=2026-07-31&dateTo=2026-07-31&outcomes=no_soliciting', { outcomes: ['no_soliciting'], dateFrom: '2026-07-31', dateTo: '2026-07-31' }],
    [`?userId=${ctx.canv._id}&outcomes=no_soliciting`, { outcomes: ['no_soliciting'], userId: String(ctx.canv._id) }],
    [`?search=${encodeURIComponent('2 Reclass')}&outcomes=no_soliciting`, { outcomes: ['no_soliciting'], search: '2 Reclass' }],
  ];
  for (const [qs, scope] of cases) {
    const table = await call('GET', entriesUrl(qs), asAdmin());
    assert.equal(table.status, 200, qs);
    const write = await call('POST', url(), { ...asAdmin(), body: { to: 'not_home', scope, dryRun: true } });
    // An empty table means an empty selection, which the write path reports as a 400 rather than
    // a zero-row dry run — the two still agree about the row COUNT, which is the invariant.
    const writeEntries = write.status === 400 ? 0 : write.json.entries;
    assert.equal(writeEntries, table.json.total, qs);
  }
});

test('a SELECTION converts exactly the chosen rows, and bumps updatedAt so phones resync', { skip }, async () => {
  const list = await call('GET', entriesUrl('?outcomes=no_soliciting'), asAdmin());
  const picked = list.json.entries.slice(0, 2);
  const untouched = list.json.entries[2];
  const doorBefore = await Household.findById(picked[0].householdId).lean();

  const r = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['no_soliciting'] }, actionIds: picked.map((e) => e.id) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.run.count, 2, 'only the two selected rows');
  assert.equal(r.json.run.from, 'no_soliciting');

  const rows = await CanvassActivity.find({ _id: { $in: [...picked.map((e) => e.id), untouched.id] } }).lean();
  const byId = new Map(rows.map((x) => [String(x._id), x]));
  for (const p of picked) assert.equal(byId.get(p.id).actionType, 'not_home');
  assert.equal(byId.get(untouched.id).actionType, 'no_soliciting', 'the unselected row is untouched');

  // The delta poll finds changed doors with `updatedAt: { $gt: since }` — a status write that
  // doesn't move it never reaches the phones. This is the batched bulkWrite's timestamps: true.
  const doorAfter = await Household.findById(picked[0].householdId).lean();
  assert.equal(doorAfter.status, 'not_home');
  assert.ok(doorAfter.updatedAt > doorBefore.updatedAt, 'updatedAt must move or phones never resync');

  await call('POST', url('/revert'), { ...asAdmin(), body: { runId: r.json.run.id } });
});

test('ids outside the filter are dropped, never written', { skip }, async () => {
  // The stale-checkbox case: an id the admin's CURRENT filter doesn't show may not ride along.
  const refusedRow = (await call('GET', entriesUrl('?outcomes=refused'), asAdmin())).json.entries[0];
  const r = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['no_soliciting'] }, actionIds: [refusedRow.id], dryRun: true },
  });
  // The refused id is not in the no_soliciting filter, so the selection resolves to nothing.
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'EMPTY_SELECTION');
  assert.equal(
    (await CanvassActivity.findById(refusedRow.id).lean()).actionType,
    'refused',
    'and nothing was written'
  );
});

test('a MIXED selection is one run, and revert restores each row to its own original', { skip }, async () => {
  const all = await call('GET', entriesUrl(), asAdmin());
  const one = all.json.entries.find((e) => e.actionType === 'no_soliciting');
  const other = all.json.entries.find((e) => e.actionType === 'refused');

  const r = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'wrong_address', actionIds: [one.id, other.id] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.run.from, 'mixed', 'a selection spanning outcomes records itself as mixed');
  assert.equal(r.json.run.count, 2);

  const converted = await CanvassActivity.find({ _id: { $in: [one.id, other.id] } }).lean();
  assert.deepEqual(converted.map((c) => c.actionType), ['wrong_address', 'wrong_address']);
  // Each row remembers ITS OWN origin — that is what makes a mixed revert exact.
  const stamps = Object.fromEntries(converted.map((c) => [String(c._id), c.reclassified.from]));
  assert.equal(stamps[one.id], 'no_soliciting');
  assert.equal(stamps[other.id], 'refused');

  await call('POST', url('/revert'), { ...asAdmin(), body: { runId: r.json.run.id } });
  const restored = await CanvassActivity.find({ _id: { $in: [one.id, other.id] } }).lean();
  const back = Object.fromEntries(restored.map((c) => [String(c._id), c.actionType]));
  assert.equal(back[one.id], 'no_soliciting');
  assert.equal(back[other.id], 'refused');
  assert.ok(restored.every((c) => !c.reclassified), 'the stamp is dropped on revert');
});

test('the previewed impact is what actually happens, and counters follow', { skip }, async () => {
  // The drift guard. A preview that merely looked plausible would be worse than none — an admin
  // approves a number, so the number has to be the one they get.
  const preview = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['refused'] }, dryRun: true },
  });
  const predicted = preview.json.impact.after;

  const run = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['refused'] } },
  });
  assert.equal(run.status, 201);

  const actual = await moneyShot();
  assert.equal(actual.contactRate, predicted.contactRate, 'previewed contact rate must be the real one');
  assert.equal(actual.knocks, predicted.knocks);
  assert.equal(actual.billableDoors, predicted.billableDoors);
  // A money-moving pair recomputes the denormalized counters; the rate-neutral path skips it
  // because it provably cannot move one.
  assert.equal(actual.stats.refusedKnockCount, 0, 'the refusal is gone from the counters too');

  await call('POST', url('/revert'), { ...asAdmin(), body: { runId: run.json.run.id } });
  const restored = await moneyShot();
  assert.equal(restored.contactRate, 40, 'revert puts the contact rate back');
  assert.equal(restored.stats.refusedKnockCount, 1);
});

test('the campaign delete cascade takes ReclassifyRun with it', { skip }, async () => {
  const doomed = await Campaign.create({
    organizationId: ctx.org._id, name: 'Doomed', type: 'survey', state: 'TX', isActive: true,
  });
  await ReclassifyRun.create({
    organizationId: ctx.org._id, campaignId: doomed._id, from: 'no_soliciting', to: 'not_home', count: 2, doorCount: 2,
  });
  assert.equal(await ReclassifyRun.countDocuments({ campaignId: doomed._id }), 1);

  await deleteCampaignCascade(doomed);
  assert.equal(await ReclassifyRun.countDocuments({ campaignId: doomed._id }), 0, 'no orphan run survives');
  await Campaign.deleteOne({ _id: doomed._id });
});

test('run detail itemizes the exact rows, and honestly loses them on revert', { skip }, async () => {
  // Self-contained: a fresh row so earlier tests' conversions can't skew the expectation.
  const row = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.doors[0]._id,
    userId: ctx.canv._id, actionType: 'refused', effortId: ctx.effort._id, passId: ctx.pass._id,
    location: { lat: 30.26, lng: -97.74, accuracy: 5 }, timestamp: new Date('2026-08-02T15:00:00Z'),
  });
  const made = await call('POST', url(), {
    ...asAdmin(),
    body: { to: 'wrong_address', actionIds: [String(row._id)] },
  });
  assert.equal(made.status, 201);
  const runId = made.json.run.id;

  const detail = await call('GET', url(`/${runId}/entries`), asAdmin());
  assert.equal(detail.status, 200);
  assert.equal(detail.json.total, 1);
  assert.equal(detail.json.entries[0].from, 'refused');
  assert.equal(detail.json.entries[0].to, 'wrong_address');
  assert.match(detail.json.entries[0].address, /Reclass Rd/);
  assert.equal(detail.json.entries[0].canvasser, 'Cara Canvasser');
  assert.equal(detail.json.entries[0].round, 'R1');
  assert.equal((await call('GET', url(`/${runId}/entries`), asLead())).status, 403);

  // Revert consumes the stamps — the summary row survives, the itemization does not, and the
  // response says WHICH of those happened rather than serving an unexplained empty list.
  await call('POST', url('/revert'), { ...asAdmin(), body: { runId } });
  const after = await call('GET', url(`/${runId}/entries`), asAdmin());
  assert.equal(after.json.reverted, true);
  assert.equal(after.json.total, 0);
  await CanvassActivity.deleteOne({ _id: row._id });
});

