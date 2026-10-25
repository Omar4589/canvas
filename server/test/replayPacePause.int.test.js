import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// The automatic-pause season replay, run as the Heroku console would run it (docs/PROPOSAL_PACE_PAUSE.md
// §I.2): read-only, counts only, internal and deleting orgs skipped, Unknock-frozen rows merged once.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pace_replay node --test test/replayPacePause.int.test.js

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { PacePause } = await import('../src/models/PacePause.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/replayPacePause.js');
const replay = (...flags) => run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: URI }, maxBuffer: 4 * 1024 * 1024 });

const MODELS = [Organization, User, Membership, Campaign, Household, CanvassActivity, UnknockRunChunk, PacePause];
const T0 = new Date('2026-09-15T19:00:00Z').getTime(); // noon in Los Angeles
const east = (m) => ({ lat: 36, lng: -115 + m / (111320 * Math.cos((36 * Math.PI) / 180)), accuracy: 5 });

// A canvasser's day of not-homes: `gapSec` apart, `spacingM` apart.
const seedDay = async ({ name, slug, isInternal = false, deleting = false, gapSec, spacingM, doors = 12 }) => {
  const org = await Organization.create({ name, slug, isActive: true, timeZone: 'America/Los_Angeles', ...(isInternal ? { isInternal: true } : {}), ...(deleting ? { deletion: { requestedAt: new Date() } } : {}) });
  const user = await User.create({ firstName: 'Secret', lastName: `Name${slug}`, email: `${slug}@replay.test`, passwordHash: 'x', isActive: true });
  await Membership.create({ userId: user._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: `${name} C`, type: 'survey', state: 'NV', isActive: true, timeZone: 'America/Los_Angeles' });
  const rows = [];
  for (let i = 0; i < doors; i++) {
    const hh = await Household.create({ organizationId: org._id, campaignId: camp._id, addressLine1: `${i} Hidden Ln`, city: 'X', state: 'NV', zipCode: '89001', normalizedAddress: `${slug}${i}`, isActive: true });
    const at = new Date(T0 + i * gapSec * 1000);
    rows.push({ organizationId: org._id, campaignId: camp._id, householdId: hh._id, userId: user._id, actionType: 'not_home', location: east(i * spacingM), timestamp: at, createdAt: at, wasOfflineSubmission: false });
  }
  const inserted = await CanvassActivity.insertMany(rows);
  return { org, user, camp, rows: inserted };
};

let fast;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of MODELS) await M.deleteMany({});
  fast = await seedDay({ name: 'Alpha Fast', slug: 'alpha', gapSec: 8, spacingM: 120 });
  await seedDay({ name: 'Bravo Honest', slug: 'bravo', gapSec: 60, spacingM: 30 });
  await seedDay({ name: 'Demo Internal', slug: 'demo', isInternal: true, gapSec: 8, spacingM: 120 });
  await seedDay({ name: 'Zulu Deleting', slug: 'zulu', deleting: true, gapSec: 8, spacingM: 120 });
  // One of Alpha's rows also frozen by an Unknock run that was undone (live and frozen): counted once.
  await UnknockRunChunk.create({
    runId: new mongoose.Types.ObjectId(), campaignId: fast.camp._id, organizationId: fast.org._id, seq: 0,
    rows: [fast.rows[3].toObject()], visitKeys: [], frozenAt: new Date(),
  });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('counts per customer org, with small counts suppressed and nothing identifying printed', { skip }, async () => {
  const before = await Promise.all(MODELS.map((M) => M.countDocuments({})));
  const { stdout } = await replay();
  const after = await Promise.all(MODELS.map((M) => M.countDocuments({})));
  assert.deepStrictEqual(after, before, 'read-only');
  assert.match(stdout, /Alpha Fast\n {2}canvassers fewer than 3 · canvasser-days fewer than 3\n {2}would have paused: fewer than 3 time\(s\)/);
  assert.match(stdout, /Bravo Honest\n {2}canvassers fewer than 3 · canvasser-days fewer than 3\n {2}would have paused: 0 time\(s\)/);
  assert.ok(!stdout.includes('Demo Internal'), 'internal org skipped');
  assert.ok(!stdout.includes('Zulu Deleting'), 'deleting org skipped');
  for (const secret of ['Secret', 'Hidden Ln', '@replay.test', String(fast.user._id), String(fast.org._id)]) {
    assert.ok(!stdout.includes(secret), `printed ${secret}`);
  }
  assert.match(stdout, /Nothing was changed\./);
});

test('other numbers by flag, and a bad flag is refused before connecting', { skip }, async () => {
  // At 4 s a door and a 200 m/s travel allowance, Alpha's 8-second hops pass.
  const { stdout } = await replay('--door=4', '--travel=200');
  assert.match(stdout, /Rule: 4 s at a door/);
  assert.match(stdout, /Alpha Fast\n.*\n {2}would have paused: 0 time\(s\)/);
  await assert.rejects(
    run(process.execPath, [SCRIPT, '--bogus=1'], { env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/never' } }),
    (e) => e.code === 2 && /Unknown flag --bogus/.test(e.stderr)
  );
});
