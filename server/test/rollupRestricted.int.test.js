import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Regression: the Overview "All active campaigns" bar must sum EVERY coverage status —
// including `restricted` — across campaigns. A hardcoded reducer seed once omitted
// `restricted`, so the org-wide bar showed Restricted 0 while per-campaign cards showed the
// real count (and every other segment's % was off because the denominator lost those doors).
// Runs against the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/rollup_restricted_test node --test test/rollupRestricted.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-rollup';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// A campaign's households by status. `voted` = fully-voted + unknocked (coverageBucketExpr
// remaps it), everything else stores its literal status.
function seedDocs(orgId, campaignId, counts) {
  const docs = [];
  for (const [status, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      docs.push({
        organizationId: orgId,
        campaignId,
        isActive: true,
        fullyVoted: status === 'voted',
        status: status === 'voted' ? 'unknocked' : status,
      });
    }
  }
  return docs;
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Rollup Org', slug: 'rollup-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'a@r.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const A = await Campaign.create({ organizationId: org._id, name: 'Camp A', type: 'survey', state: 'KY', isActive: true });
  const B = await Campaign.create({ organizationId: org._id, name: 'Camp B', type: 'survey', state: 'KY', isActive: true });

  // A: 2 restricted, 1 surveyed, 3 unknocked (6). B: 1 restricted, 1 not_home, 2 unknocked (4).
  await Household.collection.insertMany([
    ...seedDocs(org._id, A._id, { restricted: 2, surveyed: 1, unknocked: 3 }),
    ...seedDocs(org._id, B._id, { restricted: 1, not_home: 1, unknocked: 2 }),
  ]);

  Object.assign(ctx, { org, A, B, adminTok: signUserToken(admin) });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('campaign-rollup cumulative.coverage sums restricted across campaigns', { skip }, async () => {
  const res = await fetch(`${base}/api/admin/reports/campaign-rollup`, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  assert.strictEqual(res.status, 200);
  const json = await res.json();

  // Org-wide: restricted is summed across both campaigns (2 + 1 = 3) — the regression.
  assert.strictEqual(json.cumulative.coverage.restricted, 3, 'cumulative restricted = 2 + 1');

  // No door is dropped: every coverage segment sums to the household total (denominator
  // is whole, so segment percentages are correct too).
  const total = Object.values(json.cumulative.coverage).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, json.cumulative.households, 'Σ coverage == households');
  assert.strictEqual(json.cumulative.households, 10, 'all 10 households counted');

  // Per-campaign rows still carry their own restricted counts.
  const byName = new Map(json.campaigns.map((c) => [c.name, c]));
  assert.strictEqual(byName.get('Camp A').coverage.restricted, 2, 'Camp A restricted');
  assert.strictEqual(byName.get('Camp B').coverage.restricted, 1, 'Camp B restricted');
});
