import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// SUPERSEDED desk marks, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/desksup_test node --test test/deskMarkSuperseded.int.test.js
//
// The scenario: an admin marks a house Restricted from the desk because they believe it is inside
// a gated community. A canvasser gets in anyway and surveys it. That override SUCCEEDS by design
// — bulkRestrict.int.test.js:251 already pins 'field re-disposition overrides a bulk mark' — and
// this suite pins everything that has to remain TRUE around it, all of which was wrong before:
//
//   1. the admin's desk row survives the canvasser's write (the deleteMany is scoped to the
//      recording canvasser's own userId), and the door's per-round status flips to surveyed;
//   2. the book's `bulkRestrictedCount` still counts that ROW — it is what the undo deletes, so
//      it must not be redefined — and the new `bulkRestrictedSupersededCount` reports the gap,
//      which is what the book chip disagreeing with its own status chips came down to;
//   3. the superseded row is still REMOVABLE by the per-door undo, with no status guard, and
//      removing it leaves the door surveyed;
//   4. `restrictedFrom` tells the phone WHO restricted a door ('desk' vs 'field') for its round,
//      so the canvasser can tell an office prediction from a colleague's observation;
//   5. "Exclude restricted-access homes" honours a LIVE desk mark in the effort's latest round
//      even when the door's completion-sticky GLOBAL status says 'surveyed' — the case where the
//      published promise used to be false and a gated home was cut straight back in.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-desk-superseded';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { getPassStatusMap } = await import('../src/services/passes/passStatus.js');
const { deskMarkStateForPasses, countDeskMarksByBook } = await import('../src/services/canvass/deskRestrict.js');
const { cutExclusionFilter, restrictedDoorIdsForEffort } = await import('../src/services/turf/generateTurf.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const LOC = { lat: 28.3, lng: -81.4, accuracy: 8 };

const makeHousehold = (orgId, campaignId, effortId, n, extra = {}) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Gatehouse Way`,
  city: 'Town',
  state: 'FL',
  zipCode: '34741',
  normalizedAddress: `${n} GATEHOUSE WAY|TOWN|FL|34741`,
  location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
  isActive: true,
  ...extra,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  const org = await Organization.create({ name: 'Gate Org', slug: 'gate-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'gs-a@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'gs-c@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Support ask',
    version: 1,
    questions: [{
      key: 'support', label: 'Can we count on your support?', type: 'single_choice', order: 0,
      options: [{ id: 'opt_yes', text: 'Yes', order: 0 }, { id: 'opt_no', text: 'No', order: 1 }],
    }],
  });

  const camp = await Campaign.create({ organizationId: org._id, name: 'Gate C', type: 'survey', state: 'FL', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  // One effort, one ACTIVE round, one published book holding four doors:
  //   gated   — desk-marked, then SURVEYED by the canvasser (the headline case)
  //   knocked — desk-marked, then NOT-HOME'd (a non-completion override)
  //   held    — desk-marked and left alone (the control: still live)
  //   plain   — never marked
  const eff = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: eff._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const [gated, knocked, held, plain] = await Household.insertMany(
    [1, 2, 3, 4].map((n) => makeHousehold(org._id, camp._id, eff._id, n))
  );
  const doors = [gated, knocked, held, plain];
  const book = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book 1', mode: 'geometric',
    status: 'published', householdIds: doors.map((h) => h._id), doorCount: doors.length,
  });
  await Household.updateMany({ _id: { $in: doors.map((h) => h._id) } }, { $set: { turfId: book._id } });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: book._id, userId: canv._id });

  const voter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: gated._id,
    stateVoterId: 'GS1', firstName: 'Vera', lastName: 'Gate', fullName: 'Vera Gate',
    dateOfBirth: new Date('1970-04-02'), doNotContact: { flagged: false, reason: null },
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, camp, eff, pass, book, template, voter,
    gated, knocked, held, plain,
    adminTok: signUserToken(admin), canvTok: signUserToken(canv),
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

const bookRow = async () => {
  const r = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs?passId=${ctx.pass._id}`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  return (r.json.turfs || []).find((t) => String(t._id) === String(ctx.book._id));
};

const passStatusOf = async (hh) =>
  (await getPassStatusMap(ctx.pass._id, [hh._id], 'survey')).get(String(hh._id))?.status || 'unknocked';

test('1. three doors get a desk mark; all three are live and none is superseded', { skip }, async () => {
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restrict-doors`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { householdIds: [ctx.gated._id, ctx.knocked._id, ctx.held._id].map(String), passId: String(ctx.pass._id) },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.marked, 3);

  const b = await bookRow();
  assert.strictEqual(b.bulkRestrictedCount, 3, 'rows on file');
  assert.strictEqual(b.bulkRestrictedSupersededCount, 0, 'all three still hold');
  assert.strictEqual(await passStatusOf(ctx.gated), 'restricted');
});

test('2. restrictedFrom tells the phone the mark came from the DESK, per round', { skip }, async () => {
  const boot = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, {
    token: ctx.canvTok, orgId: ctx.org._id,
  });
  assert.strictEqual(boot.status, 200);
  const wire = (boot.json.households || []).find((h) => String(h._id) === String(ctx.gated._id));
  assert.ok(wire, 'a desk-marked door is still served to the canvasser — it is not a lock');
  assert.strictEqual(wire.status, 'restricted');
  assert.strictEqual(wire.restrictedFrom, 'desk');

  const untouched = (boot.json.households || []).find((h) => String(h._id) === String(ctx.plain._id));
  assert.strictEqual(untouched.restrictedFrom, null, 'null for every non-restricted door');
});

test('3. THE OVERRIDE: the canvasser surveys the gated door — 201, status flips, desk row survives', { skip }, async () => {
  const r = await call('POST', `/mobile/voters/${ctx.voter._id}/survey`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Yes', optionIds: ['opt_yes'] }],
      location: LOC,
    },
  });
  assert.strictEqual(r.status, 201, 'accepted — nothing refuses a canvasser on a desk-marked door');
  assert.strictEqual(r.json.household.status, 'surveyed');
  assert.strictEqual(r.json.household.restrictedFrom, null, 'the action response speaks per-round too');

  assert.strictEqual(await passStatusOf(ctx.gated), 'surveyed');
  assert.strictEqual(
    await CanvassActivity.countDocuments({ householdId: ctx.gated._id, actionType: 'restricted', via: 'bulk' }),
    1,
    "the admin's desk row is NOT deleted — the deleteMany is scoped to the canvasser's own userId"
  );
});

test('4. a non-completion override supersedes the mark too', { skip }, async () => {
  const r = await call('POST', `/mobile/households/${ctx.knocked._id}/not-home`, {
    token: ctx.canvTok, orgId: ctx.org._id, body: { location: LOC },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(await passStatusOf(ctx.knocked), 'not_home');
  assert.strictEqual(
    await CanvassActivity.countDocuments({ householdId: ctx.knocked._id, actionType: 'restricted', via: 'bulk' }),
    1
  );
});

test('5. the book reports ROWS unchanged and names the superseded subset', { skip }, async () => {
  const b = await bookRow();
  // ROWS must not move: this is what Unmark deletes, and the confirm dialog's "N marks will be
  // removed" has to keep equalling the toast's deletedCount.
  assert.strictEqual(b.bulkRestrictedCount, 3, 'still three rows on file');
  assert.strictEqual(b.bulkRestrictedSupersededCount, 2, 'two of them no longer hold');

  // The single-book read is routed through the SAME primitive, so it cannot drift from the list.
  const detail = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/${ctx.book._id}/households`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.json.turf.bulkRestrictedCount, 3);
  assert.strictEqual(detail.json.turf.bulkRestrictedSupersededCount, 2);

  // …and per door, so the phone's book sheet can offer the undo on a superseded mark at all.
  const row = (detail.json.households || []).find((h) => String(h.id) === String(ctx.gated._id));
  assert.strictEqual(row.status, 'surveyed');
  assert.strictEqual(row.deskMarks, 1, 'the row is still reported on the door that no longer reads restricted');
  const plainRow = (detail.json.households || []).find((h) => String(h.id) === String(ctx.plain._id));
  assert.ok(!('deskMarks' in plainRow), 'omitted where zero — an ordinary door is byte-identical');
});

test('6. the cut map carries deskMarks + restrictedFrom per door (the building/lasso gates)', { skip }, async () => {
  const r = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/doors?passId=${ctx.pass._id}&withStatus=1`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const byId = new Map((r.json.doors || []).map((d) => [String(d.id), d]));
  const g = byId.get(String(ctx.gated._id));
  assert.strictEqual(g.passStatus, 'surveyed');
  assert.strictEqual(g.deskMarks, 1, 'so the popup/selection Unmark gate can key on rows, not status');
  const h = byId.get(String(ctx.held._id));
  assert.strictEqual(h.passStatus, 'restricted');
  assert.strictEqual(h.restrictedFrom, 'desk');
  assert.ok(!('deskMarks' in byId.get(String(ctx.plain._id))), 'omitted where zero');
});

test('7. /activity still carries BOTH rows with via, newest first', { skip }, async () => {
  const r = await call('GET', `/admin/households/${ctx.gated._id}/activity`, {
    token: ctx.adminTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const round = (r.json.rounds || []).find((x) => String(x.passId) === String(ctx.pass._id));
  assert.ok(round, 'the round is present');
  const kinds = round.entries.map((e) => `${e.actionType}:${e.via || 'field'}`);
  assert.strictEqual(kinds[0], 'survey_submitted:field', 'newest first');
  assert.ok(kinds.includes('restricted:bulk'), 'the desk row is still listed — the clients read it from here');
});

test('8. a SUPERSEDED mark is still removable, and removing it leaves the door surveyed', { skip }, async () => {
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unrestrict-doors`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { householdIds: [String(ctx.gated._id)], passId: String(ctx.pass._id) },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.unmarked, 1, 'no status guard stands in the way of an orphaned row');
  assert.strictEqual(
    await CanvassActivity.countDocuments({ householdId: ctx.gated._id, actionType: 'restricted', via: 'bulk' }),
    0
  );
  assert.strictEqual(await passStatusOf(ctx.gated), 'surveyed', 'the survey is untouched');
  assert.strictEqual((await Household.findById(ctx.gated._id).lean()).status, 'surveyed');

  const b = await bookRow();
  assert.strictEqual(b.bulkRestrictedCount, 2);
  assert.strictEqual(b.bulkRestrictedSupersededCount, 1, 'only the not-home one is left superseded');
});

test('9. countDeskMarksByBook reports rows and superseded, and 0/0 for an archived stub', { skip }, async () => {
  const state = await deskMarkStateForPasses(ctx.camp._id, [String(ctx.pass._id)], 'survey');
  const live = countDeskMarksByBook([{ _id: ctx.book._id, passId: ctx.pass._id, status: 'published', householdIds: [ctx.gated._id, ctx.knocked._id, ctx.held._id, ctx.plain._id] }], state);
  assert.deepStrictEqual(live.get(String(ctx.book._id)), { rows: 2, superseded: 1 });

  const stub = countDeskMarksByBook([{ _id: ctx.book._id, passId: ctx.pass._id, status: 'archived', householdIds: [ctx.knocked._id] }], state);
  assert.deepStrictEqual(stub.get(String(ctx.book._id)), { rows: 0, superseded: 0 });
});

test('10. THE CUT BUG: a live desk mark excludes the door even when global status says surveyed', { skip }, async () => {
  // `held` was surveyed in a PRIOR round, so its global Household.status is completion-sticky
  // 'surveyed' forever — while its desk mark in the CURRENT round is live, counted and visible in
  // the console. Before this fix, cutStatusExclusion filtered on that global value alone and cut
  // the gated home straight back into the next round with "Exclude restricted" ticked.
  await Household.updateOne({ _id: ctx.held._id }, { $set: { status: 'surveyed' } });
  assert.strictEqual(await passStatusOf(ctx.held), 'restricted', 'the CURRENT round still says restricted');

  const ids = await restrictedDoorIdsForEffort({
    campaignId: ctx.camp._id, effortId: ctx.eff._id, campaignType: 'survey',
  });
  assert.deepStrictEqual(ids.map(String), [String(ctx.held._id)], 'only the mark that still holds');

  const filter = await cutExclusionFilter({
    campaignId: ctx.camp._id, effortId: ctx.eff._id, campaignType: 'survey', excludeRestricted: true,
  });
  const cuttable = await Household.find(
    { campaignId: ctx.camp._id, effortId: ctx.eff._id, ...filter },
    { _id: 1 }
  ).lean();
  const cutIds = cuttable.map((h) => String(h._id));
  assert.ok(!cutIds.includes(String(ctx.held._id)), 'the gated home is NOT cut back in');
  assert.ok(cutIds.includes(String(ctx.plain._id)), 'an ordinary door still is');
  assert.ok(cutIds.includes(String(ctx.gated._id)), 'a door whose mark was superseded IS cut back in — the crew got in');
});

test('10b. the deciding round is the one holding the MARK, not the effort\'s newest round', { skip }, async () => {
  // The normal shape of a follow-up cut: the marks live on the ACTIVE round, and the round being
  // cut is a brand-new draft with no activity at all. Judging by "the effort's latest round"
  // would look at the empty draft, find nothing, and re-open the very hole this closes — so this
  // case is the one that actually guards the fix.
  const draft = await Pass.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, effortId: ctx.eff._id,
    roundNumber: 2, name: 'Round 2', status: 'draft',
  });
  assert.strictEqual(
    await CanvassActivity.countDocuments({ passId: draft._id }),
    0,
    'the round being cut is empty, as a fresh draft always is'
  );

  const ids = (await restrictedDoorIdsForEffort({
    campaignId: ctx.camp._id, effortId: ctx.eff._id, campaignType: 'survey',
  })).map(String);
  assert.deepStrictEqual(ids, [String(ctx.held._id)], "the ACTIVE round's live mark is still found");

  const filter = await cutExclusionFilter({
    campaignId: ctx.camp._id, effortId: ctx.eff._id, campaignType: 'survey', excludeRestricted: true,
  });
  const cutIds = (await Household.find({ campaignId: ctx.camp._id, effortId: ctx.eff._id, ...filter }, { _id: 1 }).lean())
    .map((h) => String(h._id));
  assert.ok(!cutIds.includes(String(ctx.held._id)), 'and the gated home stays out of the new round');

  await Pass.deleteOne({ _id: draft._id });
});

test('11. the exclusion is $and-shaped so it cannot clobber an _id the caller owns', { skip }, async () => {
  const filter = await cutExclusionFilter({
    campaignId: ctx.camp._id, effortId: ctx.eff._id, campaignType: 'survey', excludeRestricted: true,
  });
  assert.ok(Array.isArray(filter.$and), 'clauses, never a spread _id');
  // The supplemental-book filter owns `_id: { $nin: alreadyBooked }`; both must survive the merge.
  const merged = { campaignId: ctx.camp._id, effortId: ctx.eff._id, _id: { $nin: [ctx.plain._id] }, ...filter };
  const rows = await Household.find(merged, { _id: 1 }).lean();
  const ids = rows.map((h) => String(h._id));
  assert.ok(!ids.includes(String(ctx.plain._id)), "the caller's own _id clause still applies");
  assert.ok(!ids.includes(String(ctx.held._id)), 'and so does the restricted exclusion');

  // Nothing asked for → no clause at all, so an untoggled cut is byte-for-byte what it was.
  const none = await cutExclusionFilter({ campaignId: ctx.camp._id, effortId: ctx.eff._id, campaignType: 'survey' });
  assert.deepStrictEqual(none, {});
});
