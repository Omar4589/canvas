import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// A deleted person's NAME on the promised report screens, for the retention window, over the REAL
// Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/deletednames node --test test/deletedUserNames.int.test.js
//
// Deleting an account scrubs the User row in place ("Deleted user", a tombstone address) and keeps
// the name in a DeletedUserRecord, readable by the organizations it lists until the purge. About 30
// report callers already put the name back through hydrateCanvassers. Eight lookups on promised
// screens read the scrubbed row instead (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md §A row 6, §C8):
//   1. the GPS audit (flagDetection.js): the flagged canvasser, and whoever reviewed a flag
//   2. the Coordinator label on the leaderboard and the Timeline (ledgerCoordinatorLabels)
//   3. /team-breakdown's team names
//   4. /tag-teams' team names
//   5. /canvassers/:userId/summary
//   6. /canvassers/:userId/responses
//   7. /voters-by-answer.csv's canvasser columns
//   8. the canvasser CSV's crew stamp (crewStampLabel)
// Each now restores the name from the record for the request's org only, and none prints an email.
// There is no cross-org option, and the record is no way in: the per-person drills still answer
// only for people the org (or the lead's campaigns) carries.
//
// The fixtures are written directly, a scrubbed User plus its record, not through deleteAccount(),
// so this file pins the READ side on its own.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-deleted-names';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { FlagReview } = await import('../src/models/FlagReview.js');
const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const PIN = { lng: -84.5, lat: 38.0 };
const NAME = 'Dora Departed';
const SCRUBBED = 'Deleted user';
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3);

const person = (first, last, email, extra = {}) => ({
  firstName: first, lastName: last, email, phone: '+15025550100', passwordHash: 'x', isActive: true, ...extra,
});

// One organization's campaign: a tagged survey, three doors, an admin, and Cal, a live canvasser.
const seedOrg = async (slug) => {
  const org = await Organization.create({
    name: `${slug} org`, slug, isActive: true,
    // /team-breakdown and /tag-teams refuse to answer before the team backfill has run.
    teamAttributionReadyAt: new Date(),
  });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create(person('Ada', 'Admin', `${slug}-admin@t.co`));
  const cal = await User.create(person('Cal', 'Walker', `${slug}-cal@t.co`));
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: cal._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Support', version: 1, tags: ['Supporter'],
    questions: [{
      key: 'support', label: 'Can we count on your support?', type: 'single_choice', order: 0,
      options: [
        { id: 'opt_s', text: 'Support', tag: 'Supporter', order: 0 },
        { id: 'opt_o', text: 'Opposed', order: 1 },
      ],
    }],
  });
  const campaign = await Campaign.create({
    organizationId: org._id, name: `${slug} campaign`, type: 'survey', state: 'KY', isActive: true,
    surveyTemplateId: template._id,
  });
  const homes = await Household.insertMany([1, 2, 3].map((n) => ({
    organizationId: org._id, campaignId: campaign._id,
    addressLine1: `${n} Record St`, city: 'Town', state: 'KY', zipCode: '40202',
    normalizedAddress: `${n} RECORD ST|TOWN|KY|40202`,
    location: { type: 'Point', coordinates: [PIN.lng, PIN.lat] },
    isActive: true, status: 'unknocked',
  })));
  return { org, admin, cal, template, campaign, homes, adminTok: signUserToken(admin) };
};

// Dora's work in one org, as a crew lead who also walked: her own knock on a fix too poor to trust
// (a weak GPS flag) and a tagged survey, plus Cal's knock and survey stamped with her as his
// coordinator. Cal's knock is flagged too, and Dora reviewed it. Returns her survey's id.
const seedDoraWork = async (o, dora) => {
  const at = { organizationId: o.org._id, campaignId: o.campaign._id };
  const weakFix = { lat: PIN.lat, lng: PIN.lng, accuracy: 400 }; // past GPS_ACCURACY_BAD_M
  const [, calKnock] = await CanvassActivity.insertMany([
    { ...at, householdId: o.homes[0]._id, userId: dora._id, actionType: 'survey_submitted', timestamp: hoursAgo(3), location: weakFix, distanceFromHouseMeters: 5 },
    { ...at, householdId: o.homes[1]._id, userId: o.cal._id, coordinatorId: dora._id, actionType: 'survey_submitted', timestamp: hoursAgo(2), location: weakFix, distanceFromHouseMeters: 5 },
  ]);
  const survey = (home, userId, coordinatorId, submittedAt) => ({
    ...at, householdId: home._id, voterId: new mongoose.Types.ObjectId(), userId, coordinatorId,
    surveyTemplateId: o.template._id, surveyTemplateVersion: 1,
    answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Support', optionIds: ['opt_s'] }],
    location: { lat: PIN.lat, lng: PIN.lng }, submittedAt,
  });
  const [doraSurvey] = await SurveyResponse.insertMany([
    survey(o.homes[0], dora._id, null, hoursAgo(3)),
    survey(o.homes[1], o.cal._id, dora._id, hoursAgo(2)),
  ]);
  await FlagReview.create({ ...at, actionModel: 'CanvassActivity', actionId: calKnock._id, status: 'reviewed', reviewedBy: dora._id });
  return String(doraSurvey._id);
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Household, CanvassActivity, SurveyResponse, SurveyTemplate, FlagReview, DeletedUserRecord, Subscription]) {
    await M.deleteMany({});
  }

  // Dora as the scrub leaves her: the row survives only to anchor the ledger.
  const doraId = new mongoose.Types.ObjectId();
  const deletedAt = hoursAgo(1);
  const dora = await User.create(
    person('Deleted', 'user', `deleted+${doraId}@deleted.doorline.invalid`, {
      _id: doraId, phone: null, isActive: false, deletedAt,
    })
  );

  // home:    her membership had been switched off before she deleted the account.
  // former:  she was removed (the membership row is gone); only her work remains.
  // outside: her work is on its ledger, but the record does not list it.
  // zulu:    listed on the record, but she never belonged or worked there.
  const home = await seedOrg('home');
  const former = await seedOrg('former');
  const outside = await seedOrg('outside');
  const zulu = await seedOrg('zulu');
  await Membership.create({ userId: dora._id, organizationId: home.org._id, role: 'lead', isActive: false });
  for (const o of [home, former, outside]) o.doraSurveyId = await seedDoraWork(o, dora);

  await DeletedUserRecord.create({
    userId: dora._id,
    firstName: 'Dora',
    lastName: 'Departed',
    organizationIds: [home.org._id, former.org._id, zulu.org._id],
    deletedAt,
    retentionUntil: new Date(deletedAt.getTime() + 180 * 86400e3),
    finishedAt: deletedAt, // a finished deletion, not an attempt still in flight (the deletion lock's field)
  });

  // Two team leads in home: one manages Dora's campaign, the other only a campaign she never touched.
  const otherCampaign = await Campaign.create({
    organizationId: home.org._id, name: 'home other', type: 'survey', state: 'KY', isActive: true,
  });
  const leadOn = await User.create(person('Lee', 'Lead', 'home-lee@t.co'));
  const leadOff = await User.create(person('Liv', 'Elsewhere', 'home-liv@t.co'));
  for (const u of [leadOn, leadOff]) {
    await Membership.create({ userId: u._id, organizationId: home.org._id, role: 'lead', isActive: true });
  }
  await CampaignManager.create({ organizationId: home.org._id, campaignId: home.campaign._id, userId: leadOn._id });
  await CampaignManager.create({ organizationId: home.org._id, campaignId: otherCampaign._id, userId: leadOff._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    dora,
    home,
    former,
    outside,
    zulu,
    otherCampaign,
    leadOnTok: signUserToken(leadOn),
    leadOffTok: signUserToken(leadOff),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (tok, orgId, path) => {
  const res = await fetch(`${base}/api/admin/reports${path}`, {
    headers: { Authorization: `Bearer ${tok}`, 'X-Org-Id': String(orgId) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // CSV routes answer text
  }
  return { status: res.status, json, text };
};

// What each of the eight surfaces calls Dora, read as `tok` in org `o`, plus the contact fields the
// two drills return and every body (for the tombstone check).
const namesOnEverySurface = async (o, tok = o.adminTok) => {
  const q = `campaignId=${o.campaign._id}`;
  const dora = String(ctx.dora._id);
  const cal = String(o.cal._id);
  const get = (path) => call(tok, o.org._id, path);
  const res = {
    flags: await get(`/flags?${q}`),
    board: await get(`/canvassers?${q}`),
    timeline: await get(`/canvasser-timeline?${q}&totals=1`),
    teams: await get(`/team-breakdown?${q}`),
    tagTeams: await get(`/tag-teams?${q}&tag=Supporter`),
    summary: await get(`/canvassers/${dora}/summary?${q}`),
    responses: await get(`/canvassers/${dora}/responses?${q}`),
    answersCsv: await get(`/voters-by-answer.csv?${q}&questionKey=support&optionId=opt_s`),
    crewCsv: await get(`/canvassers.csv?${q}&coordinatorId=${dora}`),
  };
  for (const [which, r] of Object.entries(res)) assert.strictEqual(r.status, 200, `${o.org.slug}, ${which}: 200`);

  // Seeded cells hold no commas or quotes, so plain splits are safe here. Dora's row is the one
  // ending in her response id (the file's last column).
  const lines = res.answersCsv.text.split('\n');
  const head = lines[0].split(',');
  const row = (lines.find((l) => l.endsWith(`,${o.doraSurveyId}`)) || '').split(',');
  const { flags, board, timeline, teams, tagTeams, summary, responses } = res;

  return {
    names: {
      'GPS audit, flagged canvasser': flags.json.entries.find((e) => e.userId === dora)?.canvasser.name,
      'GPS audit, per-canvasser summary': flags.json.summary.byCanvasser.find((u) => u.userId === dora)?.name,
      'GPS audit, reviewer': flags.json.entries.find((e) => e.userId === cal)?.review.reviewedByName,
      'leaderboard Coordinator': board.json.find((r) => r.userId === cal)?.coordinatorName,
      'Timeline Coordinator': timeline.json.canvassers.find((r) => r.userId === cal)?.coordinatorName,
      'team-breakdown': teams.json.teams.find((t) => t.coordinatorId === dora)?.coordinatorName,
      'tag-teams': tagTeams.json.teams.find((t) => t.coordinatorId === dora)?.coordinatorName,
      summary: `${summary.json.user.firstName} ${summary.json.user.lastName}`,
      responses: `${responses.json.user.firstName} ${responses.json.user.lastName}`,
      'voters-by-answer.csv': `${row[head.indexOf('Canvasser first name')]} ${row[head.indexOf('Canvasser last name')]}`,
      'canvasser CSV crew stamp': res.crewCsv.text.match(/Crew: ([^,\n]*)/)?.[1],
    },
    contact: {
      summaryEmail: summary.json.user.email,
      summaryPhone: summary.json.user.phone,
      responsesEmail: responses.json.user.email,
    },
    bodies: Object.values(res).map((r) => r.text).join('\n'),
  };
};

// One comparison for all of them, so a failure lists every surface that got it wrong.
const assertEverySurface = (seen, expected, where) => {
  const want = Object.fromEntries(Object.keys(seen.names).map((surface) => [surface, expected]));
  assert.deepStrictEqual(seen.names, want, `${where}: every surface reads "${expected}"`);
  assert.deepStrictEqual(
    seen.contact,
    { summaryEmail: '', summaryPhone: null, responsesEmail: '' },
    `${where}: no email or phone for a deleted account`
  );
  assert.ok(!seen.bodies.includes('deleted.doorline.invalid'), `${where}: the tombstone address appears nowhere`);
  if (expected !== NAME) assert.ok(!seen.bodies.includes('Dora'), `${where}: the name appears nowhere`);
};

test('an org on the record sees the name on all eight surfaces, never an email: a membership switched off before deletion', { skip }, async () => {
  assertEverySurface(await namesOnEverySurface(ctx.home), NAME, 'home');
});

test('a former org on the record, where only her work remains, sees the name too', { skip }, async () => {
  assertEverySurface(await namesOnEverySurface(ctx.former), NAME, 'former');
});

test('an org NOT on the record reads "Deleted user" on all eight, though its ledger still carries her', { skip }, async () => {
  // No cross-org option: the outside org's admin opens her drills (her work is on their ledger), but
  // the name is not theirs to read.
  assertEverySurface(await namesOnEverySurface(ctx.outside), SCRUBBED, 'outside');
});

test('a purged record reads "Deleted user" on all eight, in every org it listed', { skip }, async () => {
  // Only purgedAt moves; the names stay on the record, so the purge flag alone has to hide them.
  await DeletedUserRecord.updateOne({ userId: ctx.dora._id }, { $set: { purgedAt: new Date() } });
  try {
    assertEverySurface(await namesOnEverySurface(ctx.home), SCRUBBED, 'home, purged');
    assertEverySurface(await namesOnEverySurface(ctx.former), SCRUBBED, 'former, purged');
  } finally {
    await DeletedUserRecord.updateOne({ userId: ctx.dora._id }, { $set: { purgedAt: null } });
  }
});

test('team labels are lead-visible: a lead on her campaign sees the name, with the same org scoping', { skip }, async () => {
  assertEverySurface(await namesOnEverySurface(ctx.home, ctx.leadOnTok), NAME, 'home, lead on her campaign');
});

test('the record is no way in: the drills still answer only for people the org or the lead carries', { skip }, async () => {
  const dora = String(ctx.dora._id);
  const ghost = String(new mongoose.Types.ObjectId());

  // zulu is on the record, but she never belonged or worked there: the same 404 as an id with no
  // account, and the crew stamp cannot name her.
  const { zulu } = ctx;
  const zq = `campaignId=${zulu.campaign._id}`;
  const missing = await call(zulu.adminTok, zulu.org._id, `/canvassers/${ghost}/summary?${zq}`);
  assert.strictEqual(missing.status, 404);
  for (const which of ['summary', 'responses']) {
    const res = await call(zulu.adminTok, zulu.org._id, `/canvassers/${dora}/${which}?${zq}`);
    assert.strictEqual(res.status, 404, `zulu admin, ${which}: a 404`);
    assert.deepStrictEqual(res.json, missing.json, `zulu admin, ${which}: indistinguishable from an id that doesn't exist`);
  }
  const zuluCsv = await call(zulu.adminTok, zulu.org._id, `/canvassers.csv?${zq}&coordinatorId=${dora}`);
  assert.ok(zuluCsv.text.includes('Crew: unknown coordinator'), 'zulu admin: the crew stamp reads unknown');
  assert.ok(!zuluCsv.text.includes('Dora'), 'zulu admin: never her name');

  // A lead in home whose only campaign she never touched: walled off like anyone else.
  const { home, otherCampaign } = ctx;
  const oq = `campaignId=${otherCampaign._id}`;
  for (const which of ['summary', 'responses']) {
    const res = await call(ctx.leadOffTok, home.org._id, `/canvassers/${dora}/${which}?${oq}`);
    assert.strictEqual(res.status, 404, `lead off her campaign, ${which}: a 404`);
  }
  const offCsv = await call(ctx.leadOffTok, home.org._id, `/canvassers.csv?${oq}&coordinatorId=${dora}`);
  assert.ok(offCsv.text.includes('Crew: unknown coordinator'), 'lead off her campaign: the crew stamp reads unknown');
  assert.ok(!offCsv.text.includes('Dora'), 'lead off her campaign: never her name');
});
