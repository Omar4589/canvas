import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The org view's add by email and a profile's Add to campaigns (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md): the
// lookup (POST /admin/memberships/resolve), the add (POST /by-email), a member's campaign history
// (GET /:userId/campaign-history), the profile's add (POST /:userId/campaigns) and the crews' crewSize —
// over the real app and a throwaway mongod:
//   npm --prefix server run test:int -- test/addToCampaigns.int.test.js
//
// The lookup limiters count in memory per process, keyed on the person looking up, so the limit test uses
// its own admin. Emails land on the mailer's outbox (no RESEND_API_KEY here); route sends are
// fire-and-forget, so the email assertions poll it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-add-to-campaigns';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');
const { NAMED_LOOKUPS_PER_HOUR } = await import('../src/middleware/crewResolveLimit.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
let seq = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, timeout = 2000) => {
  const deadline = Date.now() + timeout;
  while (!pred()) {
    if (Date.now() >= deadline) return false;
    await sleep(40);
  }
  return true;
};
const mailsTo = (email) => outbox.filter((m) => [].concat(m.to).includes(email));
const bodyOf = (m) => `${m?.subject || ''}\n${m?.html || ''}\n${m?.text || ''}`;

const mkPerson = async (first, role = 'canvasser', orgId = ctx.org._id, extra = {}) => {
  const u = await User.create({
    firstName: first,
    lastName: `T${++seq}`,
    email: `${first.toLowerCase()}${seq}@addcamp.t.co`,
    passwordHash: 'x',
    isActive: true,
    ...extra,
  });
  await Membership.create({ userId: u._id, organizationId: orgId, role, isActive: true });
  return u;
};
const call = async (method, path, { as = ctx.admin, body, orgId = ctx.org._id } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${signUserToken(as)}`, 'X-Org-Id': String(orgId), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* empty body */
  }
  return { status: res.status, text, json };
};
const knock = (userId, campaignId, coordinatorId, day = '05') => {
  const when = new Date(`2026-10-${day}T15:00:00Z`);
  return {
    _id: new ObjectId(),
    organizationId: ctx.org._id,
    campaignId,
    passId: new ObjectId(),
    householdId: new ObjectId(),
    userId,
    coordinatorId,
    actionType: 'not_home',
    location: { lat: 28, lng: -81 },
    timestamp: when,
    createdAt: when,
    updatedAt: when,
  };
};
const rosterOf = async (userId) =>
  new Map(
    (await CampaignAssignment.find({ userId }, 'campaignId coordinatorId').lean()).map((r) => [
      String(r.campaignId),
      r.coordinatorId ? String(r.coordinatorId) : null,
    ])
  );

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  ctx.org = await Organization.create({ name: 'Addcamp Org', slug: 'addcamp-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });
  const mkCampaign = (name, extra = {}) =>
    Campaign.create({ organizationId: ctx.org._id, name, type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', ...extra });
  ctx.fall = await mkCampaign('Fall Canvass');
  ctx.river = await mkCampaign('Riverside Turnout');
  ctx.old = await mkCampaign('Old Campaign', { isActive: false });
  ctx.elsewhere = await Organization.create({ name: 'Elsewhere', slug: 'addcamp-elsewhere', isActive: true });
  await Subscription.create({ organizationId: ctx.elsewhere._id, status: 'active' });
  ctx.elsewhereCampaign = await Campaign.create({
    organizationId: ctx.elsewhere._id, name: 'Not Yours', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
  });
  ctx.admin = await mkPerson('Admin', 'admin');
  ctx.dana = await mkPerson('Dana', 'lead');
  ctx.sam = await mkPerson('Sam', 'admin');
  ctx.lead = await mkPerson('Lead', 'lead');
  await CampaignManager.create({ campaignId: ctx.fall._id, userId: ctx.lead._id, organizationId: ctx.org._id, grantedBy: ctx.admin._id });
  ctx.plain = await mkPerson('Plain');
  server = (await import('node:http')).createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

beforeEach(() => clearOutbox());

// ── The lookup ────────────────────────────────────────────────────────────────────────────────────────

test('resolve: an address outside the organization gets one answer, whether or not it has an account elsewhere', { skip }, async () => {
  const stranger = await mkPerson('Stranger', 'canvasser', ctx.elsewhere._id);
  const a = await call('POST', '/admin/memberships/resolve', { body: { email: stranger.email } });
  const b = await call('POST', '/admin/memberships/resolve', { body: { email: 'never-seen@nowhere.t.co' } });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.text, b.text);
  assert.strictEqual(a.json.outcome, 'outside');
  assert.strictEqual(a.json.person, null);
  assert.deepStrictEqual(a.json.campaigns, []);
  assert.ok(a.json.coordinators.some((c) => c.id === String(ctx.dana._id)), 'the coordinators are the organization’s');
  assert.ok(!a.json.coordinators.some((c) => 'email' in c), 'no emails in the coordinator list');
});

test('resolve: a colleague comes back with their standing and doors on each ACTIVE campaign', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await CampaignAssignment.create({ campaignId: ctx.fall._id, userId: pat._id, organizationId: ctx.org._id, coordinatorId: ctx.dana._id });
  await CanvassActivity.collection.insertMany([
    knock(pat._id, ctx.river._id, ctx.dana._id, '02'),
    knock(pat._id, ctx.river._id, ctx.dana._id, '03'),
    { ...knock(pat._id, ctx.river._id, ctx.dana._id, '03'), via: 'bulk' },
    knock(pat._id, ctx.old._id, null, '04'),
  ]);
  const r = await call('POST', '/admin/memberships/resolve', { body: { email: pat.email } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.outcome, 'in-org');
  assert.strictEqual(r.json.person.userId, String(pat._id));
  const byId = new Map(r.json.campaigns.map((c) => [c.campaignId, c]));
  assert.ok(!byId.has(String(ctx.old._id)), 'an archived campaign is left out, knocks or not');
  assert.deepStrictEqual([byId.get(String(ctx.fall._id)).onCampaign, byId.get(String(ctx.fall._id)).history.doors], [true, 0]);
  const river = byId.get(String(ctx.river._id));
  assert.strictEqual(river.onCampaign, false);
  assert.strictEqual(river.history.doors, 2, 'desk marks left out');
  assert.deepStrictEqual(river.history.sources.map((s) => [s.coordinatorId, s.doors, s.canLead]), [[String(ctx.dana._id), 2, true]]);
});

test('resolve and the campaign Team page lookup give one campaign the same history', { skip }, async () => {
  const kim = await mkPerson('Kim');
  await CanvassActivity.collection.insertMany([knock(kim._id, ctx.river._id, ctx.sam._id, '06'), knock(kim._id, ctx.river._id, null, '07')]);
  const org = await call('POST', '/admin/memberships/resolve', { body: { email: kim.email } });
  const team = await call('POST', `/admin/campaigns/${ctx.river._id}/crew/resolve`, { body: { email: kim.email } });
  assert.strictEqual(team.status, 200);
  const row = org.json.campaigns.find((c) => c.campaignId === String(ctx.river._id));
  assert.deepStrictEqual(row.history, team.json.history);
  const hist = await call('GET', `/admin/memberships/${kim._id}/campaign-history`);
  assert.strictEqual(hist.status, 200);
  assert.deepStrictEqual(hist.json.campaigns.find((c) => c.campaignId === String(ctx.river._id)).history, team.json.history);
});

test('resolve, by-email, campaign-history and a profile add are org-admin only', { skip }, async () => {
  const someone = await mkPerson('Someone');
  for (const [method, path, body] of [
    ['POST', '/admin/memberships/resolve', { email: someone.email }],
    ['POST', '/admin/memberships/by-email', { email: 'x@nowhere.t.co', firstName: 'X', lastName: 'Y' }],
    ['GET', `/admin/memberships/${someone._id}/campaign-history`],
    ['POST', `/admin/memberships/${someone._id}/campaigns`, { campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: null }] }],
  ]) {
    const r = await call(method, path, { as: ctx.lead, body });
    assert.strictEqual(r.status, 403, `${method} ${path}`);
    assert.strictEqual(r.json.code, 'ADMIN_ONLY');
  }
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: someone._id }), 0);
});

test('the two lookups draw on one hourly limit per person', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  const named = await mkPerson('Named');
  const half = Math.floor(NAMED_LOOKUPS_PER_HOUR / 2);
  for (let i = 0; i < half; i++) {
    assert.strictEqual((await call('POST', `/admin/campaigns/${ctx.fall._id}/crew/resolve`, { as: looker, body: { email: named.email } })).status, 200);
  }
  for (let i = half; i < NAMED_LOOKUPS_PER_HOUR; i++) {
    assert.strictEqual((await call('POST', '/admin/memberships/resolve', { as: looker, body: { email: named.email } })).status, 200, `lookup ${i + 1}`);
  }
  const over = await call('POST', '/admin/memberships/resolve', { as: looker, body: { email: named.email } });
  assert.strictEqual(over.status, 429);
  assert.strictEqual(over.json.code, 'rate-limited');
  assert.strictEqual((await call('POST', `/admin/campaigns/${ctx.fall._id}/crew/resolve`, { as: looker, body: { email: named.email } })).status, 429);
});

// ── The add ───────────────────────────────────────────────────────────────────────────────────────────

test('by-email: a new canvasser on two campaigns, a crew each — one membership, two roster rows, ONE invite naming both', { skip }, async () => {
  const email = 'jane.new@addcamp.t.co';
  const r = await call('POST', '/admin/memberships/by-email', {
    body: {
      email, firstName: 'Jane', lastName: 'Doe', role: 'canvasser',
      campaigns: [
        { campaignId: String(ctx.fall._id), coordinatorId: String(ctx.dana._id) },
        { campaignId: String(ctx.river._id), coordinatorId: null },
      ],
    },
  });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.outcome, 'created');
  assert.strictEqual(r.json.attached, false);
  assert.strictEqual(r.json.role, 'canvasser');
  assert.deepStrictEqual(r.json.campaigns.map((c) => [c.campaignName, c.result]), [['Fall Canvass', 'joined'], ['Riverside Turnout', 'joined']]);
  const user = await User.findOne({ email });
  assert.strictEqual(user.mustChangePassword, true);
  assert.strictEqual((await Membership.findOne({ userId: user._id, organizationId: ctx.org._id })).role, 'canvasser');
  const roster = await rosterOf(user._id);
  assert.strictEqual(roster.get(String(ctx.fall._id)), String(ctx.dana._id));
  assert.strictEqual(roster.get(String(ctx.river._id)), null);
  assert.ok(await waitFor(() => mailsTo(email).length >= 1));
  await sleep(150);
  const mails = mailsTo(email);
  assert.deepStrictEqual(mails.map((m) => m.kind), ['inviteSetPassword'], 'exactly one email');
  assert.ok(bodyOf(mails[0]).includes('Fall Canvass') && bodyOf(mails[0]).includes('Riverside Turnout'), 'it names both campaigns');
});

test('by-email: an address with an account elsewhere attaches that person and ignores what was typed', { skip }, async () => {
  const other = await mkPerson('Real', 'canvasser', ctx.elsewhere._id);
  const r = await call('POST', '/admin/memberships/by-email', {
    body: { email: other.email, firstName: 'Typed', lastName: 'Guess', password: 'Temp-pass-123', campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: null }] },
  });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.outcome, 'attached');
  assert.strictEqual(r.json.attached, true);
  assert.strictEqual(r.json.user.firstName, 'Real');
  const fresh = await User.findById(other._id);
  assert.strictEqual(fresh.firstName, 'Real', 'the typed name is not applied');
  assert.strictEqual(fresh.passwordHash, 'x', 'the typed password is not applied');
  assert.ok(await Membership.exists({ userId: other._id, organizationId: ctx.org._id }));
  assert.ok(await waitFor(() => mailsTo(other.email).length >= 1));
  await sleep(150);
  assert.deepStrictEqual(mailsTo(other.email).map((m) => m.kind), ['addedToOrg']);
  assert.ok(bodyOf(mailsTo(other.email)[0]).includes('Fall Canvass'));
});

test('by-email: a colleague joins the new campaigns only; their role and the crew where they already are never change', { skip }, async () => {
  const pat = await mkPerson('Pat');
  await CampaignAssignment.create({ campaignId: ctx.fall._id, userId: pat._id, organizationId: ctx.org._id, coordinatorId: ctx.dana._id });
  const r = await call('POST', '/admin/memberships/by-email', {
    body: {
      email: pat.email, role: 'admin',
      campaigns: [
        { campaignId: String(ctx.fall._id), coordinatorId: String(ctx.sam._id) },
        { campaignId: String(ctx.river._id), coordinatorId: String(ctx.sam._id) },
      ],
    },
  });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.outcome, 'in-org');
  assert.strictEqual(r.json.role, 'canvasser', 'the answer gives their real role');
  assert.deepStrictEqual(r.json.campaigns.map((c) => c.result), ['already-on', 'joined']);
  assert.strictEqual((await Membership.findOne({ userId: pat._id, organizationId: ctx.org._id })).role, 'canvasser');
  const roster = await rosterOf(pat._id);
  assert.strictEqual(roster.get(String(ctx.fall._id)), String(ctx.dana._id), 'already there: crew unchanged');
  assert.strictEqual(roster.get(String(ctx.river._id)), String(ctx.sam._id));
  assert.ok(await waitFor(() => mailsTo(pat.email).length >= 1));
  await sleep(150);
  const mails = mailsTo(pat.email);
  assert.deepStrictEqual(mails.map((m) => m.kind), ['addedToCampaign']);
  assert.strictEqual(mails[0].subject, "You've been added to Riverside Turnout", 'names only the campaign it joined');
});

test('by-email: a switched-off colleague is switched back on and joins', { skip }, async () => {
  const off = await mkPerson('Off');
  await Membership.updateOne({ userId: off._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const r = await call('POST', '/admin/memberships/by-email', {
    body: { email: off.email, campaigns: [{ campaignId: String(ctx.river._id), coordinatorId: null }] },
  });
  assert.strictEqual(r.status, 201, r.text);
  assert.strictEqual(r.json.outcome, 'in-org-inactive');
  assert.strictEqual((await Membership.findOne({ userId: off._id, organizationId: ctx.org._id })).isActive, true);
  assert.ok((await rosterOf(off._id)).has(String(ctx.river._id)));
});

test('by-email: a new team lead gets the campaigns they run and no roster rows; a new admin with no picks is org-only', { skip }, async () => {
  const lead = await call('POST', '/admin/memberships/by-email', {
    body: { email: 'new.lead@addcamp.t.co', firstName: 'New', lastName: 'Lead', role: 'lead', managedCampaignIds: [String(ctx.river._id)] },
  });
  assert.strictEqual(lead.status, 201, lead.text);
  assert.deepStrictEqual(lead.json.managedCampaignIds, [String(ctx.river._id)]);
  const leadUser = await User.findOne({ email: 'new.lead@addcamp.t.co' });
  assert.deepStrictEqual((await CampaignManager.find({ userId: leadUser._id }).lean()).map((g) => String(g.campaignId)), [String(ctx.river._id)]);
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: leadUser._id }), 0);
  assert.ok(await waitFor(() => mailsTo('new.lead@addcamp.t.co').length >= 1));
  assert.ok(!bodyOf(mailsTo('new.lead@addcamp.t.co')[0]).includes('also been added to'), 'a lead’s invite names no campaign, as before');

  const admin = await call('POST', '/admin/memberships/by-email', { body: { email: 'new.admin@addcamp.t.co', firstName: 'New', lastName: 'Admin', role: 'admin' } });
  assert.strictEqual(admin.status, 201, admin.text);
  assert.deepStrictEqual(admin.json.campaigns, []);
  const adminUser = await User.findOne({ email: 'new.admin@addcamp.t.co' });
  assert.strictEqual((await Membership.findOne({ userId: adminUser._id })).role, 'admin');
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: adminUser._id }), 0);
});

test('by-email: a canvasser with no campaigns picked joins the organization only', { skip }, async () => {
  const r = await call('POST', '/admin/memberships/by-email', { body: { email: 'org.only@addcamp.t.co', firstName: 'Org', lastName: 'Only' } });
  assert.strictEqual(r.status, 201, r.text);
  const u = await User.findOne({ email: 'org.only@addcamp.t.co' });
  assert.strictEqual((await Membership.findOne({ userId: u._id })).role, 'canvasser');
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: u._id }), 0);
  assert.ok(await waitFor(() => mailsTo('org.only@addcamp.t.co').length >= 1));
  assert.ok(!bodyOf(mailsTo('org.only@addcamp.t.co')[0]).includes('also been added to'));
});

test('by-email: every pick is checked before anything is written', { skip }, async () => {
  const pat = await mkPerson('Picky');
  const cases = [
    [{ campaignId: String(ctx.old._id), coordinatorId: null }, 409, 'campaign-archived'],
    [{ campaignId: String(ctx.elsewhereCampaign._id), coordinatorId: null }, 400],
    [{ campaignId: String(ctx.river._id), coordinatorId: String(ctx.plain._id) }, 400],
    [{ campaignId: 'not-an-id', coordinatorId: null }, 400],
  ];
  for (const [bad, status, code] of cases) {
    const email = `refused${++seq}@addcamp.t.co`;
    const r = await call('POST', '/admin/memberships/by-email', {
      body: { email, firstName: 'No', lastName: 'Way', campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: null }, bad] },
    });
    assert.strictEqual(r.status, status, `${JSON.stringify(bad)}: ${r.text}`);
    if (code) assert.strictEqual(r.json.code, code);
    assert.strictEqual(await User.countDocuments({ email }), 0, 'no account was created');
  }
  // A named person can't be their own coordinator; nothing joins.
  const own = await call('POST', '/admin/memberships/by-email', {
    body: { email: ctx.dana.email, campaigns: [{ campaignId: String(ctx.river._id), coordinatorId: String(ctx.dana._id) }] },
  });
  assert.strictEqual(own.status, 400);
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: ctx.dana._id, campaignId: ctx.river._id }), 0);
  // The same campaign twice is refused by the schema.
  const twice = await call('POST', '/admin/memberships/by-email', {
    body: { email: pat.email, campaigns: [{ campaignId: String(ctx.river._id) }, { campaignId: String(ctx.river._id) }] },
  });
  assert.strictEqual(twice.status, 400);
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: pat._id }), 0);
});

test('by-email: sent twice, the second changes nothing and sends nothing', { skip }, async () => {
  const body = { email: 'twice@addcamp.t.co', firstName: 'Two', lastName: 'Taps', campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: String(ctx.dana._id) }] };
  assert.strictEqual((await call('POST', '/admin/memberships/by-email', { body })).status, 201);
  assert.ok(await waitFor(() => mailsTo('twice@addcamp.t.co').length >= 1));
  clearOutbox();
  const again = await call('POST', '/admin/memberships/by-email', { body: { ...body, campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: String(ctx.sam._id) }] } });
  assert.strictEqual(again.status, 201, again.text);
  assert.strictEqual(again.json.outcome, 'in-org');
  assert.deepStrictEqual(again.json.campaigns.map((c) => c.result), ['already-on']);
  const u = await User.findOne({ email: 'twice@addcamp.t.co' });
  assert.strictEqual((await rosterOf(u._id)).get(String(ctx.fall._id)), String(ctx.dana._id));
  await sleep(200);
  assert.strictEqual(mailsTo('twice@addcamp.t.co').length, 0);
});

test('by-email: a returning person’s earlier doors on a campaign move to the crew they join, and only there', { skip }, async () => {
  const back = await mkPerson('Back');
  await CanvassActivity.collection.insertMany([
    knock(back._id, ctx.river._id, null, '10'),
    knock(back._id, ctx.river._id, null, '11'),
    knock(back._id, ctx.fall._id, null, '12'),
  ]);
  const r = await call('POST', '/admin/memberships/by-email', {
    body: { email: back.email, campaigns: [{ campaignId: String(ctx.river._id), coordinatorId: String(ctx.dana._id) }] },
  });
  assert.strictEqual(r.status, 201, r.text);
  const river = r.json.campaigns[0];
  assert.strictEqual(river.result, 'joined');
  assert.strictEqual(river.restamp.doors, 2);
  assert.deepStrictEqual(river.restamp.sources.map((s) => [s.coordinatorId, s.doors]), [[null, 2]]);
  const stamps = await CanvassActivity.find({ userId: back._id }, 'campaignId coordinatorId').lean();
  for (const s of stamps) {
    if (String(s.campaignId) === String(ctx.river._id)) assert.strictEqual(String(s.coordinatorId), String(ctx.dana._id));
    else assert.strictEqual(s.coordinatorId ?? null, null, 'another campaign’s doors stay where they were');
  }
});

test('by-email: an account deleted while the add runs is put back the way the deletion left it', { skip }, async () => {
  const gone = await mkPerson('Gone');
  // The deletion lands AFTER the lookup found them (an account already deleted is refused up front — next
  // test): the first roster insert marks the account deleted, so the add joins, then sees deletedAt after
  // its last write. Wrapping the model static, as crewJobCrash.int.test.js does.
  const original = CampaignAssignment.updateOne;
  let fired = false;
  CampaignAssignment.updateOne = async function (...args) {
    if (!fired && String(args[0]?.userId) === String(gone._id)) {
      fired = true;
      await User.updateOne({ _id: gone._id }, { $set: { deletedAt: new Date() } });
    }
    return original.apply(this, args);
  };
  let r;
  try {
    r = await call('POST', '/admin/memberships/by-email', {
      body: { email: gone.email, campaigns: [{ campaignId: String(ctx.fall._id) }, { campaignId: String(ctx.river._id) }] },
    });
  } finally {
    CampaignAssignment.updateOne = original;
  }
  assert.ok(fired, 'the deletion landed mid-add');
  assert.strictEqual(r.status, 409, r.text);
  assert.strictEqual(r.json.code, 'ACCOUNT_DELETED');
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: gone._id }), 0, 'every roster row it wrote is gone');
  assert.strictEqual((await Membership.findOne({ userId: gone._id, organizationId: ctx.org._id })).isActive, false);
  await sleep(150);
  assert.strictEqual(mailsTo(gone.email).length, 0);
});

test('a deleted member is refused BEFORE any write: their doors never move (both adds by email)', { skip }, async () => {
  const del = await mkPerson('Departed');
  await CanvassActivity.collection.insertMany([knock(del._id, ctx.river._id, ctx.dana._id, '13'), knock(del._id, ctx.river._id, ctx.dana._id, '14')]);
  // What account deletion leaves (services/users/deleteAccount.js): a tombstone address, deletedAt, and a
  // switched-off membership — which the tombstone address still resolves to.
  const tomb = `deleted+${del._id}@deleted.doorline.invalid`;
  await User.updateOne({ _id: del._id }, { $set: { deletedAt: new Date(), email: tomb, firstName: 'Deleted', lastName: 'user' } });
  await Membership.updateOne({ userId: del._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const before = await CanvassActivity.find({ userId: del._id }, 'coordinatorId').lean();
  const org = await call('POST', '/admin/memberships/by-email', {
    body: { email: tomb, campaigns: [{ campaignId: String(ctx.river._id), coordinatorId: String(ctx.sam._id) }] },
  });
  assert.strictEqual(org.status, 409, org.text);
  assert.strictEqual(org.json.code, 'ACCOUNT_DELETED');
  const team = await call('POST', `/admin/campaigns/${ctx.river._id}/crew`, { body: { email: tomb, coordinatorId: String(ctx.sam._id) } });
  assert.strictEqual(team.status, 409, team.text);
  assert.strictEqual(team.json.code, 'ACCOUNT_DELETED');
  const after = await CanvassActivity.find({ userId: del._id }, 'coordinatorId').lean();
  assert.deepStrictEqual(after.map((a) => String(a.coordinatorId)), before.map((a) => String(a.coordinatorId)), 'a departure never moves doors');
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: del._id }), 0);
  assert.strictEqual((await Membership.findOne({ userId: del._id, organizationId: ctx.org._id })).isActive, false);
});

test('by-email: an address outside the organization gets the same refusal whether or not it has an account elsewhere', { skip }, async () => {
  const elsewhere = await mkPerson('Elsewho', 'canvasser', ctx.elsewhere._id);
  const fresh = `nobody${++seq}@nowhere.t.co`;
  // No name typed: refused for both, and the account elsewhere is NOT attached.
  const a = await call('POST', '/admin/memberships/by-email', { body: { email: elsewhere.email } });
  const b = await call('POST', '/admin/memberships/by-email', { body: { email: fresh } });
  assert.strictEqual(a.status, 400);
  assert.strictEqual(a.text, b.text);
  assert.ok(!(await Membership.exists({ userId: elsewhere._id, organizationId: ctx.org._id })), 'not attached');
  // A typed password bcrypt can't take: refused for both.
  const bad = { firstName: 'T', lastName: 'Y', password: 'abcdefgh\uD800' };
  const c = await call('POST', '/admin/memberships/by-email', { body: { email: elsewhere.email, ...bad } });
  const d = await call('POST', '/admin/memberships/by-email', { body: { email: fresh, ...bad } });
  assert.strictEqual(c.status, 400);
  assert.strictEqual(c.text, d.text);
  assert.strictEqual(await User.countDocuments({ email: fresh }), 0);
  assert.ok(!(await Membership.exists({ userId: elsewhere._id, organizationId: ctx.org._id })));
});

test('nobody becomes their own coordinator, whatever case their id is sent in', { skip }, async () => {
  const upper = (id) => String(id).toUpperCase();
  const viaEmail = await call('POST', '/admin/memberships/by-email', {
    body: { email: ctx.dana.email, campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: upper(ctx.dana._id) }] },
  });
  assert.strictEqual(viaEmail.status, 400, viaEmail.text);
  const viaProfile = await call('POST', `/admin/memberships/${ctx.sam._id}/campaigns`, {
    body: { campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: upper(ctx.sam._id) }] },
  });
  assert.strictEqual(viaProfile.status, 400, viaProfile.text);
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: { $in: [ctx.dana._id, ctx.sam._id] }, coordinatorId: { $in: [ctx.dana._id, ctx.sam._id] } }), 0);
});

test('resolve: a switched-off colleague, and an address a deleted account gave up, which reads as outside', { skip }, async () => {
  const off = await mkPerson('Offline');
  await CampaignAssignment.create({ campaignId: ctx.river._id, userId: off._id, organizationId: ctx.org._id });
  await Membership.updateOne({ userId: off._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const r = await call('POST', '/admin/memberships/resolve', { body: { email: off.email } });
  assert.strictEqual(r.json.outcome, 'in-org-inactive');
  assert.deepStrictEqual(r.json.campaigns.map((c) => [c.campaignId, c.onCampaign]), [[String(ctx.river._id), true]]);
  // Deletion tombstones the address, so the person's old one belongs to nobody — one answer with no account.
  const was = await mkPerson('Waslater');
  const oldAddress = was.email;
  await User.updateOne({ _id: was._id }, { $set: { deletedAt: new Date(), email: `deleted+${was._id}@deleted.doorline.invalid` } });
  const gave = await call('POST', '/admin/memberships/resolve', { body: { email: oldAddress } });
  const never = await call('POST', '/admin/memberships/resolve', { body: { email: `never${++seq}@nowhere.t.co` } });
  assert.strictEqual(gave.text, never.text);
  assert.strictEqual(gave.json.outcome, 'outside');
});

test('profile add: a returning person’s doors move to the crew picked on EACH campaign, and the lookup reads both first', { skip }, async () => {
  const two = await mkPerson('Twice');
  await CanvassActivity.collection.insertMany([
    knock(two._id, ctx.fall._id, null, '15'),
    knock(two._id, ctx.river._id, ctx.dana._id, '16'),
    knock(two._id, ctx.river._id, ctx.dana._id, '17'),
  ]);
  const look = await call('POST', '/admin/memberships/resolve', { body: { email: two.email } });
  const rows = new Map(look.json.campaigns.map((c) => [c.campaignId, c.history]));
  assert.strictEqual(rows.get(String(ctx.fall._id)).doors, 1);
  assert.deepStrictEqual(rows.get(String(ctx.river._id)).sources.map((x) => [x.coordinatorId, x.doors]), [[String(ctx.dana._id), 2]]);
  const r = await call('POST', `/admin/memberships/${two._id}/campaigns`, {
    body: { campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: String(ctx.sam._id) }, { campaignId: String(ctx.river._id), coordinatorId: String(ctx.sam._id) }] },
  });
  assert.strictEqual(r.status, 201, r.text);
  assert.deepStrictEqual(r.json.campaigns.map((c) => [c.campaignName, c.restamp.doors]), [['Fall Canvass', 1], ['Riverside Turnout', 2]]);
  const stamps = await CanvassActivity.find({ userId: two._id }, 'coordinatorId').lean();
  assert.ok(stamps.every((x) => String(x.coordinatorId) === String(ctx.sam._id)), 'every campaign’s doors now count for the crew picked there');
});

test('by-email: when another admin’s add for the same address lands first, the answer says so plainly', { skip }, async () => {
  // The other add creates the membership between this request's lookup and its create: the write that
  // follows meets the unique index. Simulated by failing the first membership insert with a duplicate key.
  const email = `raced${++seq}@addcamp.t.co`;
  const original = Membership.create;
  let fired = false;
  Membership.create = async function (...args) {
    if (!fired) {
      fired = true;
      throw Object.assign(new Error('E11000 duplicate key error collection: memberships'), { code: 11000 });
    }
    return original.apply(this, args);
  };
  let r;
  try {
    r = await call('POST', '/admin/memberships/by-email', { body: { email, firstName: 'Ray', lastName: 'Ced' } });
  } finally {
    Membership.create = original;
  }
  assert.ok(fired);
  assert.strictEqual(r.status, 409, r.text);
  assert.strictEqual(r.json.code, 'ADDED_MEANWHILE');
  assert.ok(!/Existing user/.test(r.json.error), 'never points at the old form’s checkbox');
});

test('by-email: an organization read-only for billing gets 402 and nothing is written', { skip }, async () => {
  const ro = await Organization.create({ name: 'Read Only', slug: 'addcamp-ro', isActive: true });
  await Subscription.create({ organizationId: ro._id, status: 'suspended' });
  const roAdmin = await mkPerson('RoAdmin', 'admin', ro._id);
  const r = await call('POST', '/admin/memberships/by-email', { as: roAdmin, orgId: ro._id, body: { email: 'ro@addcamp.t.co', firstName: 'R', lastName: 'O' } });
  assert.strictEqual(r.status, 402);
  assert.strictEqual(r.json.code, 'subscription-inactive');
  assert.strictEqual(await User.countDocuments({ email: 'ro@addcamp.t.co' }), 0);
});

// ── A profile's Add to campaigns ──────────────────────────────────────────────────────────────────────

test('profile add: joins each campaign with its crew and sends one email naming them', { skip }, async () => {
  const ana = await mkPerson('Ana');
  const r = await call('POST', `/admin/memberships/${ana._id}/campaigns`, {
    body: { campaigns: [{ campaignId: String(ctx.fall._id), coordinatorId: String(ctx.dana._id) }, { campaignId: String(ctx.river._id), coordinatorId: null }] },
  });
  assert.strictEqual(r.status, 201, r.text);
  assert.deepStrictEqual(r.json.campaigns.map((c) => c.result), ['joined', 'joined']);
  const roster = await rosterOf(ana._id);
  assert.strictEqual(roster.get(String(ctx.fall._id)), String(ctx.dana._id));
  assert.ok(await waitFor(() => mailsTo(ana.email).length >= 1));
  await sleep(150);
  const mails = mailsTo(ana.email);
  assert.deepStrictEqual(mails.map((m) => m.kind), ['addedToCampaign']);
  assert.strictEqual(mails[0].subject, "You've been added to 2 campaigns");
  assert.ok(bodyOf(mails[0]).includes('Fall Canvass') && bodyOf(mails[0]).includes('Riverside Turnout'));
});

test('profile add: someone who has not set a password yet gets no email; a switched-off or deleted account is refused', { skip }, async () => {
  const fresh = await mkPerson('Fresh', 'canvasser', ctx.org._id, { mustChangePassword: true });
  const r = await call('POST', `/admin/memberships/${fresh._id}/campaigns`, { body: { campaigns: [{ campaignId: String(ctx.river._id) }] } });
  assert.strictEqual(r.status, 201, r.text);
  await sleep(250);
  assert.strictEqual(mailsTo(fresh.email).length, 0);

  const off = await mkPerson('Switched');
  await Membership.updateOne({ userId: off._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const refused = await call('POST', `/admin/memberships/${off._id}/campaigns`, { body: { campaigns: [{ campaignId: String(ctx.river._id) }] } });
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.json.code, 'MEMBER_DEACTIVATED');
  assert.strictEqual(await CampaignAssignment.countDocuments({ userId: off._id }), 0);

  const deleted = await mkPerson('Deleted');
  await User.updateOne({ _id: deleted._id }, { $set: { deletedAt: new Date() } });
  const gone = await call('POST', `/admin/memberships/${deleted._id}/campaigns`, { body: { campaigns: [{ campaignId: String(ctx.river._id) }] } });
  assert.strictEqual(gone.status, 409);
  assert.strictEqual(gone.json.code, 'ACCOUNT_DELETED');

  const none = await call('POST', `/admin/memberships/${fresh._id}/campaigns`, { body: { campaigns: [] } });
  assert.strictEqual(none.status, 400);
  const stranger = await call('POST', `/admin/memberships/${new ObjectId()}/campaigns`, { body: { campaigns: [{ campaignId: String(ctx.river._id) }] } });
  assert.strictEqual(stranger.status, 404);
});

// ── crewSize ──────────────────────────────────────────────────────────────────────────────────────────

test('crews: crewSize counts who has this person as coordinator on each campaign, and is left off where a lead can’t look', { skip }, async () => {
  const boss = await mkPerson('Boss', 'lead');
  await CampaignAssignment.create({ campaignId: ctx.fall._id, userId: boss._id, organizationId: ctx.org._id });
  await CampaignAssignment.create({ campaignId: ctx.river._id, userId: boss._id, organizationId: ctx.org._id });
  for (const name of ['CrewA', 'CrewB']) {
    const p = await mkPerson(name);
    await CampaignAssignment.create({ campaignId: ctx.fall._id, userId: p._id, organizationId: ctx.org._id, coordinatorId: boss._id });
  }
  const asAdmin = await call('GET', `/admin/memberships/${boss._id}/crews`);
  assert.strictEqual(asAdmin.status, 200);
  const byId = new Map(asAdmin.json.crews.map((c) => [c.campaignId, c]));
  assert.strictEqual(byId.get(String(ctx.fall._id)).crewSize, 2);
  assert.strictEqual(byId.get(String(ctx.river._id)).crewSize, 0);
  // The lead manages Fall only: Riverside comes back with its name and nothing else.
  const asLead = await call('GET', `/admin/memberships/${boss._id}/crews`, { as: ctx.lead });
  assert.strictEqual(asLead.status, 200);
  const leadView = new Map(asLead.json.crews.map((c) => [c.campaignId, c]));
  assert.strictEqual(leadView.get(String(ctx.fall._id)).crewSize, 2);
  assert.ok(!('crewSize' in leadView.get(String(ctx.river._id))), 'a hidden row keeps only its name (item 40)');
});
