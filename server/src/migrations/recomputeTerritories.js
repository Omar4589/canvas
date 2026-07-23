import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Turf } from '../models/Turf.js';
import { Pass } from '../models/Pass.js';
import { Campaign } from '../models/Campaign.js';
import { recomputePassTerritories } from '../services/turf/generateTurf.js';

// One-time re-tessellation of every stored book outline with the door-level Voronoi
// territories (services/turf/boundary.js computeTerritories) — the construction where every
// house sits INSIDE its book's shape and shapes never overlap. Outlines cut before that
// change were centroid-clipped and routinely excluded their own doors.
//
//   npm run recompute:territories               # dry run — lists what would be recomputed
//   npm run recompute:territories -- --apply    # rewrite the outlines
//
// SAFE MID-ROUND. This writes ONLY Turf.boundary — never householdIds, walkOrder,
// assignments, knocks, or pass status. Canvasser phones never receive boundary at all
// (the bootstrap doesn't ship it), so the field app is untouched either way. Re-runnable:
// the computation is deterministic, so a second --apply writes identical shapes.

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);

  // Every pass that still owns live (non-archived) books, newest campaigns first.
  const passIds = await Turf.distinct('passId', { status: { $in: ['draft', 'published'] } });
  const passes = await Pass.find({ _id: { $in: passIds } }, 'campaignId roundNumber name').lean();
  const campaigns = await Campaign.find(
    { _id: { $in: [...new Set(passes.map((p) => String(p.campaignId)))] } },
    'name organizationId'
  ).lean();
  const campName = new Map(campaigns.map((c) => [String(c._id), c.name]));

  console.log(`${passes.length} pass(es) own live books.${APPLY ? '' : ' DRY RUN — pass --apply to rewrite outlines.'}\n`);

  let totalBooks = 0;
  for (const pass of passes) {
    const bookCount = await Turf.countDocuments({ passId: pass._id, status: { $in: ['draft', 'published'] } });
    totalBooks += bookCount;
    const label = `${campName.get(String(pass.campaignId)) || pass.campaignId} · Round ${pass.roundNumber} · ${pass.name}`;
    if (!APPLY) {
      console.log(`  would recompute ${String(bookCount).padStart(4)} book outline(s) — ${label}`);
      continue;
    }
    const t0 = Date.now();
    await recomputePassTerritories(pass._id);
    console.log(`  recomputed ${String(bookCount).padStart(4)} book outline(s) in ${Date.now() - t0}ms — ${label}`);
  }

  console.log(`\n${APPLY ? 'Rewrote' : 'Would rewrite'} outlines for ${totalBooks} book(s) across ${passes.length} pass(es).`);
  if (APPLY) console.log('Reload the web console — the Turf Cutting map now shows the contained shapes.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
