import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { FbTimePersonLink } from '../models/FbTimePersonLink.js';
import { IntegrationEvent } from '../models/IntegrationEvent.js';
import { DeletedUserRecord } from '../models/DeletedUserRecord.js';
import { depairFbtimeAccount } from '../services/fbtime/purgePairing.js';

// Close two older FbTime deletion gaps for rows written BEFORE the fix
// (docs/PROPOSAL_FBTIME_DOOR_COUNTS.md §M, decision 10).
//
// The Privacy Policy says account deletion removes your email address immediately. Two
// copies outlived the account: the FbTime link's fbtimeEmail (the FbTime person's email —
// for the same human, theirs) and the link-created event's detail.userEmail. Going forward,
// deletion nulls the link's email and link-created no longer stores one; this sweeps what
// came before. And the 180-day identity purge now de-pairs an account from FbTime; step 3
// runs that same function for records purged before it existed (expected 0 — the first
// default purge is around 2027-01-08).
//
//   npm run migrate:fbtime-deletion-gaps              # dry run — counts per step
//   npm run migrate:fbtime-deletion-gaps -- --apply   # writes; re-run the bare command to see zeros
//
// Safe + idempotent: each step matches only what is still there to remove.
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  console.log(`FbTime deletion gaps · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  // 1. The email on links whose Doorline account was deleted.
  const deletedIds = await User.distinct('_id', { deletedAt: { $ne: null } });
  const linkFilter = { userId: { $in: deletedIds }, fbtimeEmail: { $nin: [null, ''] } };
  const links = await FbTimePersonLink.countDocuments(linkFilter);
  console.log(`  1. links of deleted accounts still holding an email: ${links}`);
  if (APPLY && links) {
    const res = await FbTimePersonLink.updateMany(linkFilter, { $set: { fbtimeEmail: null } });
    console.log(`     cleared ${res.modifiedCount}`);
  }

  // 2. detail.userEmail on EVERY link-created event. Nothing reads it, and matching per user
  //    would silently miss rows: detail.userId is a string, sometimes upper-case.
  const eventFilter = { type: 'link-created', 'detail.userEmail': { $exists: true } };
  const events = await IntegrationEvent.countDocuments(eventFilter);
  console.log(`  2. link-created events holding an email: ${events}`);
  if (APPLY && events) {
    const res = await IntegrationEvent.updateMany(eventFilter, { $unset: { 'detail.userEmail': '' } });
    console.log(`     cleared ${res.modifiedCount}`);
  }

  // 3. The purge's FbTime step, for records purged before it existed.
  const purged = await DeletedUserRecord.find({ purgedAt: { $ne: null } }).select('userId deletedAt').lean();
  const total = { links: 0, kept: 0, rejected: 0, clears: 0, shiftsKept: 0, shiftsReassigned: 0, events: 0 };
  let failed = 0;
  for (const rec of purged) {
    try {
      const c = await depairFbtimeAccount({ userId: rec.userId, deletedAt: rec.deletedAt, apply: APPLY });
      for (const k of Object.keys(total)) total[k] += c[k] || 0;
    } catch (err) {
      failed += 1;
      console.error(`     record ${rec._id} failed: ${err?.message || err}`);
    }
  }
  console.log(
    `  3. purged accounts still paired with FbTime (${purged.length} purged record(s) checked): ` +
      `${total.links} link(s), ${total.kept} kept entr${total.kept === 1 ? 'y' : 'ies'}, ` +
      `${total.rejected} rejected pair(s), ${total.clears} clear(s), ${total.shiftsKept} shift(s) to de-pair, ` +
      `${total.shiftsReassigned} to re-resolve, ${total.events} event(s)` +
      (APPLY ? ' — de-paired' : '')
  );
  if (failed) console.log(`     *** ${failed} record(s) failed — re-run to retry them ***`);

  if (!APPLY) console.log('Dry run — re-run with -- --apply to write.');
  await mongoose.disconnect();
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
