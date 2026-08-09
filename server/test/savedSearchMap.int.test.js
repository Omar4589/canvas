import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The two saved-search server changes, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/ssmap_test node --test test/savedSearchMap.int.test.js
//
//   - GET /admin/campaigns/:id/walklists returns the AUTHOR, flattened to { id, name } and
//     carrying nothing else off the User document.
//   - GET /admin/households/map?savedSearchId= narrows to the search's FROZEN householdIds,
//     and intersects with importId rather than overwriting it.
//
// Written because both were only read, not exercised — the same gap that let a wrong assumption
// ship in the turf-cutting picker.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-ssmap';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { normalizeAddress } = await import('../src/utils/normalizeAddress.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, Household, SavedSearch]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'SS Org', slug: 'ss-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'ss@t.co', passwordHash: 'x', isActive: true,
    phone: '555-0100',
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'SS C', type: 'survey', state: 'FL', isActive: true,
  });

  // Three geocoded doors; the saved search freezes only the first two.
  const doors = await Household.insertMany(
    ['1 Alpha St', '2 Beta St', '3 Gamma St'].map((line, i) => {
      const a = { addressLine1: line, city: 'Town', state: 'FL', zipCode: '34741' };
      return {
        organizationId: org._id,
        campaignId: camp._id,
        ...a,
        normalizedAddress: normalizeAddress(a),
        location: { type: 'Point', coordinates: [-81.4 + i * 0.01, 28.3] },
        isActive: true,
        status: 'unknocked',
      };
    })
  );

  const authored = await SavedSearch.create({
    organizationId: org._id,
    campaignId: camp._id,
    name: 'Two doors',
    householdIds: [doors[0]._id, doors[1]._id],
    householdCount: 2,
    voterCount: 0,
    source: 'filter',
    createdBy: admin._id,
  });
  // The shape migratePasses.js leaves behind: no author, and source 'filter' — NOT 'import'.
  // The UI must not read this as import-generated.
  const legacy = await SavedSearch.create({
    organizationId: org._id,
    campaignId: camp._id,
    name: 'All voters (initial)',
    householdIds: [doors[2]._id],
    householdCount: 1,
    voterCount: 0,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, admin, doors, authored, legacy, tok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(path) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

test('the saved-search list carries the author as { id, name } and nothing more', { skip }, async () => {
  const r = await call(`/admin/campaigns/${ctx.camp._id}/walklists`);
  assert.strictEqual(r.status, 200);

  const authored = r.json.walkLists.find((w) => w.name === 'Two doors');
  assert.strictEqual(authored.createdBy.name, 'Ada Admin');
  assert.strictEqual(authored.createdBy.id, String(ctx.admin._id));
  // Leads read this list too — the populated User must not leak contact details onto it.
  assert.deepStrictEqual(
    Object.keys(authored.createdBy).sort(), ['id', 'name'],
    'no email, no phone, no passwordHash — only what names the person'
  );

  // A migrated legacy list has NO author and is source 'filter'. The client keys its label on
  // SOURCE for exactly this row: reading null as "an import built this" would mislabel it.
  const legacy = r.json.walkLists.find((w) => w.name === 'All voters (initial)');
  assert.strictEqual(legacy.createdBy, null);
  assert.notStrictEqual(legacy.source, 'import', 'legacy lists are filter-sourced, not import');
});

test('map?savedSearchId= returns exactly the FROZEN doors, not a re-resolved filter', { skip }, async () => {
  const all = await call(`/admin/households/map?campaignId=${ctx.camp._id}`);
  assert.strictEqual(all.json.households.length, 3, 'precondition: three doors on the map');

  const scoped = await call(
    `/admin/households/map?campaignId=${ctx.camp._id}&savedSearchId=${ctx.authored._id}`
  );
  assert.strictEqual(scoped.status, 200);
  assert.deepStrictEqual(
    scoped.json.households.map((h) => h.addressLine1).sort(),
    ['1 Alpha St', '2 Beta St'],
    'the third door is out of scope'
  );
});

test('a saved search holding no doors returns empty, not the whole campaign', { skip }, async () => {
  const empty = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Empty', householdIds: [],
  });
  const r = await call(`/admin/households/map?campaignId=${ctx.camp._id}&savedSearchId=${empty._id}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.households.length, 0, 'an empty scope must never fall back to unscoped');
});

test('a saved search from ANOTHER campaign cannot scope this map', { skip }, async () => {
  const other = await Campaign.create({
    organizationId: ctx.org._id, name: 'Other', type: 'survey', state: 'FL', isActive: true,
  });
  const foreign = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: other._id, name: 'Foreign',
    householdIds: [ctx.doors[0]._id],
  });
  const r = await call(
    `/admin/households/map?campaignId=${ctx.camp._id}&savedSearchId=${foreign._id}`
  );
  // The lookup is campaign-scoped, so this resolves to no ids → empty, never a cross-campaign leak.
  assert.strictEqual(r.json.households.length, 0);
});

test('a malformed savedSearchId is ignored rather than 500ing', { skip }, async () => {
  const r = await call(`/admin/households/map?campaignId=${ctx.camp._id}&savedSearchId=not-an-id`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.households.length, 3, 'falls back to unscoped, like the other id params');
});
