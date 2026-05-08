import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { Campaign } from '../models/Campaign.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';
import { Household } from '../models/Household.js';
import { Voter } from '../models/Voter.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { ImportJob } from '../models/ImportJob.js';

const ORG_NAME = process.env.MIGRATE_ORG_NAME || 'Fox Bryant LLC';
const ORG_SLUG = process.env.MIGRATE_ORG_SLUG || 'fox-bryant-llc';
const SUPER_ADMIN_EMAIL = (process.env.MIGRATE_SUPER_ADMIN_EMAIL || 'omar@foxbryant.com').toLowerCase();

async function main() {
  await connectDb(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Upsert org
  const org = await Organization.findOneAndUpdate(
    { slug: ORG_SLUG },
    { $setOnInsert: { name: ORG_NAME, slug: ORG_SLUG, isActive: true } },
    { upsert: true, new: true }
  );
  console.log(`Org: ${org.name} (${org._id})`);
  const orgId = org._id;

  // 2. Backfill organizationId on existing data (raw driver bypasses schema validation)
  const collections = [
    ['campaigns', Campaign],
    ['surveytemplates', SurveyTemplate],
    ['households', Household],
    ['voters', Voter],
    ['canvassactivities', CanvassActivity],
    ['surveyresponses', SurveyResponse],
    ['importjobs', ImportJob],
  ];
  for (const [name, Model] of collections) {
    const r = await Model.collection.updateMany(
      { organizationId: { $exists: false } },
      { $set: { organizationId: orgId } }
    );
    console.log(`Backfilled ${name}: ${r.modifiedCount} docs`);
  }

  // 3. Memberships from existing user.role (raw read since schema no longer has `role`)
  const usersRaw = await mongoose.connection.collection('users').find({}).toArray();
  let memCreated = 0;
  let memSkipped = 0;
  for (const u of usersRaw) {
    const newRole = u.role === 'admin' ? 'admin' : 'canvasser';
    const result = await Membership.updateOne(
      { userId: u._id, organizationId: orgId },
      {
        $setOnInsert: {
          userId: u._id,
          organizationId: orgId,
          role: newRole,
          isActive: u.isActive !== false,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) memCreated++;
    else memSkipped++;
  }
  console.log(`Memberships: ${memCreated} created, ${memSkipped} already existed`);

  // 4. Promote super admin BEFORE assignments so we can credit assignedBy
  const promoted = await mongoose.connection.collection('users').updateOne(
    { email: SUPER_ADMIN_EMAIL },
    { $set: { isSuperAdmin: true } }
  );
  console.log(`Super admin promoted: ${promoted.matchedCount} user(s) matched, ${promoted.modifiedCount} updated`);

  const bootstrapAdmin =
    (await User.findOne({ email: SUPER_ADMIN_EMAIL })) ||
    (await mongoose.connection.collection('users').findOne({ role: 'admin' }));

  // 5. Backfill canvasser→campaign assignments to preserve current behavior
  const canvasserMemberships = await Membership.find({
    organizationId: orgId,
    role: 'canvasser',
    isActive: true,
  });
  const activeCampaigns = await Campaign.find({ organizationId: orgId, isActive: true });
  let asnCreated = 0;
  let asnSkipped = 0;
  for (const m of canvasserMemberships) {
    for (const c of activeCampaigns) {
      const result = await CampaignAssignment.updateOne(
        { campaignId: c._id, userId: m.userId },
        {
          $setOnInsert: {
            campaignId: c._id,
            userId: m.userId,
            organizationId: orgId,
            assignedBy: bootstrapAdmin?._id || null,
            assignedAt: new Date(),
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount) asnCreated++;
      else asnSkipped++;
    }
  }
  console.log(`Assignments: ${asnCreated} created, ${asnSkipped} already existed`);

  // 6. Drop old user.role field
  const dropped = await mongoose.connection.collection('users').updateMany(
    { role: { $exists: true } },
    { $unset: { role: '' } }
  );
  console.log(`Dropped role field on ${dropped.modifiedCount} user(s)`);

  // 7. Verify
  const orphans = {};
  for (const [name, Model] of collections) {
    const c = await Model.collection.countDocuments({ organizationId: { $exists: false } });
    if (c > 0) orphans[name] = c;
  }
  if (Object.keys(orphans).length) {
    console.warn('WARN: docs without organizationId remain:', orphans);
  } else {
    console.log('All docs have organizationId.');
  }

  console.log('Migration complete.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
