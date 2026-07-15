import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { requestOrgDeletion } from '../services/retention/deletionRequests.js';

// Operator intake for "please delete our account", for when the request comes in by email/phone rather
// than through the console. Schedules the org's deletion for now + SLA (default 30 days); the retention
// sweep executes it, and it is cancellable until then. VERIFY THE REQUEST IS GENUINE before running —
// this is a human step the tool cannot enforce.
//
//   node src/utils/requestOrgDeletion.js <org-slug>                 # dry run — show what would schedule
//   node src/utils/requestOrgDeletion.js <org-slug> --apply         # schedule it
//   node src/utils/requestOrgDeletion.js <org-slug> --apply --note "emailed request, ticket 88"
const APPLY = process.argv.includes('--apply');
const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const noteIdx = process.argv.indexOf('--note');
const note = noteIdx >= 0 ? process.argv[noteIdx + 1] || '' : '';

async function main() {
  if (!slug) {
    console.error('Usage: node src/utils/requestOrgDeletion.js <org-slug> [--apply] [--note "..."]');
    process.exit(1);
  }
  await connectDb(process.env.MONGODB_URI);
  const org = await Organization.findOne({ slug }, 'name slug').lean();
  if (!org) {
    console.error(`No organization with slug "${slug}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Organization: ${org.name} (${org.slug})   Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (!APPLY) {
    console.log('Re-run with --apply to schedule deletion for now + the SLA (default 30 days).');
    await mongoose.disconnect();
    return;
  }

  const { request, alreadyScheduled } = await requestOrgDeletion({
    organizationId: org._id,
    requestedBy: null,
    note: note || 'operator CLI',
  });
  if (alreadyScheduled) {
    console.log(`Already scheduled — deletion fires ${new Date(request.scheduledFor).toISOString()}.`);
  } else {
    console.log(`Scheduled. Deletion fires ${new Date(request.scheduledFor).toISOString()}. Cancellable until then.`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
