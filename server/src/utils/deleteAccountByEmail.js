import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Organization } from '../models/Organization.js'; // registered for populate
import {
  checkDeletionBlockers,
  deleteAccount,
  AccountDeletionError,
} from '../services/users/deleteAccount.js';

// Honour a deletion request from someone who can't (or won't) use the in-app button.
//
// Why this exists: /delete-account — the public page Google Play requires — tells people who have
// already uninstalled the app to email hello@doorline.app and promises we'll delete their account
// within 30 days. Without this command there is no way to keep that promise short of hand-editing
// the database and skipping every guard. A public commitment with nothing behind it is worse than
// no commitment.
//
// It runs the SAME service as the in-app button (services/users/deleteAccount.js), so an operator
// deletion is byte-for-byte identical to a self-deletion: identity scrubbed, work released, memberships
// deactivated, knock ledger untouched, identity snapshot retained for the disclosed window.
//
// VERIFY THE REQUEST FIRST. Confirm the email came from the address on the account — otherwise this
// is an account-takeover primitive that permanently destroys somebody's login on a stranger's say-so.
//
//   npm run delete:account someone@example.com            # dry run — shows what would happen
//   npm run delete:account someone@example.com --apply    # do it
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('-') && a.includes('@'))?.toLowerCase();
const APPLY = args.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  if (!email) {
    console.error('Usage: npm run delete:account <email> [--apply]');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No account with email ${email}`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  if (user.deletedAt) {
    console.log(`${email} was already deleted on ${user.deletedAt.toISOString()}. Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  const { blockers } = await checkDeletionBlockers(user._id);

  console.log(`\n${user.firstName} ${user.lastName} <${user.email}>`);
  console.log(`mode: ${APPLY ? 'APPLY — this is permanent' : 'DRY RUN'}`);

  if (blockers.length > 0) {
    console.log('\nBLOCKED — resolve these first, then re-run:');
    for (const b of blockers) console.log(`  · [${b.code}] ${b.message}`);
    // Deliberately no --force. Every blocker exists because overriding it breaks somebody ELSE:
    // the org loses its last admin, or its last bill-payer and silently goes read-only when the
    // subscription lapses. Hand the org off properly instead.
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  console.log('\nThis will:');
  console.log('  · scrub their name, email, phone and password — the login is gone for good');
  console.log('  · release every book / walk list / campaign they were holding');
  console.log('  · deactivate their membership in every org');
  console.log('  · LEAVE their knocks and survey answers with the campaign (counts and billing do not move)');
  console.log('  · keep their name in a private record for the disclosed retention window, then purge it');

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to delete.');
    await mongoose.disconnect();
    return;
  }

  try {
    const result = await deleteAccount(user._id, { reason: 'operator' });
    console.log(`\nDeleted. Identity retained until ${result.retentionUntil.toISOString().slice(0, 10)}, then purged.`);
    console.log('Reply to the requester confirming the account is gone.');
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      console.error(`\nFailed [${err.code}]: ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
