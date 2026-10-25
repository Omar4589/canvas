import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { EmailLog } from '../models/EmailLog.js';
import { scrubAccountEmailLog, tombstoneEmail } from '../services/users/deleteAccount.js';

// Take a deleted account's address off the email send log, for every account deleted BEFORE the
// deletion itself started doing it (services/users/deleteAccount.js, step 10).
//
// Decided 2026-10-24: by ACCOUNT only. A row is touched when its userId is a deleted account's id —
// the person's own mail (invites, password resets, added-to notices), which carries that one
// recipient. Never by address: addresses get reused (someone re-added after a deletion, an email
// fix), and matching by address rewrote other live people's rows. Deletion-warning and support-grant
// notice rows carry no userId and keep their recipients; they are the evidence those notices went out.
//
//   npm run migrate:scrub-deleted-email-log              # dry run — counts only
//   npm run migrate:scrub-deleted-email-log -- --apply   # scrub them
//
// Idempotent: a row already scrubbed is skipped by the count and unchanged by a re-run.
const APPLY = process.argv.includes('--apply');

const main = async () => {
  await connectDb(process.env.MONGODB_URI);

  const deleted = await User.find({ deletedAt: { $ne: null } }).select('_id').lean();
  let accountsWithRows = 0;
  let rowsToScrub = 0;
  let scrubbed = 0;
  for (const { _id } of deleted) {
    const pending = await EmailLog.countDocuments({
      userId: _id,
      $or: [{ to: { $ne: [tombstoneEmail(_id)] } }, { error: { $ne: null } }, { deliveryDetail: { $ne: null } }],
    });
    if (!pending) continue;
    accountsWithRows += 1;
    rowsToScrub += pending;
    if (APPLY) scrubbed += await scrubAccountEmailLog(_id);
  }

  console.log(`Deleted accounts: ${deleted.length}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Accounts with their own mail still showing an address: ${accountsWithRows}`);
  console.log(`Email log rows to scrub: ${rowsToScrub}`);
  if (!APPLY) {
    console.log(rowsToScrub ? 'Re-run with -- --apply to scrub them.' : 'Nothing to scrub.');
  } else {
    console.log(`Scrubbed ${scrubbed} row(s).`);
  }

  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
