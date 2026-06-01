import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Voter } from '../models/Voter.js';

// Decision 13: replace the global-unique index on Voter.stateVoterId with a
// compound {organizationId, stateVoterId} unique index so two orgs importing
// the same state voter file no longer collide. No cross-org duplicates exist
// today (the global-unique index prevented them), so this is safe.
//
// Usage: node src/migrations/migrateVoterScope.js [--apply]
const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const indexes = await Voter.collection.indexes();
  const globalUnique = indexes.find(
    (ix) => ix.unique && ix.key && Object.keys(ix.key).length === 1 && ix.key.stateVoterId === 1
  );

  console.log('Current single-field stateVoterId unique index:', globalUnique?.name || '(none)');
  console.log(
    'Has {organizationId, stateVoterId} unique:',
    indexes.some((ix) => ix.unique && ix.key?.organizationId === 1 && ix.key?.stateVoterId === 1)
  );

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to drop the global-unique index and build the compound one.');
    await mongoose.disconnect();
    return;
  }

  if (globalUnique) {
    await Voter.collection.dropIndex(globalUnique.name);
    console.log(`Dropped ${globalUnique.name}`);
  }
  await Voter.syncIndexes();
  console.log('Synced indexes (built {organizationId, stateVoterId} unique).');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
