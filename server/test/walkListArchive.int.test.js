import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Archiving a walk list ENDS its live pass, with Unarchive (and its Undo) bringing that pass back —
// docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.2-B.3, §B.8-B.9, §C.3, §C.9 — over the REAL Express app +
// a throwaway mongod:
//   npm run test:int -- test/walkListArchive.int.test.js
//
// The invariants this file exists to protect:
//   • A pass of an archived walk list is never live (B.1). Archive ends the live pass, leaves the
//     drafts as drafts, and the canvasser's next bootstrap no longer holds the book.
//   • A refused archive / unarchive changes NOTHING — the confirm gate, a busy walk list, a book
//     operation holding the pass, a pass that can't come back.
//   • Unarchive reopens the walk list FIRST: a bring-back failing after that leaves an open walk
//     list with an ended pass (and says so), never an archived walk list with a live pass.
//   • An archived walk list is read-only except its name; an archived CAMPAIGN refuses every
//     walk-list and pass write while reads keep working.
//   • History gets one row per archive / unarchive, with the structured `details`.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-walk-list-archive';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { acquireRecutLock, releaseRecutLock } = await import('../src/services/turf/recutLock.js');
const { repairWalkList } = await import('../src/services/passes/passLifecycle.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Effort } = await import('../src/models/Effort.js');
const { EffortMember } = await import('../src/models/EffortMember.js');
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

// Fault injection, restored after every test (the answerEditRound9 pattern).
const pending = [];
afterEach(() => {
  while (pending.length) pending.pop()();
});
const hookProto = (proto, method, around) => {
  const had = Object.prototype.hasOwnProperty.call(proto, method);
  const real = proto[method];
  proto[method] = function (...args) {
    return around.call(this, (...a) => real.apply(this, a), args);
  };
  const restore = () => {
    if (had) proto[method] = real;
    else delete proto[method];
  };
  pending.push(restore);
  return restore;
};

const LOC = { lat: 30.26, lng: -97.74, accuracy: 5 };
let doorSeq = 0;
const makeHousehold = (campaign, effortId) => {
  doorSeq += 1;
  return {
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    effortId,
    addressLine1: `${doorSeq} Archive Ave`,
    city: 'Austin',
    state: 'TX',
    zipCode: '78701',
    normalizedAddress: `${doorSeq} archive ave austin tx 78701`,
    location: { type: 'Point', coordinates: [-97.74 + doorSeq * 0.0001, 30.26] },
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
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const asCanv = () => ({ token: ctx.canvTok, orgId: ctx.org._id });
const efforts = (c, rest = '') => `/admin/campaigns/${c._id}/efforts${rest}`;
const passes = (c, rest = '') => `/admin/campaigns/${c._id}/passes${rest}`;
const show = (r) => JSON.stringify(r.json);

// A walk list with doors, Pass 1 (a published book assigned to the canvasser, activated through
// the REAL route when `live`) and `drafts` draft passes after it.
const seedWalkList = async ({ campaign, name, doors = 3, live = true, drafts = 1, assign = [ctx.canv] }) => {
  const effort = await Effort.create({
    organizationId: campaign.organizationId, campaignId: campaign._id, name, status: 'active', createdBy: ctx.admin._id,
  });
  const hh = await Household.insertMany(Array.from({ length: doors }, () => makeHousehold(campaign, effort._id)));
  const pass = await Pass.create({
    organizationId: campaign.organizationId, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'draft',
  });
  const book = await Turf.create({
    organizationId: campaign.organizationId, campaignId: campaign._id, passId: pass._id, name: `${name} Book 1`, mode: 'manual',
    status: 'published', householdIds: hh.map((h) => h._id), doorCount: hh.length,
  });
  for (const u of assign) {
    await TurfAssignment.create({
      turfId: book._id, userId: u._id, organizationId: campaign.organizationId, campaignId: campaign._id, passId: pass._id, assignedBy: ctx.admin._id,
    });
  }
  if (live) {
    const r = await call('POST', passes(campaign, `/${pass._id}/activate`), asAdmin());
    assert.strictEqual(r.status, 200, `seed activation: ${show(r)}`);
  }
  const draftPasses = [];
  for (let i = 0; i < drafts; i += 1) {
    draftPasses.push(
      await Pass.create({
        organizationId: campaign.organizationId, campaignId: campaign._id, effortId: effort._id, roundNumber: 2 + i, name: `Pass ${2 + i}`, status: 'draft',
      })
    );
  }
  return { effort, doors: hh, pass, book, drafts: draftPasses };
};

const litDrop = (door, token = ctx.canvTok) =>
  call('POST', `/mobile/households/${door._id}/lit-drop`, { token, orgId: ctx.org._id, body: { location: LOC } });

const bootstrap = (campaign) => call('GET', `/mobile/bootstrap?campaignId=${campaign._id}`, asCanv());
const bookIds = (boot) => (boot.json.books || []).map((b) => b.id);

const historyRows = async (campaign, walkList, field) => {
  const r = await call('GET', `/admin/campaigns/${campaign._id}/history`, asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  return r.json.items.filter((i) => i.field === field && i.details?.walkList === walkList);
};
const lifecycleRows = (campaign, walkList) =>
  CampaignChange.countDocuments({ campaignId: campaign._id, source: 'walk_list_lifecycle', 'details.walkList': walkList });

const effortRow = async (campaign, effort) => {
  const r = await call('GET', efforts(campaign), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  return r.json.efforts.find((e) => String(e._id) === String(effort._id));
};
const passRow = async (campaign, pass) => {
  const r = await call('GET', passes(campaign, `?effortId=${pass.effortId}`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  return r.json.passes.find((p) => String(p._id) === String(pass._id));
};
const fresh = (M, doc) => M.findById(doc._id).lean();
const sameMs = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment, CampaignManager, CampaignChange,
    SurveyTemplate, Effort, EffortMember, Pass, Turf, TurfAssignment, Household, CanvassActivity]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Archive Org', slug: 'archive-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'wla-a@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'wla-l@t.co', passwordHash: 'x', isActive: true });
  const outsider = await User.create({ firstName: 'Otto', lastName: 'Lead', email: 'wla-o@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'wla-c@t.co', passwordHash: 'x', isActive: true });
  for (const [u, role] of [[admin, 'admin'], [lead, 'lead'], [outsider, 'lead'], [canv, 'canvasser']]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  }
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Ask', version: 1,
    questions: [{ key: 'support', label: 'Support?', type: 'single_choice', order: 0, options: [{ id: 'y', text: 'Yes', order: 0 }, { id: 'n', text: 'No', order: 1 }] }],
  });
  const mkCampaign = async (name, extra = {}) => {
    const c = await Campaign.create({ organizationId: org._id, name, type: 'lit_drop', state: 'TX', timeZone: 'America/Chicago', isActive: true, ...extra });
    await CampaignAssignment.create({ organizationId: org._id, campaignId: c._id, userId: canv._id });
    await CampaignManager.create({ organizationId: org._id, campaignId: c._id, userId: lead._id, grantedBy: admin._id, isActive: true });
    return c;
  };
  const campaign = await mkCampaign('Archive C');
  const surveyCampaign = await mkCampaign('Archive S', { type: 'survey', surveyTemplateId: template._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, outsider, canv, template, campaign, surveyCampaign, mkCampaign,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead), outsiderTok: signUserToken(outsider), canvTok: signUserToken(canv),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('GET /efforts ships the archive facts for each walk list, and never the lifecycle lock', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Facts Live' });
  const never = await seedWalkList({ campaign: c, name: 'Facts Draft', live: false, drafts: 0 });

  const row = await effortRow(c, w.effort);
  assert.strictEqual(row.status, 'active');
  assert.strictEqual(row.archivedAt, null);
  assert.strictEqual(row.archivedByName, null);
  assert.strictEqual(row.endedPassId, null);
  assert.strictEqual(row.canDelete, false, 'a pass went live, so Delete cannot work');
  assert.strictEqual(row.everLive, true);
  assert.strictEqual(row.lastEndedPass, null);
  assert.strictEqual(String(row.activeRound?._id), String(w.pass._id));
  assert.ok(!('lifecycleLock' in row), `lifecycleLock must not be on the wire: ${JSON.stringify(row)}`);

  const draftRow = await effortRow(c, never.effort);
  assert.strictEqual(draftRow.canDelete, true, 'every pass still a draft');
  assert.strictEqual(draftRow.everLive, false);
  assert.strictEqual(draftRow.activeRound, null);
  assert.ok(!('lifecycleLock' in draftRow));

  // Nor on a create's answer.
  const created = await call('POST', efforts(c), { ...asAdmin(), body: { name: 'Facts Created' } });
  assert.strictEqual(created.status, 201, show(created));
  assert.ok(!('lifecycleLock' in created.json.effort), `lifecycleLock must not be on the wire: ${show(created)}`);
});

test('archive-preview names what archiving ends, and its knocks match the Passes panel', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Preview' });
  for (const d of w.doors.slice(0, 2)) assert.strictEqual((await litDrop(d)).status, 201);

  const r = await call('GET', efforts(c, `/${w.effort._id}/archive-preview`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  assert.deepStrictEqual(r.json, {
    livePass: { _id: String(w.pass._id), roundNumber: 1, name: 'Pass 1', books: 1, canvassers: 1, knocks: 2 },
    drafts: 1,
    doors: 3,
  });
  const panel = await passRow(c, w.pass);
  assert.strictEqual(panel.knockCount, r.json.livePass.knocks, 'the box and the Passes panel count knocks the same way');

  // Nothing live: no live pass in the box.
  const idle = await seedWalkList({ campaign: c, name: 'Preview Idle', live: false, drafts: 2 });
  const r2 = await call('GET', efforts(c, `/${idle.effort._id}/archive-preview`), asAdmin());
  assert.strictEqual(r2.status, 200, show(r2));
  assert.deepStrictEqual(r2.json, { livePass: null, drafts: 3, doors: 3 });
});

test('archive without confirmArchive on a live walk list is refused and changes nothing', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Gate' });
  for (const body of [undefined, {}, { confirmArchive: 'true' }, { confirmArchive: 1 }]) {
    const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body });
    assert.strictEqual(r.status, 409, `${JSON.stringify(body)}: ${show(r)}`);
    assert.strictEqual(r.json.code, 'archive-confirm-required');
    assert.match(r.json.error, /Pass 1/);
  }
  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'active');
  assert.strictEqual(effort.endedPassId, null);
  assert.strictEqual(effort.archivedAt, null);
  assert.strictEqual(effort.lifecycleLock?.lockedAt ?? null, null, 'the refused call released its lock');
  const pass = await fresh(Pass, w.pass);
  assert.strictEqual(pass.status, 'active');
  assert.strictEqual(pass.archivedAt, null);
  assert.strictEqual(await lifecycleRows(c, 'Gate'), 0, 'no History row for a refused archive');
});

test('archive ends the live pass, leaves the drafts, freezes the walk list — and the phone loses the book', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'North' });
  const passBefore = await fresh(Pass, w.pass);
  const assignmentsBefore = await TurfAssignment.countDocuments({ passId: w.pass._id });

  const boot0 = await bootstrap(c);
  assert.strictEqual(boot0.status, 200, show(boot0));
  assert.ok(bookIds(boot0).includes(String(w.book._id)), 'the book is on the phone before the archive');
  assert.ok(boot0.json.activePassIds.includes(String(w.pass._id)));
  const since = new Date().toISOString();

  const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual(r.json.endedPassId, String(w.pass._id));
  assert.deepStrictEqual(r.json.endedPass, { _id: String(w.pass._id), roundNumber: 1, name: 'Pass 1' }, 'the pass it ended, named for the notice and its Undo');
  assert.strictEqual(r.json.effort.status, 'archived');

  const pass = await fresh(Pass, w.pass);
  assert.strictEqual(pass.status, 'archived');
  assert.strictEqual(pass.archivedVia, 'walk-list');
  assert.strictEqual(pass.archivedFrom, 'active');
  assert.strictEqual(String(pass.archivedBy), String(ctx.admin._id));
  assert.ok(pass.archivedAt instanceof Date);
  assert.strictEqual(pass.endedByPassId, null);
  assert.ok(sameMs(pass.activatedAt, passBefore.activatedAt), 'activatedAt untouched');
  assert.strictEqual(pass.recutLock?.lockedAt ?? null, null, 'the recut lock was released');

  const draft = await fresh(Pass, w.drafts[0]);
  assert.strictEqual(draft.status, 'draft', 'drafts stay drafts');
  assert.strictEqual(draft.archivedAt, null);

  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'archived');
  assert.ok(effort.archivedAt instanceof Date);
  assert.strictEqual(String(effort.archivedBy), String(ctx.admin._id));
  assert.strictEqual(String(effort.endedPassId), String(w.pass._id));
  assert.strictEqual(effort.lifecycleLock?.lockedAt ?? null, null, 'the lifecycle lock was released');

  // Archiving deletes nothing: books stay published, assignments and doors stay.
  assert.strictEqual((await fresh(Turf, w.book)).status, 'published');
  assert.strictEqual(await TurfAssignment.countDocuments({ passId: w.pass._id }), assignmentsBefore);
  assert.strictEqual(await Household.countDocuments({ effortId: w.effort._id }), 3);

  // The phone: the book is gone from the next bootstrap, and the 30 s poll sees the changed set.
  const boot1 = await bootstrap(c);
  assert.strictEqual(boot1.status, 200, show(boot1));
  assert.ok(!bookIds(boot1).includes(String(w.book._id)), `the book left the phone: ${JSON.stringify(boot1.json.books)}`);
  assert.ok(!boot1.json.activePassIds.includes(String(w.pass._id)));
  assert.ok(!boot1.json.households.some((h) => w.doors.some((d) => String(d._id) === String(h._id))), 'its doors left too');
  const changes = await call('GET', `/mobile/changes?campaignId=${c._id}&since=${encodeURIComponent(since)}`, asCanv());
  assert.strictEqual(changes.status, 200, show(changes));
  assert.ok(!changes.json.activePassIds.includes(String(w.pass._id)), 'the poll reports the new set of live passes');
  assert.notDeepStrictEqual([...changes.json.activePassIds].sort(), [...boot0.json.activePassIds].sort());

  // The Walk Lists page.
  const row = await effortRow(c, w.effort);
  assert.strictEqual(row.status, 'archived');
  assert.ok(sameMs(row.archivedAt, effort.archivedAt));
  assert.strictEqual(row.archivedByName, 'Ada Admin');
  assert.strictEqual(String(row.endedPassId), String(w.pass._id));
  assert.strictEqual(row.activeRound, null, 'one status per walk list: never archived AND live');
  assert.strictEqual(row.canDelete, false);
  assert.strictEqual(row.everLive, true);
  assert.deepStrictEqual(
    { ...row.lastEndedPass, archivedAt: new Date(row.lastEndedPass.archivedAt).getTime() },
    { _id: String(w.pass._id), roundNumber: 1, name: 'Pass 1', archivedAt: pass.archivedAt.getTime(), archivedVia: 'walk-list' }
  );

  // History: one row, with the structured facts.
  const rows = await historyRows(c, 'North', 'walkListArchived');
  assert.strictEqual(rows.length, 1, JSON.stringify(rows));
  assert.deepStrictEqual(rows[0].details, { walkList: 'North', pass: 'Pass 1', outcome: 'ended' });
  assert.strictEqual(rows[0].by?.name, 'Ada Admin');
  assert.strictEqual(rows[0].fromValue, 'North · live (Pass 1)');
  assert.strictEqual(rows[0].toValue, 'North · archived · Pass 1 ended');
  assert.strictEqual(rows[0].kind, 'config');

  // Archive again.
  const again = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
  assert.strictEqual(again.status, 409, show(again));
  assert.strictEqual(again.json.code, 'already-archived');
  assert.strictEqual(await lifecycleRows(c, 'North'), 1, 'the refused second archive wrote no row');
});

test('an archived walk list with nothing live archives without the typed confirm; History says nothing-live', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Quiet', live: false });
  const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual(r.json.endedPassId, null);
  assert.strictEqual(r.json.endedPass, null);
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'draft');
  assert.strictEqual((await fresh(Pass, w.drafts[0])).status, 'draft');
  const rows = await historyRows(c, 'Quiet', 'walkListArchived');
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].details, { walkList: 'Quiet', pass: null, outcome: 'nothing-live' });
  const preview = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
  assert.strictEqual(preview.status, 200, show(preview));
  assert.deepStrictEqual(preview.json, { endedPass: null });
  // bringBack:true with nothing to bring back.
  const nothing = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
  assert.strictEqual(nothing.status, 409, show(nothing));
  assert.strictEqual(nothing.json.code, 'nothing-to-bring-back');
  assert.strictEqual((await fresh(Effort, w.effort)).status, 'archived', 'refused: still archived');
});

test('an archived walk list is read-only — except renaming it', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Frozen' });
  const draft = w.drafts[0];
  // The draft has books of its own, so an activation refusal can only be the walk-list guard.
  await Turf.create({
    organizationId: c.organizationId, campaignId: c._id, passId: draft._id, name: 'Frozen Draft Book', mode: 'manual',
    status: 'published', householdIds: [w.doors[0]._id], doorCount: 1,
  });
  await EffortMember.create({ organizationId: c.organizationId, campaignId: c._id, effortId: w.effort._id, userId: ctx.canv._id, addedBy: ctx.admin._id });
  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  const passCount = await Pass.countDocuments({ effortId: w.effort._id });

  const refusals = [
    ['PATCH', efforts(c, `/${w.effort._id}`), { surveyTemplateId: null }],
    ['PATCH', efforts(c, `/${w.effort._id}`), { name: 'Frozen', surveyTemplateId: String(ctx.template._id) }],
    ['POST', efforts(c, `/${w.effort._id}/claim`), { all: true }],
    ['POST', efforts(c, `/${w.effort._id}/members`), { userId: String(ctx.lead._id) }],
    ['DELETE', efforts(c, `/${w.effort._id}/members/${ctx.canv._id}`)],
    ['POST', passes(c), { effortId: String(w.effort._id) }],
    ['PATCH', passes(c, `/${draft._id}`), { name: 'Renamed draft' }],
    ['DELETE', passes(c, `/${draft._id}`)],
    ['POST', passes(c, `/${draft._id}/activate`)],
    ['POST', passes(c, `/${draft._id}/archive`), { confirmArchive: true }],
    ['POST', passes(c, `/${w.pass._id}/archive`), { confirmArchive: true }],
    ['POST', passes(c, `/${w.pass._id}/bring-back`)],
  ];
  for (const [method, path, body] of refusals) {
    const r = await call(method, path, { ...asAdmin(), body });
    assert.strictEqual(r.status, 409, `${method} ${path} ${JSON.stringify(body)}: ${show(r)}`);
    assert.strictEqual(r.json.code, 'walk-list-archived', `${method} ${path}: ${show(r)}`);
    assert.match(r.json.error, /archived/);
  }
  // The ended pass itself says Bring back, not "create a new pass".
  const reactivate = await call('POST', passes(c, `/${w.pass._id}/activate`), asAdmin());
  assert.strictEqual(reactivate.status, 409, show(reactivate));
  assert.strictEqual(reactivate.json.code, 'pass-archived');
  assert.match(reactivate.json.error, /Bring back/);

  // Nothing moved.
  assert.strictEqual(await Pass.countDocuments({ effortId: w.effort._id }), passCount);
  const d = await fresh(Pass, draft);
  assert.strictEqual(d.status, 'draft');
  assert.strictEqual(d.name, 'Pass 2');
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'archived');
  assert.strictEqual(await EffortMember.countDocuments({ effortId: w.effort._id }), 1, 'the roster is untouched');
  assert.strictEqual((await fresh(Effort, w.effort)).surveyTemplateId, null);

  // Renaming stays allowed.
  const rename = await call('PATCH', efforts(c, `/${w.effort._id}`), { ...asAdmin(), body: { name: 'Frozen Renamed' } });
  assert.strictEqual(rename.status, 200, show(rename));
  const after = await fresh(Effort, w.effort);
  assert.strictEqual(after.name, 'Frozen Renamed');
  assert.strictEqual(after.status, 'archived', 'a rename leaves it archived');
});

test('unarchive-preview offers the ended pass back with its books and canvassers', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Preview Back' });
  const open = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
  assert.strictEqual(open.status, 200, show(open));
  assert.deepStrictEqual(open.json, { endedPass: null }, 'an open walk list ended nothing');

  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  const pass = await fresh(Pass, w.pass);
  const r = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  const ended = r.json.endedPass;
  assert.strictEqual(ended._id, String(w.pass._id));
  assert.strictEqual(ended.roundNumber, 1);
  assert.strictEqual(ended.name, 'Pass 1');
  assert.ok(sameMs(ended.archivedAt, pass.archivedAt));
  assert.strictEqual(ended.archivedVia, 'walk-list');
  assert.strictEqual(ended.archivedByName, 'Ada Admin');
  assert.deepStrictEqual(ended.bringBack, { ok: true, to: 'active', downgraded: null, books: 1, canvassers: 1 });
  assert.ok(!('bringBackMessage' in ended), 'no refusal sentence when it can come back');
});

test('Unarchive only reopens the walk list and leaves the pass ended — with its own Bring back — in one History row', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Only' });
  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  const rowsBefore = await lifecycleRows(c, 'Only');

  const r = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: false } });
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual(r.json.effort.status, 'active');
  assert.strictEqual(r.json.broughtBack, null);
  assert.strictEqual(r.json.to, null);
  assert.ok(!('bringBackError' in r.json));

  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'active');
  assert.strictEqual(effort.archivedAt, null);
  assert.strictEqual(effort.archivedBy, null);
  assert.strictEqual(effort.endedPassId, null);
  const pass = await fresh(Pass, w.pass);
  assert.strictEqual(pass.status, 'archived', 'the pass stayed ended');
  assert.strictEqual(pass.archivedVia, 'walk-list');

  const panel = await passRow(c, w.pass);
  assert.strictEqual(panel.bringBack.ok, true, `its own Bring back is offered: ${JSON.stringify(panel.bringBack)}`);
  assert.strictEqual(panel.bringBack.to, 'active');
  assert.ok(!('bringBackMessage' in panel));
  assert.strictEqual(panel.archivedVia, 'walk-list');
  assert.strictEqual(panel.archivedByName, 'Ada Admin');
  assert.strictEqual(panel.endedByPassName, null);
  const row = await effortRow(c, w.effort);
  assert.strictEqual(row.archivedAt, null);
  assert.strictEqual(row.archivedByName, null);
  assert.strictEqual(row.endedPassId, null);

  assert.strictEqual(await lifecycleRows(c, 'Only'), rowsBefore + 1, 'exactly one History row for the unarchive');
  const rows = await historyRows(c, 'Only', 'walkListUnarchived');
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].details, { walkList: 'Only', pass: 'Pass 1', outcome: 'stayed-ended' });
  assert.strictEqual(rows[0].fromValue, 'Only · archived');
  assert.strictEqual(rows[0].toValue, 'Only · open · Pass 1 stayed ended');

  const again = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: false } });
  assert.strictEqual(again.status, 409, show(again));
  assert.strictEqual(again.json.code, 'not-archived');

  // Later, the pass's own Bring back (G: "Unarchive only, then later Bring back — allowed").
  const back = await call('POST', passes(c, `/${w.pass._id}/bring-back`), asAdmin());
  assert.strictEqual(back.status, 200, show(back));
  assert.strictEqual(back.json.to, 'active');
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'active');
  const bb = await historyRows(c, 'Only', 'passBroughtBack');
  assert.strictEqual(bb.length, 1);
  assert.deepStrictEqual(bb[0].details, { walkList: 'Only', pass: 'Pass 1', outcome: 'live' });
});

test('Undo (archive, then unarchive with bringBack) puts the same pass back live on the same phones, in one History row', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Undo' });
  const before0 = await fresh(Pass, w.pass);
  const assignments0 = (await TurfAssignment.find({ passId: w.pass._id }).lean()).map((a) => `${a.turfId}|${a.userId}`).sort();
  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  assert.ok(!bookIds(await bootstrap(c)).includes(String(w.book._id)));
  await new Promise((r) => setTimeout(r, 5));

  const r = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual(r.json.broughtBack, String(w.pass._id));
  assert.strictEqual(r.json.to, 'active');
  assert.strictEqual(r.json.effort.status, 'active');
  assert.ok(!('bringBackError' in r.json));

  const pass = await fresh(Pass, w.pass);
  assert.strictEqual(pass.status, 'active');
  assert.ok(sameMs(pass.activatedAt, before0.activatedAt), 'activatedAt is first-activation only — never touched');
  assert.ok(pass.lastActivatedAt > before0.lastActivatedAt, 'lastActivatedAt re-stamped by the bring-back');
  for (const f of ['archivedAt', 'archivedFrom', 'archivedVia', 'archivedBy', 'endedByPassId']) {
    assert.strictEqual(pass[f], null, `${f} cleared`);
  }
  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'active');
  assert.strictEqual(effort.endedPassId, null);
  assert.strictEqual(effort.lifecycleLock?.lockedAt ?? null, null);
  assert.strictEqual(pass.recutLock?.lockedAt ?? null, null);

  // Same books, same canvassers, back on the phone.
  const assignments1 = (await TurfAssignment.find({ passId: w.pass._id }).lean()).map((a) => `${a.turfId}|${a.userId}`).sort();
  assert.deepStrictEqual(assignments1, assignments0);
  const boot = await bootstrap(c);
  assert.ok(bookIds(boot).includes(String(w.book._id)), 'the book is back in the canvasser bootstrap');
  assert.ok(boot.json.activePassIds.includes(String(w.pass._id)));

  // ONE History row for the unarchive (no separate passBroughtBack row), plus the archive's.
  const un = await historyRows(c, 'Undo', 'walkListUnarchived');
  assert.strictEqual(un.length, 1);
  assert.deepStrictEqual(un[0].details, { walkList: 'Undo', pass: 'Pass 1', outcome: 'brought-back' });
  assert.strictEqual(un[0].toValue, 'Undo · open · Pass 1 brought back');
  assert.strictEqual((await historyRows(c, 'Undo', 'passBroughtBack')).length, 0);
  assert.strictEqual(await lifecycleRows(c, 'Undo'), 2);
});

test('Unarchive with bringBack is refused — and changes nothing — when the pass cannot come back; Unarchive only still works', { skip }, async () => {
  const c = ctx.surveyCampaign;
  const w = await seedWalkList({ campaign: c, name: 'No Survey' });
  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  await Campaign.updateOne({ _id: c._id }, { $set: { surveyTemplateId: null } });
  try {
    const preview = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
    assert.strictEqual(preview.status, 200, show(preview));
    assert.strictEqual(preview.json.endedPass.bringBack.ok, false);
    assert.strictEqual(preview.json.endedPass.bringBack.reason, 'survey-required');
    assert.match(preview.json.endedPass.bringBackMessage, /Add a survey/, 'the dialog shows the server sentence');

    const r = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
    assert.strictEqual(r.json?.error, preview.json.endedPass.bringBackMessage, 'the preview and the refusal say the same thing');
    assert.strictEqual(r.status, 409, show(r));
    assert.strictEqual(r.json.code, 'survey-required');
    const effort = await fresh(Effort, w.effort);
    assert.strictEqual(effort.status, 'archived', 'a permanent refusal leaves the walk list archived');
    assert.strictEqual(String(effort.endedPassId), String(w.pass._id), 'and still remembering its pass');
    assert.strictEqual((await fresh(Pass, w.pass)).status, 'archived');
    assert.strictEqual((await historyRows(c, 'No Survey', 'walkListUnarchived')).length, 0);

    const only = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: false } });
    assert.strictEqual(only.status, 200, show(only));
    assert.strictEqual(only.json.broughtBack, null);
    assert.strictEqual((await fresh(Effort, w.effort)).status, 'active');
    assert.strictEqual((await fresh(Pass, w.pass)).status, 'archived');
  } finally {
    await Campaign.updateOne({ _id: c._id }, { $set: { surveyTemplateId: ctx.template._id } });
  }
});

test('Unarchive with bringBack while a book operation holds the pass is a temporary refusal that changes nothing', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Held' });
  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  assert.ok(await acquireRecutLock(w.pass._id, ctx.admin._id));
  try {
    const preview = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
    assert.strictEqual(preview.json.endedPass.bringBack.ok, false);
    assert.strictEqual(preview.json.endedPass.bringBack.reason, 'recut-locked');
    assert.strictEqual(preview.json.endedPass.bringBack.temporary, true);

    const r = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
    assert.strictEqual(r.status, 409, show(r));
    assert.strictEqual(r.json.code, 'recut-locked');
    assert.strictEqual(r.json.temporary, true);
    const effort = await fresh(Effort, w.effort);
    assert.strictEqual(effort.status, 'archived');
    assert.strictEqual(String(effort.endedPassId), String(w.pass._id));
    assert.strictEqual((await fresh(Pass, w.pass)).status, 'archived');
    assert.ok((await fresh(Pass, w.pass)).recutLock.lockedAt, "the other holder's lock is untouched");
  } finally {
    await releaseRecutLock(w.pass._id);
  }
  const ok = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
  assert.strictEqual(ok.status, 200, show(ok));
  assert.strictEqual(ok.json.to, 'active');
});

test('a bring-back that fails AFTER Unarchive reopened the walk list answers 200 with bringBackError — open walk list, ended pass', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Partial' });
  assert.strictEqual((await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);

  // A book operation grabs the pass's recut lock right after the reopen save (B.3 step 3 → step 4).
  let grabbed = false;
  hookProto(Effort.prototype, 'save', async function (real) {
    const out = await real();
    if (!grabbed && String(this._id) === String(w.effort._id) && this.status === 'active') {
      grabbed = await acquireRecutLock(w.pass._id, ctx.admin._id);
    }
    return out;
  });
  let r;
  try {
    r = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
  } finally {
    while (pending.length) pending.pop()();
  }
  try {
    assert.ok(grabbed, 'the fault was injected');
    assert.strictEqual(r.status, 200, show(r));
    assert.strictEqual(r.json.effort.status, 'active');
    assert.strictEqual(r.json.broughtBack, null);
    assert.strictEqual(r.json.to, null);
    assert.strictEqual(r.json.bringBackError?.code, 'recut-locked', show(r));
    assert.match(r.json.bringBackError.error, /"Partial" is unarchived, but Pass 1 couldn't come back/);

    const effort = await fresh(Effort, w.effort);
    assert.strictEqual(effort.status, 'active', 'reopened first');
    assert.strictEqual(effort.endedPassId, null);
    assert.strictEqual((await fresh(Pass, w.pass)).status, 'archived', 'never an archived walk list with a live pass');
    const rows = await historyRows(c, 'Partial', 'walkListUnarchived');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].details.outcome, 'stayed-ended');
  } finally {
    await releaseRecutLock(w.pass._id);
  }
  // Its own Bring back then fixes it (B.3 "Why this order").
  const back = await call('POST', passes(c, `/${w.pass._id}/bring-back`), asAdmin());
  assert.strictEqual(back.status, 200, show(back));
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'active');
});

test('a walk list busy with another lifecycle change refuses every lifecycle write with lifecycle-busy and changes nothing', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Busy' });
  const ended = await Pass.create({
    organizationId: c.organizationId, campaignId: c._id, effortId: w.effort._id, roundNumber: 9, name: 'Pass 9', status: 'archived',
    archivedAt: new Date(Date.now() - 60_000), archivedFrom: 'draft', archivedVia: 'pass',
  });
  const lockedAt = new Date();
  await Effort.updateOne({ _id: w.effort._id }, { $set: { lifecycleLock: { lockedAt, token: 'someone-else' } } });
  try {
    const writes = [
      ['POST', efforts(c, `/${w.effort._id}/archive`), { confirmArchive: true }],
      ['POST', passes(c, `/${w.pass._id}/archive`), { confirmArchive: true }],
      ['POST', passes(c, `/${w.drafts[0]._id}/activate`)],
      ['POST', passes(c, `/${ended._id}/bring-back`)],
      ['DELETE', passes(c, `/${w.drafts[0]._id}`)],
      ['DELETE', efforts(c, `/${w.effort._id}`)],
    ];
    for (const [method, path, body] of writes) {
      const r = await call(method, path, { ...asAdmin(), body });
      assert.strictEqual(r.status, 409, `${method} ${path}: ${show(r)}`);
      assert.strictEqual(r.json.code, 'lifecycle-busy', `${method} ${path}: ${show(r)}`);
      assert.strictEqual(r.json.temporary, true);
    }
    const effort = await fresh(Effort, w.effort);
    assert.strictEqual(effort.status, 'active');
    assert.strictEqual(effort.endedPassId, null);
    assert.strictEqual(effort.lifecycleLock.token, 'someone-else', "a loser never releases the holder's lock");
    assert.strictEqual((await fresh(Pass, w.pass)).status, 'active');
    assert.strictEqual((await fresh(Pass, w.drafts[0])).status, 'draft');
    assert.strictEqual((await fresh(Pass, ended)).status, 'archived');
    assert.strictEqual(await lifecycleRows(c, 'Busy'), 0);
    // A rename doesn't wait for the lock — and its answer never carries the holder's token.
    const renamed = await call('PATCH', efforts(c, `/${w.effort._id}`), { ...asAdmin(), body: { name: 'Busy' } });
    assert.strictEqual(renamed.status, 200, show(renamed));
    assert.ok(!('lifecycleLock' in renamed.json.effort), `lifecycleLock must not be on the wire: ${show(renamed)}`);
  } finally {
    await Effort.updateOne({ _id: w.effort._id }, { $set: { lifecycleLock: { lockedAt: null, token: null } } });
  }

  // A lock older than the staleness window (a crashed holder) is taken over.
  await Effort.updateOne({ _id: w.effort._id }, { $set: { lifecycleLock: { lockedAt: new Date(Date.now() - 6 * 60_000), token: 'crashed' } } });
  const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
  assert.strictEqual(r.status, 200, show(r));
  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'archived');
  assert.strictEqual(effort.lifecycleLock.lockedAt, null);
});

test('archive while a book operation holds the live pass answers recut-locked and changes nothing', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Recut' });
  assert.ok(await acquireRecutLock(w.pass._id, ctx.admin._id));
  try {
    const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
    assert.strictEqual(r.status, 409, show(r));
    assert.strictEqual(r.json.code, 'recut-locked');
    assert.strictEqual(r.json.temporary, true);
    const pass = await fresh(Pass, w.pass);
    assert.strictEqual(pass.status, 'active');
    assert.ok(pass.recutLock.lockedAt, "the book operation's lock is untouched");
    const effort = await fresh(Effort, w.effort);
    assert.strictEqual(effort.status, 'active');
    assert.strictEqual(effort.lifecycleLock.lockedAt, null);
    assert.strictEqual(await lifecycleRows(c, 'Recut'), 0);
  } finally {
    await releaseRecutLock(w.pass._id);
  }
});

// B.2: step 3 takes the recut lock ("409 recut-locked … nothing changes"), step 4 then records
// endedPassId. Kept apart from the test above so a failure here is read on its own.
test('a recut-locked archive does not leave endedPassId stamped on the still-open walk list', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Recut Pointer' });
  assert.ok(await acquireRecutLock(w.pass._id, ctx.admin._id));
  try {
    const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
    assert.strictEqual(r.status, 409, show(r));
    const effort = await fresh(Effort, w.effort);
    assert.strictEqual(effort.endedPassId, null, `nothing changes on recut-locked (B.2 step 3), but endedPassId=${effort.endedPassId}`);
    assert.strictEqual((await effortRow(c, w.effort)).endedPassId, null);
  } finally {
    await releaseRecutLock(w.pass._id);
  }
});

test('a crash between ending the pass and archiving the walk list: archiving again keeps endedPassId, and Unarchive offers the pass back', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Crash', live: false });
  // The state B.2 leaves when it stops after step 5: open walk list, pass ended via 'walk-list'.
  const endedAt = new Date(Date.now() - 60_000);
  await Pass.updateOne(
    { _id: w.pass._id },
    { $set: { status: 'archived', activatedAt: new Date(Date.now() - 3600_000), lastActivatedAt: new Date(Date.now() - 3600_000), archivedAt: endedAt, archivedFrom: 'active', archivedVia: 'walk-list', archivedBy: ctx.admin._id } }
  );
  await Effort.updateOne({ _id: w.effort._id }, { $set: { endedPassId: w.pass._id } });

  // Meanwhile its own Bring back works.
  const panel = await passRow(c, w.pass);
  assert.strictEqual(panel.bringBack.ok, true, JSON.stringify(panel.bringBack));

  const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual(r.json.endedPassId, String(w.pass._id), 'the pointer the crashed archive left is kept');
  assert.strictEqual(r.json.endedPass?._id, String(w.pass._id), 'and named, so Undo brings it back');
  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'archived');
  assert.strictEqual(String(effort.endedPassId), String(w.pass._id));

  const preview = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
  assert.strictEqual(preview.json.endedPass?._id, String(w.pass._id), show(preview));
  assert.strictEqual(preview.json.endedPass.bringBack.ok, true);
  const back = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asAdmin(), body: { bringBack: true } });
  assert.strictEqual(back.status, 200, show(back));
  assert.strictEqual(back.json.broughtBack, String(w.pass._id));
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'active');

  // A stale pointer at a pass this archive did NOT end (archived by hand) is dropped, so Unarchive
  // never offers back something it didn't end.
  const s = await seedWalkList({ campaign: c, name: 'Stale Pointer', live: false });
  await Pass.updateOne({ _id: s.pass._id }, { $set: { status: 'archived', archivedAt: new Date(), archivedFrom: 'draft', archivedVia: 'pass' } });
  await Effort.updateOne({ _id: s.effort._id }, { $set: { endedPassId: s.pass._id } });
  const r2 = await call('POST', efforts(c, `/${s.effort._id}/archive`), asAdmin());
  assert.strictEqual(r2.status, 200, show(r2));
  assert.strictEqual(r2.json.endedPassId, null);
  const p2 = await call('GET', efforts(c, `/${s.effort._id}/unarchive-preview`), asAdmin());
  assert.deepStrictEqual(p2.json, { endedPass: null });
});

test('the amber pre-repair state: archive (End Pass N) on an archived walk list with a live pass ends it', { skip }, async () => {
  const c = ctx.campaign;
  // Archived before this change: a label only, so the pass stayed live and no archive facts exist.
  const w = await seedWalkList({ campaign: c, name: 'Amber', live: false, drafts: 0 });
  await Pass.collection.updateOne({ _id: w.pass._id }, { $set: { status: 'active', activatedAt: new Date(Date.now() - 86400_000) }, $unset: { lastActivatedAt: '' } });
  await Effort.collection.updateOne({ _id: w.effort._id }, { $set: { status: 'archived' }, $unset: { archivedAt: '', archivedBy: '', endedPassId: '', lifecycleLock: '' } });

  const amber = await effortRow(c, w.effort);
  assert.strictEqual(amber.status, 'archived');
  assert.strictEqual(String(amber.activeRound?._id), String(w.pass._id), 'the amber row: archived with a live pass');
  assert.ok(bookIds(await bootstrap(c)).includes(String(w.book._id)), 'the bug being repaired: the book is still on the phone');

  const gate = await call('POST', efforts(c, `/${w.effort._id}/archive`), asAdmin());
  assert.strictEqual(gate.status, 409, show(gate));
  assert.strictEqual(gate.json.code, 'archive-confirm-required');
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'active');

  const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual(r.json.endedPassId, String(w.pass._id));
  const pass = await fresh(Pass, w.pass);
  assert.strictEqual(pass.status, 'archived');
  assert.strictEqual(pass.archivedVia, 'walk-list');
  assert.strictEqual(pass.archivedFrom, 'active');
  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(effort.status, 'archived');
  assert.strictEqual(String(effort.endedPassId), String(w.pass._id));
  assert.ok(!bookIds(await bootstrap(c)).includes(String(w.book._id)), 'the book left the phone');
  assert.strictEqual((await effortRow(c, w.effort)).activeRound, null);

  // Amber was archived long before: History records the pass it ended, not a walk-list archive.
  assert.strictEqual((await historyRows(c, 'Amber', 'walkListArchived')).length, 0);
  const rows = await historyRows(c, 'Amber', 'passArchived');
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].details, { walkList: 'Amber', pass: 'Pass 1', outcome: 'by-hand' });

  const preview = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asAdmin());
  assert.strictEqual(preview.json.endedPass?._id, String(w.pass._id));
  assert.deepStrictEqual(
    { ok: preview.json.endedPass.bringBack.ok, to: preview.json.endedPass.bringBack.to },
    { ok: true, to: 'active' }
  );
});

test('the one-time repair\'s History row names "One-time check" — no id, no status — so no phone says Unknown user', { skip }, async () => {
  // A shipped phone prints the actor's name, plus "(status)" for any status but 'active'; an actorless
  // row would read "Unknown user". The History route names the repair, with no status at all.
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Repaired', live: false, drafts: 0 });
  await Pass.collection.updateOne({ _id: w.pass._id }, { $set: { status: 'active', activatedAt: new Date(Date.now() - 86400_000) }, $unset: { lastActivatedAt: '' } });
  await Effort.collection.updateOne({ _id: w.effort._id }, { $set: { status: 'archived' }, $unset: { archivedAt: '', archivedBy: '', endedPassId: '', lifecycleLock: '' } });

  const { ended } = await repairWalkList({ campaign: c, effortId: w.effort._id });
  assert.deepStrictEqual(ended.map((p) => String(p._id)), [String(w.pass._id)]);

  const rows = await historyRows(c, 'Repaired', 'passArchived');
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].by, { id: null, name: 'One-time check' });
  assert.deepStrictEqual(rows[0].details, { walkList: 'Repaired', pass: 'Pass 1', outcome: 'repair' });
  assert.match(rows[0].toValue, /\(one-time check\)$/, 'the plain form an old phone shows still says where it came from');
  // The walk list's own archive date is left as it was (none, for an archive from before the change).
  assert.strictEqual((await fresh(Effort, w.effort)).archivedAt ?? null, null);
});

test('walk lists and passes from before this change answer the new fields as null, not missing', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Legacy', live: false, drafts: 0 });
  await Effort.collection.updateOne({ _id: w.effort._id }, { $unset: { archivedAt: '', archivedBy: '', endedPassId: '', lifecycleLock: '' } });
  await Pass.collection.updateOne(
    { _id: w.pass._id },
    { $set: { status: 'archived', archivedAt: new Date(), activatedAt: new Date(Date.now() - 86400_000) }, $unset: { lastActivatedAt: '', archivedFrom: '', archivedVia: '', archivedBy: '', endedByPassId: '' } }
  );
  const row = await effortRow(c, w.effort);
  const p = await passRow(c, w.pass);
  const wrong = [
    ...['archivedAt', 'archivedByName', 'endedPassId'].filter((f) => !(f in row) || row[f] !== null).map((f) => `GET /efforts ${f}: ${f in row ? JSON.stringify(row[f]) : 'missing'}`),
    ...['lastActivatedAt', 'archivedFrom', 'archivedVia', 'archivedByName', 'endedByPassName']
      .filter((f) => !(f in p) || p[f] !== null)
      .map((f) => `GET /passes ${f}: ${f in p ? JSON.stringify(p[f]) : 'missing'}`),
  ];
  assert.deepStrictEqual(wrong, [], 'contract: these are `X|null`, so a pre-change doc must answer null');
});

test('on an archived campaign every walk-list and pass write answers 409 campaign-archived, while reads keep working', { skip }, async () => {
  const c = await ctx.mkCampaign('Archive Done');
  const w = await seedWalkList({ campaign: c, name: 'Done Live' });
  const gone = await seedWalkList({ campaign: c, name: 'Done Ended' });
  assert.strictEqual((await call('POST', efforts(c, `/${gone.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  const ended = await Pass.create({
    organizationId: c.organizationId, campaignId: c._id, effortId: w.effort._id, roundNumber: 7, name: 'Pass 7', status: 'archived',
    archivedAt: new Date(), archivedFrom: 'draft', archivedVia: 'pass',
  });
  await Campaign.updateOne({ _id: c._id }, { $set: { isActive: false } });
  const snapshot = async () => ({
    efforts: (await Effort.find({ campaignId: c._id }, { name: 1, status: 1, endedPassId: 1 }).sort({ _id: 1 }).lean()).map((e) => `${e.name}|${e.status}|${e.endedPassId}`),
    passes: (await Pass.find({ campaignId: c._id }, { name: 1, status: 1 }).sort({ _id: 1 }).lean()).map((p) => `${p.name}|${p.status}`),
    members: await EffortMember.countDocuments({ campaignId: c._id }),
  });
  const before0 = await snapshot();

  const writes = [
    ['POST', efforts(c), { name: 'New list' }],
    ['PATCH', efforts(c, `/${w.effort._id}`), { name: 'Renamed' }],
    ['POST', efforts(c, `/${w.effort._id}/archive`), { confirmArchive: true }],
    ['POST', efforts(c, `/${gone.effort._id}/unarchive`), { bringBack: true }],
    ['POST', efforts(c, `/${gone.effort._id}/unarchive`), { bringBack: false }],
    ['POST', efforts(c, `/${w.effort._id}/claim`), { all: true }],
    ['POST', efforts(c, `/${w.effort._id}/members`), { userId: String(ctx.canv._id) }],
    ['DELETE', efforts(c, `/${w.effort._id}/members/${ctx.canv._id}`)],
    ['DELETE', efforts(c, `/${w.effort._id}`)],
    ['POST', passes(c), { effortId: String(w.effort._id) }],
    ['PATCH', passes(c, `/${w.drafts[0]._id}`), { name: 'Renamed draft' }],
    ['DELETE', passes(c, `/${w.drafts[0]._id}`)],
    ['POST', passes(c, `/${w.drafts[0]._id}/activate`)],
    ['POST', passes(c, `/${w.pass._id}/archive`), { confirmArchive: true }],
    ['POST', passes(c, `/${ended._id}/bring-back`)],
    ['POST', passes(c, `/${gone.pass._id}/bring-back`)],
  ];
  for (const [method, path, body] of writes) {
    const r = await call(method, path, { ...asAdmin(), body });
    assert.strictEqual(r.status, 409, `${method} ${path}: ${show(r)}`);
    assert.strictEqual(r.json.code, 'campaign-archived', `${method} ${path}: ${show(r)}`);
  }
  assert.deepStrictEqual(await snapshot(), before0, 'nothing changed');

  const reads = [
    efforts(c),
    efforts(c, `/${w.effort._id}/archive-preview`),
    efforts(c, `/${gone.effort._id}/unarchive-preview`),
    efforts(c, `/${w.effort._id}/members`),
    efforts(c, '/intake'),
    passes(c),
    passes(c, `/${w.pass._id}/progress`),
  ];
  for (const path of reads) {
    const r = await call('GET', path, asAdmin());
    assert.strictEqual(r.status, 200, `GET ${path}: ${show(r)}`);
  }
  const preview = await call('GET', efforts(c, `/${gone.effort._id}/unarchive-preview`), asAdmin());
  assert.strictEqual(preview.json.endedPass.bringBack.ok, false);
  assert.strictEqual(preview.json.endedPass.bringBack.reason, 'campaign-archived');
  const panel = await passRow(c, ended);
  assert.strictEqual(panel.bringBack.reason, 'campaign-archived');
});

test('Delete works on an archived walk list that never went live (canDelete), and is refused once a pass went live', { skip }, async () => {
  const c = ctx.campaign;
  const never = await seedWalkList({ campaign: c, name: 'Never Live', live: false, drafts: 1 });
  assert.strictEqual((await call('POST', efforts(c, `/${never.effort._id}/archive`), asAdmin())).status, 200);
  const row = await effortRow(c, never.effort);
  assert.strictEqual(row.status, 'archived');
  assert.strictEqual(row.canDelete, true);
  assert.strictEqual(row.everLive, false);
  const del = await call('DELETE', efforts(c, `/${never.effort._id}`), asAdmin());
  assert.strictEqual(del.status, 200, show(del));
  assert.strictEqual(await Effort.countDocuments({ _id: never.effort._id }), 0);
  assert.strictEqual(await Pass.countDocuments({ effortId: never.effort._id }), 0);
  assert.strictEqual(await Turf.countDocuments({ passId: never.pass._id }), 0);
  assert.strictEqual(await Household.countDocuments({ _id: { $in: never.doors.map((d) => d._id) }, effortId: null }), 3, 'its doors went back to Intake');

  const was = await seedWalkList({ campaign: c, name: 'Was Live' });
  assert.strictEqual((await call('POST', efforts(c, `/${was.effort._id}/archive`), { ...asAdmin(), body: { confirmArchive: true } })).status, 200);
  assert.strictEqual((await effortRow(c, was.effort)).canDelete, false);
  const refused = await call('DELETE', efforts(c, `/${was.effort._id}`), asAdmin());
  assert.strictEqual(refused.status, 400, show(refused));
  assert.strictEqual(await Effort.countDocuments({ _id: was.effort._id }), 1);
});

test('a team lead who manages the campaign can archive and unarchive (ruling 6); one who does not is refused', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Lead Undo' });
  const outsider = await call('POST', efforts(c, `/${w.effort._id}/archive`), { token: ctx.outsiderTok, orgId: ctx.org._id, body: { confirmArchive: true } });
  assert.strictEqual(outsider.status, 403, show(outsider));
  assert.strictEqual((await fresh(Effort, w.effort)).status, 'active');

  const r = await call('POST', efforts(c, `/${w.effort._id}/archive`), { ...asLead(), body: { confirmArchive: true } });
  assert.strictEqual(r.status, 200, show(r));
  const effort = await fresh(Effort, w.effort);
  assert.strictEqual(String(effort.archivedBy), String(ctx.lead._id));
  assert.strictEqual(String((await fresh(Pass, w.pass)).archivedBy), String(ctx.lead._id));
  assert.strictEqual((await effortRow(c, w.effort)).archivedByName, 'Lena Lead');
  const rows = await historyRows(c, 'Lead Undo', 'walkListArchived');
  assert.strictEqual(rows[0]?.by?.name, 'Lena Lead');

  const preview = await call('GET', efforts(c, `/${w.effort._id}/unarchive-preview`), asLead());
  assert.strictEqual(preview.status, 200, show(preview));
  assert.strictEqual(preview.json.endedPass.archivedByName, 'Lena Lead');
  const back = await call('POST', efforts(c, `/${w.effort._id}/unarchive`), { ...asLead(), body: { bringBack: true } });
  assert.strictEqual(back.status, 200, show(back));
  assert.strictEqual(back.json.to, 'active');
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'active');
  assert.strictEqual((await historyRows(c, 'Lead Undo', 'walkListUnarchived'))[0]?.by?.name, 'Lena Lead');
});

test('a live pass with no walk list (data from before walk lists) can still be archived — its books stop reaching phones', { skip }, async () => {
  const c = ctx.campaign;
  const { insertedId } = await Pass.collection.insertOne({
    organizationId: c.organizationId, campaignId: c._id, roundNumber: 77, name: 'Pass 77', status: 'active', activatedAt: new Date(Date.now() - 60_000),
  });
  const plain = await call('POST', passes(c, `/${insertedId}/archive`), asAdmin());
  assert.strictEqual(plain.status, 409, show(plain));
  assert.strictEqual(plain.json.code, 'archive-confirm-required', 'the same confirm as any live pass');

  const r = await call('POST', passes(c, `/${insertedId}/archive`), { ...asAdmin(), body: { confirmArchive: true } });
  assert.strictEqual(r.status, 200, show(r));
  const pass = await Pass.findById(insertedId).lean();
  assert.strictEqual(pass.status, 'archived');
  assert.strictEqual(pass.archivedVia, 'pass');
  // Coming back needs a walk list.
  const back = await call('POST', passes(c, `/${insertedId}/bring-back`), asAdmin());
  assert.strictEqual(back.status, 409, show(back));
  assert.strictEqual(back.json.code, 'walk-list-missing');
});

test('a survey change racing an archive never lands on the archived walk list — the write itself is conditional', { skip }, async () => {
  const c = ctx.surveyCampaign;
  const w = await seedWalkList({ campaign: c, name: 'Survey Race', live: false, drafts: 0 });
  // The archive lands between the route's check and its write — deterministically, by archiving the walk
  // list just before the route's own update runs (code review round 2 won this race 30 times in 30).
  const original = Effort.updateOne;
  let raced = false;
  Effort.updateOne = function racing(filter, update, ...rest) {
    if (!raced && update?.$set && 'surveyTemplateId' in update.$set) {
      raced = true;
      return Effort.collection
        .updateOne({ _id: w.effort._id }, { $set: { status: 'archived', archivedAt: new Date() } })
        .then(() => original.call(this, filter, update, ...rest));
    }
    return original.call(this, filter, update, ...rest);
  };
  let r;
  try {
    r = await call('PATCH', efforts(c, `/${w.effort._id}`), { ...asAdmin(), body: { surveyTemplateId: String(ctx.template._id) } });
  } finally {
    Effort.updateOne = original;
  }
  assert.ok(raced, 'the race was staged');
  assert.strictEqual(r.status, 409, show(r));
  assert.strictEqual(r.json.code, 'walk-list-archived');
  assert.strictEqual((await fresh(Effort, w.effort)).surveyTemplateId, null, 'the frozen survey stayed as it was');
});

test('a delete answers only once the walk list is free again — and a draft with no walk list can still be deleted', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Delete Free', drafts: 1 });
  const r = await call('DELETE', passes(c, `/${w.drafts[0]._id}`), asAdmin());
  assert.strictEqual(r.status, 200, show(r));
  assert.strictEqual((await fresh(Effort, w.effort)).lifecycleLock?.lockedAt ?? null, null, 'released before the reply');
  // A refusal comes back the same way, after the release.
  const refused = await call('DELETE', passes(c, `/${w.pass._id}`), asAdmin());
  assert.strictEqual(refused.status, 400, show(refused));
  assert.match(refused.json.error, /Only draft passes can be deleted/);
  assert.strictEqual((await fresh(Effort, w.effort)).lifecycleLock?.lockedAt ?? null, null);

  const { insertedId } = await Pass.collection.insertOne({
    organizationId: c.organizationId, campaignId: c._id, roundNumber: 78, name: 'Pass 78', status: 'draft',
  });
  const orphan = await call('DELETE', passes(c, `/${insertedId}`), asAdmin());
  assert.strictEqual(orphan.status, 200, show(orphan));
  assert.strictEqual(await Pass.countDocuments({ _id: insertedId }), 0);
});

test('ruling 6 for passes: a lead who manages the campaign archives a pass and brings it back; a canvasser reaches no lifecycle route', { skip }, async () => {
  const c = ctx.campaign;
  const w = await seedWalkList({ campaign: c, name: 'Lead Pass' });
  const archived = await call('POST', passes(c, `/${w.pass._id}/archive`), { ...asLead(), body: { confirmArchive: true } });
  assert.strictEqual(archived.status, 200, show(archived));
  assert.strictEqual(String((await fresh(Pass, w.pass)).archivedBy), String(ctx.lead._id));
  const back = await call('POST', passes(c, `/${w.pass._id}/bring-back`), asLead());
  assert.strictEqual(back.status, 200, show(back));
  assert.strictEqual(back.json.to, 'active');
  assert.strictEqual((await historyRows(c, 'Lead Pass', 'passBroughtBack'))[0]?.by?.name, 'Lena Lead');

  for (const [method, path, body] of [
    ['GET', efforts(c, `/${w.effort._id}/archive-preview`)],
    ['POST', efforts(c, `/${w.effort._id}/archive`), { confirmArchive: true }],
    ['GET', efforts(c, `/${w.effort._id}/unarchive-preview`)],
    ['POST', efforts(c, `/${w.effort._id}/unarchive`), { bringBack: true }],
    ['POST', passes(c, `/${w.pass._id}/archive`), { confirmArchive: true }],
    ['POST', passes(c, `/${w.pass._id}/bring-back`)],
  ]) {
    const r = await call(method, path, { ...asCanv(), body });
    assert.strictEqual(r.status, 403, `${method} ${path}: ${show(r)}`);
  }
  assert.strictEqual((await fresh(Pass, w.pass)).status, 'active', 'nothing a canvasser sent changed it');
  assert.strictEqual((await fresh(Effort, w.effort)).status, 'active');
});
