import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { Subscription } from '../models/Subscription.js';
import { SubscriptionEvent } from '../models/SubscriptionEvent.js';
import { DEMO_ORG_SLUG } from '../utils/demoData/namePools.js';

// Marks Doorline-owned orgs with the born-immutable `Organization.isInternal` flag — the
// marker that lets platform staff enter without a support grant (middleware/orgContext.js)
// and locks billing to 'internal' (routes/superAdmin/billing.js).
//
// `isInternal` is schema-immutable ON PURPOSE: no API path, and no ordinary Mongoose write,
// can set it on an existing org — an org that already holds customer data must never become
// exempt from the staff-access gate. This operator-run script is one of the three sanctioned
// CLI-only bypasses (raw collection writes) — the others being seedDemoOrg (demo slug only)
// and migrateBilling's --internal backfill — used to stamp pre-existing Doorline-owned orgs.
// Idempotent — safe to re-run; prints every org it touches.
//
// Usage: node src/migrations/migrateInternalOrgs.js [--apply] [--slugs a,b]
//   (targets the demo org by default; --slugs adds more, e.g. a future sandbox org)
const APPLY = process.argv.includes('--apply');
const slugsArgIdx = process.argv.indexOf('--slugs');
const extraSlugs =
  slugsArgIdx > -1 && process.argv[slugsArgIdx + 1]
    ? process.argv[slugsArgIdx + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const slugs = [...new Set([DEMO_ORG_SLUG, ...extraSlugs])];
  const orgs = await Organization.find({ slug: { $in: slugs } }, { name: 1, slug: 1, isInternal: 1 }).lean();
  const missing = slugs.filter((s) => !orgs.some((o) => o.slug === s));
  for (const s of missing) console.log(`  (no org with slug '${s}' — skipped)`);

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  for (const o of orgs) {
    const sub = await Subscription.findOne({ organizationId: o._id }, { status: 1 }).lean();
    const flagNote = o.isInternal ? 'isInternal already set' : 'isInternal will be SET';
    const subNote =
      sub?.status === 'internal' ? "sub already 'internal'" : `sub ${sub ? `'${sub.status}' → ` : '(none) → '}'internal'`;
    console.log(`  ${o.name} (${o.slug}): ${flagNote} · ${subNote}`);

    if (!APPLY) continue;

    // The sanctioned immutability bypass — raw collection write, filter-guarded so a
    // re-run is a no-op.
    const flagged = await Organization.collection.updateOne(
      { _id: o._id, isInternal: { $ne: true } },
      { $set: { isInternal: true } }
    );
    if (flagged.modifiedCount) console.log('    → flag set');

    if (sub?.status !== 'internal') {
      await Subscription.updateOne(
        { organizationId: o._id },
        { $set: { status: 'internal', statusChangedAt: new Date() } },
        { upsert: true }
      );
      await SubscriptionEvent.create({
        organizationId: o._id,
        toStatus: 'internal',
        reason: 'migrate:internal-orgs',
      });
      console.log("    → subscription set to 'internal'");
    }
  }
  if (!APPLY) console.log('Dry run — re-run with --apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
