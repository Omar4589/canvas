import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { ClientReport } from '../models/ClientReport.js';
import { ClientReportMapPoint } from '../models/ClientReportMapPoint.js';
import { Campaign } from '../models/Campaign.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';
import { publicPointAnswer } from '../services/reports/computeReport.js';

// Scrub canvasser-typed "Other: ___" write-ins out of ALREADY-PUBLISHED report map points.
//
// The point builder now rebuilds every public answer from canonical option labels
// ('__other__' → the literal 'Other'), so nothing a canvasser typed can reach the public map
// going forward. But points frozen before that fix keep whatever the response snapshot carried
// — which for an Other pick is the typed text, pinned to a street address on an unauthenticated
// page. Republishing rebuilds a report's points, but nothing forces a republish, so this sweeps
// the frozen corpus once with the SAME rule the builder now applies (publicPointAnswer's
// snapshot branch: stored points carry no optionIds, so a value that exactly matches one of the
// question's canonical labels is kept; anything else becomes 'Other'; a question the template
// no longer knows — or a report whose template can't be resolved — drops the answer entirely).
//
//   node src/migrations/scrubMapPointAnswers.js            # dry run — count points that would change
//   node src/migrations/scrubMapPointAnswers.js --apply    # rewrite them
//
// Safe + idempotent: the transformation is a fixed point (canonical labels map to themselves).
const APPLY = process.argv.includes('--apply');

async function templateFor(report, cache) {
  const key = String(report.campaignId);
  if (!cache.has(key)) {
    const campaign = await Campaign.findById(report.campaignId, { surveyTemplateId: 1 }).lean();
    const template = campaign?.surveyTemplateId
      ? await SurveyTemplate.findById(campaign.surveyTemplateId).lean()
      : null;
    cache.set(key, template);
  }
  return cache.get(key);
}

function sameAnswer(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  const reportIds = await ClientReportMapPoint.distinct('clientReportId');
  console.log(
    `ClientReportMapPoint: ${reportIds.length} report(s) hold frozen points. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
  );

  const templates = new Map();
  let scanned = 0;
  let changed = 0;
  let droppedRows = 0;

  for (const reportId of reportIds) {
    const report = await ClientReport.findById(reportId, { campaignId: 1 }).lean();
    // Orphaned points (report deleted out-of-band): no template can vouch for their answers —
    // strip the answers rather than leave unverifiable text on a public collection.
    const template = report ? await templateFor(report, templates) : null;
    const questionByKey = new Map(((template && template.questions) || []).map((q) => [q.key, q]));

    const ops = [];
    for await (const point of ClientReportMapPoint.find(
      { clientReportId: reportId },
      { answers: 1 }
    ).cursor()) {
      scanned += 1;
      if (!point.answers?.length) continue;

      const next = [];
      for (const row of point.answers) {
        // Stored points carry no optionIds — publicPointAnswer takes its snapshot branch.
        const clean = publicPointAnswer(questionByKey.get(row.questionKey), {
          answer: row.answer,
          optionIds: [],
        });
        if (clean != null) next.push({ questionKey: row.questionKey, answer: clean });
        else droppedRows += 1;
      }

      const changedHere =
        next.length !== point.answers.length ||
        next.some((row, i) => row.questionKey !== point.answers[i].questionKey || !sameAnswer(row.answer, point.answers[i].answer));
      if (!changedHere) continue;

      changed += 1;
      if (APPLY) {
        ops.push({
          updateOne: { filter: { _id: point._id }, update: { $set: { answers: next } } },
        });
      }
    }
    if (ops.length) await ClientReportMapPoint.bulkWrite(ops, { ordered: false });
  }

  console.log(
    `Scanned ${scanned} point(s): ${changed} ${APPLY ? 'rewritten' : 'would be rewritten'} (${droppedRows} unverifiable answer row(s) dropped).`
  );
  if (!APPLY && changed) console.log('Re-run with --apply to rewrite them.');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
