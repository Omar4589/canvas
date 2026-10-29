import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Bring back an archived pass — docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.4-B.6, §C.3 — over the REAL
// Express app + a throwaway mongod:
//   npm run test:int -- test/passBringBack.int.test.js
//
// The invariants this file exists to protect:
//   • A pass ended by the next pass going live NEVER comes back (rule 4a) — stamped by the real
//     activation route, and inferred for rows from before this change.
//   • A pass coming back LIVE is refused once a later pass of its walk list was live at or after
//     its end (rule 4b, `>=` because activation stamps both from one `now`); a draft coming back as
//     a draft is not.
//   • Every refusal is a 409 with its reason and changes nothing; GET /passes answers the same
//     verdict for every archived pass, with the sentence.
//   • What comes back is what left: the same books, the same assignments, activatedAt kept.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pass-bring-back';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { acquireRecutLock, releaseRecutLock } = await import('../src/services/turf/recutLock.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const LOC = { lat: 30.26, lng: -97.74, accuracy: 5 };
let doorSeq = 0;
const makeHousehold = (campaign, effortId) => {
  doorSeq += 1;
  return {
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    effortId,
    addressLine1: `${doorSeq} Return Rd`,
    city: 'Austin',
    state: 'TX',
    zipCode: '78702',
    normalizedAddress: `${doorSeq} return rd austin tx 78702`,
    location: { type: 'Point', coordinates: [-97.73 + (doorSeq % 7) * 0.0003, 30.27 + Math.floor(doorSeq / 7) * 0.0003] },
    status: 'unknocked',
    isActive: true,
  };
};

const call = async (method, path, { token, orgId, body } = {}) => {
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
};

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const passes = (c, rest = '') => `/admin/campaigns/${c._id}/passes${rest}`;
const show = (r) => JSON.stringify(r.json);
const fresh = (M, doc) => M.findById(doc._id).lean();
const ms = (d) => (d ? new Date(d).getTime() : null);

const activate = (c, p) => call('POST', passes(c, `/${p._id}/activate`), asAdmin());
const archivePass = (c, p, confirm = true) => call('POST', passes(c, `/${p._id}/archive`), { ...asAdmin(), body: confirm ? { confirmArchive: true } : {} });
const bringBack = (c, p) => call('POST', passes(c, `/${p._id}/bring-back`), asAdmin());
const passRow = async (c, p) => {
  const r = await call('GET', passes(c, `?effortId=${p.effortId}`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  return r.json.passes.find((x) => String(x._id) === String(p._id));
};
const historyRows = (c, field, pass) =>
  CampaignChange.find({ campaignId: c._id, source: 'walk_list_lifecycle', field, 'details.pass': pass }).sort({ createdAt: 1 }).lean();
const ok = (r, what) => assert.strictEqual(r.status, 200, `${what}: ${show(r)}`);
const refused = (r, code) => {
  assert.strictEqual(r.status, 409, `expected 409 ${code}: ${show(r)}`);
  assert.strictEqual(r.json.code, code, show(r));
  assert.ok(typeof r.json.error === 'string' && r.json.error.length, 'a sentence for the UI');
};

// A walk list with `passCount` draft passes (named `names[i]` or "Pass N"), each with its own
// published book over the walk list's doors, assigned to the canvasser.
const seedWalkList = async ({ campaign, name, passCount = 2, doors = 3, names = [] }) => {
  const effort = await Effort.create({ organizationId: campaign.organizationId, campaignId: campaign._id, name, status: 'active' });
  const hh = await Household.insertMany(Array.from({ length: doors }, () => makeHousehold(campaign, effort._id)));
  const ps = [];
  const books = [];
  for (let i = 0; i < passCount; i += 1) {
    const pass = await Pass.create({
      organizationId: campaign.organizationId, campaignId: campaign._id, effortId: effort._id, roundNumber: i + 1, name: names[i] || `Pass ${i + 1}`, status: 'draft',
    });
    const book = await Turf.create({
      organizationId: campaign.organizationId, campaignId: campaign._id, passId: pass._id, name: `${name} P${i + 1} Book`, mode: 'manual',
      status: 'published', householdIds: hh.map((h) => h._id), doorCount: hh.length,
    });
    await TurfAssignment.create({
      turfId: book._id, userId: ctx.canv._id, organizationId: campaign.organizationId, campaignId: campaign._id, passId: pass._id, assignedBy: ctx.admin._id,
    });
    ps.push(pass);
    books.push(book);
  }
  return { effort, doors: hh, passes: ps, books };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment, CampaignChange, SurveyTemplate,
    Effort, Pass, Turf, TurfAssignment, Household, CanvassActivity]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Return Org', slug: 'return-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pbb-a@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'pbb-c@t.co', passwordHash: 'x', isActive: true });
  const ben = await User.create({ firstName: 'Ben', lastName: 'Canvasser', email: 'pbb-b@t.co', passwordHash: 'x', isActive: true });
  for (const [u, role] of [[admin, 'admin'], [canv, 'canvasser'], [ben, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Ask', version: 1,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes', order: 0 }, { id: 'n', text: 'No', order: 1 }] }],
  });
  const mkCampaign = async (name, extra = {}) => {
    const c = await Campaign.create({ organizationId: org._id, name, type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true, ...extra });
    for (const u of [canv, ben]) await CampaignAssignment.create({ organizationId: org._id, campaignId: c._id, userId: u._id });
    return c;
  };
  const campaign = await mkCampaign('Return C');
  const surveyCampaign = await mkCampaign('Return S', { type: 'survey', surveyTemplateId: template._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, canv, ben, template, campaign, surveyCampaign, mkCampaign,
    adminTok: signUserToken(admin), canvTok: signUserToken(canv),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('activation stamps how the pass it ends ended, and a pass ended by the next one never comes back', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Chain' });
  const [p1, p2] = w.passes;
  ok(await activate(c, p1), 'activate Pass 1');
  const live1 = await fresh(Pass, p1);
  assert.strictEqual(live1.status, 'active');
  assert.ok(live1.activatedAt && ms(live1.activatedAt) === ms(live1.lastActivatedAt), 'first activation stamps both');

  const r2 = await activate(c, p2);
  ok(r2, 'activate Pass 2');
  const one = await fresh(Pass, p1);
  const two = await fresh(Pass, p2);
  assert.strictEqual(one.status, 'archived');
  assert.strictEqual(one.archivedVia, 'next-pass');
  assert.strictEqual(one.archivedFrom, 'active');
  assert.strictEqual(String(one.archivedBy), String(ctx.admin._id));
  assert.strictEqual(String(one.endedByPassId), String(p2._id));
  assert.strictEqual(ms(one.archivedAt), ms(two.activatedAt), 'archivedAt === the next pass activatedAt, to the ms');
  assert.strictEqual(ms(two.lastActivatedAt), ms(two.activatedAt));
  assert.ok(ms(one.activatedAt) === ms(live1.activatedAt), "the ended pass's activatedAt is kept");
  assert.strictEqual(await CampaignChange.countDocuments({ campaignId: c._id, source: 'walk_list_lifecycle', 'details.walkList': 'Chain' }), 0, 'activation writes no History row (B.6)');

  // Pass 2 archived by hand.
  ok(await archivePass(c, p2), 'archive Pass 2');
  const two2 = await fresh(Pass, p2);
  assert.strictEqual(two2.archivedVia, 'pass');
  assert.strictEqual(two2.archivedFrom, 'active');
  assert.strictEqual(String(two2.archivedBy), String(ctx.admin._id));
  assert.strictEqual(two2.endedByPassId, null);

  // Pass 1: never.
  const no = await bringBack(c, p1);
  refused(no, 'ended-by-next-pass');
  assert.match(no.json.error, /ended when Pass 2 went live/);
  assert.strictEqual(no.json.laterPass?._id, String(p2._id));
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
  const row1 = await passRow(c, p1);
  assert.strictEqual(row1.bringBack.ok, false);
  assert.strictEqual(row1.bringBack.reason, 'ended-by-next-pass');
  assert.strictEqual(row1.bringBackMessage, no.json.error, 'the panel says the same sentence the refusal does');
  assert.strictEqual(row1.endedByPassName, 'Pass 2');
  assert.strictEqual(row1.archivedVia, 'next-pass');
  assert.strictEqual(row1.archivedByName, 'Ada Admin');
  const row2 = await passRow(c, p2);
  assert.strictEqual(row2.bringBack.ok, true, JSON.stringify(row2.bringBack));
  assert.strictEqual(row2.bringBack.to, 'active');
  assert.strictEqual(row2.endedByPassName, null);
  assert.ok(!('bringBackMessage' in row2));

  // Pass 2: yes, live, re-stamped, cleared, activatedAt kept.
  await new Promise((r) => setTimeout(r, 5));
  const back = await bringBack(c, p2);
  ok(back, 'bring back Pass 2');
  assert.strictEqual(back.json.to, 'active');
  assert.strictEqual(back.json.downgraded, null);
  assert.strictEqual(back.json.pass.status, 'active');
  const two3 = await fresh(Pass, p2);
  assert.strictEqual(two3.status, 'active');
  assert.ok(ms(two3.lastActivatedAt) > ms(two.lastActivatedAt), 'lastActivatedAt re-stamped');
  assert.strictEqual(ms(two3.activatedAt), ms(two.activatedAt), 'activatedAt never touched');
  for (const f of ['archivedAt', 'archivedFrom', 'archivedVia', 'archivedBy', 'endedByPassId']) assert.strictEqual(two3[f], null, `${f} cleared`);
  assert.strictEqual(two3.recutLock?.lockedAt ?? null, null);

  // History: the hand archive and the bring-back, one row each.
  const arch = await historyRows(c, 'passArchived', 'Pass 2');
  const bb = await historyRows(c, 'passBroughtBack', 'Pass 2');
  assert.strictEqual(arch.length, 1);
  assert.deepStrictEqual(arch[0].details, { walkList: 'Chain', pass: 'Pass 2', outcome: 'by-hand' });
  assert.strictEqual(arch[0].fromValue, 'Chain · Pass 2 · live');
  assert.strictEqual(arch[0].toValue, 'Chain · Pass 2 · archived');
  assert.strictEqual(bb.length, 1);
  assert.deepStrictEqual(bb[0].details, { walkList: 'Chain', pass: 'Pass 2', outcome: 'live' });
  assert.strictEqual(bb[0].fromValue, 'Chain · Pass 2 · archived');
  assert.strictEqual(bb[0].toValue, 'Chain · Pass 2 · live again');
  assert.strictEqual(String(bb[0].byUserId), String(ctx.admin._id));
  const feed = await call('GET', `/admin/campaigns/${c._id}/history`, asAdmin());
  const item = feed.json.items.find((i) => i.id === String(bb[0]._id));
  assert.deepStrictEqual(item?.details, { walkList: 'Chain', pass: 'Pass 2', outcome: 'live' });
  assert.strictEqual(item?.by?.name, 'Ada Admin');
});

test('the next pass deleted after it ended this one: still refused (4a), labeled "the next pass"', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Gone Next' });
  const [p1, p2] = w.passes;
  ok(await activate(c, p1), 'activate 1');
  ok(await activate(c, p2), 'activate 2');
  // Discarded back to draft and deleted (a direct write: both routes' own rules are not under test here).
  await Pass.deleteOne({ _id: p2._id });
  const row = await passRow(c, p1);
  assert.strictEqual(row.endedByPassName, null);
  assert.strictEqual(row.bringBack.reason, 'ended-by-next-pass');
  assert.strictEqual(row.bringBack.laterPass ?? null, null);
  assert.strictEqual(row.bringBackMessage, "This pass ended when the next pass went live, so it can't come back.");
  const no = await bringBack(c, p1);
  refused(no, 'ended-by-next-pass');
  assert.match(no.json.error, /the next pass went live/);
});

test('a pass from before this change: archivedFrom and the pass that ended it are inferred, and it stays refused', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Old Chain', names: ['Pass 1', 'Sweep'] });
  const [p1, p2] = w.passes;
  const t0 = new Date(Date.now() - 2 * 86400_000);
  const t1 = new Date(Date.now() - 86400_000);
  // Old activation: one `now` for both stamps, and none of the new fields.
  await Pass.collection.updateOne({ _id: p1._id }, {
    $set: { status: 'archived', activatedAt: t0, archivedAt: t1 },
    $unset: { lastActivatedAt: '', archivedFrom: '', archivedVia: '', archivedBy: '', endedByPassId: '' },
  });
  await Pass.collection.updateOne({ _id: p2._id }, {
    $set: { status: 'active', activatedAt: t1 },
    $unset: { lastActivatedAt: '', archivedFrom: '', archivedVia: '', archivedBy: '', endedByPassId: '' },
  });
  const row = await passRow(c, p1);
  assert.strictEqual(row.endedByPassName, 'Pass 2 · Sweep', 'inferred from activatedAt === archivedAt');
  assert.strictEqual(row.bringBack.ok, false);
  assert.strictEqual(row.bringBack.reason, 'later-pass-went-live');
  assert.strictEqual(row.bringBack.laterPass?._id, String(p2._id));
  assert.match(row.bringBackMessage, /Pass 2 · Sweep went live after this one ended/);
  const no = await bringBack(c, p1);
  refused(no, 'later-pass-went-live');
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');

  // The same once the successor itself has ended (pre-change): last live until its archivedAt.
  await Pass.collection.updateOne({ _id: p2._id }, { $set: { status: 'archived', archivedAt: new Date(Date.now() - 3600_000) } });
  const no2 = await bringBack(c, p1);
  refused(no2, 'later-pass-went-live');
  assert.strictEqual((await passRow(c, p1)).endedByPassName, 'Pass 2 · Sweep');
});

test('the pre-change re-activation case: a sibling first live BEFORE this pass ended, last live after it, still refuses it', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Reactivated' });
  const [p1, p2] = w.passes;
  const ended = new Date(Date.now() - 86400_000);
  await Pass.collection.updateOne({ _id: p1._id }, {
    $set: { status: 'archived', activatedAt: new Date(ended.getTime() - 3600_000), archivedAt: ended },
    $unset: { lastActivatedAt: '', archivedFrom: '', archivedVia: '', archivedBy: '', endedByPassId: '' },
  });
  // Pass 2 first went live before Pass 1 ended (activatedAt is first-activation only and survives a
  // discard), was re-activated later with no lastActivatedAt to show for it, and ended after Pass 1.
  await Pass.collection.updateOne({ _id: p2._id }, {
    $set: { status: 'archived', activatedAt: new Date(ended.getTime() - 7200_000), archivedAt: new Date(ended.getTime() + 3600_000) },
    $unset: { lastActivatedAt: '', archivedFrom: '', archivedVia: '', archivedBy: '', endedByPassId: '' },
  });
  const row = await passRow(c, p1);
  assert.strictEqual(row.endedByPassName, null, 'no equal timestamp, nothing inferred');
  assert.strictEqual(row.bringBack.reason, 'later-pass-went-live');
  const no = await bringBack(c, p1);
  refused(no, 'later-pass-went-live');
  assert.strictEqual(no.json.laterPass?._id, String(p2._id));
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
});

test('a draft archived by hand comes back as a draft even after a later pass went live (rule 4b skipped)', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Draft Back' });
  const [p1, p2] = w.passes;
  // A draft with no knocks archives without the confirm.
  ok(await archivePass(c, p1, false), 'archive the draft');
  const a = await fresh(Pass, p1);
  assert.strictEqual(a.archivedFrom, 'draft');
  assert.strictEqual(a.archivedVia, 'pass');
  ok(await activate(c, p2), 'activate Pass 2 afterwards');

  const row = await passRow(c, p1);
  assert.strictEqual(row.bringBack.ok, true, JSON.stringify(row.bringBack));
  assert.strictEqual(row.bringBack.to, 'draft');
  const back = await bringBack(c, p1);
  ok(back, 'bring back the draft');
  assert.strictEqual(back.json.to, 'draft');
  assert.strictEqual(back.json.downgraded, null);
  const one = await fresh(Pass, p1);
  assert.strictEqual(one.status, 'draft');
  assert.strictEqual(one.lastActivatedAt, null, 'coming back as a draft stamps no activation');
  assert.strictEqual(one.archivedAt, null);
  assert.strictEqual((await fresh(Pass, p2)).status, 'active', 'the live pass is untouched');
  const bb = await historyRows(c, 'passBroughtBack', 'Pass 1');
  const mine = bb.filter((r) => r.details.walkList === 'Draft Back');
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].details.outcome, 'draft');
  assert.strictEqual(mine[0].toValue, 'Draft Back · Pass 1 · back as a draft');
  assert.strictEqual(mine[0].fromValue, 'Draft Back · Pass 1 · archived');
});

test('another-pass-live: a pass that was live before this one ended, and still is, blocks it', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Two Live' });
  const [p1, p2] = w.passes;
  ok(await activate(c, p2), 'Pass 2 live');
  await new Promise((r) => setTimeout(r, 5));
  // Only reachable on data from before the one-live-pass index: Pass 1 was live beside Pass 2 and was
  // archived by hand after Pass 2 went live.
  await Pass.updateOne({ _id: p1._id }, {
    $set: {
      status: 'archived', activatedAt: new Date(Date.now() - 86400_000), lastActivatedAt: new Date(Date.now() - 86400_000),
      archivedAt: new Date(), archivedFrom: 'active', archivedVia: 'pass', archivedBy: ctx.admin._id,
    },
  });
  const no = await bringBack(c, p1);
  refused(no, 'another-pass-live');
  assert.strictEqual(no.json.laterPass?._id, String(p2._id));
  assert.strictEqual(no.json.error, 'Pass 2 is live on this walk list. Archive it first.');
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
  assert.strictEqual((await fresh(Pass, p2)).status, 'active');
  assert.strictEqual((await passRow(c, p1)).bringBack.reason, 'another-pass-live');
});

test('survey-required: a survey campaign with no survey cannot take a pass live again', { skip }, async () => {
  const c = ctx.surveyCampaign;
  const w = await seedWalkList({ campaign: c, name: 'Survey Gone', passCount: 1 });
  const [p1] = w.passes;
  ok(await activate(c, p1), 'activate');
  ok(await archivePass(c, p1), 'archive');
  await Campaign.updateOne({ _id: c._id }, { $set: { surveyTemplateId: null } });
  try {
    const no = await bringBack(c, p1);
    refused(no, 'survey-required');
    assert.match(no.json.error, /Add a survey/);
    assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
    assert.strictEqual((await passRow(c, p1)).bringBack.reason, 'survey-required');
  } finally {
    await Campaign.updateOne({ _id: c._id }, { $set: { surveyTemplateId: ctx.template._id } });
  }
  ok(await bringBack(c, p1), 'with the survey back');
  assert.strictEqual((await fresh(Pass, p1)).status, 'active');
});

test('no doors left in its books: it comes back as a draft (downgraded no-doors), said before and after', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Emptied', passCount: 1 });
  const [p1] = w.passes;
  ok(await activate(c, p1), 'activate');
  ok(await archivePass(c, p1), 'archive');
  const was = await fresh(Pass, p1);
  // Every door re-carved into another walk list: the book is empty now.
  await Turf.updateOne({ _id: w.books[0]._id }, { $set: { householdIds: [], doorCount: 0 } });

  const row = await passRow(c, p1);
  assert.deepStrictEqual(
    { ok: row.bringBack.ok, to: row.bringBack.to, downgraded: row.bringBack.downgraded, books: row.bringBack.books },
    { ok: true, to: 'draft', downgraded: 'no-doors', books: 0 }
  );
  const back = await bringBack(c, p1);
  ok(back, 'bring back');
  assert.strictEqual(back.json.to, 'draft');
  assert.strictEqual(back.json.downgraded, 'no-doors');
  const p = await fresh(Pass, p1);
  assert.strictEqual(p.status, 'draft');
  assert.strictEqual(ms(p.lastActivatedAt), ms(was.lastActivatedAt), 'not re-stamped: it did not go live');
  assert.strictEqual(ms(p.activatedAt), ms(was.activatedAt));
  const bb = (await historyRows(c, 'passBroughtBack', 'Pass 1')).filter((r) => r.details.walkList === 'Emptied');
  assert.strictEqual(bb[0]?.details.outcome, 'draft');
});

test('walk-list-archived: a pass of an archived walk list comes back only through Unarchive', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Shut', passCount: 1 });
  const [p1] = w.passes;
  ok(await activate(c, p1), 'activate');
  ok(await call('POST', `/admin/campaigns/${c._id}/efforts/${w.effort._id}/archive`, { ...asAdmin(), body: { confirmArchive: true } }), 'archive walk list');
  const no = await bringBack(c, p1);
  refused(no, 'walk-list-archived');
  assert.match(no.json.error, /unarchive the walk list/);
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
  const row = await passRow(c, p1);
  assert.strictEqual(row.bringBack.reason, 'walk-list-archived');
  assert.strictEqual(row.archivedVia, 'walk-list');
});

test('an archived campaign: bring-back answers 409 campaign-archived (router guard) and GET /passes says why', { skip }, async () => {
  const c = await ctx.mkCampaign('Return Done');
  const w = await seedWalkList({ campaign: c, name: 'Done', passCount: 1 });
  const [p1] = w.passes;
  ok(await activate(c, p1), 'activate');
  ok(await archivePass(c, p1), 'archive');
  await Campaign.updateOne({ _id: c._id }, { $set: { isActive: false } });
  const no = await bringBack(c, p1);
  refused(no, 'campaign-archived');
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
  const row = await passRow(c, p1);
  assert.strictEqual(row.bringBack.reason, 'campaign-archived');

  // Being deleted: the campaign reads as gone, as every route answers today.
  await Campaign.updateOne({ _id: c._id }, { $set: { isActive: true, 'deletion.requestedAt': new Date() } });
  const gone = await bringBack(c, p1);
  assert.strictEqual(gone.status, 404, show(gone));
  assert.strictEqual((await fresh(Pass, p1)).status, 'archived');
});

test('what comes back is what left: the same books and assignments, and the outlines are redrawn', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Same Crew', passCount: 2, doors: 4 });
  const [p1, p2] = w.passes;
  await TurfAssignment.create({
    turfId: w.books[0]._id, userId: ctx.ben._id, organizationId: c.organizationId, campaignId: c._id, passId: p1._id, assignedBy: ctx.admin._id,
  });
  const shape = async (p) =>
    (await TurfAssignment.find({ passId: p._id }).lean()).map((a) => `${a._id}|${a.turfId}|${a.userId}|${ms(a.assignedAt)}`).sort();
  const books = async (p) => (await Turf.find({ passId: p._id }).lean()).map((t) => `${t._id}|${t.status}|${t.householdIds.join(',')}`).sort();
  ok(await activate(c, p1), 'activate');
  const before0 = { a: await shape(p1), b: await books(p1) };
  assert.strictEqual(before0.a.length, 2);
  ok(await archivePass(c, p1), 'archive');
  assert.deepStrictEqual(await shape(p1), before0.a, 'archiving keeps the assignments');
  assert.strictEqual((await fresh(Turf, w.books[0])).centroid, null, 'no outline before the bring-back');
  assert.strictEqual((await passRow(c, p1)).bringBack.canvassers, 2);

  ok(await bringBack(c, p1), 'bring back');
  assert.deepStrictEqual(await shape(p1), before0.a, 'the same assignment rows come back');
  assert.deepStrictEqual(await books(p1), before0.b, 'the same books');
  const book = await fresh(Turf, w.books[0]);
  assert.strictEqual(book.centroid?.type, 'Point', 'Bring back redraws the outlines (B.5 step 3)');

  // Above the cap the redraw is skipped (logged) and the bring-back still succeeds.
  const prev = process.env.TURF_BRING_BACK_REHULL_MAX_DOORS;
  process.env.TURF_BRING_BACK_REHULL_MAX_DOORS = '1';
  try {
    ok(await archivePass(c, p1), 'archive again');
    ok(await archivePass(c, p2, false), 'archive the draft Pass 2');
    ok(await bringBack(c, p2), 'bring back Pass 2 as a draft');
    assert.strictEqual((await fresh(Turf, w.books[1])).centroid, null, 'skipped above TURF_BRING_BACK_REHULL_MAX_DOORS');
    assert.strictEqual((await fresh(Pass, p2)).status, 'draft');
  } finally {
    if (prev === undefined) delete process.env.TURF_BRING_BACK_REHULL_MAX_DOORS;
    else process.env.TURF_BRING_BACK_REHULL_MAX_DOORS = prev;
  }
});

test('archiving a pass: the confirm gate is unchanged; an archived pass and an archived walk list refuse', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Gatekeep', passCount: 3 });
  const [p1, p2, p3] = w.passes;
  ok(await activate(c, p1), 'activate');
  for (const d of w.doors.slice(0, 2)) {
    const r = await call('POST', `/mobile/households/${d._id}/lit-drop`, { token: ctx.canvTok, orgId: ctx.org._id, body: { location: LOC } });
    assert.strictEqual(r.status, 201, show(r));
  }
  // A draft holding knocks (a discard that kept them).
  await CanvassActivity.create({
    organizationId: c.organizationId, campaignId: c._id, effortId: w.effort._id, passId: p2._id, householdId: w.doors[2]._id,
    userId: ctx.canv._id, actionType: 'lit_dropped', timestamp: new Date(), location: { lat: LOC.lat, lng: LOC.lng },
  });

  const live = await archivePass(c, p1, false);
  refused(live, 'archive-confirm-required');
  assert.strictEqual(live.json.isActive, true);
  assert.strictEqual(live.json.knockCount, 2);
  assert.doesNotMatch(live.json.error, /one-way/i);
  assert.strictEqual((await fresh(Pass, p1)).status, 'active');

  const knocked = await archivePass(c, p2, false);
  refused(knocked, 'archive-confirm-required');
  assert.strictEqual(knocked.json.isActive, false);
  assert.strictEqual(knocked.json.knockCount, 1);
  assert.strictEqual((await fresh(Pass, p2)).status, 'draft');

  ok(await archivePass(c, p3, false), 'a draft with no knocks needs no confirm');
  const at = (await fresh(Pass, p3)).archivedAt;
  const again = await archivePass(c, p3);
  refused(again, 'already-archived');
  assert.strictEqual(ms((await fresh(Pass, p3)).archivedAt), ms(at), 'archivedAt is no longer overwritten');

  ok(await archivePass(c, p1), 'with the confirm');
  const one = await fresh(Pass, p1);
  assert.strictEqual(one.archivedVia, 'pass');
  assert.strictEqual(one.archivedFrom, 'active');

  ok(await call('POST', `/admin/campaigns/${c._id}/efforts/${w.effort._id}/archive`, asAdmin()), 'archive the walk list (nothing live)');
  const frozen = await archivePass(c, p2);
  refused(frozen, 'walk-list-archived');
  assert.strictEqual((await fresh(Pass, p2)).status, 'draft', 'its draft stays a draft');

  // A book operation holding the pass: recut-locked, nothing changes.
  const v = await seedWalkList({ campaign: c, name: 'Gate Held', passCount: 1 });
  ok(await activate(c, v.passes[0]), 'activate');
  assert.ok(await acquireRecutLock(v.passes[0]._id, ctx.admin._id));
  try {
    const held = await archivePass(c, v.passes[0]);
    refused(held, 'recut-locked');
    assert.strictEqual(held.json.temporary, true);
    assert.strictEqual((await fresh(Pass, v.passes[0])).status, 'active');
  } finally {
    await releaseRecutLock(v.passes[0]._id);
  }
});

test('the other refusals: not-archived, unknown-end, recut-locked — each a 409 that changes nothing', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Refusals', passCount: 2 });
  const [p1, p2] = w.passes;
  ok(await activate(c, p1), 'activate');
  refused(await bringBack(c, p1), 'not-archived');
  refused(await bringBack(c, p2), 'not-archived');
  assert.strictEqual((await fresh(Pass, p1)).status, 'active');

  // No record of when it ended.
  await Pass.updateOne({ _id: p2._id }, { $set: { status: 'archived', archivedAt: null } });
  refused(await bringBack(c, p2), 'unknown-end');
  assert.strictEqual((await passRow(c, p2)).bringBack.reason, 'unknown-end');
  assert.strictEqual((await fresh(Pass, p2)).status, 'archived');

  // A book operation holding it.
  ok(await archivePass(c, p1), 'archive Pass 1');
  assert.ok(await acquireRecutLock(p1._id, ctx.admin._id));
  try {
    const row = await passRow(c, p1);
    assert.strictEqual(row.bringBack.ok, false);
    assert.strictEqual(row.bringBack.reason, 'recut-locked');
    assert.strictEqual(row.bringBack.temporary, true);
    const held = await bringBack(c, p1);
    refused(held, 'recut-locked');
    assert.strictEqual(held.json.temporary, true);
    const p = await fresh(Pass, p1);
    assert.strictEqual(p.status, 'archived');
    assert.ok(p.recutLock.lockedAt, "the holder's lock is untouched");
  } finally {
    await releaseRecutLock(p1._id);
  }
  ok(await bringBack(c, p1), 'once the lock is free');
});

// B.5 rule 3 names `walk-list-missing` for a pass whose walk list is gone (the contract lists it among
// POST /passes/:id/bring-back's 409 reasons). Kept on its own: the walk list is removed by a direct
// write, since the delete route refuses a walk list holding an archived pass.
test('walk-list-missing: a pass whose walk list no longer exists is refused with that reason, not as busy', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Orphaned', passCount: 1 });
  const [p1] = w.passes;
  ok(await activate(c, p1), 'activate');
  ok(await archivePass(c, p1), 'archive');
  await Effort.deleteOne({ _id: w.effort._id });
  const row = await passRow(c, p1);
  assert.strictEqual(row.bringBack.reason, 'walk-list-missing', 'GET /passes says why');
  const no = await bringBack(c, p1);
  assert.strictEqual(no.status, 409, show(no));
  assert.strictEqual(no.json.code, 'walk-list-missing', `POST answers ${show(no)}`);
  assert.notStrictEqual(no.json.temporary, true, 'not a "try again in a minute"');
});

// C.11/C.12: live passes with NO walk list exist in pre-Effort data (the index's $type filter and the
// repair's dry-run count are there for them). Before this change archiving one failed outright (the
// route's save() trips Pass.effortId's `required`, a 500 — probed on a scratch mongod); what must not
// happen now is a TEMPORARY "someone else is changing this walk list, try again in a minute" for a
// condition that can never clear. Any definite answer passes this test.
test('a pass from before walk lists existed (no effortId) never gets a "try again in a minute" that cannot clear', { skip }, async () => {
  const c = ctx.campaign;
  const { insertedId } = await Pass.collection.insertOne({
    organizationId: c.organizationId, campaignId: c._id, roundNumber: 1, name: 'Old round', status: 'active',
    activatedAt: new Date(Date.now() - 86400_000), archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  const r = await call('POST', passes(c, `/${insertedId}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
  assert.ok(r.status < 500, show(r));
  assert.notStrictEqual(r.json?.code, 'lifecycle-busy', `archiving it answers ${show(r)}`);
});
