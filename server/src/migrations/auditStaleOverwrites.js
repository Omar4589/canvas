import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { Campaign } from '../models/Campaign.js';
import { Household } from '../models/Household.js';
import { User } from '../models/User.js';

// Finds doors where a STALE OFFLINE REPLAY destroyed a newer disposition.
//
//   node src/migrations/auditStaleOverwrites.js        # report only — this script never writes
//
// THE SIGNATURE. Both write paths in routes/mobile/canvass.js are replace-then-create, and the new
// row carries a `replaced` snapshot of the entry it deleted. In an honest correction the canvasser
// always replaces something OLDER than what they are recording now. So a surviving row whose
// `replaced.timestamp` is NEWER than its own `timestamp` cannot have happened in order — it is a
// queued action that arrived late and overwrote a correction made after it.
//
// The cause is fixed going forward (`supersededByNewer` in routes/mobile/canvass.js rejects a
// replay once a newer row exists for the same canvasser on that (household, pass)). This script
// exists to size the damage that predates the fix.
//
// WHY THERE IS NO --apply. The destroyed disposition IS recoverable from the snapshot — it holds
// `actionType`, `timestamp`, `location` and `distanceFromHouseMeters` — but the snapshot does NOT
// store the destroyed row's `note`, so an automatic restore would silently drop a canvasser's note.
// Look at the real numbers first and decide deliberately; a repair belongs in its own change with
// its own review, not as a flag on an audit.

const STALE_MATCH = {
  'replaced.timestamp': { $ne: null },
  $expr: { $gt: ['$replaced.timestamp', '$timestamp'] },
};

function fmt(d) {
  return d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const rows = await CanvassActivity.find(
    STALE_MATCH,
    'campaignId householdId userId actionType timestamp replaced wasOfflineSubmission'
  )
    .sort({ timestamp: 1 })
    .lean();

  if (!rows.length) {
    console.log('No stale overwrites found — every replacement in the ledger is in order.');
    await mongoose.disconnect();
    return;
  }

  // Hydrate names in bulk rather than per row.
  const [campaigns, households, users] = await Promise.all([
    Campaign.find({ _id: { $in: [...new Set(rows.map((r) => String(r.campaignId)))] } }, 'name').lean(),
    Household.find(
      { _id: { $in: [...new Set(rows.map((r) => String(r.householdId)))] } },
      'addressLine1 city state'
    ).lean(),
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)))] } }, 'firstName lastName').lean(),
  ]);
  const campName = new Map(campaigns.map((c) => [String(c._id), c.name]));
  const hh = new Map(households.map((h) => [String(h._id), h]));
  const userName = new Map(
    users.map((u) => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim() || String(u._id)])
  );

  const byCampaign = new Map();
  for (const r of rows) {
    const k = String(r.campaignId);
    if (!byCampaign.has(k)) byCampaign.set(k, []);
    byCampaign.get(k).push(r);
  }

  console.log(`${rows.length} door(s) where a stale replay won:\n`);
  for (const [campaignId, list] of byCampaign) {
    console.log(`## ${campName.get(campaignId) || campaignId}  (${list.length})`);
    for (const r of list) {
      const h = hh.get(String(r.householdId));
      const addr = h ? `${h.addressLine1}, ${h.city} ${h.state}` : String(r.householdId);
      console.log(`  ${addr}`);
      console.log(`    KEPT      ${r.actionType.padEnd(16)} ${fmt(r.timestamp)}${r.wasOfflineSubmission ? '  (offline replay)' : ''}`);
      console.log(`    DESTROYED ${String(r.replaced.actionType).padEnd(16)} ${fmt(r.replaced.timestamp)}`);
      console.log(`    canvasser: ${userName.get(String(r.userId)) || r.userId}`);
    }
    console.log('');
  }

  console.log(
    'The DESTROYED row is what the door should read. Nothing was changed by this script — the\n' +
    'snapshot carries no note, so restoring is a deliberate decision, not an automatic one.'
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
