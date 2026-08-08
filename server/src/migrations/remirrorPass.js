// Re-point the Household.turfId / walkOrder mirror at ONE pass's published books.
//
// Why this exists: the mirror is single-valued and every cut re-points it, so cutting a
// FUTURE draft round moves it off the live round's books. Nothing authoritative changes —
// membership lives in Turf.householdIds — but the admin cut map hides the live round's dots
// and the phone's list-view sort (which reads walkOrder) shuffles. This script restores the
// mirror from the pass's own books, each door in its book's stored walk order. It writes
// nothing a cut didn't already own: only turfId and walkOrder, only for the pass's members.
//
// Heroku dashboard → More → Run console:
//   npm run remirror:pass -- --pass <passId>            (dry run: reports, writes nothing)
//   npm run remirror:pass -- --pass <passId> --apply
//
// Deliberately NOT filtered to doors whose mirror looks wrong: the book's stored order is
// the truth, so writing it for every member is idempotent and self-healing.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Pass } from '../models/Pass.js';
import { Turf } from '../models/Turf.js';
import { Household } from '../models/Household.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const passId = args[args.indexOf('--pass') + 1];

if (!args.includes('--pass') || !mongoose.isValidObjectId(passId)) {
  console.error('Usage: npm run remirror:pass -- --pass <passId> [--apply]');
  process.exit(1);
}

await connectDb(process.env.MONGODB_URI);
try {
  const pass = await Pass.findById(passId).lean();
  if (!pass) throw new Error(`No pass ${passId}`);
  console.log(`Pass "${pass.name}" (round ${pass.roundNumber}, ${pass.status})`);

  const books = await Turf.find({ passId, status: 'published' }, { name: 1, householdIds: 1 }).lean();
  if (!books.length) throw new Error('This pass has no published books — nothing to mirror.');

  let total = 0;
  let drifted = 0;
  for (const book of books) {
    const ids = book.householdIds || [];
    total += ids.length;
    // What would change, for the dry-run report — and a sanity check either way.
    const current = await Household.countDocuments({ _id: { $in: ids }, turfId: book._id });
    drifted += ids.length - current;
    if (!APPLY) continue;
    const ops = ids.map((hid, idx) => ({
      updateOne: { filter: { _id: hid }, update: { $set: { turfId: book._id, walkOrder: idx } } },
    }));
    for (let i = 0; i < ops.length; i += 2000) {
      await Household.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
    }
  }

  console.log(`${books.length} published books · ${total} doors · ${drifted} mirrors currently pointing elsewhere`);
  console.log(
    APPLY
      ? 'APPLIED — every member door now mirrors its book on this pass, in the book’s stored order.'
      : 'Dry run — re-run with --apply to write.'
  );
} finally {
  await mongoose.disconnect();
}
