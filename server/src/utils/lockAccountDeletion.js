import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';

// Mark an account as un-deletable — for the App Store / Play reviewer demo logins.
//
// Why this exists: a store reviewer WILL press "Delete my account", because testing it is
// exactly what App Store guideline 5.1.1(v) asks them to do. If the demo login is deletable,
// the reviewer destroys the demo tenant on their way through, and your NEXT submission has no
// working credentials to review. This is a one-line setting that saves a rejected release.
//
// Run it once per demo account, before you submit. It is idempotent.
//
// From the Heroku dashboard's "Run console" (Deploy ▸ More ▸ Run console), type:
//
//   npm run lock:account reviewer@doorline.app            # lock it
//   npm run lock:account                                  # list what's locked
//   npm run lock:account reviewer@doorline.app --unlock   # undo
//
// The email is accepted as a bare argument (not just --email=) because the Heroku web console
// is a single text box and `npm run x -- --flag y` quoting is a footgun there.
const args = process.argv.slice(2);
const flagged = args.find((a) => a.startsWith('--email='))?.replace('--email=', '')
  ?? (args.includes('--email') ? args[args.indexOf('--email') + 1] : null);
const positional = args.find((a) => !a.startsWith('-') && a.includes('@'));
const email = (flagged ?? positional)?.toLowerCase();
const UNLOCK = args.includes('--unlock');
const LIST = args.includes('--list');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  if (LIST || !email) {
    const locked = await User.find({ deletionLocked: true }, 'firstName lastName email').lean();
    if (locked.length === 0) {
      console.log('No accounts are deletion-locked.');
      console.log('\nA store reviewer will press "Delete my account" — lock your demo login before you submit:');
      console.log('  npm run lock:account reviewer@doorline.app');
    } else {
      console.log(`${locked.length} deletion-locked account(s):`);
      for (const u of locked) console.log(`  · ${u.firstName} ${u.lastName} <${u.email}>`);
    }
    await mongoose.disconnect();
    return;
  }

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  if (user.deletedAt) {
    console.error(`${email} is already deleted — nothing to lock.`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  user.deletionLocked = !UNLOCK;
  await user.save();
  console.log(
    `${UNLOCK ? 'Unlocked' : 'Locked'}: ${user.firstName} ${user.lastName} <${user.email}> — ` +
      `${UNLOCK ? 'this account can now be self-deleted.' : 'this account can no longer be self-deleted.'}`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
