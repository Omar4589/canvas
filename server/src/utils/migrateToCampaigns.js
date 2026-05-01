// One-time migration: tag every existing Household, CanvassActivity,
// SurveyResponse, and ImportJob with a campaignId. Creates a default
// "Kentucky 2026" Campaign linked to the currently-active SurveyTemplate
// (the one previously selected via the global isActive flag), and assigns
// every untagged document to it.
//
// Also drops the legacy global unique index on Household.normalizedAddress
// so the new compound (campaignId, normalizedAddress) unique index can take
// effect.
//
// Usage (from server/):
//   node src/utils/migrateToCampaigns.js               # preview only
//   node src/utils/migrateToCampaigns.js --apply       # actually write
//
// Heroku:
//   heroku run "node src/utils/migrateToCampaigns.js" -a <app>
//   heroku run "node src/utils/migrateToCampaigns.js --apply" -a <app>

import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Household } from '../models/Household.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { ImportJob } from '../models/ImportJob.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const DEFAULT_NAME = process.env.MIGRATE_DEFAULT_CAMPAIGN_NAME || 'Kentucky 2026';
const DEFAULT_STATE = process.env.MIGRATE_DEFAULT_CAMPAIGN_STATE || 'KY';

function header(s) {
  console.log(`\n— ${s} —`);
}

async function dropLegacyIndex() {
  header('0. Drop legacy unique index on Household.normalizedAddress');
  const indexes = await Household.collection.indexes();
  const legacy = indexes.find(
    (idx) =>
      idx.unique === true &&
      idx.key &&
      Object.keys(idx.key).length === 1 &&
      idx.key.normalizedAddress === 1
  );
  if (!legacy) {
    console.log('  no legacy unique index found.');
    return;
  }
  console.log(`  found: ${legacy.name}`);
  if (APPLY) {
    await Household.collection.dropIndex(legacy.name);
    console.log(`  dropped index ${legacy.name}.`);
  }
}

async function ensureDefaultCampaign() {
  header('1. Ensure default campaign exists');
  let existing = await Campaign.findOne({ name: DEFAULT_NAME });
  if (existing) {
    console.log(`  using existing campaign "${existing.name}" (${existing._id})`);
    return existing;
  }
  const activeTemplate = await SurveyTemplate.findOne({ isActive: true }).lean();
  if (!activeTemplate) {
    const fallback = await SurveyTemplate.findOne().sort({ createdAt: -1 }).lean();
    if (!fallback) {
      throw new Error(
        'No SurveyTemplate found. Create a survey first, then run the migration.'
      );
    }
    console.log(
      `  no active survey template — falling back to most recent: "${fallback.name}"`
    );
    if (!APPLY) {
      console.log('  (preview) would create campaign linked to that template.');
      return { _id: '<preview>', surveyTemplateId: fallback._id };
    }
    return await Campaign.create({
      name: DEFAULT_NAME,
      type: 'survey',
      state: DEFAULT_STATE,
      surveyTemplateId: fallback._id,
      isActive: true,
    });
  }
  console.log(`  active template: "${activeTemplate.name}"`);
  if (!APPLY) {
    console.log(`  (preview) would create campaign "${DEFAULT_NAME}" linked to it.`);
    return { _id: '<preview>', surveyTemplateId: activeTemplate._id };
  }
  return await Campaign.create({
    name: DEFAULT_NAME,
    type: 'survey',
    state: DEFAULT_STATE,
    surveyTemplateId: activeTemplate._id,
    isActive: true,
  });
}

async function tagCollection(name, Model, campaignId) {
  header(`Tag ${name} with campaignId`);
  const count = await Model.countDocuments({ campaignId: { $exists: false } });
  console.log(`  ${count} documents missing campaignId`);
  if (APPLY && count) {
    const r = await Model.updateMany(
      { campaignId: { $exists: false } },
      { $set: { campaignId } }
    );
    console.log(`  updated ${r.modifiedCount}`);
  }
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'PREVIEW (no writes)'}`);
  await connectDb(process.env.MONGODB_URI);

  await dropLegacyIndex();
  const campaign = await ensureDefaultCampaign();
  const cId = campaign._id === '<preview>' ? null : campaign._id;

  if (cId || !APPLY) {
    await tagCollection('Household', Household, cId);
    await tagCollection('CanvassActivity', CanvassActivity, cId);
    await tagCollection('SurveyResponse', SurveyResponse, cId);
    await tagCollection('ImportJob', ImportJob, cId);
  }

  if (APPLY) {
    header('Sync indexes (creates compound unique index)');
    await Household.syncIndexes();
    console.log('  Household indexes synced.');
  }

  await mongoose.disconnect();
  console.log(
    APPLY
      ? '\nDone. Restart the server.'
      : '\nDone (preview). Re-run with --apply to actually migrate.'
  );
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
