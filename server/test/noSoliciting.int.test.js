import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The "No soliciting" door disposition — the canvasser reached the door and a posted sign ended
// the visit.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/nosolicit_test node --test test/noSoliciting.int.test.js
//
// The invariant this file exists to protect is the pair that makes it DIFFERENT from `restricted`,
// the disposition it is most easily confused with:
//
//   IS a knock      — the walk happened, so it enters KNOCK_ACTIONS, billable doors, doors/hour,
//                     and the "homes knocked" side of the coverage funnel. `restricted` does none
//                     of that (nobody ever reached the door).
//   is NOT a contact — nobody answered, so it must never enter the contactRate numerator. That is
//                     what separates it from `refused`, where someone did answer.
//
// Getting exactly one of those two wrong is silent: the number still renders, it is just false.
// So the tests below pin BOTH directions against a fixture whose right answers are known by hand.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-no-soliciting';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { KNOCK_ACTIONS } = await import('../src/services/reports/aggregations.js');
const { resolveStatus, ACTION_TO_STATUS } = await import('../src/utils/statusPrecedence.js');
const { cutStatusExclusion } = await import('../src/services/turf/generateTurf.js');
const { computeWindowStats } = await import('../src/services/reports/computeReport.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const KNOCK_AT = new Date('2026-04-14T15:00:00Z');
// Door 7's second visit. Distinct on purpose: resolveStatus is last-write-wins, and with two
// rows sharing a timestamp the winner falls out of aggregation order — a fixture that would
// pass or fail for reasons unrelated to the code under test.
const LATER = new Date('2026-04-14T16:30:00Z');

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Subscription, Household, CanvassActivity, Effort, Pass, CampaignAssignment]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Sign Org', slug: 'sign-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'nsa@t.co', passwordHash: 'x', isActive: true });
  const c1 = await User.create({ firstName: 'Cara', lastName: 'One', email: 'ns1@t.co', passwordHash: 'x', isActive: true });
  const c2 = await User.create({ firstName: 'Cal', lastName: 'Two', email: 'ns2@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: c1._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Ward 9', type: 'survey', state: 'TX', timeZone: 'America/Chicago',
  });
  const litCampaign = await Campaign.create({
    organizationId: org._id, name: 'Lit Run', type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago',
  });
  // The mobile write path gates on CampaignAssignment, not Membership.
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: c1._id });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: litCampaign._id, userId: c1._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: KNOCK_AT,
  });

  // Fixture, one round, 8 doors. Chosen so every headline number below has a hand-checkable value:
  //   1 surveyed · 2 refused · 3 not_home · 4,5 no_soliciting · 6 restricted (never a knock)
  //   7 no_soliciting by c1, then not_home by c2 an hour later (the dedup case — ONE door,
  //     resolving to not_home because the later mark wins)
  //   8 wrong_address
  // ⇒ knocks = 7 doors (1,2,3,4,5,7,8); restrictedDoors = 1 (door 6)
  //   contact numerator = surveyed(1) + refused(1) = 2 ⇒ contactRate = round(2/7*100) = 29
  //   connection numerator = surveyed(1) ⇒ connectionRate = round(1/7*100) = 14
  const doors = [];
  for (let i = 1; i <= 8; i++) {
    doors.push(await Household.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      addressLine1: `${i} Sign St`, city: 'Austin', state: 'TX', zipCode: '78701',
      normalizedAddress: `${i} sign st austin tx 78701`,
      location: { type: 'Point', coordinates: [-97.74, 30.26] },
      status: 'unknocked', isActive: true,
    }));
  }

  const act = (household, userId, actionType, extra = {}) =>
    CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, householdId: household._id,
      userId, actionType, passId: pass._id, timestamp: KNOCK_AT,
      location: { lat: 30.26, lng: -97.74 }, ...extra,
    });

  await act(doors[0], c1._id, 'survey_submitted');
  await act(doors[1], c1._id, 'refused');
  await act(doors[2], c1._id, 'not_home');
  await act(doors[3], c1._id, 'no_soliciting');
  await act(doors[4], c1._id, 'no_soliciting');
  await act(doors[5], c1._id, 'restricted');
  await act(doors[6], c1._id, 'no_soliciting');
  await act(doors[6], c2._id, 'not_home', { timestamp: LATER });
  await act(doors[7], c1._id, 'wrong_address');

  const statuses = ['surveyed', 'refused', 'not_home', 'no_soliciting', 'no_soliciting', 'restricted', 'not_home', 'wrong_address'];
  for (let i = 0; i < statuses.length; i++) {
    await Household.updateOne({ _id: doors[i]._id }, { status: statuses[i] });
  }

  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, c1, c2, campaign, litCampaign, effort, pass, doors,
    adminTok: signUserToken(admin), c1Tok: signUserToken(c1),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body, raw } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

const auth = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

const EXPECTED_KNOCKS = 7;
// Two different units, and the difference is real — door 7 was marked no_soliciting by one
// canvasser and not_home by another:
//   ...BY_STATUS = doors whose RESOLVED status is no_soliciting (door 7 resolved to not_home).
//     This is what the coverage funnel and the cut exclusion speak in.
//   ...KNOCKS    = doors where ANY canvasser recorded it ($max over the household×pass group).
//     This is what the per-outcome report buckets speak in, exactly like refusedKnocks — a door
//     can appear in two of these buckets, and they deliberately do NOT partition the knocks.
// Conflating the two is the specific mistake this pair of constants exists to prevent.
const EXPECTED_NO_SOLICITING_BY_STATUS = 2; // doors 4, 5
const EXPECTED_NO_SOLICITING_KNOCKS = 3; // doors 4, 5, 7
const EXPECTED_RESTRICTED_DOORS = 1;
const EXPECTED_CONTACT_RATE = 29; // (1 surveyed + 1 refused) / 7
const EXPECTED_CONNECTION_RATE = 14; // 1 surveyed / 7

test('the vocabulary: a knock action, a non-completion status', { skip }, () => {
  assert.ok(KNOCK_ACTIONS.includes('no_soliciting'), 'no_soliciting must be a knock action');
  assert.ok(!KNOCK_ACTIONS.includes('restricted'), 'restricted must NOT be — the two are not interchangeable');
  assert.equal(ACTION_TO_STATUS.no_soliciting, 'no_soliciting');

  // Non-completion ⇒ last-write-wins in BOTH directions, so a mistake is correctable in the field.
  const t0 = new Date('2026-04-14T15:00:00Z');
  const t1 = new Date('2026-04-14T15:05:00Z');
  assert.equal(
    resolveStatus('survey', [{ actionType: 'not_home', timestamp: t0 }, { actionType: 'no_soliciting', timestamp: t1 }]),
    'no_soliciting'
  );
  assert.equal(
    resolveStatus('survey', [{ actionType: 'no_soliciting', timestamp: t0 }, { actionType: 'not_home', timestamp: t1 }]),
    'not_home'
  );
  // ...but a completion still wins regardless of order (sticky), same as every other outcome.
  assert.equal(
    resolveStatus('survey', [{ actionType: 'survey_submitted', timestamp: t0 }, { actionType: 'no_soliciting', timestamp: t1 }]),
    'surveyed'
  );
  assert.equal(
    resolveStatus('lit_drop', [{ actionType: 'no_soliciting', timestamp: t0 }, { actionType: 'lit_dropped', timestamp: t1 }]),
    'lit_dropped'
  );
});

test('IS a knock: it counts in knocks and billable doors, and is not a restricted door', { skip }, async () => {
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(kbp.status, 200);
  assert.equal(kbp.json.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(kbp.json.totals.noSolicitingKnocks, EXPECTED_NO_SOLICITING_KNOCKS);
  // The whole point of the split from `restricted`: these doors were REACHED.
  assert.equal(kbp.json.totals.restrictedDoors, EXPECTED_RESTRICTED_DOORS, 'a no-soliciting door is not a restricted door');
  // billableDoors === knocks with the restricted opt-in off, so no-soliciting doors bill by
  // default — no flag, no opt-in, because the walk happened.
  assert.equal(kbp.json.totals.billableDoors, EXPECTED_KNOCKS);
});

test('is NOT a contact: contact rate ignores it, connection rate ignores it', { skip }, async () => {
  const ov = await call('GET', `/admin/reports/overview?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(ov.status, 200);
  assert.equal(ov.json.totals.knocks, EXPECTED_KNOCKS);
  assert.equal(ov.json.totals.contactRate, EXPECTED_CONTACT_RATE, 'nobody answered a no-soliciting door');
  assert.equal(ov.json.totals.connectionRate, EXPECTED_CONNECTION_RATE);

  // The failure this pins: were no_soliciting wrongly folded into the contact numerator, the rate
  // would read (1+1+2)/7 = 57 rather than 29 — a plausible-looking number that is simply wrong.
  assert.notEqual(ov.json.totals.contactRate, 57);
});

test('coverage: a no-soliciting door IS "homes knocked" (a restricted door is not)', { skip }, async () => {
  const ov = await call('GET', `/admin/reports/overview?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(ov.json.canvass.no_soliciting, EXPECTED_NO_SOLICITING_BY_STATUS, 'its own coverage segment');
  assert.equal(ov.json.canvass.restricted, EXPECTED_RESTRICTED_DOORS);
  // 8 doors, 1 restricted ⇒ 7 knocked. The restricted door is the ONLY one held out.
  assert.equal(ov.json.totals.homesKnocked, EXPECTED_KNOCKS);
  assert.equal(ov.json.events.noSoliciting, EXPECTED_NO_SOLICITING_KNOCKS, 'the raw event tally counts door 7 too');
});

test('the client-report breakdown still sums to doors knocked', { skip }, async () => {
  // The trap this exists for: computeReport builds a fixed `events` literal and drops any status
  // missing from it via `status in events`. A knock outcome absent from that literal makes the
  // breakdown quietly stop adding up, and nothing else goes red.
  const stats = await computeWindowStats({
    orgId: ctx.org._id,
    campaignId: ctx.campaign._id,
    range: { from: new Date('2026-04-01T00:00:00Z'), to: new Date('2026-04-30T23:59:59Z') },
    campaignType: 'survey',
  });
  assert.equal(stats.totals.doorsKnocked, EXPECTED_KNOCKS);
  // contactBreakdown IS the `events` literal — one resolved outcome per (household, pass), so
  // here door 7 counts once, as not_home. That is why this partitions and the buckets above don't.
  assert.equal(stats.contactBreakdown.no_soliciting, EXPECTED_NO_SOLICITING_BY_STATUS);
  const sum = Object.values(stats.contactBreakdown).reduce((s, n) => s + n, 0);
  assert.equal(sum, stats.totals.doorsKnocked, 'Σ(contact breakdown) must equal doorsKnocked');
  assert.equal(stats.totals.contactRate, EXPECTED_CONTACT_RATE, 'and the report agrees with the dashboard');
});

test('per-round rows reconcile with the totals they break down', { skip }, async () => {
  const kbp = await call('GET', `/admin/reports/knocks-by-pass?campaignId=${ctx.campaign._id}`, auth());
  const sum = (k) => kbp.json.rounds.reduce((s, r) => s + r[k], 0);
  assert.equal(sum('knocks'), kbp.json.totals.knocks);
  assert.equal(sum('noSolicitingKnocks'), kbp.json.totals.noSolicitingKnocks);
});

test('the write route records it, on BOTH campaign types, and is replaceable', { skip }, async () => {
  const fresh = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id,
    addressLine1: '42 Fresh Way', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '42 fresh way austin tx 78701',
    location: { type: 'Point', coordinates: [-97.74, 30.26] },
    status: 'unknocked', isActive: true,
  });
  const post = (id) =>
    call('POST', `/mobile/households/${id}/no-soliciting`, {
      token: ctx.c1Tok, orgId: ctx.org._id,
      body: { location: { lat: 30.26, lng: -97.74, accuracy: 5 } },
    });

  const r1 = await post(fresh._id);
  assert.equal(r1.status, 201, `expected 201, got ${r1.status}: ${JSON.stringify(r1.json)}`);
  let doc = await Household.findById(fresh._id).lean();
  assert.equal(doc.status, 'no_soliciting');

  // Replaceable: a second tap supersedes rather than stacking a duplicate knock.
  const r2 = await post(fresh._id);
  assert.ok(r2.status === 200 || r2.status === 201, `expected 2xx, got ${r2.status}`);
  const rows = await CanvassActivity.countDocuments({
    householdId: fresh._id, userId: ctx.c1._id, actionType: 'no_soliciting',
  });
  assert.equal(rows, 1, 'latest-wins must replace, not accumulate');

  // A lit-drop campaign gets the button too — a sign forbids literature at least as much.
  const litDoor = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.litCampaign._id,
    addressLine1: '7 Lit Ln', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '7 lit ln austin tx 78701',
    location: { type: 'Point', coordinates: [-97.74, 30.26] },
    status: 'unknocked', isActive: true,
  });
  await Membership.updateOne({ userId: ctx.c1._id, organizationId: ctx.org._id }, { $set: { isActive: true } });
  const r3 = await post(litDoor._id);
  assert.ok(r3.status === 201 || r3.status === 200, `lit-drop campaigns must accept it, got ${r3.status}`);

  await CanvassActivity.deleteMany({ householdId: { $in: [fresh._id, litDoor._id] } });
  await Household.deleteMany({ _id: { $in: [fresh._id, litDoor._id] } });
});

test('cut exclusion: each toggle alone, and BOTH together (the $nin case)', { skip }, () => {
  // Two toggles, one `status` key. Spreading two `{ status: { $ne } }` objects would keep only the
  // last — silently re-cutting the doors the admin asked to drop. This is that regression's pin.
  assert.deepEqual(cutStatusExclusion({}), {});
  assert.deepEqual(cutStatusExclusion({ excludeRestricted: true }), { status: { $nin: ['restricted'] } });
  assert.deepEqual(cutStatusExclusion({ excludeNoSoliciting: true }), { status: { $nin: ['no_soliciting'] } });
  assert.deepEqual(
    cutStatusExclusion({ excludeRestricted: true, excludeNoSoliciting: true }),
    { status: { $nin: ['restricted', 'no_soliciting'] } },
    'both toggles must survive together'
  );
});

test('cut exclusion actually removes the doors from a target preview', { skip }, async () => {
  const body = { passId: String(ctx.pass._id), filter: {} };
  const all = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/target-preview`, { ...auth(), body });
  assert.equal(all.status, 200, `target-preview failed: ${JSON.stringify(all.json)}`);

  const dropped = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/target-preview`, {
    ...auth(), body: { ...body, excludeNoSoliciting: true },
  });
  assert.equal(dropped.status, 200);
  assert.equal(
    all.json.doorCount - dropped.json.doorCount,
    EXPECTED_NO_SOLICITING_BY_STATUS,
    'excluding no-soliciting must drop exactly those doors'
  );

  const both = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/target-preview`, {
    ...auth(), body: { ...body, excludeNoSoliciting: true, excludeRestricted: true },
  });
  assert.equal(
    all.json.doorCount - both.json.doorCount,
    EXPECTED_NO_SOLICITING_BY_STATUS + EXPECTED_RESTRICTED_DOORS,
    'both toggles together must drop both sets'
  );
});

test('CSV: the invoice-grade export carries a No soliciting column', { skip }, async () => {
  const csv = await call('GET', `/admin/reports/knocks-by-pass.csv?campaignId=${ctx.campaign._id}`, { ...auth(), raw: true });
  assert.equal(csv.status, 200);
  const [header, ...rows] = csv.text.trim().split('\n');
  assert.ok(header.includes('No soliciting'), `header must carry the column: ${header}`);
  const idx = header.split(',').indexOf('No soliciting');
  const total = rows.find((l) => l.startsWith('TOTAL'));
  assert.equal(
    Number(total.split(',')[idx]),
    EXPECTED_NO_SOLICITING_KNOCKS,
    'and the TOTAL row must carry the real number'
  );
});

test('per-canvasser numbers include it in knocks without inflating the contact rate', { skip }, async () => {
  const r = await call('GET', `/admin/reports/canvassers?campaignId=${ctx.campaign._id}`, auth());
  assert.equal(r.status, 200);
  const cara = r.json.find((c) => String(c.userId) === String(ctx.c1._id));
  assert.ok(cara, 'the canvasser must appear');
  assert.equal(cara.noSoliciting, 3, 'her own three no-soliciting marks');
  // Her knocks: survey + refused + not_home + 3 no_soliciting + wrong_address = 7 (restricted is out).
  assert.equal(cara.knocks, 7);
  assert.equal(cara.restricted, 1, 'and the restricted mark stays outside knocks');
  // Contact numerator is still surveyed + refused only.
  assert.equal(cara.contactRate, Math.round((2 / 7) * 100));
});

test('Campaign.stats counters agree with the live pipeline', { skip }, async () => {
  await recomputeCampaignStats(ctx.campaign._id);
  const doc = await Campaign.findById(ctx.campaign._id, { stats: 1 }).lean();
  assert.equal(doc.stats.knockCount, EXPECTED_KNOCKS, 'the counter path must count it as a knock too');
  assert.equal(doc.stats.restrictedDoorCount, EXPECTED_RESTRICTED_DOORS);
});
