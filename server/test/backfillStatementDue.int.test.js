import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// THE DUE-DATE BACKFILL, run as a real process against a real mongod — the way the Heroku
// dashboard's Run console runs it.
//
// What matters is not that it writes something, but that it writes EXACTLY what the read path
// already returns: `effectiveDueAt` resolves a missing dueAt as issuedAt + the org's current terms,
// and this persists that same value. If the two ever diverge, an invoice's due date would silently
// move the day someone ran maintenance.
const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../src/migrations/backfillStatementDueDates.js');

const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Statement } = await import('../src/models/Statement.js');
const { effectiveDueAt, termsDaysFor } = await import('../src/services/billing/invoicingState.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const ctx = {};

const run = (args = []) =>
  exec(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, MONGODB_URI: URI, MONGODB_URI_TEST: URI },
  });

const mkStatement = (over = {}) => ({
  month: '2026-01',
  status: 'issued',
  rateCents: 30000,
  rulesVersion: 3,
  totalCents: 30000,
  lines: [],
  issuedAt: new Date('2026-02-01T00:00:00Z'),
  dueAt: null,
  termsDays: null,
  ...over,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Subscription, Statement]) await M.deleteMany({});

  // net-30 (the default, left unset), net-14 (explicit), and an org with no subscription row.
  const a = await Organization.create({ name: 'Net30', slug: 'net30', isActive: true });
  const b = await Organization.create({ name: 'Net14', slug: 'net14', isActive: true });
  const c = await Organization.create({ name: 'NoSub', slug: 'nosub', isActive: true });
  await Subscription.create({ organizationId: a._id, status: 'active' });
  await Subscription.create({ organizationId: b._id, status: 'active', paymentTermsDays: 14 });

  await Statement.create(mkStatement({ organizationId: a._id, month: '2026-01' }));
  await Statement.create(mkStatement({ organizationId: b._id, month: '2026-02', issuedAt: new Date('2026-03-01T00:00:00Z') }));
  await Statement.create(mkStatement({ organizationId: c._id, month: '2026-03', issuedAt: new Date('2026-04-01T00:00:00Z') }));
  // A VOID row — nothing is owed on it, and a due date would only clutter the paper trail.
  await Statement.create(mkStatement({ organizationId: a._id, month: '2025-12', status: 'void', issuedAt: new Date('2026-01-01T00:00:00Z') }));
  // An already-stamped row, to prove the run is idempotent and never re-dates an invoice.
  await Statement.create(
    mkStatement({
      organizationId: a._id,
      month: '2025-11',
      issuedAt: new Date('2025-12-01T00:00:00Z'),
      dueAt: new Date('2099-01-01T00:00:00Z'),
      termsDays: 99,
    })
  );
  Object.assign(ctx, { a, b, c });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('the dry run writes nothing and reports what WILL read overdue', { skip }, async () => {
  const { stdout } = await run();
  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /3 issued statements? across 3 organizations? have no due date/);
  assert.match(stdout, /Dry run — nothing written/);
  // The last line is the one an operator has to read before applying: legacy invoices long past
  // their date become visible the moment this ships.
  assert.match(stdout, /will read OVERDUE/);

  const unstamped = await Statement.countDocuments({ status: 'issued', dueAt: null });
  assert.strictEqual(unstamped, 3, 'a dry run touched nothing');
});

test('--apply writes exactly what the read path already returned', { skip }, async () => {
  // Capture what readers resolve BEFORE the migration, per org, then assert the persisted value
  // matches to the millisecond. This is the whole contract.
  const before_ = await Statement.find({ status: 'issued', dueAt: null }).lean();
  const subs = await Subscription.find({}).lean();
  const termsByOrg = new Map(subs.map((s) => [String(s.organizationId), termsDaysFor(s)]));
  const expected = new Map(
    before_.map((s) => [
      String(s._id),
      effectiveDueAt(s, termsByOrg.get(String(s.organizationId)) ?? termsDaysFor(null)).getTime(),
    ])
  );

  const { stdout } = await run(['--apply']);
  assert.match(stdout, /APPLY/);
  assert.match(stdout, /Wrote 3 due dates/);

  for (const [id, want] of expected) {
    const after_ = await Statement.findById(id).lean();
    assert.strictEqual(
      new Date(after_.dueAt).getTime(),
      want,
      'the persisted date equals what effectiveDueAt returned before the run'
    );
  }

  // And the arithmetic itself, per org's terms.
  const a = await Statement.findOne({ organizationId: ctx.a._id, month: '2026-01' }).lean();
  assert.strictEqual(new Date(a.dueAt).toISOString(), '2026-03-03T00:00:00.000Z', 'net-30 from Feb 1');
  assert.strictEqual(a.termsDays, 30);

  const b = await Statement.findOne({ organizationId: ctx.b._id }).lean();
  assert.strictEqual(new Date(b.dueAt).toISOString(), '2026-03-15T00:00:00.000Z', 'net-14 from Mar 1');
  assert.strictEqual(b.termsDays, 14);

  const c = await Statement.findOne({ organizationId: ctx.c._id }).lean();
  assert.strictEqual(c.termsDays, 30, 'an org with no subscription row falls to the default');
});

test('void rows are skipped, and an already-stamped row is never re-dated', { skip }, async () => {
  const voided = await Statement.findOne({ organizationId: ctx.a._id, status: 'void' }).lean();
  assert.strictEqual(voided.dueAt, null, 'nothing is owed on a void statement');

  const stamped = await Statement.findOne({ organizationId: ctx.a._id, month: '2025-11' }).lean();
  assert.strictEqual(
    new Date(stamped.dueAt).toISOString(),
    '2099-01-01T00:00:00.000Z',
    'an invoice already carrying a date keeps it — the filter is dueAt: null'
  );
  assert.strictEqual(stamped.termsDays, 99);
});

test('a second run is a clean no-op', { skip }, async () => {
  const { stdout } = await run(['--apply']);
  assert.match(stdout, /Nothing to do/);
});

test('--terms overrides the resolved terms, and a bad value is refused', { skip }, async () => {
  await Statement.create(mkStatement({ organizationId: ctx.a._id, month: '2026-05', issuedAt: new Date('2026-06-01T00:00:00Z') }));
  const bad = await run(['--apply', '--terms', '900']).catch((e) => e);
  assert.match(String(bad.stderr || bad.stdout), /--terms must be a whole number of days/);

  const { stdout } = await run(['--apply', '--terms', '7']);
  assert.match(stdout, /terms forced to net-7/);
  const row = await Statement.findOne({ organizationId: ctx.a._id, month: '2026-05' }).lean();
  assert.strictEqual(new Date(row.dueAt).toISOString(), '2026-06-08T00:00:00.000Z');
  assert.strictEqual(row.termsDays, 7);
});
