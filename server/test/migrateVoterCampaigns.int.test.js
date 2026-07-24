import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

// The per-campaign voter migration, against a REAL legacy-shape dataset in a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/votermig_test node --test --test-force-exit test/migrateVoterCampaigns.int.test.js
// Seeds rows WITHOUT campaignId under the OLD unique {organizationId, stateVoterId} index
// (raw collection writes — the current schema would refuse them), runs the actual script
// twice (dry run must write nothing; --apply must backfill + swap indexes), and proves a
// post-migration overlap import works. Also locks applyImport's un-migrated guard.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-votermig';

const execFileP = promisify(execFile);

const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { applyImport } = await import('../src/services/import/csvImporter.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ctx = {};

function runScript(args = []) {
  return execFileP(
    process.execPath,
    ['src/migrations/migrateVoterCampaigns.js', ...args],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MONGODB_URI: URI } }
  );
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Subscription, Campaign, Household, Voter]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Mig Org', slug: 'mig-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Mig C', type: 'survey', state: 'IL', isActive: true });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id,
    addressLine1: '1 Mig St', city: 'Town', state: 'IL', zipCode: '62704',
    normalizedAddress: '1 MIG ST|TOWN|IL|62704',
    location: { type: 'Point', coordinates: [-89.1, 40.1] },
    isActive: true, status: 'unknocked',
  });

  // Recreate the LEGACY index state: old unique pair present, new pair absent.
  const indexes = await Voter.collection.indexes();
  for (const ix of indexes) {
    if (ix.unique && ix.key?.campaignId === 1 && ix.key?.stateVoterId === 1) {
      await Voter.collection.dropIndex(ix.name);
    }
  }
  await Voter.collection.createIndex({ organizationId: 1, stateVoterId: 1 }, { unique: true });

  // Legacy rows: NO campaignId. Raw driver writes — the current schema would refuse them,
  // which is exactly the point.
  await Voter.collection.insertMany([
    { organizationId: org._id, householdId: hh._id, stateVoterId: 'MGV1', firstName: 'Meg', lastName: 'One', fullName: 'Meg One', surveyStatus: 'not_surveyed' },
    { organizationId: org._id, householdId: hh._id, stateVoterId: 'MGV2', firstName: 'Mo', lastName: 'Two', fullName: 'Mo Two', surveyStatus: 'not_surveyed' },
  ]);

  Object.assign(ctx, { org, camp, hh });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('applyImport refuses to run against un-migrated rows', { skip }, async () => {
  await assert.rejects(
    applyImport({
      campaign: ctx.camp,
      orgId: ctx.org._id,
      validRows: [],
      householdMap: new Map(),
    }),
    /migrate:voter-campaigns/
  );
});

test('dry run reports but writes nothing', { skip }, async () => {
  const { stdout } = await runScript();
  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /Voters missing campaignId: 2/);
  assert.equal(await Voter.countDocuments({ campaignId: { $exists: false } }), 2, 'dry run must not backfill');
  const indexes = await Voter.collection.indexes();
  assert.ok(
    indexes.some((ix) => ix.unique && ix.key?.organizationId === 1 && ix.key?.stateVoterId === 1),
    'old unique index still present after dry run'
  );
});

test('--apply backfills campaignId and swaps the unique index', { skip }, async () => {
  const { stdout } = await runScript(['--apply']);
  assert.match(stdout, /backfilled 2 row/);

  assert.equal(await Voter.countDocuments({ campaignId: { $exists: false } }), 0);
  const v1 = await Voter.findOne({ stateVoterId: 'MGV1' }).lean();
  assert.equal(String(v1.campaignId), String(ctx.camp._id), 'campaignId derived from the household');

  const indexes = await Voter.collection.indexes();
  assert.ok(
    indexes.some((ix) => ix.unique && ix.key?.campaignId === 1 && ix.key?.stateVoterId === 1),
    'new unique {campaignId, stateVoterId} built'
  );
  assert.ok(
    !indexes.some((ix) => ix.unique && ix.key?.organizationId === 1 && ix.key?.stateVoterId === 1),
    'old unique pair dropped'
  );
  assert.ok(
    indexes.some((ix) => !ix.unique && ix.key?.organizationId === 1 && ix.key?.stateVoterId === 1),
    'non-unique sibling-lookup index built'
  );
});

test('a second campaign can now import the SAME person (the point of it all)', { skip }, async () => {
  const camp2 = await Campaign.create({ organizationId: ctx.org._id, name: 'Mig C2', type: 'survey', state: 'IL', isActive: true });
  await Household.create({
    organizationId: ctx.org._id, campaignId: camp2._id,
    addressLine1: '1 Mig St', city: 'Town', state: 'IL', zipCode: '62704',
    normalizedAddress: '1 MIG ST|TOWN|IL|62704',
    location: { type: 'Point', coordinates: [-89.1, 40.1] },
    isActive: true, status: 'unknocked',
  });
  // Same {campaignId} pair may not repeat; the same person ACROSS campaigns must.
  await assert.rejects(
    Voter.create({ organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: ctx.hh._id, stateVoterId: 'MGV1', firstName: 'Dup', lastName: 'Row', fullName: 'Dup Row' }),
    /E11000/
  );
  const sibling = await Voter.create({
    organizationId: ctx.org._id, campaignId: camp2._id,
    householdId: (await Household.findOne({ campaignId: camp2._id }))._id,
    stateVoterId: 'MGV1', firstName: 'Meg', lastName: 'One', fullName: 'Meg One',
  });
  assert.ok(sibling._id);
  assert.equal(await Voter.countDocuments({ organizationId: ctx.org._id, stateVoterId: 'MGV1' }), 2);
});
