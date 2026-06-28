import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';
import { Tag } from '../models/Tag.js';
import { normalizeTag } from '../services/surveys/tags.js';
import { rewriteTag, ensureTags } from '../services/surveys/tagOps.js';

// Seed the org-level tag library (Phase 3.1) from existing survey usage. Additive +
// idempotent: gather every distinct option.tag / palette tag per org, upsert a Tag doc
// (deduped by normalizedName, first-seen display casing wins), and canonicalize that
// display across all surveys + saved-search filters so case variants ("Supporter" /
// "supporter") collapse to one. Existing string tags keep working throughout.

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectDb(process.env.MONGODB_URI);
  await Tag.syncIndexes();

  const templates = await SurveyTemplate.find({}, 'organizationId questions tags').lean();
  const byOrg = new Map(); // orgId -> Map<normalizedKey, firstDisplay>
  for (const t of templates) {
    const orgId = String(t.organizationId);
    if (!byOrg.has(orgId)) byOrg.set(orgId, new Map());
    const m = byOrg.get(orgId);
    const consider = (raw) => {
      const k = normalizeTag(raw);
      if (k && !m.has(k)) m.set(k, String(raw).trim());
    };
    for (const q of t.questions || []) for (const o of q.options || []) consider(o.tag);
    for (const tag of t.tags || []) consider(tag);
  }

  let orgs = 0;
  let created = 0;
  let canonicalized = 0;
  for (const [orgId, m] of byOrg) {
    if (!m.size) continue;
    orgs += 1;
    for (const [k, display] of m) {
      const existing = await Tag.findOne({ organizationId: orgId, normalizedName: k }).lean();
      if (!existing) {
        created += 1;
        if (APPLY) await ensureTags(orgId, [display]);
      }
      if (APPLY) {
        const c = await rewriteTag(orgId, k, display);
        if (c.surveys || c.savedSearches) canonicalized += 1;
      }
    }
  }

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
  console.log(
    `orgs with tags: ${orgs} · tags ${APPLY ? 'created' : 'to create'}: ${created}` +
      (APPLY ? ` · tag groups canonicalized across surveys: ${canonicalized}` : '')
  );
  if (!APPLY) console.log('\nDry run — re-run with --apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
