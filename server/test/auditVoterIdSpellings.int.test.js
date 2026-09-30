import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// The voter-ID spellings audit, run as the OPERATOR runs it (a child process over the real script,
// MONGODB_URI pointed at a throwaway mongod), against an organization seeded with every shape the
// report exists to find: one person under two spellings across campaigns, the same person twice in
// one campaign, a cross-STATE digits clash, a placeholder all-zero id, a letter-bearing manual id,
// two Person-directory entries that differ only by zeros, and parked early-vote / do-not-contact
// ids that match a voter only after ignoring zeros. A second, clean organization pins the
// nothing-found path and per-org scoping. Locks that the script is read-only.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/audit_svid_test node --test test/auditVoterIdSpellings.int.test.js

const { Organization } = await import('../src/models/Organization.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { VotedPendingId } = await import('../src/models/VotedPendingId.js');
const { DncPendingId } = await import('../src/models/DncPendingId.js');
const { canonicalVoterId } = await import('../src/utils/voterIdKey.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/auditVoterIdSpellings.js');

const ctx = {};
let doorNo = 0;
function hh(orgId, campaignId, state) {
  doorNo += 1;
  return {
    organizationId: orgId,
    campaignId,
    addressLine1: `${doorNo} Audit Ave`,
    city: 'Town',
    state,
    zipCode: '30342',
    normalizedAddress: `${doorNo} AUDIT AVE||TOWN|${state}|30342`,
    location: { type: 'Point', coordinates: [-84.4 + doorNo * 0.001, 33.8] },
    isActive: true,
    status: 'unknocked',
  };
}
const voter = (orgId, campaignId, householdId, svid, first, last, extra = {}) => ({
  organizationId: orgId,
  campaignId,
  householdId,
  stateVoterId: svid,
  firstName: first,
  lastName: last,
  fullName: `${first} ${last}`,
  ...extra,
});

async function audit(...flags) {
  const { stdout } = await run(process.execPath, [SCRIPT, '--json', ...flags], {
    env: { ...process.env, MONGODB_URI: URI },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
const org = (report, slug) => report.organizations.find((o) => o.slug === slug);
const campaign = (o, name) => o.campaigns.find((c) => c.name === name);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Campaign, Household, Voter, Person, VotedPendingId, DncPendingId]) await M.deleteMany({});

  const orgA = await Organization.create({ name: 'Audit Org', slug: 'audit-org', isActive: true });
  const orgB = await Organization.create({ name: 'Clean Org', slug: 'clean-org', isActive: true });
  const mk = (o, name, state) => Campaign.create({ organizationId: o._id, name, type: 'survey', state, isActive: true });
  const [ga1, ga2, tx1, fl1, ne1, gaEmpty, cleanFl] = await Promise.all([
    mk(orgA, 'GA One', 'GA'), mk(orgA, 'GA Two', 'GA'), mk(orgA, 'TX One', 'TX'), mk(orgA, 'FL One', 'FL'),
    mk(orgA, 'NE One', 'NE'), mk(orgA, 'GA Empty', 'GA'), mk(orgB, 'Clean FL', 'FL'),
  ]);
  const door = async (c) => (await Household.create(hh(orgA._id, c._id, c.state)))._id;
  const [dGa1, dGa2, dTx1, dFl1, dNe1] = await Promise.all([door(ga1), door(ga2), door(tx1), door(fl1), door(ne1)]);
  const dClean = (await Household.create(hh(orgB._id, cleanFl._id, 'FL')))._id;

  await Voter.insertMany([
    // GA One: the same person under both spellings INSIDE one campaign (a doubled import) …
    voter(orgA._id, ga1._id, dGa1, '08719967', 'Martin', 'Richenhagen', { dateOfBirth: new Date('1986-01-01') }),
    voter(orgA._id, ga1._id, dGa1, '8719967', 'Martin', 'Richenhagen', { dateOfBirth: new Date('1986-01-01') }),
    // … a padded id whose GA Two twin is spelled 9 wide, an id that clashes with a TEXAS voter's
    // digits, a placeholder, a walk-up manual id, and two ordinary padded ids.
    voter(orgA._id, ga1._id, dGa1, '05187273', 'Nancy', 'Glover'),
    voter(orgA._id, ga1._id, dGa1, '01234567', 'Alice', 'Georgia'),
    voter(orgA._id, ga1._id, dGa1, '00000000', 'Place', 'Holder'),
    voter(orgA._id, ga1._id, dGa1, 'manual:66f1a2b3c4d5e6f7a8b9c0d1', 'Walk', 'Up'),
    voter(orgA._id, ga1._id, dGa1, '12453551', 'Alejandro', 'Arango'),
    voter(orgA._id, ga1._id, dGa1, '00097985', 'Brian', 'Beckwith'),
    // GA Two: Martin again under the SAME spelling (fine), Nancy under a 9-wide spelling (mixed).
    voter(orgA._id, ga2._id, dGa2, '08719967', 'Martin', 'Richenhagen'),
    voter(orgA._id, ga2._id, dGa2, '005187273', 'Nancy', 'Glover'),
    // TX One: a different human whose digits equal Alice's without the zero.
    voter(orgA._id, tx1._id, dTx1, '1234567', 'Bob', 'Texas'),
    // FL One: nine digits, never a leading zero.
    voter(orgA._id, fl1._id, dFl1, '100123456', 'Flo', 'Rida'),
    voter(orgA._id, fl1._id, dFl1, '100123457', 'Sunny', 'Beach'),
    // NE One: plain sequential numbers, no padding — several widths and not one leading zero. That is
    // NOT damage (production's Nebraska, Connecticut and Kentucky files look like this); it is
    // exposure the other way round: a list that pads these would not match.
    voter(orgA._id, ne1._id, dNe1, '12345', 'Corn', 'Husker'),
    voter(orgA._id, ne1._id, dNe1, '234567', 'Big', 'Red'),
    voter(orgA._id, ne1._id, dNe1, '3456789', 'Platte', 'River'),
    // The clean organization.
    voter(orgB._id, cleanFl._id, dClean, '100999001', 'Neat', 'Tidy'),
    voter(orgB._id, cleanFl._id, dClean, '100999002', 'Spick', 'Span'),
  ]);

  await Person.insertMany([
    { organizationId: orgA._id, firstName: 'Martin', lastName: 'Richenhagen', svidKeys: [{ registeredState: 'GA', stateVoterId: '08719967', source: 'import' }] },
    { organizationId: orgA._id, firstName: 'Martin', lastName: 'Richenhagen', svidKeys: [{ registeredState: 'GA', stateVoterId: '8719967', source: 'import' }] },
    { organizationId: orgA._id, firstName: 'Flo', lastName: 'Rida', svidKeys: [{ registeredState: 'FL', stateVoterId: '100123456', source: 'import' }] },
    // A tombstone must not count.
    { organizationId: orgA._id, firstName: 'Old', lastName: 'Merged', mergedInto: new mongoose.Types.ObjectId(), svidKeys: [{ registeredState: 'GA', stateVoterId: '012453551', source: 'import' }] },
  ]);

  const uploadId = new mongoose.Types.ObjectId();
  await VotedPendingId.insertMany([
    { organizationId: orgA._id, campaignId: ga1._id, uploadId, stateVoterId: '5187273' }, // Nancy, stripped → by zeros
    { organizationId: orgA._id, campaignId: tx1._id, uploadId, stateVoterId: '01234567' }, // Bob in TX One, padded → by zeros (campaign-scoped, never Alice)
    { organizationId: orgA._id, campaignId: ga1._id, uploadId, stateVoterId: '99999999' }, // nobody
    { organizationId: orgA._id, campaignId: ga2._id, uploadId, stateVoterId: '8719967' }, // Martin is in GA Two only as 08719967 → by zeros
  ]);
  await DncPendingId.insertMany([
    { organizationId: orgA._id, uploadId, stateVoterId: '8719967' }, // exists under this very spelling in GA One → exact (stale)
    { organizationId: orgA._id, uploadId, stateVoterId: '012453551' }, // Alejandro, padded → by zeros
    { organizationId: orgA._id, uploadId: null, stateVoterId: '424242' }, // nobody
  ]);

  Object.assign(ctx, { orgA, orgB, ga1, ga2, tx1, fl1, ne1, gaEmpty, cleanFl, votersBefore: await Voter.countDocuments({}) });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('exposure per campaign: numeric share, widths, leading zeros, letters, placeholders', { skip }, async () => {
  const report = await audit('--org', 'audit-org');
  const a = org(report, 'audit-org');
  assert.ok(a, 'the scoped org is reported');
  assert.strictEqual(report.organizations.length, 1, '--org scopes the report to one organization');

  const ga1 = campaign(a, 'GA One');
  assert.strictEqual(ga1.state, 'GA');
  assert.strictEqual(ga1.voters, 8);
  assert.strictEqual(ga1.numeric, 6, 'numeric excludes the all-zero placeholder and the manual id');
  assert.strictEqual(ga1.letters, 1);
  assert.strictEqual(ga1.allZero, 1);
  assert.strictEqual(ga1.startsWithZero, 4, '08719967, 05187273, 01234567, 00097985');
  assert.deepStrictEqual(ga1.widths, { 7: 1, 8: 5 });
  assert.strictEqual(ga1.mixedWidths, true, 'one 7-wide row among 8-wide rows is the doubled-import tell');
  assert.strictEqual(ga1.widestNumeric, 8);
  assert.strictEqual(ga1.shorterRows, 1);
  assert.strictEqual(ga1.padding, 'mixed', 'zeros present AND a shorter row: the one real finding');
  assert.strictEqual(ga1.exposed, true);

  const fl1 = campaign(a, 'FL One');
  assert.strictEqual(fl1.startsWithZero, 0);
  assert.strictEqual(fl1.mixedWidths, false);
  assert.deepStrictEqual(fl1.widths, { 9: 2 });
  assert.strictEqual(fl1.padding, 'uniform');
  assert.strictEqual(fl1.exposed, false, 'one width, no zeros: a spelling cannot differ');

  const ne1 = campaign(a, 'NE One');
  assert.deepStrictEqual(ne1.widths, { 5: 1, 6: 1, 7: 1 });
  assert.strictEqual(ne1.startsWithZero, 0);
  assert.strictEqual(ne1.padding, 'unpadded', 'several widths and no zeros is plain numbering, not damage');
  assert.strictEqual(ne1.exposed, true, 'a list that pads these would not match');

  const empty = campaign(a, 'GA Empty');
  assert.ok(empty, 'a campaign with no voters yet is still listed');
  assert.strictEqual(empty.voters, 0);
  assert.strictEqual(empty.padding, 'empty');
  assert.strictEqual(empty.exposed, false);

  assert.strictEqual(campaign(a, 'GA Two').padding, 'mixed', '08719967 (8 wide) next to 005187273 (9 wide)');
});

test('one person under two spellings across campaigns, with the CHECK and STOP flags', { skip }, async () => {
  const a = org(await audit('--org', 'audit-org'), 'audit-org');
  assert.strictEqual(a.mixedSpellings.count, 3, 'Martin (08719967/8719967), Nancy (05187273/005187273), Alice-vs-Bob (01234567/1234567)');
  const byCanon = new Map(a.mixedSpellings.samples.map((s) => [s.canon, s]));

  const martin = byCanon.get('8719967');
  assert.deepStrictEqual([...martin.spellings].sort(), ['08719967', '8719967']);
  assert.strictEqual(martin.rows, 3, 'two rows in GA One plus one in GA Two');
  assert.strictEqual(martin.differentPerson, false);
  assert.strictEqual(martin.crossState, false);

  const nancy = byCanon.get('5187273');
  assert.deepStrictEqual([...nancy.spellings].sort(), ['005187273', '05187273']);
  assert.strictEqual(nancy.differentPerson, false);

  const clash = byCanon.get('1234567');
  assert.strictEqual(clash.crossState, true, 'GA One and TX One');
  assert.strictEqual(clash.differentPerson, true, 'Alice Georgia vs Bob Texas');
  assert.deepStrictEqual([...clash.states].sort(), ['GA', 'TX']);
  assert.strictEqual(a.mixedSpellings.crossState, 1);
  assert.strictEqual(a.mixedSpellings.differentPerson, 1);
});

test('the same person twice inside one campaign is reported per campaign', { skip }, async () => {
  const a = org(await audit('--org', 'audit-org'), 'audit-org');
  assert.strictEqual(a.inCampaignTwins.count, 1);
  const t = a.inCampaignTwins.samples[0];
  assert.strictEqual(t.campaignId, String(ctx.ga1._id));
  assert.strictEqual(t.canon, '8719967');
  assert.strictEqual(t.rows, 2);
});

test('person-directory keys that would collide once zeros are ignored (tombstones excluded)', { skip }, async () => {
  const a = org(await audit('--org', 'audit-org'), 'audit-org');
  assert.strictEqual(a.personClashes.count, 1);
  assert.strictEqual(a.personClashes.samples[0].state, 'GA');
  assert.strictEqual(a.personClashes.samples[0].persons.length, 2);
});

test('parked ids: by-zeros vs exact vs unmatched, early-vote per campaign, do-not-contact org-wide', { skip }, async () => {
  const a = org(await audit('--org', 'audit-org'), 'audit-org');
  assert.deepStrictEqual(
    { parked: a.parked.voted.parked, byZeros: a.parked.voted.byZeros, exact: a.parked.voted.exact, unmatched: a.parked.voted.unmatched },
    { parked: 4, byZeros: 3, exact: 0, unmatched: 1 }
  );
  const txSample = a.parked.voted.samples.find((s) => s.parked === '01234567');
  assert.strictEqual(txSample.campaignId, String(ctx.tx1._id));
  assert.deepStrictEqual(txSample.matches, [{ campaignId: String(ctx.tx1._id), spellings: ['1234567'] }], 'campaign-scoped: Bob, never Alice in GA One');
  assert.deepStrictEqual(a.parked.voted.byCampaign[String(ctx.ga1._id)], { parked: 2, byZeros: 1, exact: 0, unmatched: 1 });
  assert.deepStrictEqual(a.parked.voted.byCampaign[String(ctx.tx1._id)], { parked: 1, byZeros: 1, exact: 0, unmatched: 0 });
  assert.deepStrictEqual(a.parked.voted.byCampaign[String(ctx.ga2._id)], { parked: 1, byZeros: 1, exact: 0, unmatched: 0 });

  assert.deepStrictEqual(
    { parked: a.parked.dnc.parked, byZeros: a.parked.dnc.byZeros, exact: a.parked.dnc.exact, unmatched: a.parked.dnc.unmatched },
    { parked: 3, byZeros: 1, exact: 1, unmatched: 1 }
  );
  assert.strictEqual(a.parked.dnc.samples[0].parked, '012453551');
});

test('a clean organization reports nothing, and the unscoped run covers every organization', { skip }, async () => {
  const report = await audit();
  assert.strictEqual(report.organizations.length, 2);
  const b = org(report, 'clean-org');
  assert.strictEqual(b.mixedSpellings.count, 0);
  assert.strictEqual(b.inCampaignTwins.count, 0);
  assert.strictEqual(b.personClashes.count, 0);
  assert.strictEqual(b.parked.voted.parked, 0);
  assert.strictEqual(b.parked.dnc.parked, 0);
  assert.strictEqual(campaign(b, 'Clean FL').startsWithZero, 0);
  assert.strictEqual(campaign(b, 'Clean FL').padding, 'uniform');
  assert.strictEqual(b.campaigns.some((c) => c.exposed), false);
});

test('the aggregation twin of canonicalVoterId agrees with it on every seeded spelling', { skip }, async () => {
  const a = org(await audit('--org', 'audit-org'), 'audit-org');
  for (const s of a.mixedSpellings.samples) {
    for (const spelling of s.spellings) assert.strictEqual(canonicalVoterId(spelling), s.canon, `${spelling} → ${s.canon}`);
  }
  // All-zero and the manual id never form a group.
  const canons = a.mixedSpellings.samples.map((s) => s.canon);
  assert.ok(!canons.includes(null) && !canons.includes('0'));
});

test('the script writes nothing and rejects an unknown organization slug', { skip }, async () => {
  assert.strictEqual(await Voter.countDocuments({}), ctx.votersBefore);
  await assert.rejects(audit('--org', 'no-such-org'), (err) => err.code === 1 && /No organization with slug/.test(err.stderr));
});
