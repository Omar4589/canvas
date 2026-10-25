import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { PacePause } from '../models/PacePause.js';
import { resolveAllOpen } from '../services/audit/pacePause.js';

// Automatic pause — the rollback companion (docs/PROPOSAL_PACE_PAUSE.md §N). After PACE_PAUSE is set to off
// because something misfired, the pauses it left open would block again the moment it is switched back on.
// This resolves them (resolvedVia 'switch_off'), moving each member's restart point so the old fails never
// count again.
//
//   npm run pace:resolve-open              # dry run: how many open pauses, per org (counts only)
//   npm run pace:resolve-open -- --apply   # resolve them
//
// Counts only: no canvasser is named.

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply');
  if (unknown.length) {
    console.error(`Unknown argument ${unknown[0]} (the only flag is --apply)`);
    process.exit(2);
  }
  const apply = args.includes('--apply');
  await connectDb(process.env.MONGODB_URI);

  const open = await PacePause.aggregate([{ $match: { status: 'paused' } }, { $group: { _id: '$organizationId', n: { $sum: 1 } } }]);
  const orgs = await Organization.find({ _id: { $in: open.map((o) => o._id) } }, 'name').lean();
  const nameOf = new Map(orgs.map((o) => [String(o._id), o.name]));
  const total = open.reduce((s, o) => s + o.n, 0);
  console.log(`Open automatic pauses: ${total}`);
  for (const o of open) console.log(`  ${nameOf.get(String(o._id)) || '(organization not found)'}: ${o.n}`);

  if (!apply) {
    console.log('\nDry run — nothing was changed. Add -- --apply to resolve them.');
  } else {
    let resolved = 0;
    for (const o of open) resolved += await resolveAllOpen({ organizationId: o._id, via: 'switch_off' });
    console.log(`\nResolved ${resolved} open pause(s) (resolvedVia switch_off); each member's count starts over.`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
