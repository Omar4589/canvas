import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// npm run report:all-reports-links (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C6), run as the operator runs it —
// a child process over the real script, MONGODB_URI pointed at a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/all_reports_links node --test test/reportAllReportsLinks.int.test.js
//
//   · per organization, its links to all your reports by state, as a client meets them — turned off, then
//     expired, then off because of billing, else still working — a link from before reportId included; on
//     how many campaigns; when one was last opened; how many of its reports have more than one link; totals;
//   · organization names and counts only — no campaign, label, token, slug, id or person;
//   · READ-ONLY: every collection, index and document is the same after a run, the profiler records reads
//     only (no insert, update, delete, collection or index build), and a database it reads that doesn't
//     exist still doesn't (autoCreate: false — autoIndex alone would create the collections).

const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/reportAllReportsLinks.js');
const { ObjectId } = mongoose.Types;
const DAY = 86400e3;

const check = (uri = URI, ...args) => run(process.execPath, [SCRIPT, ...args], { env: { ...process.env, MONGODB_URI: uri } });

// Every collection (system ones aside), its indexes and its documents, in a comparable form.
const snapshot = async (db) => {
  const out = {};
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
  for (const name of names) {
    const c = db.collection(name);
    out[name] = { indexes: await c.indexes(), docs: await c.find({}).sort({ _id: 1 }).toArray() };
  }
  return out;
};

const ctx = { secrets: [] };

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // This process's own index builds (autoIndex is on in tests) finish here, never inside the profiled run.
  await Promise.all([Organization.init(), Subscription.init(), ReportShareLink.init()]);
  await mongoose.connection.db.dropDatabase();
  const now = Date.now();
  const org = async (name, slug, status, extra = {}) => {
    const o = await Organization.create({ name, slug, isActive: true, ...extra });
    if (status) await Subscription.create({ organizationId: o._id, status });
    ctx.secrets.push(slug, String(o._id));
    return o;
  };
  const acme = await org('Acme Field Co', 'acme-field-slug', 'active');
  const blocked = await org('Blocked Org', 'blocked-org-slug', 'suspended');
  const multiOnly = await org('Multi Only Org', 'multi-only-slug', 'active');
  await org('Quiet Org', 'quiet-org-slug', 'active');
  const demo = await org('Doorline Demo', 'doorline-demo-slug', 'internal', { isInternal: true });
  const leaving = await org('Leaving Org', 'leaving-org-slug', 'active', { deletion: { requestedAt: new Date(), source: 'requested', status: 'pending' } });

  let linkN = 0;
  const link = async (o, campaignId, fields = {}) => {
    linkN += 1;
    const token = `secret-token-${linkN}`;
    const label = `Secret label ${linkN}`;
    const doc = await ReportShareLink.create({
      organizationId: o._id, campaignId, token, label, passwordHash: '$2a$04$notarealhashnotarealhashnotarealhashnotarealhash00',
      expiresAt: new Date(now + 30 * DAY), isActive: true, ...fields,
    });
    ctx.secrets.push(token, label, String(doc._id), String(campaignId));
    if (fields.reportId) ctx.secrets.push(String(fields.reportId));
    return doc;
  };
  const camp = () => new ObjectId();

  // Acme: three that still work (one made before reportId existed), one turned off, one expired, on two
  // campaigns; a report with two links of its own, another with one.
  const [a1, a2] = [camp(), camp()];
  await link(acme, a1, { lastAccessedAt: new Date('2026-10-20T15:00:00Z') });
  await link(acme, a1, { isActive: false, lastAccessedAt: new Date('2026-10-25T15:00:00Z') });
  await link(acme, a1, { expiresAt: new Date(now - DAY) });
  await link(acme, a2, { lastAccessedAt: new Date('2026-10-26T15:00:00Z') });
  const { insertedId: legacyId } = await ReportShareLink.collection.insertOne({
    organizationId: acme._id, campaignId: a2, token: 'secret-token-legacy', label: 'Secret legacy label', passwordHash: null,
    expiresAt: null, isActive: true, createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
  });
  ctx.secrets.push('secret-token-legacy', 'Secret legacy label', String(legacyId));
  const twice = new ObjectId();
  await link(acme, a1, { reportId: twice });
  await link(acme, a1, { reportId: twice, oneLinkGuard: true });
  await link(acme, a2, { reportId: new ObjectId(), oneLinkGuard: true });

  // Blocked (suspended): an active, unexpired link is off because of billing; an expired one reads expired
  // and a turned-off one turned off, whatever the billing.
  const b1 = camp();
  await link(blocked, b1);
  await link(blocked, b1, { expiresAt: new Date(now - DAY) });
  await link(blocked, b1, { isActive: false });

  // Multi Only: no links to all its reports, three reports' links of their own — two reports with more than one.
  const [m1, m2] = [new ObjectId(), new ObjectId()];
  for (const r of [m1, m1, m1, m2, m2, new ObjectId()]) await link(multiOnly, camp(), { reportId: r });

  await link(demo, camp());
  await link(leaving, camp());
  // A link whose organization is gone.
  await link({ _id: new ObjectId() }, camp());
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('counts each organization’s links to all your reports by state — names and counts only', { skip }, async () => {
  const { stdout } = await check();
  assert.strictEqual(
    stdout,
    [
      'Old links to all your reports, by organization (read-only; organization names and counts only)',
      '',
      'Acme Field Co',
      '  5 links to all your reports: 3 still working · 0 off because of billing · 1 turned off · 1 expired',
      '  on 2 campaigns · last opened 2026-10-26',
      '  1 report with more than one link',
      '',
      'Doorline Demo (Doorline internal)',
      '  1 link to all your reports: 1 still working · 0 off because of billing · 0 turned off · 0 expired',
      '  on 1 campaign · never opened',
      '',
      'Leaving Org (being deleted)',
      '  1 link to all your reports: 1 still working · 0 off because of billing · 0 turned off · 0 expired',
      '  on 1 campaign · never opened',
      '',
      'Blocked Org',
      '  3 links to all your reports: 0 still working · 1 off because of billing · 1 turned off · 1 expired',
      '  on 1 campaign · never opened',
      '',
      'Multi Only Org',
      '  no links to all your reports',
      '  2 reports with more than one link',
      '',
      'All organizations: 4 organizations with links to all your reports · 10 links: 5 still working · 1 off because of billing · 2 turned off · 2 expired · on 5 campaigns',
      '3 reports with more than one link, in 2 organizations',
      'Not counted above: 1 link to all your reports in an organization that no longer exists.',
      'Nothing was changed.',
      '',
    ].join('\n')
  );
  assert.ok(!stdout.includes('Quiet Org'), 'an organization without such links isn’t listed');
  for (const secret of ctx.secrets) assert.ok(!stdout.includes(secret), `printed ${secret}`);
});

test('read-only: no collection, index or document changes, the profiler sees reads only, and a missing database stays missing', { skip }, async () => {
  const db = mongoose.connection.db;
  const before = await snapshot(db);
  await db.command({ profile: 2 });
  try {
    await check();
  } finally {
    await db.command({ profile: 0 });
  }
  assert.deepStrictEqual(await snapshot(db), before, 'every collection, index and document as it was');

  const ops = (await db.collection('system.profile').find({ ns: { $not: /\.system\./ } }).toArray())
    .map((p) => ({ op: p.op, coll: p.ns.slice(db.databaseName.length + 1), cmd: Object.keys(p.command || {})[0] || '' }))
    // The test's own profile switch.
    .filter((p) => p.cmd !== 'profile');
  const writes = ops.filter((p) => ['insert', 'update', 'remove'].includes(p.op) || !['find', 'aggregate', 'getMore'].includes(p.cmd));
  assert.deepStrictEqual(writes, [], 'reads only');
  const reads = (coll, cmd) => ops.filter((p) => p.coll === coll && p.cmd === cmd).length;
  assert.deepStrictEqual(
    [reads('reportsharelinks', 'find'), reads('reportsharelinks', 'aggregate'), reads('organizations', 'find')],
    [1, 1, 1],
    `the profiler saw the run: ${JSON.stringify(ops)}`
  );
  assert.strictEqual(reads('subscriptions', 'find'), 4, 'billing read once per organization with such links');
  assert.deepStrictEqual([...new Set(ops.map((p) => p.coll))].sort(), ['organizations', 'reportsharelinks', 'subscriptions']);

  // A database with nothing in it: Mongoose would create the imported models' collections (autoCreate) or
  // build their indexes (autoIndex), and either would bring it into being.
  const emptyName = `${db.databaseName}_empty`.slice(0, 63);
  const emptyUri = URI.replace(/\/[^/?]+(\?|$)/, `/${emptyName}$1`);
  const { stdout } = await check(emptyUri);
  assert.match(stdout, /no organization has a link to all your reports\.\nNo report has more than one link\.\nNothing was changed\./);
  const dbs = (await db.admin().listDatabases()).databases.map((d) => d.name);
  assert.ok(!dbs.includes(emptyName), `${emptyName} was created`);
});

test('takes no arguments — there is no --apply', { skip }, async () => {
  await assert.rejects(check(URI, '--apply'), (err) => err.code === 2 && /Unknown argument: --apply/.test(err.stderr));
});
