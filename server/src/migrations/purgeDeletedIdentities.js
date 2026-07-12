import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { DeletedUserRecord } from '../models/DeletedUserRecord.js';

// The second half of account deletion.
//
// When someone deletes their account we scrub the User row immediately, but we keep one copy
// of their identity in DeletedUserRecord so the org can still attribute past field work —
// above all the GPS/quality flags — to a real person. That retention is bounded and disclosed
// (the in-app deletion sheet and the privacy policy both say so). This job is what makes the
// bound real: once retentionUntil passes, the snapshot is scrubbed too and the person's past
// work becomes permanently anonymous.
//
// Without this running, "retained for a limited period" is a promise we don't keep — which is
// exactly the kind of gap an App Review privacy complaint is made of. Run it on a schedule
// (Heroku Scheduler daily is enough; the window is measured in months).
//
// Idempotent: only touches records whose window has lapsed and that aren't already purged.
//
// Usage: node src/migrations/purgeDeletedIdentities.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const now = new Date();
  const filter = { retentionUntil: { $lte: now }, purgedAt: null };
  const due = await DeletedUserRecord.find(filter).lean();

  console.log(
    `${due.length} deleted identities past their retention window · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
  );
  for (const r of due) {
    const age = Math.floor((now - new Date(r.deletedAt)) / (24 * 60 * 60 * 1000));
    console.log(`  · ${r.firstName} ${r.lastName} <${r.email}> — deleted ${age}d ago`);
  }

  if (APPLY && due.length > 0) {
    // Scrub the snapshot in place rather than dropping the row: the row itself is the record
    // that a deletion happened and that we honoured the window, which is worth keeping.
    const res = await DeletedUserRecord.updateMany(filter, {
      $set: { firstName: '', lastName: '', email: '', phone: null, purgedAt: now },
    });
    console.log(`Purged ${res.modifiedCount} identities. Their past field work is now permanently anonymous.`);
  } else if (!APPLY) {
    console.log('Dry run — re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
