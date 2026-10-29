import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// repair:archived-walk-lists (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.11) over a throwaway mongod:
//   npm run test:int -- test/repairArchivedWalkLists.int.test.js
//
// The states it repairs can't be made any more — the one_live_pass_per_walk_list index refuses two
// live passes on a walk list, and archiving ends the live pass — so this drops the index and writes
// them as data from before the change: walk lists archived with their pass still live, in an
// archived campaign too, and walk lists holding two live passes. Pins that the dry run lists them
// grouped by organization (internal first) with counts and never a canvasser's name; that --apply
// ends every listed pass the way an archive would (the walk list's own archive date kept, Unarchive
// offered the pass last activated, a History row per pass) and keeps the latest of an open walk
// list's live passes; that a walk list someone is changing is skipped and named; that a re-run
// finishes and a third finds nothing; and that the index then builds.

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { repairArchivedWalkLists } = await import('../src/migrations/repairArchivedWalkLists.js');
const { archiveWalkList, unarchiveWalkList, walkListUnarchivePreview } = await import('../src/services/passes/passLifecycle.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/repairArchivedWalkLists.js');
const INDEX = 'one_live_pass_per_walk_list';

const NOW = new Date('2026-10-28T15:00:00Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW.getTime() - days * DAY);
// A walk list archived before archivedAt existed has none; this one carries a date, which must stay.
const WEST_ARCHIVED_AT = new Date('2026-09-01T12:00:00Z');

const ctx = {};
const linesOf = async (opts) => {
  const lines = [];
  const out = await repairArchivedWalkLists({ now: NOW, log: (l = '') => lines.push(...String(l).split('\n')), ...opts });
  return { out, lines, text: lines.join('\n') };
};
const lineFor = (lines, needle) => lines.find((l) => l.includes(needle)) || '';
const statusOf = async (p) => (await Pass.findById(p._id).lean()).status;
const indexBuilds = async () => {
  const [keys, opts] = Pass.schema.indexes().find(([, o]) => o?.name === INDEX);
  await Pass.collection.createIndex(keys, opts);
  await Pass.collection.dropIndex(INDEX);
};

let spot = 0;
const walkList = (campaign, name, extra = {}) =>
  Effort.create({ organizationId: campaign.organizationId, campaignId: campaign._id, name, ...extra });
const pass = (effort, n, status, extra = {}) =>
  Pass.create({
    organizationId: effort.organizationId, campaignId: effort.campaignId, effortId: effort._id, roundNumber: n,
    name: extra.name || `Pass ${n}`, status, ...extra,
  });
// `count` published books on the pass, one door each, assigned round-robin; each door knocked
// `knockedDaysAgo` before NOW when given.
const books = async (p, count, people, knockedDaysAgo = null) => {
  for (let i = 0; i < count; i += 1) {
    spot += 1;
    const door = await Household.create({
      organizationId: p.organizationId, campaignId: p.campaignId, effortId: p.effortId,
      addressLine1: `${spot} Repair Rd`, city: 'Town', state: 'TX', zipCode: '75701',
      normalizedAddress: `${spot} REPAIR RD|TOWN|TX|75701`,
      location: { type: 'Point', coordinates: [-95.3 + spot * 0.001, 32.35] }, isActive: true, status: 'unknocked',
    });
    const book = await Turf.create({
      organizationId: p.organizationId, campaignId: p.campaignId, passId: p._id, name: `Book ${spot}`,
      mode: 'manual', status: 'published', householdIds: [door._id], doorCount: 1,
    });
    const user = people[i % people.length];
    await TurfAssignment.create({ organizationId: p.organizationId, campaignId: p.campaignId, passId: p._id, turfId: book._id, userId: user._id });
    if (knockedDaysAgo !== null) {
      await CanvassActivity.create({
        organizationId: p.organizationId, campaignId: p.campaignId, householdId: door._id, effortId: p.effortId, passId: p._id,
        userId: user._id, actionType: 'not_home', location: { lat: 32.35, lng: -95.3, accuracy: 5 }, timestamp: ago(knockedDaysAgo),
      });
    }
  }
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // The model's own background index build must settle before the index is dropped below, or it
  // could land behind the fixtures it is meant to refuse.
  await Pass.init().catch(() => {});
  await mongoose.connection.dropDatabase();
  await Pass.collection.dropIndex(INDEX);

  const people = await User.insertMany(
    [['Zelda', 'Quillfeather'], ['Ottoline', 'Brackenbury'], ['Barnaby', 'Wolfendale']].map(([firstName, lastName], i) => ({
      firstName, lastName, email: `repair${i}@private.test`, passwordHash: 'x', isActive: true,
    }))
  );
  ctx.people = people;

  // Named to sort LAST alphabetically: internal organizations still come first.
  const zeta = await Organization.create({ name: 'Zeta Internal', slug: 'zeta-internal', isActive: true, isInternal: true });
  const acme = await Organization.create({ name: 'Acme Strategies', slug: 'acme', isActive: true });
  const beta = await Organization.create({ name: 'Beta Field Co', slug: 'beta', isActive: true });
  const campaign = (org, name, extra = {}) =>
    Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'TX', isActive: true, ...extra });

  // Internal: the split leftover "Main", archived with Pass 1 live and knocked yesterday; "North" is
  // a healthy open walk list and must never appear.
  const alpha = await campaign(zeta, 'Alpha');
  ctx.main = await walkList(alpha, 'Main', { status: 'archived' });
  ctx.mainP1 = await pass(ctx.main, 1, 'active', { activatedAt: ago(20) });
  await books(ctx.mainP1, 2, people.slice(0, 2), 1);
  ctx.north = await walkList(alpha, 'North');
  ctx.northP1 = await pass(ctx.north, 1, 'active', { activatedAt: ago(10) });
  await books(ctx.northP1, 1, people.slice(2), 0);

  // A customer's ARCHIVED campaign: "West" archived (with a recorded date) and Pass 2 · GOTV still live.
  ctx.oldRace = await campaign(acme, 'Old Race', { isActive: false, archivedAt: ago(5) });
  ctx.west = await walkList(ctx.oldRace, 'West', { status: 'archived', archivedAt: WEST_ARCHIVED_AT });
  ctx.westP1 = await pass(ctx.west, 1, 'archived', { activatedAt: ago(60), archivedAt: ago(45) });
  ctx.westP2 = await pass(ctx.west, 2, 'active', { name: 'GOTV', activatedAt: ago(45) });
  await books(ctx.westP2, 3, people, 10);

  // The same customer's live campaign: "South" open with two live passes (Pass 2 · Re-knock went live
  // last), and "East" archived with two live passes (Pass 3 last activated, though created first).
  // A lit drop: a pass can come back without a survey on the campaign.
  const mayor = await campaign(acme, 'Mayor', { type: 'lit_drop' });
  ctx.mayor = mayor;
  ctx.south = await walkList(mayor, 'South');
  ctx.southP1 = await pass(ctx.south, 1, 'active', { activatedAt: ago(9) });
  ctx.southP2 = await pass(ctx.south, 2, 'active', { name: 'Re-knock', activatedAt: ago(4), lastActivatedAt: ago(4) });
  ctx.east = await walkList(mayor, 'East', { status: 'archived' });
  ctx.eastP3 = await pass(ctx.east, 3, 'active', { activatedAt: ago(30), lastActivatedAt: ago(6) });
  ctx.eastP2 = await pass(ctx.east, 2, 'active', { activatedAt: ago(15) });

  // Another customer, mid-change: "Central" has its lifecycle lock held, "Docks" its pass's recut lock.
  const county = await campaign(beta, 'County');
  ctx.central = await walkList(county, 'Central', { status: 'archived', lifecycleLock: { lockedAt: new Date(), token: 'someone' } });
  ctx.centralP1 = await pass(ctx.central, 1, 'active', { activatedAt: ago(30) });
  ctx.docks = await walkList(county, 'Docks', { status: 'archived' });
  ctx.docksP1 = await pass(ctx.docks, 1, 'active', { activatedAt: ago(30), recutLock: { lockedAt: new Date(), lockedBy: null, token: 'job-1' } });

  // Live passes from before walk lists existed: counted, left alone.
  const legacy = { organizationId: beta._id, campaignId: county._id, status: 'active', activatedAt: ago(400) };
  await Pass.collection.insertMany([
    { ...legacy, roundNumber: 91, name: 'Legacy 1' },
    { ...legacy, roundNumber: 92, name: 'Legacy 2', effortId: null },
  ]);
  ctx.passCount = await Pass.countDocuments();
});

after(async () => {
  if (!URI) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('the fixture is the state the index refuses to build over', { skip }, async () => {
  await assert.rejects(indexBuilds(), (err) => err.code === 11000);
});

test('dry run: grouped by organization, internal first; counts, pass names, archived campaigns — and never a canvasser\'s name', { skip }, async () => {
  const { out, lines, text } = await linesOf({});

  // Organizations: internal first though it sorts last by name; then customers, and campaigns, by name.
  const at = (s) => lines.indexOf(s);
  assert.strictEqual(lines[2], 'Zeta Internal (internal)', text);
  assert.ok(at('Acme Strategies') > 2 && at('Acme Strategies') < at('Beta Field Co'), text);
  assert.ok(at('  Campaign "Old Race" (archived campaign)') > at('  Campaign "Mayor"'), 'an archived campaign is listed, and flagged');
  assert.ok(at('  Campaign "Mayor"') > at('Acme Strategies'));

  assert.strictEqual(
    lineFor(lines, '"Main"').trim(),
    `Archived walk list "Main": Pass 1 still live; 2 published books; fewer than 3 canvassers assigned; last knock ${ago(1).toISOString().slice(0, 10)}; knocked in the last 2 days`
  );
  assert.strictEqual(
    lineFor(lines, '"West"').trim(),
    `Archived walk list "West": Pass 2 · GOTV still live; 3 published books; 3 canvassers assigned; last knock ${ago(10).toISOString().slice(0, 10)}`
  );
  assert.strictEqual(lineFor(lines, '"East"').trim(), 'Archived walk list "East": Pass 3 and Pass 2 still live; 0 published books; 0 canvassers assigned; no knocks yet');
  assert.strictEqual(lineFor(lines, '"South"').trim(), 'Walk list "South": 2 live passes; Pass 2 · Re-knock stays live (started most recently); Pass 1 ends');
  assert.ok(lineFor(lines, '"Central"').includes('Pass 1 still live'));
  assert.ok(lineFor(lines, '"Docks"').includes('Pass 1 still live'));
  assert.ok(!text.includes('North'), 'a healthy walk list is not listed');

  assert.ok(lines.includes('Archived walk lists with a live pass: 5 (1 knocked in the last 2 days).'), text);
  assert.ok(lines.includes('Walk lists with two or more live passes: 2 (1 of them archived).'), text);
  assert.ok(lines.includes('Live passes with no walk list: 2 — left alone (the one-live-pass index skips them).'), text);
  assert.ok(lines.includes('Live passes to end: 7, on 6 walk lists in 3 organizations.'), text);
  assert.match(text, /Dry run — nothing written/);
  assert.strictEqual(out.walkLists.length, 6);

  // Counts only: no canvasser's name or email reaches the console.
  for (const u of ctx.people) {
    for (const s of [u.firstName, u.lastName, u.email]) assert.ok(!text.includes(s), `"${s}" never printed`);
  }

  // Nothing written: 9 live passes on walk lists, 2 without one.
  assert.strictEqual(await Pass.countDocuments({ status: 'active' }), 11);
  assert.strictEqual(await CampaignChange.countDocuments(), 0);
  assert.strictEqual((await Effort.findById(ctx.main._id).lean()).endedPassId, null);
});

test('--campaign scopes the listing and the apply to one campaign', { skip }, async () => {
  const { out, text } = await linesOf({ campaignId: ctx.oldRace._id, apply: true });
  assert.deepStrictEqual(out.walkLists.map((w) => w.effort.name), ['West']);
  assert.ok(!text.includes('Main') && !text.includes('South'));
  assert.deepStrictEqual(out.ended.map((e) => String(e.pass._id)), [String(ctx.westP2._id)]);
  assert.match(text, /Acme Strategies \/ Old Race \/ West: ended Pass 2 · GOTV/);
  assert.strictEqual(await statusOf(ctx.mainP1), 'active', 'another campaign untouched');
  assert.strictEqual(await Pass.countDocuments({ status: 'active' }), 10);
});

test('--apply ends every listed pass, keeps the latest of an open walk list, skips what is locked — and writes History', { skip }, async () => {
  const walkListFields = async () =>
    (await Effort.find({}, { name: 1, status: 1, archivedAt: 1 }).sort({ name: 1 }).lean()).map((e) => [e.name, e.status, e.archivedAt?.toISOString() ?? null]);
  const before = await walkListFields();
  const { out, lines, text } = await linesOf({ apply: true });

  // Archived walk lists: every live pass ended, as the one-time check; Unarchive offers the latest.
  for (const p of [ctx.mainP1, ctx.eastP3, ctx.eastP2]) {
    const doc = await Pass.findById(p._id).lean();
    assert.strictEqual(doc.status, 'archived', `${doc.name} ended`);
    assert.strictEqual(doc.archivedVia, 'repair');
    assert.strictEqual(doc.archivedFrom, 'active');
    assert.strictEqual(doc.archivedBy, null);
    assert.ok(doc.archivedAt instanceof Date);
  }
  assert.strictEqual(String((await Effort.findById(ctx.main._id).lean()).endedPassId), String(ctx.mainP1._id));
  assert.strictEqual(String((await Effort.findById(ctx.east._id).lean()).endedPassId), String(ctx.eastP3._id), 'the pass last activated');
  // ...and it ended last: Pass 2, from before lastActivatedAt, counts as live until it ended, so ended
  // after Pass 3 it would block Pass 3 from ever coming back (rule 4b). With no books, as a draft.
  const eastPreview = await walkListUnarchivePreview({
    campaign: await Campaign.findById(ctx.mayor._id).lean(),
    effort: await Effort.findById(ctx.east._id).lean(),
  });
  assert.strictEqual(eastPreview.endedPass?.bringBack.ok, true, JSON.stringify(eastPreview.endedPass));
  assert.strictEqual(eastPreview.endedPass.bringBack.to, 'draft');

  // The earlier scoped run's walk list, in an archived campaign: its own archive date kept, the
  // campaign still archived, Unarchive offers Pass 2 back.
  const west = await Effort.findById(ctx.west._id).lean();
  assert.strictEqual(west.status, 'archived');
  assert.strictEqual(west.archivedAt.getTime(), WEST_ARCHIVED_AT.getTime());
  assert.strictEqual(String(west.endedPassId), String(ctx.westP2._id));
  assert.strictEqual((await Campaign.findById(ctx.oldRace._id).lean()).isActive, false);
  assert.strictEqual((await Effort.findById(ctx.main._id).lean()).archivedAt, null, 'an archive from before the change keeps no date');

  // The open walk list keeps its latest live pass, and stays open.
  assert.strictEqual(await statusOf(ctx.southP1), 'archived');
  const southP2 = await Pass.findById(ctx.southP2._id).lean();
  assert.strictEqual(southP2.status, 'active');
  assert.strictEqual(southP2.archivedVia, null);
  const south = await Effort.findById(ctx.south._id).lean();
  assert.strictEqual(south.status, 'active');
  assert.strictEqual(south.endedPassId, null);
  assert.match(text, /Acme Strategies \/ Mayor \/ South: ended Pass 1 \(Pass 2 · Re-knock stays live\)/);

  // Locked walk lists are skipped, named, and keep their pass.
  assert.strictEqual(await statusOf(ctx.centralP1), 'active');
  assert.strictEqual(await statusOf(ctx.docksP1), 'active');
  assert.deepStrictEqual(out.skipped.map((s) => [s.walkList.effort.name, s.code]).sort(), [['Central', 'lifecycle-busy'], ['Docks', 'recut-locked']]);
  assert.ok(lineFor(lines, 'Beta Field Co / County / Central: SKIPPED (lifecycle-busy)'));
  assert.ok(lineFor(lines, 'Beta Field Co / County / Docks: SKIPPED (recut-locked)'));
  assert.ok(lines.includes('2 walk lists skipped while someone was changing them — re-run to finish.'), text);

  // Untouched: the healthy walk list, the walk-list-less passes, every walk list's own fields.
  assert.strictEqual(await statusOf(ctx.northP1), 'active');
  assert.strictEqual(await Pass.collection.countDocuments({ status: 'active', effortId: { $not: { $type: 'objectId' } } }), 2);
  assert.deepStrictEqual(await walkListFields(), before, 'no walk list archived, unarchived or re-dated');
  assert.strictEqual(await Pass.countDocuments(), ctx.passCount, 'nothing deleted');
  assert.strictEqual(await Turf.countDocuments({ status: 'published' }), 6, 'books untouched');
  assert.strictEqual(await TurfAssignment.countDocuments(), 6, 'assignments untouched');

  // One History row per pass ended, by the one-time check (no actor).
  const rows = await CampaignChange.find({}).sort({ createdAt: 1 }).lean();
  assert.strictEqual(rows.length, 5, 'West (scoped run), Main, East ×2, South');
  for (const r of rows) {
    assert.strictEqual(r.field, 'passArchived');
    assert.strictEqual(r.source, 'walk_list_lifecycle');
    assert.strictEqual(r.byUserId, null);
    assert.strictEqual(r.details.outcome, 'repair');
    assert.match(r.toValue, /\(one-time check\)$/);
  }
  const west2 = rows.find((r) => r.details.walkList === 'West');
  assert.deepStrictEqual(west2.details, { walkList: 'West', pass: 'Pass 2 · GOTV', outcome: 'repair' });
  assert.strictEqual(west2.fromValue, 'West · Pass 2 · GOTV · live');
  assert.strictEqual(String(west2.campaignId), String(ctx.oldRace._id));
});

test('a re-run finishes what was skipped, a third finds nothing — and then the index builds', { skip }, async () => {
  await Effort.updateOne({ _id: ctx.central._id }, { $set: { lifecycleLock: { lockedAt: null, token: null } } });
  await Pass.updateOne({ _id: ctx.docksP1._id }, { $set: { recutLock: { lockedAt: null, lockedBy: null, token: null } } });

  const second = await linesOf({ apply: true });
  assert.deepStrictEqual(second.out.walkLists.map((w) => w.effort.name).sort(), ['Central', 'Docks']);
  assert.strictEqual(second.out.ended.length, 2);
  assert.strictEqual(second.out.skipped.length, 0);
  assert.strictEqual(await statusOf(ctx.centralP1), 'archived');
  assert.strictEqual(String((await Effort.findById(ctx.docks._id).lean()).endedPassId), String(ctx.docksP1._id));
  assert.match(second.text, /Next: npm run migrate:build-indexes/);

  const rowsBefore = await CampaignChange.countDocuments();
  const third = await linesOf({ apply: true });
  assert.strictEqual(third.out.walkLists.length, 0);
  assert.strictEqual(third.out.ended.length, 0);
  assert.ok(third.lines.includes('Nothing to repair.'), third.text);
  assert.strictEqual(await CampaignChange.countDocuments(), rowsBefore, 'no History row on a run that changes nothing');
  assert.strictEqual(await Pass.countDocuments({ status: 'active' }), 4, 'North, South\'s latest, and the two walk-list-less passes');

  await indexBuilds();
});

test('as the console runs it: the real script, a dry run after the repair, and a mistyped flag refused', { skip }, async () => {
  const env = { ...process.env, MONGODB_URI: URI };
  const { stdout } = await run(process.execPath, [SCRIPT], { env });
  assert.match(stdout, /DRY RUN — nothing is written/);
  assert.match(stdout, /Nothing to repair\./);

  // A typo must never widen an --apply to every campaign.
  for (const flags of [['--campaign=' + String(ctx.oldRace._id), '--apply'], ['--aply'], ['--campaign', 'nope', '--apply']]) {
    await assert.rejects(run(process.execPath, [SCRIPT, ...flags], { env }), (err) => {
      assert.strictEqual(err.code, 1, flags.join(' '));
      assert.match(err.stderr, /Usage: npm run repair:archived-walk-lists -- \[--campaign <id>\] \[--apply\]/);
      return true;
    });
  }
});

test('archiving a walk list that holds two live passes ends both, the offered one last — so Unarchive can bring it back', { skip }, async () => {
  const c = await Campaign.create({ organizationId: ctx.mayor.organizationId, name: 'Undo', type: 'lit_drop', state: 'TX', isActive: true });
  const w = await walkList(c, 'Twin');
  const older = await pass(w, 1, 'active', { activatedAt: ago(9) });
  const latest = await pass(w, 2, 'active', { activatedAt: ago(4) });
  await books(latest, 1, ctx.people);

  const archived = await archiveWalkList({ campaign: c, effortId: w._id, userId: null, confirm: true });
  assert.strictEqual(archived.effort.status, 'archived');
  assert.strictEqual(archived.endedPassId, String(latest._id), 'Unarchive offers the pass last activated');
  const [o, l] = await Promise.all([Pass.findById(older._id).lean(), Pass.findById(latest._id).lean()]);
  assert.strictEqual(o.archivedVia, 'walk-list');
  assert.ok(o.archivedAt < l.archivedAt, 'the offered pass ends last');

  const back = await unarchiveWalkList({ campaign: c, effortId: w._id, userId: null, bringBack: true });
  assert.strictEqual(back.broughtBack, String(latest._id), JSON.stringify(back));
  assert.strictEqual(back.to, 'active');
  assert.strictEqual(await statusOf(older), 'archived', 'only the offered pass comes back');
});

test('--apply lists a campaign being deleted but leaves it alone: its passes go with it, and no History row lands in it', { skip }, async () => {
  const c = await Campaign.create({
    organizationId: ctx.mayor.organizationId, name: 'Going', type: 'lit_drop', state: 'TX', isActive: true,
    deletion: { requestedAt: new Date(), status: 'running' },
  });
  const w = await walkList(c, 'Doomed', { status: 'archived' });
  const p = await pass(w, 1, 'active', { activatedAt: ago(3) });

  const dry = await linesOf({ campaignId: c._id });
  assert.ok(dry.lines.includes('Live passes to end: 0, on 1 walk list in 1 organization.'), dry.text);
  assert.ok(dry.lines.includes('1 walk list in campaigns being deleted: listed, not counted above — --apply leaves them to the delete.'), dry.text);

  const { out, lines, text } = await linesOf({ campaignId: c._id, apply: true });
  assert.match(lineFor(lines, 'Campaign "Going"'), /being deleted/);
  assert.deepStrictEqual(out.deleting.map((d) => d.walkList.effort.name), ['Doomed']);
  assert.strictEqual(out.ended.length, 0);
  assert.strictEqual(out.skipped.length, 0, 'not a busy walk list — a re-run would skip it again');
  assert.strictEqual(await statusOf(p), 'active');
  assert.strictEqual(await CampaignChange.countDocuments({ campaignId: c._id }), 0);
  assert.ok(lineFor(lines, 'Going / Doomed: SKIPPED — its campaign is being deleted'), text);
  assert.ok(lines.includes('1 walk list skipped in campaigns being deleted.'), text);
  assert.match(text, /Next: npm run migrate:build-indexes .* — once those deletes have finished\./);
});
