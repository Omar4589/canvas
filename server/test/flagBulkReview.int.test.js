import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Bulk flag review over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/flagbulk_test node --test test/flagBulkReview.int.test.js
// Locks the POST /admin/reports/flags/review-bulk contract: scope in the QUERY (so the
// router's campaign-scope guard vets it — deliberately NOT exempt like /flags/review),
// server-resolved targets (actionIds only narrows; out-of-scope ids are ignored, and
// reasonsAtReview comes from the server's own detection), dryRun counting, the
// created/overwritten undo split, the empty-note-preserves rule, bulk reopen's
// drop-reviewStatus undo semantics, and the BULK_REVIEW_CAP 409.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-flag-bulk';

const { createApp } = await import('../src/app.js');
const { BULK_REVIEW_CAP } = await import('../src/routes/admin/reports.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { FlagReview } = await import('../src/models/FlagReview.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

function hh(orgId, campaignId, n, pin) {
  return {
    organizationId: orgId,
    campaignId,
    addressLine1: `${n} Bulk St`,
    city: 'Town',
    state: 'TX',
    zipCode: '75701',
    normalizedAddress: `${n} BULK ST|TOWN|TX|75701`,
    location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

// A ledger row 5 m from its own pin with a tight fix — flags NOTHING unless the extras
// (mocked / wasOfflineSubmission) say so. Doors sit ~1.1 km apart and rows 10 min apart, so
// far/rapid/one_spot can't muddy the counts.
function row(campaignId, householdId, pin, ts, extra = {}) {
  return {
    organizationId: ctx.org._id,
    campaignId,
    householdId,
    userId: ctx.canv._id,
    actionType: 'not_home',
    timestamp: ts,
    location: { lat: pin.lat + 0.000045, lng: pin.lng, accuracy: 5, ...(extra.location || {}) },
    distanceFromHouseMeters: 5,
    wasOfflineSubmission: !!extra.offline,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, CanvassActivity, FlagReview, CampaignManager, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Bulk Org', slug: 'bulk-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ba@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'bl@t.co', passwordHash: 'x', isActive: true });
  const otherLead = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'bo@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Gil', lastName: 'Walker', email: 'bc@t.co', passwordHash: 'x', isActive: true });
  for (const [u, role] of [[admin, 'admin'], [lead, 'lead'], [otherLead, 'lead'], [canv, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp1 = await Campaign.create({ organizationId: org._id, name: 'Bulk C1', type: 'survey', state: 'TX', isActive: true });
  const camp2 = await Campaign.create({ organizationId: org._id, name: 'Bulk C2', type: 'survey', state: 'TX', isActive: true });
  const camp3 = await Campaign.create({ organizationId: org._id, name: 'Bulk C3', type: 'survey', state: 'TX', isActive: true });
  await CampaignManager.create({ userId: lead._id, organizationId: org._id, campaignId: camp1._id });
  await CampaignManager.create({ userId: otherLead._id, organizationId: org._id, campaignId: camp2._id });

  Object.assign(ctx, { org, admin, lead, otherLead, canv, camp1, camp2, camp3 });

  // camp1: 6 mock_gps (high) + 3 weak_gps offline (low) — 9 flagged rows.
  const pins1 = Array.from({ length: 9 }, (_, i) => ({ lng: -95.3 + i * 0.01, lat: 32.35 }));
  const homes1 = await Household.insertMany(pins1.map((p, i) => hh(org._id, camp1._id, i + 1, p)));
  const base1 = Date.now() - 3 * 3600_000;
  const rows1 = homes1.map((h, i) =>
    row(camp1._id, h._id, pins1[i], new Date(base1 + i * 600_000),
      i < 6 ? { location: { mocked: true } } : { offline: true })
  );
  await CanvassActivity.insertMany(rows1);
  ctx.camp1Mocked = await CanvassActivity.find({ campaignId: camp1._id, 'location.mocked': true })
    .sort({ timestamp: 1 })
    .lean();

  // camp2: 2 mock rows — proves camp1 bulk writes never leak across campaigns.
  const pins2 = [{ lng: -95.0, lat: 32.5 }, { lng: -94.99, lat: 32.5 }];
  const homes2 = await Household.insertMany(pins2.map((p, i) => hh(org._id, camp2._id, 100 + i, p)));
  await CanvassActivity.insertMany(
    homes2.map((h, i) => row(camp2._id, h._id, pins2[i], new Date(base1 + i * 600_000), { location: { mocked: true } }))
  );
  ctx.camp2Actions = await CanvassActivity.find({ campaignId: camp2._id }).lean();

  // camp3: BULK_REVIEW_CAP + 1 mocked rows on ONE door (same-door gaps skip `rapid`, one
  // household can't trip one_spot) — arms the cap 409.
  const pin3 = { lng: -94.5, lat: 32.6 };
  const [home3] = await Household.insertMany([hh(org._id, camp3._id, 300, pin3)]);
  const base3 = Date.now() - 12 * 3600_000;
  await CanvassActivity.insertMany(
    Array.from({ length: BULK_REVIEW_CAP + 1 }, (_, i) =>
      row(camp3._id, home3._id, pin3, new Date(base3 + i * 10_000), { location: { mocked: true } })
    )
  );

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.adminTok = signUserToken(admin);
  ctx.leadTok = signUserToken(lead);
  ctx.otherLeadTok = signUserToken(otherLead);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': String(ctx.org._id),
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

const bulk = (query, body, token = ctx.adminTok) =>
  call('POST', `/admin/reports/flags/review-bulk?${query}`, { token, body });

test('sanity after the resolveFlagScope extraction: GET /flags is unchanged', { skip }, async () => {
  const r = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp1._id}`, { token: ctx.adminTok });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.total, 9, '6 mock + 3 weak');
  assert.strictEqual(r.json.summary.totals.mockGps, 6);
  assert.strictEqual(r.json.summary.totals.weakGps, 3);
  assert.strictEqual(r.json.summary.totals.open, 9);
  const high = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp1._id}&severity=high`, { token: ctx.adminTok });
  assert.strictEqual(high.json.total, 6, 'severity is a MIN filter — the low weak rows drop');
});

test('dryRun counts without writing; severity/reasonType narrow the scope', { skip }, async () => {
  const all = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open`, { status: 'dismissed', dryRun: true });
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.json.matched, 9);
  assert.strictEqual(all.json.dryRun, true);

  const high = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open&severity=high`, { status: 'dismissed', dryRun: true });
  assert.strictEqual(high.json.matched, 6, 'high = the mock rows only');

  const weak = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open&reasonType=weak_gps`, { status: 'dismissed', dryRun: true });
  assert.strictEqual(weak.json.matched, 3);

  assert.strictEqual(await FlagReview.countDocuments({}), 0, 'dry runs wrote nothing');
});

test('always campaign-scoped: all=1 and bad status are refused', { skip }, async () => {
  const wide = await bulk('all=1', { status: 'dismissed' });
  assert.strictEqual(wide.status, 400);
  assert.match(wide.json.error, /campaignId/i, 'org-wide bulk is not a thing');

  const none = await call('POST', '/admin/reports/flags/review-bulk', { token: ctx.adminTok, body: { status: 'dismissed' } });
  assert.strictEqual(none.status, 400, 'no campaignId → refused (router guard or handler)');

  const bad = await bulk(`campaignId=${ctx.camp1._id}`, { status: 'nuke' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /status/i);
});

test('actionIds NARROWS the server-resolved set; out-of-scope ids are ignored', { skip }, async () => {
  const [m1, m2] = ctx.camp1Mocked;
  const r = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open`, {
    status: 'dismissed',
    actionIds: [
      String(m1._id),
      String(m2._id),
      String(ctx.camp2Actions[0]._id), // other campaign — must be ignored, not written
      String(new mongoose.Types.ObjectId()), // nonsense — ignored
    ],
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.matched, 2, 'only the two in-scope ids count');
  assert.strictEqual(r.json.createdActionIds.length, 2, 'both were open → created');
  assert.strictEqual(r.json.overwrittenActionIds.length, 0);

  assert.strictEqual(await FlagReview.countDocuments({}), 2);
  const saved = await FlagReview.findOne({ actionId: m1._id }).lean();
  assert.strictEqual(saved.status, 'dismissed');
  assert.strictEqual(String(saved.reviewedBy), String(ctx.admin._id));
  assert.strictEqual(String(saved.campaignId), String(ctx.camp1._id), 'campaign from the server entry, not the client');
  assert.ok(saved.reasonsAtReview.includes('mock_gps'), 'reasons snapshotted from the SERVER detection');
  assert.strictEqual(await FlagReview.countDocuments({ actionId: ctx.camp2Actions[0]._id }), 0, 'nothing leaked into camp2');
});

test('an empty shared note preserves per-entry notes; a non-empty one overwrites', { skip }, async () => {
  const [m1, m2] = ctx.camp1Mocked;
  // Someone wrote a per-entry note through the single-review route.
  const single = await call('POST', '/admin/reports/flags/review', {
    token: ctx.adminTok,
    body: { actionModel: 'CanvassActivity', actionId: String(m1._id), status: 'dismissed', note: 'keep me' },
  });
  assert.strictEqual(single.status, 200);

  // Bulk with NO note over both dismissed rows → statuses move, notes untouched.
  const sweep = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=dismissed`, { status: 'reviewed' });
  assert.strictEqual(sweep.json.matched, 2);
  assert.strictEqual(sweep.json.createdActionIds.length, 0, 'both already had decisions');
  assert.strictEqual(sweep.json.overwrittenActionIds.length, 2, '…so both report as overwritten (not undoable)');
  assert.strictEqual((await FlagReview.findOne({ actionId: m1._id }).lean()).note, 'keep me', 'empty note left it alone');
  assert.strictEqual((await FlagReview.findOne({ actionId: m1._id }).lean()).status, 'reviewed');
  assert.strictEqual((await FlagReview.findOne({ actionId: m2._id }).lean()).note ?? null, null);

  // Bulk WITH a note overwrites.
  const noted = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=reviewed`, { status: 'reviewed', note: 'swept' });
  assert.strictEqual(noted.json.matched, 2);
  assert.strictEqual((await FlagReview.findOne({ actionId: m1._id }).lean()).note, 'swept');
  assert.strictEqual((await FlagReview.findOne({ actionId: m2._id }).lean()).note, 'swept');
});

test('undo contract: reopen needs the scope WITHOUT reviewStatus, and only created ids', { skip }, async () => {
  // Dismiss everything still open (4 mock + 3 weak).
  const r = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open`, { status: 'dismissed' });
  assert.strictEqual(r.json.matched, 7);
  assert.strictEqual(r.json.createdActionIds.length, 7, 'all were open → the whole batch is undoable');

  // The trap the clients must avoid: replaying the ORIGINAL scope (reviewStatus=open) matches
  // nothing — the entries just stopped being open.
  const wrong = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open`, {
    status: 'open',
    actionIds: r.json.createdActionIds,
  });
  assert.strictEqual(wrong.json.matched, 0, 'the naive replay is a no-op');
  assert.strictEqual(wrong.json.deleted, 0);

  // The correct undo: same scope minus reviewStatus, ids = createdActionIds.
  const undo = await bulk(`campaignId=${ctx.camp1._id}`, { status: 'open', actionIds: r.json.createdActionIds });
  assert.strictEqual(undo.json.matched, 7);
  assert.strictEqual(undo.json.deleted, 7);
  assert.strictEqual(await FlagReview.countDocuments({}), 2, 'back to just the two reviewed rows');
});

test('a lead can bulk only on a campaign they manage (the guard this route is NOT exempt from)', { skip }, async () => {
  const own = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open`, { status: 'reviewed', dryRun: true }, ctx.leadTok);
  assert.strictEqual(own.status, 200);
  assert.ok(own.json.matched > 0);

  const foreign = await bulk(`campaignId=${ctx.camp2._id}&reviewStatus=open`, { status: 'reviewed', dryRun: true }, ctx.leadTok);
  assert.strictEqual(foreign.status, 403, 'camp2 is not theirs');

  const other = await bulk(`campaignId=${ctx.camp1._id}&reviewStatus=open`, { status: 'reviewed', dryRun: true }, ctx.otherLeadTok);
  assert.strictEqual(other.status, 403, 'a camp2 lead gets nothing on camp1');
});

test('the flags LIST obeys the same lead scoping as the bulk write', { skip }, async () => {
  const own = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp1._id}`, { token: ctx.leadTok });
  assert.strictEqual(own.status, 200);
  const adminView = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp1._id}`, { token: ctx.adminTok });
  assert.strictEqual(own.json.total, adminView.json.total, 'a granted lead reads the same list an admin does');
  assert.ok(own.json.total > 0, 'and the list is not vacuously empty');

  // NB: these 403s come from the reports router's own scope gate (reports.js), which returns
  // a plain {error} without the FORBIDDEN_ROLE code — so only the status is pinned here.
  const foreign = await call('GET', `/admin/reports/flags?campaignId=${ctx.camp2._id}`, { token: ctx.leadTok });
  assert.strictEqual(foreign.status, 403, 'an unmanaged campaign is refused');

  const orgWide = await call('GET', '/admin/reports/flags', { token: ctx.leadTok });
  assert.strictEqual(orgWide.status, 403, 'no campaignId means org-wide — never lead territory');
});

test('campaign scopes stay watertight under a real write', { skip }, async () => {
  const before1 = await FlagReview.countDocuments({ campaignId: ctx.camp1._id });
  const r = await bulk(`campaignId=${ctx.camp2._id}&reviewStatus=open`, { status: 'dismissed' });
  assert.strictEqual(r.json.matched, 2);
  assert.strictEqual(await FlagReview.countDocuments({ campaignId: ctx.camp2._id }), 2);
  assert.strictEqual(await FlagReview.countDocuments({ campaignId: ctx.camp1._id }), before1, 'camp1 untouched');
});

test(`over ${BULK_REVIEW_CAP} matches → 409, nothing written`, { skip }, async () => {
  const r = await bulk(`campaignId=${ctx.camp3._id}&reviewStatus=open`, { status: 'dismissed' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.matched, BULK_REVIEW_CAP + 1);
  assert.match(r.json.error, /narrow/i);
  assert.strictEqual(await FlagReview.countDocuments({ campaignId: ctx.camp3._id }), 0, 'the cap never partial-applies');
});
