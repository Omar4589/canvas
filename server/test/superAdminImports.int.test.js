import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The geocoding-cost surface, batch 2: real paging past the 500-row window, server-side search,
// the org filter finally wired, cost-ranked sort, the undone-import toggle (a reversed import
// still incurred its lookups — but "what did live imports cost" must also be answerable), and the
// month/org rollups a Geocodio invoice is actually reconciled against.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/saimports node --test test/superAdminImports.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-superadmin-imports';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ImportJob } = await import('../src/models/ImportJob.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(path, token) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Campaign, ImportJob]) await M.deleteMany({});

  const orgA = await Organization.create({ name: 'Acme Campaigns', slug: 'acme', isActive: true });
  const orgB = await Organization.create({ name: 'Bravo Field', slug: 'bravo', isActive: true });
  const superU = await User.create({
    firstName: 'Sue', lastName: 'Super', email: 'sue@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true,
  });
  const campA = await Campaign.create({ organizationId: orgA._id, name: 'A1', type: 'survey', state: 'TX', isActive: true });
  const campB = await Campaign.create({ organizationId: orgB._id, name: 'B1', type: 'survey', state: 'TX', isActive: true });

  // Deterministic history: 3 Acme imports across two months (one UNDONE), 1 Bravo import.
  const mk = (org, camp, over) => ({
    organizationId: org._id,
    campaignId: camp._id,
    status: 'completed',
    kind: 'apply',
    uploadedBy: superU._id,
    ...over,
  });
  await ImportJob.create([
    mk(orgA, campA, {
      filename: 'acme-june.csv', createdAt: new Date('2026-06-10T12:00:00Z'),
      uniqueHouseholds: 1000, geocodedNew: 500, geocodedCached: 300, geocodeUnmatched: 10, geocodeFailed: 5,
    }),
    mk(orgA, campA, {
      filename: 'acme-july.csv', createdAt: new Date('2026-07-05T12:00:00Z'),
      uniqueHouseholds: 400, geocodedNew: 100, geocodedCached: 250,
    }),
    mk(orgA, campA, {
      filename: 'acme-undone.csv', createdAt: new Date('2026-07-06T12:00:00Z'),
      uniqueHouseholds: 2000, geocodedNew: 2000, undone: true, undoneAt: new Date('2026-07-07T12:00:00Z'),
    }),
    mk(orgB, campB, {
      filename: 'bravo-july.csv', createdAt: new Date('2026-07-08T12:00:00Z'),
      uniqueHouseholds: 300, geocodedNew: 200, geocodedCached: 50,
    }),
  ]);

  Object.assign(ctx, { orgA, orgB, token: signUserToken(superU) });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('LEGACY SHAPE: parameterless call keeps the newest-window contract and whole-set totals', { skip }, async () => {
  const res = await call('/super-admin/imports', ctx.token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.imports.length, 4);
  assert.strictEqual(res.json.total, 4);
  assert.strictEqual(res.json.totals.geocodedNew, 2800, 'totals cover the whole filtered set');
  assert.ok(res.json.ratePer1000Cents > 0);
  const undone = res.json.imports.find((r) => r.filename === 'acme-undone.csv');
  assert.strictEqual(undone.undone, true, 'a reversed import is flagged, not hidden');
  const june = res.json.imports.find((r) => r.filename === 'acme-june.csv');
  assert.strictEqual(june.geocodeFailed, 5, 'provider failures are visible per row');
});

test('paging, org filter, server search, and cost sort', { skip }, async () => {
  const paged = await call('/super-admin/imports?limit=2&skip=2', ctx.token);
  assert.strictEqual(paged.json.imports.length, 2, 'rows past the first page stay reachable');
  assert.strictEqual(paged.json.total, 4);

  const byOrg = await call(`/super-admin/imports?orgId=${ctx.orgB._id}`, ctx.token);
  assert.strictEqual(byOrg.json.total, 1, 'the org filter answers "which org is driving spend"');
  assert.strictEqual(byOrg.json.imports[0].organizationName, 'Bravo Field');

  const byName = await call('/super-admin/imports?q=bravo&limit=10&skip=0', ctx.token);
  assert.strictEqual(byName.json.total, 1, 'search hits the DB (file, uploader, or org name)');

  const byCost = await call('/super-admin/imports?sort=cost&limit=10&skip=0', ctx.token);
  assert.strictEqual(byCost.json.imports[0].filename, 'acme-undone.csv', 'the most expensive import sorts first');
});

test('excludeUndone drops reversed imports from the list AND the cost math', { skip }, async () => {
  const res = await call('/super-admin/imports?excludeUndone=1', ctx.token);
  assert.strictEqual(res.json.total, 3);
  assert.strictEqual(res.json.totals.geocodedNew, 800, '2000 undone lookups excluded from the bill view');
  assert.ok(!res.json.imports.some((r) => r.undone));
});

test('groupBy=month and groupBy=org roll the filtered set into invoice shapes', { skip }, async () => {
  const byMonth = await call('/super-admin/imports?groupBy=month', ctx.token);
  const months = byMonth.json.groups;
  assert.strictEqual(months.length, 2);
  assert.strictEqual(months[0].key, '2026-07', 'newest month first');
  assert.strictEqual(months[0].geocodedNew, 2300, 'July = 100 + 2000 + 200');
  assert.strictEqual(months[1].geocodedNew, 500, 'June = 500');
  assert.strictEqual(
    months[0].imports + months[1].imports, 4,
    'every import lands in exactly one month bucket'
  );

  const byOrg = await call('/super-admin/imports?groupBy=org&excludeUndone=1', ctx.token);
  const acme = byOrg.json.groups.find((g) => g.label === 'Acme Campaigns');
  const bravo = byOrg.json.groups.find((g) => g.label === 'Bravo Field');
  assert.strictEqual(acme.geocodedNew, 600, 'per-org rollup respects the same filters');
  assert.strictEqual(bravo.geocodedNew, 200);
  assert.ok(acme.costCents >= bravo.costCents, 'ranked by spend');
});
