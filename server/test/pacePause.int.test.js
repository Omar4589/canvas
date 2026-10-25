import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Automatic pause over the REAL Express app (docs/PROPOSAL_PACE_PAUSE.md §K.1):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pace_test node --test test/pacePause.int.test.js
// The tests share one org and run in order: a canvasser is paused by too-fast doors, refused, reviewed,
// unpaused, paused again on a second campaign, and so on.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pace-pause';
process.env.PACE_PAUSE = 'on';
process.env.PACE_ALERT_SEND_GAP_MS = '0';
process.env.RESEND_API_KEY = 'test:accept';
process.env.MAIL_FROM = 'Doorline <alerts@doorline.test>';
process.env.WEB_ORIGIN = 'https://doorline.test';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { PacePause } = await import('../src/models/PacePause.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');
const { syncPacePauseIndexes, pauseRecipients, switchCovers, paceSwitch } = await import('../src/services/audit/pacePause.js');
const { ORG_SCOPED } = await import('../src/services/platform/deleteOrganization.js');
const { LATE_WRITE_MODELS } = await import('../src/services/platform/lateWriteSweep.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');
const { zonedDayStr, zonedTimeToUtc } = await import('../src/utils/timezone.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const TZ = 'America/Los_Angeles';
const MESSAGE = 'Recording is paused for review. Call your team lead.';

let server;
let base;
const ctx = {};

// Doors on a line east of (36, -115): door i sits i * 120 m along, so consecutive doors 8 s apart are
// impossible (120 / 11.2 + 15 = 25.7 s needed) and 60 s apart are fine.
const SPACING_M = 120;
const pinOf = (campaignIndex, i) => ({
  lat: 36 + campaignIndex * 0.05,
  lng: -115 + (i * SPACING_M) / (111320 * Math.cos((36 * Math.PI) / 180)),
});
const near = (p) => ({ lat: p.lat + 0.00003, lng: p.lng, accuracy: 5 });

// Tap times on today's local date in the campaign's zone, from noon.
let clock = 0;
const noon = () => {
  const [y, m, d] = zonedDayStr(new Date(), TZ).split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 12, 0, 0, TZ).getTime();
};
const tick = (sec) => {
  clock += sec;
  return new Date(noon() + clock * 1000).toISOString();
};

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

const asCanv = (tok = ctx.tok) => ({ token: tok, orgId: ctx.org._id });
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const notHome = (door, sec, extra = {}, tok) =>
  call('POST', `/mobile/households/${door._id}/not-home`, { ...asCanv(tok), body: { location: near(door.pin), timestamp: tick(sec), ...extra } });

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
};

const homesFor = (orgId, campaignId, effortId, campaignIndex, n) =>
  Array.from({ length: n }, (_, i) => {
    const pin = pinOf(campaignIndex, i);
    return {
      organizationId: orgId,
      campaignId,
      effortId,
      addressLine1: `${100 + i} Pace St ${campaignIndex}`,
      city: 'Paceville',
      state: 'NV',
      zipCode: '89001',
      normalizedAddress: `${100 + i} PACE ST ${campaignIndex}|PACEVILLE|NV|89001`,
      location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      isActive: true,
      status: 'unknocked',
    };
  });

const bookFor = async (org, campaignIndex, name, canvassers) => {
  const template = await SurveyTemplate.create({ organizationId: org._id, name: `S${campaignIndex}`, questions: [], isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'NV', isActive: true, timeZone: TZ, surveyTemplateId: template._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'All' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany(homesFor(org._id, camp._id, effort._id, campaignIndex, 40));
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: `Book ${campaignIndex}`, mode: 'geometric',
    status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  for (const u of canvassers) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: u._id });
    await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  return { camp, template, doors: homes.map((h, i) => ({ _id: h._id, pin: pinOf(campaignIndex, i) })) };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription, PacePause]) {
    await M.deleteMany({});
  }
  await syncPacePauseIndexes('test');

  const org = await Organization.create({ name: 'Pace Org', slug: 'pace-a', isActive: true, timeZone: TZ });
  const orgB = await Organization.create({ name: 'Other Org', slug: 'pace-b', isActive: true });
  const mk = (first, last, email) => User.create({ firstName: first, lastName: last, email, passwordHash: 'x', isActive: true });
  const admin = await mk('Ada', 'Billing', 'ada@pace.test');
  const admin2 = await mk('Abe', 'Plain', 'abe@pace.test');
  const leadA = await mk('Lee', 'Alpha', 'lee@pace.test');
  const leadB = await mk('Lou', 'Beta', 'lou@pace.test');
  const canv = await mk('Jody', 'Fastwalker', 'jody@pace.test');
  const canv2 = await mk('Kim', 'Second', 'kim@pace.test');
  const adminB = await mk('Bo', 'OtherAdmin', 'bo@pace.test');
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: admin2._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: leadA._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: leadB._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: canv2._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: adminB._id, organizationId: orgB._id, role: 'admin', isActive: true, billingAccess: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  await Subscription.create({ organizationId: orgB._id, status: 'internal' });

  const c1 = await bookFor(org, 0, 'Campaign One', [canv, canv2]);
  const c2 = await bookFor(org, 1, 'Campaign Two', [canv, canv2]);
  await CampaignManager.create({ organizationId: org._id, campaignId: c1.camp._id, userId: leadA._id, grantedBy: admin._id });
  await CampaignManager.create({ organizationId: org._id, campaignId: c2.camp._id, userId: leadB._id, grantedBy: admin._id });
  const voter = await Voter.create({
    organizationId: org._id, campaignId: c1.camp._id, householdId: c1.doors[20]._id, stateVoterId: 'NVP1',
    firstName: 'Vera', lastName: 'Votington', fullName: 'Vera Votington',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, orgB, admin, admin2, leadA, leadB, canv, canv2, adminB, c1, c2, voter,
    adminTok: signUserToken(admin), admin2Tok: signUserToken(admin2), leadATok: signUserToken(leadA), leadBTok: signUserToken(leadB),
    tok: signUserToken(canv), tok2: signUserToken(canv2), adminBTok: signUserToken(adminB),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('eight too-fast doors pause the canvasser; the tipping write is kept and says so', { skip }, async () => {
  clearOutbox();
  const d = ctx.c1.doors;
  let r = await notHome(d[0], 0);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.pace.paused, false);
  for (let i = 1; i <= 7; i++) {
    r = await notHome(d[i], 8);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.pace.paused, false, `door ${i}`);
  }
  r = await notHome(d[8], 8); // the 8th fail
  assert.strictEqual(r.status, 201, 'the tipping door is saved');
  assert.deepStrictEqual([r.json.pace.paused, r.json.pace.tipped], [true, true]);
  const pause = await PacePause.findOne({ userId: ctx.canv._id }).lean();
  assert.ok(pause);
  assert.strictEqual(pause.status, 'paused');
  assert.strictEqual(String(pause.campaignId), String(ctx.c1.camp._id));
  assert.strictEqual(pause.window.filter((v) => v.fail).length, 8);
  assert.ok(await CanvassActivity.exists({ householdId: d[8]._id }), 'tipping row written');
  ctx.pause1 = pause;
});

test('the alert: one email per billing admin, a neutral subject, no names or addresses, no @ on the record', { skip }, async () => {
  const sent = await waitFor(() => outbox.filter((e) => e.kind === 'pacePauseAlert').length >= 1 && outbox.filter((e) => e.kind === 'pacePauseAlert'));
  assert.ok(sent && sent.length === 1, 'one recipient: the only billing admin');
  const m = sent[0];
  assert.deepStrictEqual(m.to, ['ada@pace.test']);
  assert.strictEqual(m.subject, 'A canvasser was paused for review');
  for (const forbidden of ['Jody', 'Fastwalker', 'Pace St', 'Vera', 'Votington', 'jody@pace.test']) {
    assert.ok(!m.text.includes(forbidden) && !m.html.includes(forbidden), `email carries ${forbidden}`);
  }
  assert.ok(m.text.includes(`https://doorline.test/pause/${ctx.org._id}/${ctx.c1.camp._id}/${ctx.pause1._id}`));
  assert.ok(m.text.includes('Campaign One'));
  const pause = await waitFor(async () => {
    const p = await PacePause.findById(ctx.pause1._id).lean();
    return p.alert.status === 'done' && p;
  });
  assert.deepStrictEqual([pause.alert.sent, pause.alert.failed], [1, 0]);
  // The record's promise (privacy item 39): no email address, coordinate, street address, name or free text.
  const stored = JSON.stringify(pause);
  assert.ok(!stored.includes('@'), 'no email address stored on the pause');
  for (const forbidden of ['Jody', 'Fastwalker', 'Pace St', '"lat"', '"lng"', '"coordinates"', '"note"']) {
    assert.ok(!stored.includes(forbidden), `the pause stores ${forbidden}`);
  }
});

test('a fresh write while blocked is refused with PACE_PAUSED and writes nothing, on every gated path', { skip }, async () => {
  const d = ctx.c1.doors;
  const rows = await CanvassActivity.countDocuments({});
  const voters = await Voter.countDocuments({});
  let r = await notHome(d[9], 60);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'PACE_PAUSED');
  assert.strictEqual(r.json.error, MESSAGE);
  // The refusal carries the state on the server's clock, so the phone orders it against its other answers.
  assert.strictEqual(r.json.pace.paused, true);
  assert.ok(Number.isFinite(Date.parse(r.json.pace.at)));
  r = await call('POST', `/mobile/voters/${ctx.voter._id}/survey`, {
    ...asCanv(),
    body: { surveyTemplateId: String(ctx.c1.template._id), answers: [], location: near(d[20].pin), timestamp: tick(60) },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'PACE_PAUSED');
  assert.strictEqual(r.json.pace.paused, true);
  r = await call('POST', `/mobile/households/${d[21]._id}/voters`, {
    ...asCanv(),
    body: { voterId: new mongoose.Types.ObjectId().toHexString(), firstName: 'New', lastName: 'Person', location: near(d[21].pin), timestamp: tick(30) },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'PACE_PAUSED');
  assert.strictEqual(r.json.pace.paused, true);
  assert.strictEqual(await CanvassActivity.countDocuments({}), rows);
  assert.strictEqual(await Voter.countDocuments({}), voters);
  assert.strictEqual(await SurveyResponse.countDocuments({}), 0);
});

test('a replay while blocked is accepted, and every phone answer says paused', { skip }, async () => {
  const d = ctx.c1.doors;
  const r = await notHome(d[10], 60, { wasOfflineSubmission: true });
  assert.strictEqual(r.status, 201, 'the queue would delete a refused replay');
  assert.strictEqual(r.json.pace.paused, true);
  const pace = await call('GET', '/mobile/pace', asCanv());
  assert.strictEqual(pace.json.paused, true);
  assert.ok(Date.parse(pace.json.at));
  const changes = await call('GET', `/mobile/changes?campaignId=${ctx.c1.camp._id}&since=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`, asCanv());
  assert.strictEqual(changes.status, 200);
  assert.strictEqual(changes.json.pace.paused, true, 'an otherwise empty delta still carries pace');
  const boot = await call('GET', `/mobile/bootstrap?campaignId=${ctx.c1.camp._id}`, asCanv());
  assert.strictEqual(boot.status, 200);
  assert.strictEqual(boot.json.pace.paused, true);
});

test('the badge counts blocking pauses per campaign', { skip }, async () => {
  const r = await call('GET', '/admin/campaigns', asAdmin());
  const list = Array.isArray(r.json) ? r.json : r.json.campaigns;
  const one = list.find((c) => String(c._id ?? c.id) === String(ctx.c1.camp._id));
  const two = list.find((c) => String(c._id ?? c.id) === String(ctx.c2.camp._id));
  assert.strictEqual(one.openPacePauses, 1);
  assert.strictEqual(two.openPacePauses, 0);
});

test('a lead of another campaign can neither open nor lift it, and sees only a named roster line', { skip }, async () => {
  const id = ctx.pause1._id;
  let r = await call('GET', `/admin/pace-pauses/${id}`, { token: ctx.leadBTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 403);
  r = await call('POST', `/admin/pace-pauses/${id}/unpause`, { token: ctx.leadBTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 403);
  r = await call('GET', '/admin/pace-pauses', { token: ctx.leadBTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.pauses.length, 0);
  assert.deepStrictEqual(r.json.rosterLines.map((l) => [l.userId, l.name, l.paused, l.elsewhere]), [[String(ctx.canv._id), 'Jody Fastwalker', true, true]]);
  assert.strictEqual(JSON.stringify(r.json).includes(String(ctx.c1.camp._id)), false, 'nothing about the other campaign');
});

test("another organization's admin gets a 404", { skip }, async () => {
  const r = await call('GET', `/admin/pace-pauses/${ctx.pause1._id}`, { token: ctx.adminBTok, orgId: ctx.orgB._id });
  assert.strictEqual(r.status, 404);
});

test('the managing lead sees the evidence and unpauses; the count starts over', { skip }, async () => {
  const opts = { token: ctx.leadATok, orgId: ctx.org._id };
  let r = await call('GET', `/admin/pace-pauses/${ctx.pause1._id}`, opts);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.blocking, true);
  assert.strictEqual(r.json.summary.fails, 8);
  assert.ok(r.json.window.some((v) => v.address?.includes('Pace St')));
  assert.strictEqual(r.json.doorOutcomesUrl, null, 'Door Outcomes is org-admin only');
  r = await call('POST', `/admin/pace-pauses/${ctx.pause1._id}/unpause`, opts);
  assert.strictEqual(r.status, 200);
  const pace = await call('GET', '/mobile/pace', asCanv());
  assert.strictEqual(pace.json.paused, false);
  const m = await Membership.findOne({ userId: ctx.canv._id, organizationId: ctx.org._id }).lean();
  assert.ok(m.paceRestartAt);
  // One more too-fast door right away: one fail since the restart, no new pause.
  r = await notHome(ctx.c1.doors[11], 8);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.pace.paused, false);
  r = await call('POST', `/admin/pace-pauses/${ctx.pause1._id}/unpause`, opts);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'NOT_OPEN');
});

test('a pause on the second campaign shows the first campaign only as redacted rows to its lead', { skip }, async () => {
  // Fast doors on campaign one, then on campaign two: the 8th fail lands on campaign two.
  await notHome(ctx.c1.doors[12], 8);
  let last;
  for (let i = 0; i < 10 && !last?.json?.pace?.tipped; i++) last = await notHome(ctx.c2.doors[i], 8);
  assert.strictEqual(last.status, 201);
  assert.strictEqual(last.json.pace.tipped, true, 'tipped on a campaign-two door');
  const pause2 = await PacePause.findOne({ userId: ctx.canv._id, status: 'paused' }).lean();
  assert.strictEqual(String(pause2.campaignId), String(ctx.c2.camp._id));
  ctx.pause2 = pause2;
  const r = await call('GET', `/admin/pace-pauses/${pause2._id}`, { token: ctx.leadBTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 200);
  const hidden = r.json.window.filter((v) => v.otherCampaign);
  assert.ok(hidden.length >= 1, 'campaign-one visits are in the window');
  for (const v of hidden) assert.deepStrictEqual(Object.keys(v).sort(), ['at', 'fail', 'otherCampaign']);
  const firstHop = r.json.window.find((v) => v.prevOtherCampaign);
  assert.ok(firstHop, 'the hop from campaign one keeps only seconds and verdict');
  assert.strictEqual(firstHop.meters, undefined);
  assert.strictEqual(firstHop.neededSec, undefined);
  const text = JSON.stringify(r.json);
  assert.ok(!text.includes('Pace St 0'), 'no campaign-one address');
  assert.ok(!text.includes(String(ctx.c1.camp._id)), 'no campaign-one id');
  // Campaign one's lead lists a named roster line, not the pause.
  const l = await call('GET', '/admin/pace-pauses', { token: ctx.leadATok, orgId: ctx.org._id });
  assert.ok(l.json.rosterLines.some((x) => x.userId === String(ctx.canv._id)));
  assert.ok(!l.json.pauses.some((p) => p.id === String(pause2._id)));
});

test("a lead can't lift another campaign's pause through an old record of their own", { skip }, async () => {
  const r = await call('POST', `/admin/pace-pauses/${ctx.pause1._id}/unpause`, { token: ctx.leadATok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await PacePause.findById(ctx.pause2._id).lean()).status, 'paused', 'campaign two stays paused');
});

test('deleting resolved records never re-arms the pause; open ones and leads cannot delete', { skip }, async () => {
  let r = await call('DELETE', `/admin/pace-pauses/${ctx.pause2._id}`, asAdmin());
  assert.strictEqual(r.status, 409, 'an open pause is lifted, never deleted');
  r = await call('POST', `/admin/pace-pauses/${ctx.pause2._id}/unpause`, asAdmin());
  assert.strictEqual(r.status, 200);
  r = await call('DELETE', `/admin/pace-pauses/${ctx.pause1._id}`, { token: ctx.leadATok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 403);
  for (const p of [ctx.pause1, ctx.pause2]) {
    r = await call('DELETE', `/admin/pace-pauses/${p._id}`, asAdmin());
    assert.strictEqual(r.status, 200);
  }
  assert.strictEqual(await PacePause.countDocuments({ userId: ctx.canv._id }), 0);
  // The next door doesn't bring the old fails back.
  r = await notHome(ctx.c2.doors[7], 8);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.pace.paused, false);
  assert.strictEqual(await PacePause.countDocuments({ userId: ctx.canv._id }), 0);
});

test('history is built server-side across re-saves, and a history sent in the body is ignored', { skip }, async () => {
  const door = ctx.c1.doors[30];
  const slow = (path, extra = {}) =>
    call('POST', `/mobile/households/${door._id}/${path}`, { ...asCanv(ctx.tok2), body: { location: near(door.pin), timestamp: tick(90), ...extra } });
  await slow('not-home');
  await slow('refused', { replaced: { history: [{ at: new Date(0).toISOString(), actionType: 'forged' }] } });
  await slow('not-home');
  const row = await CanvassActivity.findOne({ householdId: door._id, userId: ctx.canv2._id }).lean();
  assert.deepStrictEqual(row.replaced.history.map((h) => h.actionType), ['not_home', 'refused']);
  assert.ok(row.replaced.history.every((h) => h.createdAt && h.offline === false));
});

test('promoting a paused canvasser to lead unblocks them', { skip }, async () => {
  const p = await PacePause.create({
    organizationId: ctx.org._id, campaignId: ctx.c1.camp._id, userId: ctx.canv2._id, status: 'paused',
    firedAt: new Date(), triggerActivityId: new mongoose.Types.ObjectId(), triggerAt: new Date(), day: zonedDayStr(new Date(), TZ),
    timeZone: TZ, config: { doorSec: 15, surveySec: 45, travelMps: 11.2, window: 20, failsToPause: 8, sameVisitSec: 600 },
  });
  assert.strictEqual((await call('GET', '/mobile/pace', asCanv(ctx.tok2))).json.paused, true);
  let r = await call('PATCH', `/admin/memberships/${ctx.canv2._id}`, { ...asAdmin(), body: { role: 'lead' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call('GET', '/mobile/pace', asCanv(ctx.tok2))).json.paused, false);
  assert.ok((await Membership.findOne({ userId: ctx.canv2._id }).lean()).paceRestartAt);
  r = await call('PATCH', `/admin/memberships/${ctx.canv2._id}`, { ...asAdmin(), body: { role: 'canvasser' } });
  assert.strictEqual(r.status, 200);
  await PacePause.updateOne({ _id: p._id }, { $set: { status: 'resolved', resolvedAt: new Date(), resolvedVia: 'unpause' } });
});

test('settings: org admins only, billing admins edit, dotted paths keep siblings, off resolves and on restarts', { skip }, async () => {
  let r = await call('GET', '/admin/pace-pauses/settings', { token: ctx.leadATok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 403);
  r = await call('PATCH', '/admin/pace-pauses/settings', { token: ctx.admin2Tok, orgId: ctx.org._id, body: { billingAdmins: true } });
  assert.strictEqual(r.status, 403, 'an admin without billing access');
  r = await call('PATCH', '/admin/pace-pauses/settings', { ...asAdmin(), body: { alertUserIds: [String(ctx.leadA._id), String(ctx.leadB._id)] } });
  assert.strictEqual(r.status, 200);
  r = await call('PATCH', '/admin/pace-pauses/settings', { ...asAdmin(), body: { billingAdmins: true } });
  assert.deepStrictEqual(r.json.alertUserIds.sort(), [String(ctx.leadA._id), String(ctx.leadB._id)].sort(), 'siblings kept');
  assert.strictEqual((await Organization.findById(ctx.org._id).lean()).pacePause.enabledAt, null, 'a recipients save restarts no one');
  r = await call('PATCH', '/admin/pace-pauses/settings', { ...asAdmin(), body: { alertUserIds: ['not-an-id'] } });
  assert.strictEqual(r.status, 400);
  r = await call('PATCH', '/admin/pace-pauses/settings', { ...asAdmin(), body: { alertUserIds: [String(ctx.canv._id)] } });
  assert.strictEqual(r.status, 400, 'a canvasser is never a recipient');

  // Recipients for a campaign-one pause: the billing admin and campaign one's lead; campaign two's lead is skipped.
  const recipients = await pauseRecipients({ organizationId: ctx.org._id, campaignId: ctx.c1.camp._id, userId: ctx.canv._id });
  assert.deepStrictEqual(recipients.map((x) => x.email).sort(), ['ada@pace.test', 'lee@pace.test']);
  assert.ok(recipients.every((x) => x.userId));

  // Pause the canvasser, then turn it off: the pause is resolved and nothing blocks.
  for (let i = 15; i <= 23; i++) await notHome(ctx.c1.doors[i], 8);
  assert.ok(await PacePause.exists({ userId: ctx.canv._id, status: 'paused' }));
  r = await call('PATCH', '/admin/pace-pauses/settings', { ...asAdmin(), body: { enabled: false } });
  assert.strictEqual(r.json.enabled, false);
  assert.strictEqual(await PacePause.countDocuments({ userId: ctx.canv._id, status: 'paused' }), 0);
  assert.strictEqual((await PacePause.findOne({ userId: ctx.canv._id, resolvedVia: 'setting_off' }).lean()).status, 'resolved');
  assert.strictEqual((await call('GET', '/mobile/pace', asCanv())).json.paused, false);
  r = await notHome(ctx.c1.doors[24], 8);
  assert.strictEqual(r.json.pace.paused, false, 'off: no checks');
  r = await call('PATCH', '/admin/pace-pauses/settings', { ...asAdmin(), body: { enabled: true } });
  assert.strictEqual(r.json.enabled, true);
  assert.ok((await Organization.findById(ctx.org._id).lean()).pacePause.enabledAt, 'on stamps enabledAt');
  r = await notHome(ctx.c1.doors[25], 8);
  assert.strictEqual(r.json.pace.paused, false, 'the count restarted when it was turned on');
});

test('the switch: unset blocks nothing, orgs:<slug> covers only that org, internal orgs are never covered', { skip }, async () => {
  const p = await PacePause.create({
    organizationId: ctx.org._id, campaignId: ctx.c1.camp._id, userId: ctx.canv._id, status: 'paused',
    firedAt: new Date(), triggerActivityId: new mongoose.Types.ObjectId(), triggerAt: new Date(), day: zonedDayStr(new Date(), TZ),
    timeZone: TZ, config: { doorSec: 15, surveySec: 45, travelMps: 11.2, window: 20, failsToPause: 8, sameVisitSec: 600 },
  });
  try {
    for (const [value, paused] of [['', false], ['off', false], ['nonsense', false], ['orgs:pace-b', false], ['orgs:pace-a', true], ['on', true]]) {
      process.env.PACE_PAUSE = value;
      assert.strictEqual((await call('GET', '/mobile/pace', asCanv())).json.paused, paused, `PACE_PAUSE=${value}`);
    }
    process.env.PACE_PAUSE = '';
    const r = await notHome(ctx.c1.doors[26], 60);
    assert.strictEqual(r.status, 201, 'switched off: not refused');
  } finally {
    process.env.PACE_PAUSE = 'on';
    await PacePause.updateOne({ _id: p._id }, { $set: { status: 'resolved', resolvedAt: new Date(), resolvedVia: 'unpause' } });
  }
  assert.strictEqual(switchCovers({ slug: 'demo', isInternal: true }, paceSwitch('on')), false);
  assert.strictEqual(switchCovers({ slug: 'demo', isInternal: true }, paceSwitch('orgs:demo')), true);
});

test('a failing alert dispatch never fails the write or the process', { skip }, async () => {
  // A stored recipients list that can't be cast makes the recipients query throw inside the detached send.
  await Organization.collection.updateOne({ _id: ctx.org._id }, { $set: { 'pacePause.alertUserIds': ['not-an-id'] } });
  await Membership.updateOne({ userId: ctx.canv2._id, organizationId: ctx.org._id }, { $set: { paceRestartAt: new Date() } });
  let r;
  await notHome(ctx.c2.doors[20], 900, {}, ctx.tok2); // fifteen minutes after anything else: passes
  for (let i = 21; i <= 28; i++) r = await notHome(ctx.c2.doors[i], 8, {}, ctx.tok2);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.pace.tipped, true);
  const p = await waitFor(async () => {
    const x = await PacePause.findOne({ userId: ctx.canv2._id, status: 'paused' }).lean();
    return x?.alert.status === 'done' && x;
  });
  assert.strictEqual(p.alert.sent, 0, 'the screen will say the email did not go out');
  assert.strictEqual((await call('GET', '/mobile/pace', asCanv(ctx.tok2))).json.paused, true, 'the server is still up');
  await Organization.collection.updateOne({ _id: ctx.org._id }, { $unset: { 'pacePause.alertUserIds': '' } });
  await call('POST', `/admin/pace-pauses/${p._id}/unpause`, asAdmin());
});

test('the preview: org admins only, finds the would-be pauses, refuses an over-long range', { skip }, async () => {
  const today = zonedDayStr(new Date(), TZ);
  let r = await call('GET', `/admin/pace-pauses/preview?campaignId=${ctx.c1.camp._id}&from=${today}&to=${today}`, asAdmin());
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.pauses.length >= 1);
  assert.ok(r.json.pauses.some((p) => p.name === 'Jody Fastwalker'));
  assert.ok(r.json.pauses.every((p) => p.window.length));
  r = await call('GET', `/admin/pace-pauses/preview?campaignId=${ctx.c1.camp._id}&from=${today}&to=${today}`, { token: ctx.leadATok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 403);
  r = await call('GET', `/admin/pace-pauses/preview?campaignId=${ctx.c1.camp._id}&from=2026-01-01&to=2026-12-31`, asAdmin());
  assert.strictEqual(r.status, 400);
});

test('cascades: campaign and org deletes and the late-write sweep cover pauses', { skip }, async () => {
  assert.ok(ORG_SCOPED.includes(PacePause));
  assert.ok(LATE_WRITE_MODELS.includes(PacePause));
  const camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Throwaway', type: 'survey', state: 'NV', isActive: true, timeZone: TZ });
  await PacePause.create({
    organizationId: ctx.org._id, campaignId: camp._id, userId: ctx.canv2._id, status: 'resolved',
    firedAt: new Date(), triggerActivityId: new mongoose.Types.ObjectId(), triggerAt: new Date(), day: zonedDayStr(new Date(), TZ),
    timeZone: TZ, config: { doorSec: 15, surveySec: 45, travelMps: 11.2, window: 20, failsToPause: 8, sameVisitSec: 600 },
  });
  await deleteCampaignCascade(camp);
  assert.strictEqual(await PacePause.countDocuments({ campaignId: camp._id }), 0);
  assert.ok((await PacePause.countDocuments({ organizationId: ctx.org._id })) > 0, 'other campaigns untouched');
});
