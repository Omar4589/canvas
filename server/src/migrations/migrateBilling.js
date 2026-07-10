import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Campaign } from '../models/Campaign.js';
import { Subscription } from '../models/Subscription.js';
import { SubscriptionEvent } from '../models/SubscriptionEvent.js';
import { DEMO_ORG_SLUG } from '../utils/demoData/namePools.js';

// Billing backfill so deploy day locks NOBODY out:
//   - every org without a Subscription gets one: the demo org (and any slugs
//     passed via --internal a,b,c) → `internal` (permanently free); everything
//     else → `active` (grandfathered at the default rate — set per-org rates
//     afterwards from the Billing tab).
//   - already-archived campaigns (isActive:false) get archivedAt backfilled
//     from updatedAt so the statement's "bills through the archive month" rule
//     has a date to work with.
// Idempotent — safe to re-run; existing Subscriptions are never touched.
//
// Usage: node src/migrations/migrateBilling.js [--apply] [--internal slug1,slug2]
const APPLY = process.argv.includes('--apply');
const internalArgIdx = process.argv.indexOf('--internal');
const extraInternalSlugs =
  internalArgIdx > -1 && process.argv[internalArgIdx + 1]
    ? process.argv[internalArgIdx + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const internalSlugs = new Set([DEMO_ORG_SLUG, ...extraInternalSlugs]);
  const orgs = await Organization.find({}, { name: 1, slug: 1 }).lean();
  const covered = new Set(
    (await Subscription.find({}, { organizationId: 1 }).lean()).map((s) => String(s.organizationId))
  );
  const missing = orgs.filter((o) => !covered.has(String(o._id)));
  const archivedNoStamp = await Campaign.countDocuments({ isActive: false, archivedAt: null });

  console.log(
    `${orgs.length} orgs · ${missing.length} need a Subscription ` +
      `(${missing.filter((o) => internalSlugs.has(o.slug)).length} internal) · ` +
      `${archivedNoStamp} archived campaigns need archivedAt · mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
  );
  for (const o of missing) {
    console.log(`  ${internalSlugs.has(o.slug) ? 'internal' : 'active  '} ← ${o.name} (${o.slug})`);
  }

  if (APPLY) {
    const now = new Date();
    for (const o of missing) {
      const status = internalSlugs.has(o.slug) ? 'internal' : 'active';
      await Subscription.create({ organizationId: o._id, status, statusChangedAt: now });
      await SubscriptionEvent.create({
        organizationId: o._id,
        toStatus: status,
        reason: 'migrate:billing backfill',
      });
    }
    if (missing.length) console.log(`created ${missing.length} subscriptions.`);
    // Bulk backfill via updateMany + aggregation pipeline so updatedAt itself
    // isn't bumped by the write (timestamps are skipped on pipeline updates).
    const r = await Campaign.updateMany({ isActive: false, archivedAt: null }, [
      { $set: { archivedAt: '$updatedAt' } },
    ]);
    if (r.modifiedCount) console.log(`backfilled archivedAt on ${r.modifiedCount} archived campaigns.`);
  } else {
    console.log('Dry run — re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
