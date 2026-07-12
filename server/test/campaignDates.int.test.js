import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Campaign key dates (electionDay / earlyVotingStart / earlyVotingEnd / datesNote)
// over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/campaigndates_test node --test test/campaignDates.int.test.js
// Proves: POST round-trips the four fields onto the GET /admin/campaigns list
// (lean-doc spread), PATCH updates + explicit null clears a date, the early-voting
// window is validated on POST and on a one-bound PATCH against the STORED other
// bound, malformed date strings and an over-long datesNote are rejected, and
// GET /mobile/campaigns carries the fields on every item.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-campaign-dates';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Dates Org', slug: 'dates-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'da@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, adminTok: signUserToken(admin) });
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

const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

test('POST round-trips the four fields onto the GET /admin/campaigns list', { skip }, async () => {
  const r = await call('POST', '/admin/campaigns', {
    ...auth(),
    body: {
      name: 'Dated C',
      type: 'survey',
      state: 'FL',
      electionDay: '2026-11-03',
      earlyVotingStart: '2026-10-19',
      earlyVotingEnd: '2026-10-30',
      datesNote: '  Polls close 7pm.  ',
    },
  });
  assert.strictEqual(r.status, 201);
  ctx.campId = r.json.campaign._id;

  const list = await call('GET', '/admin/campaigns', auth());
  assert.strictEqual(list.status, 200);
  const row = list.json.campaigns.find((c) => String(c._id) === String(ctx.campId));
  assert.ok(row, 'created campaign appears in the list');
  assert.strictEqual(row.electionDay, '2026-11-03');
  assert.strictEqual(row.earlyVotingStart, '2026-10-19');
  assert.strictEqual(row.earlyVotingEnd, '2026-10-30');
  assert.strictEqual(row.datesNote, 'Polls close 7pm.', 'Zod trims the note');
});

test('PATCH updates a date and explicit null clears one', { skip }, async () => {
  const upd = await call('PATCH', `/admin/campaigns/${ctx.campId}`, {
    ...auth(),
    body: { electionDay: '2026-11-10', datesNote: 'Runoff moved.' },
  });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual(upd.json.campaign.electionDay, '2026-11-10');
  assert.strictEqual(upd.json.campaign.datesNote, 'Runoff moved.');

  const clear = await call('PATCH', `/admin/campaigns/${ctx.campId}`, {
    ...auth(),
    body: { earlyVotingEnd: null },
  });
  assert.strictEqual(clear.status, 200);
  assert.strictEqual(clear.json.campaign.earlyVotingEnd, null);
  assert.strictEqual((await Campaign.findById(ctx.campId).lean()).earlyVotingEnd, null);
});

test('POST rejects an inverted early-voting window', { skip }, async () => {
  const r = await call('POST', '/admin/campaigns', {
    ...auth(),
    body: {
      name: 'Bad Window',
      type: 'lit_drop',
      state: 'FL',
      earlyVotingStart: '2026-10-30',
      earlyVotingEnd: '2026-10-19',
    },
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /end date cannot be before/i);
});

test('PATCH of one bound validates against the STORED other bound', { skip }, async () => {
  // earlyVotingStart is stored as 2026-10-19; earlyVotingEnd is currently null.
  const bad = await call('PATCH', `/admin/campaigns/${ctx.campId}`, {
    ...auth(),
    body: { earlyVotingEnd: '2026-10-01' },
  });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /end date cannot be before/i);

  const ok = await call('PATCH', `/admin/campaigns/${ctx.campId}`, {
    ...auth(),
    body: { earlyVotingEnd: '2026-10-25' },
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.campaign.earlyVotingEnd, '2026-10-25');
});

test('malformed date strings are rejected', { skip }, async () => {
  for (const bad of ['11/04/2026', '2026-7-4']) {
    const r = await call('PATCH', `/admin/campaigns/${ctx.campId}`, {
      ...auth(),
      body: { electionDay: bad },
    });
    assert.strictEqual(r.status, 400, `'${bad}' must fail the YYYY-MM-DD regex`);
  }
});

test('datesNote longer than 280 chars is rejected', { skip }, async () => {
  const r = await call('PATCH', `/admin/campaigns/${ctx.campId}`, {
    ...auth(),
    body: { datesNote: 'x'.repeat(281) },
  });
  assert.strictEqual(r.status, 400);
});

test('GET /mobile/campaigns includes the four fields on each item', { skip }, async () => {
  const r = await call('GET', '/mobile/campaigns', auth());
  assert.strictEqual(r.status, 200);
  const item = r.json.campaigns.find((c) => c.id === String(ctx.campId));
  assert.ok(item, 'active campaign appears in the mobile picker');
  assert.strictEqual(item.electionDay, '2026-11-10');
  assert.strictEqual(item.earlyVotingStart, '2026-10-19');
  assert.strictEqual(item.earlyVotingEnd, '2026-10-25');
  assert.strictEqual(item.datesNote, 'Runoff moved.');
});

test('GET /mobile/bootstrap carries the four key-date fields on the campaign (in-campaign)', { skip }, async () => {
  // The in-campaign payload feeds the canvasser Books header + mobile admin detail chip.
  const r = await call('GET', `/mobile/bootstrap?campaignId=${ctx.campId}`, auth());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.campaign.electionDay, '2026-11-10');
  assert.strictEqual(r.json.campaign.earlyVotingStart, '2026-10-19');
  assert.strictEqual(r.json.campaign.earlyVotingEnd, '2026-10-25');
  assert.strictEqual(r.json.campaign.datesNote, 'Runoff moved.');
});
