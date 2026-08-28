import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Pin Fixes over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pinfixes_test node --test test/pinFixes.int.test.js
// Proves: the ONE needs-fixing predicate (interpolated + unconfirmed + active) drives the
// list, and the campaigns-rollup pinsToFix badge equals it; confirm-in-place stamps WITHOUT
// touching coordSource/coordConfidence and writes a from==to 'confirm' audit row; the
// building fan-out stamps only interpolated siblings (a corrected or exact door on the same
// pin is never vouched — the repair-script latest-row invariant); undo clears the stamp and
// writes no row; a real MOVE clears the stamp; confirm refuses non-approximate doors
// (NOT_APPROXIMATE), canvassers (403), and archived campaigns (409); and the re-import pin
// shield keeps a confirmed door's pin (keptConfirmed, not keptPins) until overwriteHandEdits
// takes the file's pin AND clears the stamp.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pin-fixes';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Household } = await import('../src/models/Household.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { applyImport } = await import('../src/services/import/csvImporter.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Same pin (5-decimal building key) for the apartment stack; distinct pins elsewhere.
const STACK = [-81.4001, 28.3001];

function hh(orgId, campaignId, n, { coords, coordSource = 'geocodio', coordConfidence = 'interpolated', extra = {} } = {}) {
  return {
    organizationId: orgId,
    campaignId,
    addressLine1: `${n} Approx Way`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} APPROX WAY|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: coords },
    coordSource,
    coordConfidence,
    isActive: true,
    ...extra,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Household, HouseholdLocationChange, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Pins Org', slug: 'pins-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pa@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'pl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'pc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Pins C', type: 'survey', state: 'FL', isActive: true });
  await CampaignManager.create({ campaignId: camp._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const [h1, h2, h3, h4, h5, h6, h7, h8, h9] = await Household.insertMany([
    // In the queue: interpolated, unconfirmed, active.
    hh(org._id, camp._id, 1, { coords: [-81.41, 28.31] }),
    hh(org._id, camp._id, 2, { coords: STACK }),
    hh(org._id, camp._id, 3, { coords: STACK }),
    // Same pin as h2/h3 but NOT eligible: hand-corrected and rooftop-exact — the building
    // fan-out must leave both alone.
    hh(org._id, camp._id, 4, { coords: STACK, coordSource: 'corrected', coordConfidence: null, extra: { correctedAt: new Date() } }),
    hh(org._id, camp._id, 5, { coords: STACK, coordConfidence: 'exact' }),
    // Out of the queue for every other reason:
    hh(org._id, camp._id, 6, { coords: [-81.42, 28.32], coordConfidence: 'exact' }),
    hh(org._id, camp._id, 7, { coords: [-81.43, 28.33], coordSource: 'corrected', coordConfidence: null, extra: { correctedAt: new Date() } }),
    hh(org._id, camp._id, 8, { coords: [-81.44, 28.34], extra: { locationConfirmedBy: admin._id, locationConfirmedAt: new Date() } }),
    hh(org._id, camp._id, 9, { coords: [-81.45, 28.35], extra: { isActive: false } }),
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, admin, lead, canv, h1, h2, h3, h4, h5, h6, h7, h8, h9,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead), canvTok: signUserToken(canv),
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

const listQueue = async (token = ctx.adminTok) =>
  call('GET', `/admin/campaigns/${ctx.camp._id}/households/pin-fixes`, { token, orgId: ctx.org._id });

const confirm = (hid, body, token = ctx.adminTok) =>
  call('POST', `/admin/campaigns/${ctx.camp._id}/households/${hid}/confirm-location`, {
    token, orgId: ctx.org._id, body,
  });

const badgeCount = async () => {
  const r = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 200);
  const row = (r.json.campaigns || []).find((c) => String(c._id) === String(ctx.camp._id));
  assert.ok(row, 'campaign row present in the rollup');
  return row.pinsToFix;
};

test('1. the queue is exactly the needs-fixing set, for admins and granted leads; canvassers 403', { skip }, async () => {
  const r = await listQueue();
  assert.strictEqual(r.status, 200);
  const ids = new Set(r.json.households.map((h) => h.id));
  assert.deepStrictEqual(
    [...ids].sort(),
    [ctx.h1._id, ctx.h2._id, ctx.h3._id].map(String).sort(),
    'interpolated+unconfirmed+active only — never corrected (h4/h7), exact (h5/h6), confirmed (h8), inactive (h9)'
  );
  assert.strictEqual(r.json.total, 3);
  assert.strictEqual(r.json.truncated, false);

  const asLead = await listQueue(ctx.leadTok);
  assert.strictEqual(asLead.status, 200, 'a granted lead reads the queue');
  const asCanv = await listQueue(ctx.canvTok);
  assert.strictEqual(asCanv.status, 403, 'a canvasser never does');
});

test('2. the sidebar badge (campaigns rollup pinsToFix) equals the queue total', { skip }, async () => {
  assert.strictEqual(await badgeCount(), 3);
});

test('3. confirm-in-place stamps without touching provenance, from==to audit row; queue + badge drop', { skip }, async () => {
  const r = await confirm(ctx.h1._id, { scope: 'unit' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.updated, 1);

  const h = await Household.findById(ctx.h1._id).lean();
  assert.ok(h.locationConfirmedAt, 'stamped');
  assert.strictEqual(String(h.locationConfirmedBy), String(ctx.admin._id));
  assert.strictEqual(h.coordSource, 'geocodio', 'a confirm is NOT a correction');
  assert.strictEqual(h.coordConfidence, 'interpolated', "the geocoder's verdict is preserved");

  const rows = await HouseholdLocationChange.find({ householdId: ctx.h1._id }).lean();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].source, 'confirm');
  assert.deepStrictEqual(rows[0].from.coordinates, rows[0].to.coordinates, 'nothing moved: from == to');

  const q = await listQueue();
  assert.strictEqual(q.json.total, 2);
  assert.strictEqual(await badgeCount(), 2);
});

test('4. confirm refuses a door that is not approximate (exact and corrected alike)', { skip }, async () => {
  for (const bad of [ctx.h6._id, ctx.h7._id]) {
    const r = await confirm(bad, { scope: 'unit' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.code, 'NOT_APPROXIMATE');
  }
});

test('5. building confirm fans out to interpolated siblings ONLY — corrected/exact doors on the pin stay unvouched', { skip }, async () => {
  const r = await confirm(ctx.h2._id, { scope: 'building' }, ctx.leadTok);
  assert.strictEqual(r.status, 200, 'a granted lead can confirm');
  assert.strictEqual(r.json.updated, 2, 'h2 + its interpolated sibling h3');

  const [h2, h3, h4, h5] = await Promise.all(
    [ctx.h2, ctx.h3, ctx.h4, ctx.h5].map((h) => Household.findById(h._id).lean())
  );
  assert.ok(h2.locationConfirmedAt && h3.locationConfirmedAt);
  assert.strictEqual(h4.locationConfirmedAt, null, 'the hand-corrected sibling is never vouched');
  assert.strictEqual(h5.locationConfirmedAt, null, 'the rooftop-exact sibling was never in question');
  // No 'confirm' row may ever land on a corrected door — repair:import-pins reverts its own
  // work only while the LATEST audit row is import_repair, and a confirm row would mask it.
  assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: ctx.h4._id, source: 'confirm' }), 0);
  assert.strictEqual(await HouseholdLocationChange.countDocuments({ source: 'confirm' }), 3, 'h1 + h2 + h3, nothing else');

  const q = await listQueue();
  assert.strictEqual(q.json.total, 0, 'queue cleared');
  assert.strictEqual(await badgeCount(), 0);
});

test('6. undo clears the stamp, writes NO audit row, and the door re-enters the queue', { skip }, async () => {
  const r = await confirm(ctx.h1._id, { scope: 'unit', confirmed: false });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.updated, 1);
  const h = await Household.findById(ctx.h1._id).lean();
  assert.strictEqual(h.locationConfirmedAt, null);
  assert.strictEqual(h.locationConfirmedBy, null);
  assert.strictEqual(
    await HouseholdLocationChange.countDocuments({ householdId: ctx.h1._id, source: 'confirm' }),
    1,
    'un-stamping is not a location event — the confirm row stands alone'
  );
  const q = await listQueue();
  assert.strictEqual(q.json.total, 1, 'h1 is back');
});

test('7. a real MOVE clears the stamp — the vouch described the old spot', { skip }, async () => {
  await confirm(ctx.h1._id, { scope: 'unit' }); // re-stamp
  const r = await call('PATCH', `/admin/campaigns/${ctx.camp._id}/households/${ctx.h1._id}/location`, {
    token: ctx.adminTok, orgId: ctx.org._id, body: { lat: 28.311, lng: -81.411 },
  });
  assert.strictEqual(r.status, 200);
  const h = await Household.findById(ctx.h1._id).lean();
  assert.strictEqual(h.coordSource, 'corrected');
  assert.strictEqual(h.locationConfirmedAt, null, 'the move superseded the vouch');
  assert.strictEqual(h.locationConfirmedBy, null);
  const q = await listQueue();
  assert.strictEqual(q.json.total, 0, 'a corrected door leaves the queue via coordConfidence null');
});

test('8. re-import pin shield: a confirmed pin survives by omission (keptConfirmed, not keptPins); overwriteHandEdits takes the file pin AND clears the stamp', { skip }, async () => {
  const before8 = await Household.findById(ctx.h8._id).lean();
  const fileRow = {
    normalizedAddress: before8.normalizedAddress,
    addressLine1: before8.addressLine1,
    addressLine2: null,
    city: before8.city,
    state: before8.state,
    zipCode: before8.zipCode,
    county: null,
    longitude: -81.9,
    latitude: 28.9,
  };
  const campaign = await Campaign.findById(ctx.camp._id);

  const kept = await applyImport({
    campaign, orgId: ctx.org._id, validRows: [], householdMap: new Map([[fileRow.normalizedAddress, { ...fileRow }]]),
  });
  assert.strictEqual(kept.keptConfirmed, 1, 'counted apart from keptPins');
  assert.strictEqual(kept.keptPins, 0);
  const afterKept = await Household.findById(ctx.h8._id).lean();
  assert.deepStrictEqual(afterKept.location.coordinates, before8.location.coordinates, 'pin untouched');
  assert.strictEqual(afterKept.coordSource, 'geocodio');
  assert.strictEqual(afterKept.coordConfidence, 'interpolated');
  assert.ok(afterKept.locationConfirmedAt, 'stamp intact');

  const overwritten = await applyImport({
    campaign, orgId: ctx.org._id, validRows: [], householdMap: new Map([[fileRow.normalizedAddress, { ...fileRow }]]),
    overwriteHandEdits: true,
  });
  assert.strictEqual(overwritten.keptConfirmed, 0, 'shield disarmed');
  const afterOverwrite = await Household.findById(ctx.h8._id).lean();
  assert.deepStrictEqual(afterOverwrite.location.coordinates, [-81.9, 28.9], 'the file pin won');
  assert.strictEqual(afterOverwrite.coordSource, 'file');
  assert.strictEqual(afterOverwrite.locationConfirmedAt, null, 'a stamp must never vouch for a pin nobody saw');
  assert.strictEqual(afterOverwrite.locationConfirmedBy, null);
});

test('9. an archived campaign refuses confirm with the 409 the mobile client understands; the queue stays readable', { skip }, async () => {
  await Campaign.updateOne({ _id: ctx.camp._id }, { isActive: false });
  try {
    const r = await confirm(ctx.h2._id, { scope: 'unit', confirmed: false });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.code, 'campaign-archived');
    const q = await listQueue();
    assert.strictEqual(q.status, 200, 'reads stay open on an archive');
  } finally {
    await Campaign.updateOne({ _id: ctx.camp._id }, { isActive: true });
  }
});
