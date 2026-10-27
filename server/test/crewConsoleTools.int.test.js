import { test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

// The two console tools the people-pages release runs (docs/PROPOSAL_PEOPLE_PAGES.md §B.8, §M.4),
// run as the Heroku Run console runs them, against a throwaway database:
//   · audit:team-counts lists, under each person, rows that don't count for their crew and a crew
//     change left unfinished — informational, never a failure;
//   · repair:team-stamps only reports and switches on an org's team surfaces, and points to the audit.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/consoletools node --import ./scripts/testIndexPreload.mjs --test test/crewConsoleTools.int.test.js
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const script = (name) => path.resolve(HERE, `../src/migrations/${name}.js`);
const tool = (name, ...flags) =>
  run(process.execPath, [script(name), ...flags], { env: { ...process.env, MONGODB_URI: URI }, maxBuffer: 4 * 1024 * 1024 });

const ctx = {};
let seq = 0;
const mkPerson = async (first, role = 'canvasser') => {
  const u = await User.create({ firstName: first, lastName: `C${++seq}`, email: `${first.toLowerCase()}${seq}@console.t.co`, passwordHash: 'x', isActive: true });
  await Membership.create({ userId: u._id, organizationId: ctx.org._id, role, isActive: true });
  return u;
};
const knocks = (u, coord, n) => {
  const at = new Date('2026-10-01T15:00:00Z');
  return CanvassActivity.collection.insertMany(
    Array.from({ length: n }, () => ({
      _id: new ObjectId(), organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: ctx.passId, householdId: new ObjectId(),
      userId: u._id, coordinatorId: coord ? coord._id : null, actionType: 'not_home', location: { lat: 28, lng: -81 },
      timestamp: at, createdAt: at, updatedAt: at,
    }))
  );
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  ctx.org = await Organization.create({ name: 'Console Org', slug: 'console-org', isActive: true });
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Autumn', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  ctx.passId = new ObjectId();
  ctx.dana = await mkPerson('Dana', 'lead');
  ctx.yan = await mkPerson('Yan', 'lead');
  ctx.pat = await mkPerson('Pat');
  ctx.ann = await mkPerson('Ann');
  ctx.sam = await mkPerson('Sam');
  const roster = (u, coordinatorId, extra = {}) =>
    CampaignAssignment.create({ campaignId: ctx.camp._id, userId: u._id, organizationId: ctx.org._id, coordinatorId, ...extra });
  await roster(ctx.pat, ctx.dana._id);
  await knocks(ctx.pat, ctx.dana, 2);
  await knocks(ctx.pat, ctx.yan, 3); // drift: on Dana's crew, three rows still on Yan's team
  await roster(ctx.ann, null);
  await knocks(ctx.ann, ctx.dana, 4); // what a departure leaves: no crew, doors on Dana's team
  await roster(ctx.sam, ctx.yan._id, {
    crewJob: { token: new ObjectId(), run: 'r', until: new Date(Date.now() - 60_000), from: ctx.dana._id, to: ctx.yan._id, activities: 1, surveys: 0, doors: 1, source: 'lead_crew' },
  });
  await knocks(ctx.sam, ctx.yan, 1);
  // An org that predates the team-surfaces default.
  ctx.oldOrg = await Organization.create({ name: 'Old Org', slug: 'old-org', isActive: true });
  await Organization.collection.updateOne({ _id: ctx.oldOrg._id }, { $unset: { teamAttributionReadyAt: '' } });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('audit:team-counts lists drift, a departure without a fix, and an unfinished change — and still passes', { skip }, async () => {
  const { stdout } = await tool('auditTeamCounts', `--campaign=${ctx.camp._id}`);
  const lines = stdout.split('\n');
  const after = (who) => lines.slice(lines.findIndex((l) => l.includes(`${who.firstName} ${who.lastName}`)) + 1);
  assert.match(after(ctx.pat)[0], new RegExp(`rows not on their crew: Yan C\\d+ 3 {2}· {2}open Team → Pat C\\d+ → Finish it`));
  assert.match(after(ctx.ann)[0], /rows not on their crew: Dana C\d+ 4 {2}· {2}possibly a departure; check before changing/);
  assert.match(after(ctx.sam)[0], /an unfinished crew change {2}· {2}open Team → Sam C\d+ → Finish it/);
  assert.match(stdout, /✓ Every column reconciles/);
});

test('repair:team-stamps reports an org whose team surfaces are off, refuses its old crew apply, and switches surfaces on only when asked', { skip }, async () => {
  const bare = await tool('repairTeamStamps');
  assert.match(bare.stdout, /Old Org: team surfaces are switched OFF/);
  assert.match(bare.stdout, /npm run audit:team-counts/);

  const oldApply = await tool('repairTeamStamps', '--apply');
  assert.match(oldApply.stdout, /Nothing was written/);
  assert.ok(!(await Organization.findById(ctx.oldOrg._id).lean()).teamAttributionReadyAt, 'still off');

  const on = await tool('repairTeamStamps', '--apply', '--ready-only');
  assert.match(on.stdout, /Old Org: team surfaces switched ON/);
  assert.ok((await Organization.findById(ctx.oldOrg._id).lean()).teamAttributionReadyAt);
});
