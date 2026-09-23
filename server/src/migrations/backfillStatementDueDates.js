import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Statement } from '../models/Statement.js';
import { Subscription } from '../models/Subscription.js';
import { dueAtFor, effectiveDueAt, paymentStateOf, termsDaysFor } from '../services/billing/invoicingState.js';

// STAMP A DUE DATE on every statement issued before due dates existed.
//
//   npm run migrate:statement-due                  # dry run — what would change, and what turns overdue
//   npm run migrate:statement-due -- --apply       # write it
//   npm run migrate:statement-due -- --apply --terms 14   # override the terms used for every row
//
// NOT A GATE. Readers already resolve a missing `dueAt` as issuedAt + the org's current terms
// (services/billing/invoicingState.js effectiveDueAt), and this writes exactly that value — so the
// app is correct before, during and after the run. What the run buys is FREEZING: once persisted,
// a later change to an org's payment terms stops moving the due date of an invoice already sent.
//
// Read the dry run's last line before applying. Every legacy invoice whose due date has already
// passed reads OVERDUE the moment this is visible, which is true but startling if half of them
// were paid months ago — marking those paid, from each org's Statements tab under the Outstanding
// filter, is the expected first-day chore.
//
// Idempotent: the filter is `dueAt: null`, so a second run is a no-op. Void rows are skipped —
// nothing is owed on them and a due date would only make the paper trail harder to read.
const APPLY = process.argv.includes('--apply');
const termsArgIndex = process.argv.indexOf('--terms');
const TERMS_OVERRIDE =
  termsArgIndex !== -1 && process.argv[termsArgIndex + 1] !== undefined
    ? Number(process.argv[termsArgIndex + 1])
    : null;

const fmtUsd = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

async function main() {
  if (TERMS_OVERRIDE !== null && (!Number.isInteger(TERMS_OVERRIDE) || TERMS_OVERRIDE < 0 || TERMS_OVERRIDE > 365)) {
    console.error('--terms must be a whole number of days between 0 and 365.');
    process.exitCode = 1;
    return;
  }
  await connectDb(process.env.MONGODB_URI);
  const now = new Date();

  const rows = await Statement.find({ status: 'issued', dueAt: null }).lean();
  if (!rows.length) {
    console.log('Nothing to do — every issued statement already carries a due date.');
    await mongoose.disconnect();
    return;
  }

  const orgIds = [...new Set(rows.map((r) => String(r.organizationId)))];
  const subs = await Subscription.find({ organizationId: { $in: orgIds } }).lean();
  const termsByOrg = new Map(subs.map((s) => [String(s.organizationId), termsDaysFor(s)]));

  console.log(
    `${rows.length} issued statement${rows.length === 1 ? '' : 's'} across ${orgIds.length} organization${
      orgIds.length === 1 ? '' : 's'
    } have no due date · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${
      TERMS_OVERRIDE !== null ? ` · terms forced to net-${TERMS_OVERRIDE}` : ''
    }\n`
  );

  const perOrg = new Map();
  let willReadOverdue = 0;
  let overdueCents = 0;
  let written = 0;

  for (const s of rows) {
    const orgId = String(s.organizationId);
    const termsDays = TERMS_OVERRIDE !== null ? TERMS_OVERRIDE : termsByOrg.get(orgId) ?? termsDaysFor(null);
    const dueAt = dueAtFor(s.issuedAt, termsDays);
    // Exactly what a reader resolves today — asserted by the int test, so the switch from computed
    // to stored can never move a date.
    const wouldHaveRead = effectiveDueAt(s, termsDays);
    if (dueAt && wouldHaveRead && dueAt.getTime() !== wouldHaveRead.getTime()) {
      console.error(`  ! ${s.month} ${orgId}: computed ${dueAt.toISOString()} differs from the read path — aborting.`);
      process.exitCode = 1;
      await mongoose.disconnect();
      return;
    }

    const state = paymentStateOf({ ...s, dueAt }, { now, termsDays });
    if (state === 'overdue') {
      willReadOverdue += 1;
      overdueCents += s.totalCents || 0;
    }
    const agg = perOrg.get(orgId) || { count: 0, overdue: 0 };
    agg.count += 1;
    if (state === 'overdue') agg.overdue += 1;
    perOrg.set(orgId, agg);

    if (APPLY) {
      await Statement.updateOne({ _id: s._id, dueAt: null }, { $set: { dueAt, termsDays } });
      written += 1;
    }
  }

  for (const [orgId, agg] of perOrg) {
    console.log(`  ${orgId}  ${agg.count} statement${agg.count === 1 ? '' : 's'}, ${agg.overdue} will read overdue`);
  }

  console.log(
    `\n${APPLY ? `Wrote ${written} due date${written === 1 ? '' : 's'}.` : 'Dry run — nothing written.'}`
  );
  console.log(
    `${willReadOverdue} statement${willReadOverdue === 1 ? '' : 's'} totalling ${fmtUsd(overdueCents)} ` +
      'will read OVERDUE. Any of those already paid should be marked paid from the organization’s ' +
      'Statements tab (Outstanding filter) — that is the expected first-day chore, not a bug.'
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  try {
    await mongoose.disconnect();
  } catch {
    /* already down */
  }
});
