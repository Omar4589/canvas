import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// One live pass per walk list, enforced by the unique partial index one_live_pass_per_walk_list
// (models/Pass.js; docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.12), over a throwaway mongod:
//   npm run test:int -- test/liveIndex.int.test.js
//
// Production has autoIndex off, so the index ships through `npm run migrate:build-indexes`, which
// decides "missing" by key pattern alone — the reason the key is {status, effortId} and not the
// {effortId} that already exists. So this runs the REAL script's dry run against a database without
// the index, as the owner's console does. Then the index itself: a second live pass on one walk list
// is refused, and live passes with no walk list (from before walk lists) never collide on null. And
// the test preload (scripts/testIndexPreload.mjs) builds it before any fixture with the model's exact
// spec — the suites §C.12 fixed lean on that, and a drifted copy would fail the model's own build.

const { Organization } = await import('../src/models/Organization.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { ReportShareLink, REPORT_ONE_LINK_GUARD } = await import('../src/models/ReportShareLink.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const BUILD_INDEXES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/buildIndexes.js');
const NAME = 'one_live_pass_per_walk_list';

const ctx = {};
const declared = () => Pass.schema.indexes().find(([, opts]) => opts?.name === NAME);
const onFile = async () => (await Pass.collection.indexes()).find((i) => i.name === NAME) || null;

// The real script, as the console runs it — no preload in the child, so it sees the database as is.
const buildIndexesDryRun = async () => {
  const { stdout } = await run(process.execPath, [BUILD_INDEXES], {
    env: { ...process.env, MONGODB_URI: URI },
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.match(stdout, /mode: DRY RUN/);
  return stdout;
};
// The Pass block of its listing: the heading, then one "   + {keys} {options}" line per missing index.
const passListing = (stdout) => {
  const lines = stdout.split('\n');
  const at = lines.findIndex((l) => l.startsWith('Pass (passes)'));
  if (at === -1) return '';
  const end = lines.findIndex((l, i) => i > at && !l.startsWith('   +'));
  return lines.slice(at, end === -1 ? undefined : end).join('\n');
};

const pass = (effortId, n, status, extra = {}) =>
  Pass.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId, roundNumber: n, name: `Pass ${n}`, status, ...extra,
  });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // Let the model's own background build settle first: it must not rebuild the index behind a test
  // that drops it.
  await Pass.init().catch(() => {});
  await mongoose.connection.dropDatabase();
  ctx.org = await Organization.create({ name: 'Index Org', slug: 'index-org', isActive: true });
  ctx.campaign = await Campaign.create({ organizationId: ctx.org._id, name: 'Index C', type: 'survey', state: 'TX', isActive: true });
  ctx.north = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, name: 'North' });
  ctx.south = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, name: 'South' });
});

after(async () => {
  if (!URI) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('the test preload builds the index before any fixture, with exactly the model\'s spec', { skip }, async () => {
  const [keys, opts] = declared();
  const ix = await onFile();
  assert.ok(ix, 'present right after the database was dropped — the preload rebuilt it');
  assert.deepStrictEqual(ix.key, keys);
  assert.strictEqual(ix.unique, true);
  assert.strictEqual(opts.unique, true);
  assert.deepStrictEqual(ix.partialFilterExpression, opts.partialFilterExpression);
  assert.deepStrictEqual(opts.partialFilterExpression, { status: 'active', effortId: { $type: 'objectId' } });
});

// The preload's other enforced index, the client-report-links session's: same check, so its copy of
// the spec can't drift from the model's either.
test('the test preload builds the one-link-per-report guard too, with exactly the model\'s spec', { skip }, async () => {
  const { keys, options } = REPORT_ONE_LINK_GUARD;
  const declaredGuard = ReportShareLink.schema.indexes().find(([, o]) => o?.name === options.name);
  assert.ok(declaredGuard, 'the model declares it');
  const ix = (await ReportShareLink.collection.indexes()).find((i) => i.name === options.name);
  assert.ok(ix, 'present right after the database was dropped — the preload rebuilt it');
  assert.deepStrictEqual(ix.key, { ...keys });
  assert.strictEqual(ix.unique, true);
  assert.deepStrictEqual(ix.partialFilterExpression, { ...options.partialFilterExpression });
});

test('migrate:build-indexes (the real script) lists the index as missing on a database without it, and not once built', { skip }, async () => {
  await Pass.collection.dropIndex(NAME);
  assert.strictEqual(await onFile(), null);
  const missing = passListing(await buildIndexesDryRun());
  assert.match(missing, /^Pass \(passes\) — MISSING/, 'the Pass model is listed');
  const line = missing.split('\n').find((l) => l.includes(`"name":"${NAME}"`));
  assert.ok(line, `the dry run names ${NAME}:\n${missing}`);
  assert.ok(line.startsWith('   + {"status":1,"effortId":1} '), 'under its own key pattern');
  assert.match(line, /"unique":true/);
  assert.match(line, /"partialFilterExpression":\{"status":"active","effortId":\{"\$type":"objectId"\}\}/);
  assert.strictEqual(await onFile(), null, 'a dry run builds nothing');

  // Built (as --apply would, from the model's declaration), the next dry run no longer lists it.
  const [keys, opts] = declared();
  await Pass.collection.createIndex(keys, opts);
  assert.ok(await onFile());
  assert.ok(!(await buildIndexesDryRun()).includes(`"name":"${NAME}"`), 'built: not listed again');
});

test('a second live pass on one walk list is refused; drafts, archived passes and other walk lists are not', { skip }, async () => {
  const live = await pass(ctx.north._id, 1, 'active', { activatedAt: new Date() });
  await assert.rejects(pass(ctx.north._id, 2, 'active', { activatedAt: new Date() }), (err) => {
    assert.strictEqual(err.code, 11000);
    assert.match(err.message, new RegExp(NAME));
    return true;
  });
  // Turning a draft live beside it is refused the same way — the path an activation or Bring back takes.
  const draft = await pass(ctx.north._id, 3, 'draft');
  await assert.rejects(Pass.updateOne({ _id: draft._id }, { $set: { status: 'active' } }), (err) => err.code === 11000);
  assert.strictEqual((await Pass.findById(draft._id).lean()).status, 'draft', 'nothing changed');
  // The partial filter covers live passes only: an ended pass and a draft sit beside the live one.
  await pass(ctx.north._id, 4, 'archived', { archivedAt: new Date(), archivedFrom: 'active', archivedVia: 'next-pass' });
  await pass(ctx.north._id, 5, 'draft');
  // Another walk list has its own live pass.
  await pass(ctx.south._id, 1, 'active', { activatedAt: new Date() });
  assert.strictEqual(await Pass.countDocuments({ status: 'active' }), 2, 'one live pass per walk list');
  // Once the live one ends, the next can go live.
  await Pass.updateOne({ _id: live._id }, { $set: { status: 'archived', archivedAt: new Date() } });
  await Pass.updateOne({ _id: draft._id }, { $set: { status: 'active' } });
  assert.strictEqual((await Pass.findById(draft._id).lean()).status, 'active');
});

test('live passes with no walk list (from before walk lists) never collide — the $type filter leaves them out', { skip }, async () => {
  // Raw inserts: the model requires effortId today; older data doesn't have one.
  const base = { organizationId: ctx.org._id, campaignId: ctx.campaign._id, status: 'active', activatedAt: new Date('2025-06-01T00:00:00Z') };
  await Pass.collection.insertMany([
    { ...base, roundNumber: 1, name: 'Legacy 1' },
    { ...base, roundNumber: 2, name: 'Legacy 2' },
    { ...base, roundNumber: 3, name: 'Legacy 3', effortId: null },
  ]);
  assert.strictEqual(await Pass.collection.countDocuments({ status: 'active', effortId: { $not: { $type: 'objectId' } } }), 3);
  // And the index still builds over them.
  await Pass.collection.dropIndex(NAME);
  const [keys, opts] = declared();
  await Pass.collection.createIndex(keys, opts);
  assert.ok(await onFile());
});
