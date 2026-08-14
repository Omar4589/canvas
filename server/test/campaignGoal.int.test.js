import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Campaign door goal (doorGoal / goalDate) + the pace block, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/campaigngoal_test node --test test/campaignGoal.int.test.js
// Proves: the fields round-trip and validate; a TEAM LEAD may set them while still being
// blocked from the key dates (the deliberate departure — owner ruling 2026-08-14); `done` is
// billable doors and moves with billRestrictedDoors; the deadline falls back to electionDay;
// the verdict stays suppressed on a young campaign; and — the regression most likely to bite —
// a WINDOWED rollup still reports an ALL-TIME goal.done.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-campaign-goal';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const TZ = 'America/Chicago';
const DAY = 86400000;
// Knocks spread over the last 10 days so the trailing pace window has real days in it, and the
// round activated 40 days ago so the campaign is comfortably past the 5-day verdict floor.
const now = Date.now();
const ACTIVATED_AT = new Date(now - 40 * DAY);

let server;
let base;
const ctx = {};

const todayIn = (tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
const shift = (dayStr, n) => {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, CampaignManager, Campaign, Effort, Pass, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Goal Org', slug: 'goal-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ga@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'gl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canv', email: 'gc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  // The campaign the pace assertions run against: 8 knocked doors + 2 restricted-only doors,
  // so billableDoors (10) and knocks (8) are DIFFERENT numbers and the policy flip is visible.
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Paced', type: 'survey', state: 'TX', timeZone: TZ,
  });
  await CampaignManager.create({ organizationId: org._id, campaignId: campaign._id, userId: lead._id, isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: ACTIVATED_AT,
  });

  const doors = [];
  for (let i = 1; i <= 10; i++) {
    doors.push(await Household.create({
      organizationId: org._id, campaignId: campaign._id,
      addressLine1: `${i} Main St`, city: 'Austin', state: 'TX', zipCode: '78701',
      normalizedAddress: `${i} main st austin tx 78701`,
      status: 'unknocked', isActive: true,
    }));
  }
  const act = (household, actionType, daysAgo) =>
    CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, householdId: household._id,
      userId: canv._id, actionType, passId: pass._id,
      timestamp: new Date(now - daysAgo * DAY),
      location: { lat: 30.26, lng: -97.74 },
    });
  // 8 knocks inside the 14-day pace window, on 8 distinct days.
  for (let i = 0; i < 8; i++) await act(doors[i], 'not_home', i + 1);
  // 2 restricted-only doors, also in-window — billable only when the policy is on.
  await act(doors[8], 'restricted', 2);
  await act(doors[9], 'restricted', 3);
  for (let i = 0; i < 8; i++) await Household.updateOne({ _id: doors[i]._id }, { status: 'not_home' });
  await Household.updateOne({ _id: doors[8]._id }, { status: 'restricted' });
  await Household.updateOne({ _id: doors[9]._id }, { status: 'restricted' });
  await recomputeCampaignStats(campaign._id);

  // A second campaign that has NEVER activated a round — the verdict-suppression case.
  const young = await Campaign.create({
    organizationId: org._id, name: 'Young', type: 'lit_drop', state: 'TX', timeZone: TZ,
    doorGoal: 5000, goalDate: shift(todayIn(TZ), 30),
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, campaign, young,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
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

const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const leadAuth = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const rollupRow = async (opts = {}, who = auth()) => {
  const p = new URLSearchParams({ campaignId: String(ctx.campaign._id), ...opts });
  const r = await call('GET', `/admin/reports/campaign-rollup?${p}`, who);
  assert.strictEqual(r.status, 200);
  return r.json.campaigns[0];
};

test('POST round-trips doorGoal + goalDate onto the campaigns list', { skip }, async () => {
  const r = await call('POST', '/admin/campaigns', {
    ...auth(),
    body: { name: 'Goal C', type: 'survey', state: 'FL', doorGoal: 10000, goalDate: '2026-10-28' },
  });
  assert.strictEqual(r.status, 201);
  ctx.plainId = r.json.campaign._id;

  const list = await call('GET', '/admin/campaigns', auth());
  const row = list.json.campaigns.find((c) => String(c._id) === String(ctx.plainId));
  assert.strictEqual(row.doorGoal, 10000);
  assert.strictEqual(row.goalDate, '2026-10-28');
  assert.strictEqual(row.goal.target, 10000, 'the list carries the computed block too');
  assert.strictEqual(row.goal.done, 0, 'a brand-new campaign has knocked nothing');
});

test('a campaign with no goal reports goal: null everywhere', { skip }, async () => {
  const r = await call('POST', '/admin/campaigns', {
    ...auth(),
    body: { name: 'No Goal', type: 'lit_drop', state: 'FL' },
  });
  assert.strictEqual(r.status, 201);
  const list = await call('GET', '/admin/campaigns', auth());
  const row = list.json.campaigns.find((c) => String(c._id) === String(r.json.campaign._id));
  assert.strictEqual(row.doorGoal, null);
  assert.strictEqual(row.goal, null);
});

test('PATCH updates the goal and explicit null clears the pair', { skip }, async () => {
  const up = await call('PATCH', `/admin/campaigns/${ctx.plainId}`, {
    ...auth(),
    body: { doorGoal: 12000, goalDate: '2026-11-01' },
  });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.campaign.doorGoal, 12000);

  const clear = await call('PATCH', `/admin/campaigns/${ctx.plainId}`, {
    ...auth(),
    body: { doorGoal: null, goalDate: null },
  });
  assert.strictEqual(clear.status, 200);
  assert.strictEqual(clear.json.campaign.doorGoal, null);
  assert.strictEqual(clear.json.campaign.goalDate, null);
});

test('a goal date with no goal is rejected, on POST and on the MERGED patch', { skip }, async () => {
  const post = await call('POST', '/admin/campaigns', {
    ...auth(),
    body: { name: 'Dateless', type: 'survey', state: 'FL', goalDate: '2026-10-28' },
  });
  assert.strictEqual(post.status, 400);
  assert.strictEqual(post.json.code, 'goal-date-without-goal');

  // Set both, then clear ONLY the goal — the stored date must be caught.
  await call('PATCH', `/admin/campaigns/${ctx.plainId}`, {
    ...auth(),
    body: { doorGoal: 9000, goalDate: '2026-10-28' },
  });
  const orphan = await call('PATCH', `/admin/campaigns/${ctx.plainId}`, {
    ...auth(),
    body: { doorGoal: null },
  });
  assert.strictEqual(orphan.status, 400, 'clearing the goal must not leave a dangling date');
  assert.strictEqual(orphan.json.code, 'goal-date-without-goal');
});

test('doorGoal validation: no zero, no negative, no fraction, no absurd, bad date rejected', { skip }, async () => {
  for (const doorGoal of [0, -5, 12.5, 10_000_001]) {
    const r = await call('PATCH', `/admin/campaigns/${ctx.plainId}`, { ...auth(), body: { doorGoal } });
    assert.strictEqual(r.status, 400, `doorGoal ${doorGoal} must be rejected`);
  }
  const bad = await call('PATCH', `/admin/campaigns/${ctx.plainId}`, {
    ...auth(),
    body: { doorGoal: 100, goalDate: '10/28/2026' },
  });
  assert.strictEqual(bad.status, 400, 'goalDate must be YYYY-MM-DD');
});

test('a TEAM LEAD may set the goal but still cannot touch the key dates', { skip }, async () => {
  const ok = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...leadAuth(),
    body: { doorGoal: 100, goalDate: shift(todayIn(TZ), 16) },
  });
  assert.strictEqual(ok.status, 200, 'a lead owns their campaign target (owner ruling)');
  assert.strictEqual(ok.json.campaign.doorGoal, 100);

  // The same lead, on the same campaign, is still walled off from every other date.
  for (const field of ['electionDay', 'earlyVotingStart', 'earlyVotingEnd']) {
    const nope = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
      ...leadAuth(),
      body: { [field]: '2026-11-03' },
    });
    assert.strictEqual(nope.status, 403, `${field} stays org-admin-only`);
  }
  const note = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...leadAuth(),
    body: { datesNote: 'nope' },
  });
  assert.strictEqual(note.status, 403);
});

test('done is BILLABLE doors and moves with the billRestrictedDoors policy', { skip }, async () => {
  await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...auth(),
    body: { doorGoal: 1000, goalDate: shift(todayIn(TZ), 16) },
  });

  const off = await rollupRow();
  assert.strictEqual(off.knocks, 8);
  assert.strictEqual(off.restrictedDoors, 2);
  assert.strictEqual(off.goal.done, 8, 'policy off → billable doors are just the knocks');

  await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...auth(),
    body: { billRestrictedDoors: true },
  });
  const on = await rollupRow();
  assert.strictEqual(on.billableDoors, 10);
  assert.strictEqual(on.goal.done, 10, 'policy on → the two restricted doors count');
  assert.strictEqual(on.goal.remaining, 990);

  await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...auth(),
    body: { billRestrictedDoors: null },
  });
});

test('a WINDOWED rollup still reports an ALL-TIME goal.done', { skip }, async () => {
  // Today only: every knock in the fixture is at least a day old, so the windowed numbers are
  // zero while the goal must not budge. This is the regression the caption on the card exists
  // to describe, and the one most likely to be broken by a future refactor.
  const today = todayIn(TZ);
  const windowed = await rollupRow({ from: today, to: today });
  assert.strictEqual(windowed.knocks, 0, 'nothing was knocked today');
  assert.strictEqual(windowed.goal.done, 8, 'the goal is all-time regardless of the date filter');
  assert.strictEqual(windowed.goal.target, 1000);
});

test('the deadline falls back to Election Day and says so', { skip }, async () => {
  await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...auth(), body: { goalDate: null } });
  const noDate = await rollupRow();
  assert.strictEqual(noDate.goal.verdict, 'no_deadline');
  assert.strictEqual(noDate.goal.deadline, null);
  assert.strictEqual(noDate.goal.requiredPerDay, null, 'no date, no pace');

  const eday = shift(todayIn(TZ), 20);
  await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...auth(), body: { electionDay: eday } });
  const fell = await rollupRow();
  assert.strictEqual(fell.goal.deadline, eday);
  assert.strictEqual(fell.goal.deadlineSource, 'electionDay');
  assert.strictEqual(fell.goal.daysLeft, 20);

  // An explicit goal date wins over Election Day.
  const earlier = shift(todayIn(TZ), 10);
  await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...auth(), body: { goalDate: earlier } });
  const won = await rollupRow();
  assert.strictEqual(won.goal.deadline, earlier);
  assert.strictEqual(won.goal.deadlineSource, 'goalDate');
});

test('a real pace verdict appears once there is history to judge', { skip }, async () => {
  const row = await rollupRow();
  assert.ok(['ahead', 'on_track', 'behind'].includes(row.goal.verdict), `got ${row.goal.verdict}`);
  assert.strictEqual(row.goal.paceWindowDays, 14, 'the round activated 40 days ago — full window');
  assert.ok(row.goal.recentPerDay >= 0);
  assert.ok(row.goal.requiredPerDay > 0);
});

test('a campaign that never activated a round gets no verdict, only the target', { skip }, async () => {
  const p = new URLSearchParams({ campaignId: String(ctx.young._id) });
  const r = await call('GET', `/admin/reports/campaign-rollup?${p}`, auth());
  const goal = r.json.campaigns[0].goal;
  assert.strictEqual(goal.verdict, 'no_pace', 'nothing has been canvassed — no verdict is honest');
  assert.strictEqual(goal.paceWindowDays, 0);
  assert.strictEqual(goal.projectedFinish, null);
  assert.ok(goal.requiredPerDay > 0, 'the required rate is still reported');
});

test('a lead sees the goal on their own campaign and 403s on one they do not manage', { skip }, async () => {
  const mine = await rollupRow({}, leadAuth());
  assert.strictEqual(mine.goal.target, 1000);

  const p = new URLSearchParams({ campaignId: String(ctx.young._id) });
  const other = await call('GET', `/admin/reports/campaign-rollup?${p}`, leadAuth());
  assert.strictEqual(other.status, 403, 'the goal rides the existing grant intersection');
});
