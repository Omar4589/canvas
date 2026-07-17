import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { PersonMergeCandidate } from '../models/PersonMergeCandidate.js';
import { Person } from '../models/Person.js';

// Stamp `organizationId` on existing PersonMergeCandidate rows (from personIdA's org — both sides
// of a pair are provably same-org, the matcher's queries are org-prefixed). New rows get it at
// write time (resolvePerson.raiseCandidate); this closes out whatever predates that.
//
// Expected to touch 0 rows in prod: candidates only arise from vendor-uid conflicts, and no import
// has ever set a uidSource in this deployment. Kept for dev data and as a safety net — a candidate
// whose person was hard-deleted has no resolvable org and is DROPPED (it is unactionable: there is
// nothing left to merge).
//
//   node src/migrations/backfillCandidateOrgs.js            # dry run
//   node src/migrations/backfillCandidateOrgs.js --apply    # stamp / drop
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const missing = await PersonMergeCandidate.find({
    $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
  }).lean();
  console.log(`Candidates without organizationId: ${missing.length}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  let stamped = 0;
  let dropped = 0;
  for (const c of missing) {
    const person = await Person.findById(c.personIdA, 'organizationId').lean();
    if (person?.organizationId) {
      if (APPLY) {
        await PersonMergeCandidate.updateOne({ _id: c._id }, { $set: { organizationId: person.organizationId } });
      }
      stamped += 1;
    } else {
      // Person hard-deleted → the candidate points at nothing mergeable.
      if (APPLY) await PersonMergeCandidate.deleteOne({ _id: c._id });
      dropped += 1;
    }
  }

  console.log(`${APPLY ? 'Stamped' : 'Would stamp'}: ${stamped} · ${APPLY ? 'dropped' : 'would drop'} (person gone): ${dropped}`);
  if (!APPLY) console.log('Dry run — re-run with --apply to persist.');
  else console.log('Done. Safe to re-run — it is idempotent.');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
