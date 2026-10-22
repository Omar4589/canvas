import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { Household } from '../../models/Household.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { Voter } from '../../models/Voter.js';
import { recomputeHouseholdStatusesBatched, recomputeSurveyStatusesBatched } from './status.js';
import { doorKey } from './doorKey.js';
import { recomputeCampaignStats } from '../reports/campaignCounters.js';
import { KNOCK_ACTIONS } from '../reports/aggregations.js';
import { normalizeAndFilterAnswers } from '../surveys/normalizeAnswers.js';
import { effectiveSurveyTemplatesForDoors } from '../surveys/effectiveTemplate.js';
import { archiveOverwrittenResponses, snapshotFromArchive, claimCopiesForWriteBack, releaseCopies, deleteUnlessReplaced } from '../surveys/archiveOverwrite.js';
import { insertAllowingDuplicates, idsOnFile } from './rawInsert.js';
import { bumpLive } from '../platform/platformStats.js';
import { isOutcomeEnabled } from './outcomeToggles.js';
import { ConversionStrike } from '../../models/ConversionStrike.js';
import { deletionRequested, sweptAfter } from '../platform/lateWriteSweep.js';
import { NO_FRESH_STEP } from './stepCount.js';
import { fingerprint } from './answerEdit.js';
import { fencesForSlots, withFences } from './answerEditWriter.js';
import {
  RECLASSIFIABLE_OUTCOMES,
  CONVERTIBLE_SOURCES,
  convertibleMatch,
} from './reclassifyOutcomes.js';
import { visitsClause } from './answerScope.js';
import { getQueue, QUEUE_NAMES, queueOp } from '../../queues/index.js';

// Converting a door outcome INTO Surveyed, and back out again — the Door Outcomes page's
// Surveyed direction.
//
// reclassifyOutcomes.js refuses both of these, and its reason is correct FOR ITSELF: a bare
// actionType flip into `survey_submitted` fabricates answers nobody gave, and a bare flip out of
// it orphans answers somebody did. This module exists because that refusal is about missing
// machinery, not about the act being impossible. It pays for both halves:
//
//   INTO Surveyed  — the admin supplies real answers, composed against the door's OWN effective
//                    template, and every created SurveyResponse carries a `deskEntry` stamp
//                    naming who typed it and when. A voter who already answered in the field is
//                    SKIPPED, never overwritten.
//   OUT of Surveyed — the answers are ARCHIVED, not deleted (this is the fraud-cleanup direction,
//                    where the answers being removed are the evidence), scoped to the converting
//                    row's own canvasser so a second canvasser's honest work at the same door
//                    survives.
//
// WHAT IS PRESERVED, both directions: userId, timestamp, GPS, distance, pass, turf, effort and
// coordinator all stay exactly as the canvasser recorded them. The knock happened; only what it
// says — and the answers hanging off it — change.
//
// ⚠ WRITE ORDER IS THE MIRROR IMAGE OF runReclassify's, on purpose. That function stamps rows
// FIRST so a crash can't offer a Revert for a conversion that never happened. Here the stamp is
// written LAST, because here the stamp is also what a resumed job reads as "this row is done":
//   • responses first, crash → orphan responses, door still says not_home. That is the TRUE state
//     of both ledgers, so the nightly reconcile agrees with it, and resume finds the row unstamped,
//     recognises the responses by deskEntry.runId, and finishes the flip. Self-healing.
//   • flip first, crash → door says Surveyed with zero answers, a state the field also produces,
//     so nothing detects it — and resume finds the row STAMPED and skips it forever. Silently wrong.
// The invariant is the same one runReclassify states (a stamp must mean the whole unit landed);
// only which write is last differs. Do not "align" the two.

// This build's conversion job ids (routes/admin/campaigns.js conversionJobId), which the processor
// tells from the previous build's — BullMQ's own (conversionProcessor.js, the deploy window).
export const CONVERSION_JOB_PREFIX = 'outcome-convert-';

// One conversion may create at most this many SurveyResponse rows. Separate from the reclassify
// entry cap because the cost here scales with VOTERS, not entries: 25k doors at ~2 voters each is
// already 50k document writes plus a counter recompute.
export const SURVEY_CONVERT_MAX_RESPONSES = 50000;
// Env override read at CALL time (the answerScopeCap pattern) — what lets the volume guards be
// exercised by an int test without seeding fifty thousand responses. Unset, it is the constant.
export const surveyConvertCap = () => Number(process.env.SURVEY_CONVERT_MAX_RESPONSES) || SURVEY_CONVERT_MAX_RESPONSES;

// A single door applied synchronously (the single-fix and queue-step paths) must not outlive the
// router's budget, so one pathological address can't hang the request.
export const MAX_VOTERS_PER_DOOR_SYNC = 50;

// Activity rows per chunk. Smaller than status.js's 500 because each row here fans out to a voter
// read and a response insert rather than a single field write.
const CHUNK = 200;
// Visits per read in the review's survey count (computeSurveyImpact).
const IMPACT_VISITS_PER_READ = 500;

// Named examples behind the skip counts. An admin acts on names; the totals alone are unusable.
const SAMPLE_CAP = 200;

// Surveys an undo writes back in one insert (round 6: one per survey made a big undo three times slower).
const WRITE_BACK_BATCH = 500;
// Voters per page of an undo's copies: their copies, holders and fences in memory at once (round 9). Read
// at call time, so a test can make the pages small.
const UNDO_VOTER_PAGE = () => Number(process.env.UNDO_VOTER_PAGE) || 1000;

/** Rows convertible in each direction. Surveyed is the only legal source going backwards. */
export const SOURCES_FOR = (direction) => (direction === 'to_survey' ? RECLASSIFIABLE_OUTCOMES : ['survey_submitted']);

const err = (status, code, error) => ({ status, body: { error, code } });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the campaign and the requested direction. Returns null when legal, else { status, body }.
 * The per-door template check lives in resolveSelectionTemplate, which needs the selection to run.
 */
export function validateConversion(campaign, { direction, to }) {
  if (campaign.type !== 'survey') {
    return err(
      400,
      'NOT_A_SURVEY_CAMPAIGN',
      'Only survey campaigns record survey answers, so there is nothing to convert to or from here.'
    );
  }
  if (direction === 'to_survey') return null;

  if (!RECLASSIFIABLE_OUTCOMES.includes(to)) {
    return err(400, 'OUTCOME_NOT_RECLASSIFIABLE', 'Pick a door outcome to convert these entries to.');
  }
  // isOutcomeEnabled, not the deny-list: an off-by-default outcome is a target only where it is on.
  if (!isOutcomeEnabled(campaign, to)) {
    return err(
      400,
      'TARGET_DISABLED',
      'That outcome is switched off for this campaign — pick one canvassers can still record.'
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolving a selection into doors, voters and a template
// ---------------------------------------------------------------------------

// Selection resolution lives in reclassifyOutcomes.resolveSelection — ONE resolver for the
// table, the plain reclassify and both conversion directions, so a filter honoured by one can
// never be dropped by another. This module used to carry its own copy (resolveConversion), and
// the two had already drifted apart on the date keys before it was deleted. Callers pass
// SOURCES_FOR(direction) as the `outcomes` argument; the intersect inside buildEntryFilter
// then constrains a selection to the direction's legal sources exactly as the old copy did.

/**
 * The ONE template every selected door must resolve to.
 *
 * A selection spanning two effective templates is refused rather than written under whichever came
 * first — the mobile submit route itself 400s a response whose template isn't the door's effective
 * one, so picking one would manufacture data the field path forbids. The fix is one click away:
 * the page's walk-list filter narrows the selection to a single effort.
 */
export async function resolveSelectionTemplate(campaign, householdIds) {
  const doors = await Household.find({ _id: { $in: householdIds } }, 'effortId').lean();
  const { templateIds } = await effectiveSurveyTemplatesForDoors(campaign, doors);

  if (templateIds.length > 1) {
    const named = await SurveyTemplate.find(
      { _id: { $in: templateIds.filter(Boolean) } },
      'name'
    ).lean();
    return {
      error: err(
        400,
        'MIXED_SURVEY_TEMPLATES',
        `These doors don't all use the same survey (${named.map((t) => t.name).join(', ') || 'none'}). Filter by walk list first, then convert one at a time.`
      ),
    };
  }
  const id = templateIds[0];
  if (!id) {
    return {
      error: err(400, 'NO_SURVEY_TEMPLATE', 'These doors have no survey attached, so there are no answers to record.'),
    };
  }
  const template = await SurveyTemplate.findOne({ _id: id, organizationId: campaign.organizationId }).lean();
  if (!template) return { error: err(404, 'SURVEY_TEMPLATE_MISSING', 'That survey no longer exists.') };
  if (template.archivedAt) {
    return {
      error: err(400, 'SURVEY_TEMPLATE_ARCHIVED', `"${template.name}" is archived — restore it before recording answers against it.`),
    };
  }
  return { template };
}

// ---------------------------------------------------------------------------
// Pricing the response ledger (the money half reuses computeImpact unchanged)
// ---------------------------------------------------------------------------

/** Voters at these doors the field app would have let a canvasser survey. */
const eligibleVotersFor = async (campaignId, householdIds) =>
  Voter.find(
    { householdId: { $in: householdIds }, campaignId },
    'householdId fullName doNotContact.flagged'
  )
    .sort({ _id: 1 })
    .lean();

/**
 * What this conversion does to the SURVEY ledger — the half knocksPipeline is structurally blind
 * to, since it only ever reads CanvassActivity.
 *
 * The unit is the activity ROW, not the door: two rows at one door in two rounds convert
 * independently and write into two different passIds, which is legal because the unique key is
 * {voterId, passId}. `passId ?? null` is written explicitly everywhere — omitting the key would
 * make the legacy null-pass bucket match every round at once.
 */
export async function computeSurveyImpact({ campaign, rows, direction, answerMatch = null }) {
  const householdIds = [...new Set(rows.map((r) => String(r.householdId)))].map(
    (s) => new mongoose.Types.ObjectId(s)
  );

  if (direction === 'from_survey') {
    // A batch of visits per read, one clause for its doors and rounds (visitsClause, the unknock's own
    // read), the batch's visits kept below: one `$or` clause per entry spent the review's time planning the
    // query — 31 s at 5,000 entries, past the router's 30 s (round 7) — and one per round and canvasser grew
    // the same way with the crew (round 8). Each survey once: two Surveyed entries at one visit (an older
    // shape) can fall in two batches.
    // The +1 is the truncation probe: past the cap, responsesToArchive reads cap+1 and the
    // route's TOO_MANY_RESPONSES guard refuses BEFORE the preview renders — which is what
    // keeps entriesNoResponses (computed off this read) from over-counting at the cap.
    const cap = surveyConvertCap();
    const keys = new Set(rows.map((r) => doorKey(r)));
    const seen = new Map();
    for (let i = 0; i < rows.length && seen.size <= cap; i += IMPACT_VISITS_PER_READ) {
      const found = await SurveyResponse.find(visitsClause(rows.slice(i, i + IMPACT_VISITS_PER_READ)), 'voterId householdId passId userId submittedAt answers').lean();
      for (const s of found) if (keys.has(doorKey(s)) && !seen.has(String(s._id))) seen.set(String(s._id), s);
    }
    const existing = [...seen.values()].slice(0, cap + 1);
    const byRow = new Set(existing.map((s) => doorKey(s)));
    const entriesNoResponses = rows.filter(
      (r) => !byRow.has(doorKey(r))
    ).length;

    // Under an answer filter the archive is WIDER than the match — it takes every response at
    // each selected visit, including the neighbour who answered differently. Mark which of them
    // matched (re-applying the resolved response clauses to these exact ids), and sort the
    // manifest matched-first BEFORE the 50-row slice, or a truncated manifest could show only
    // unmatched voters — the worst possible presentation of an honest number.
    const matchedIds = answerMatch
      ? new Set(
          (
            await SurveyResponse.find(
              { _id: { $in: existing.map((s) => s._id) }, $and: answerMatch },
              { _id: 1 }
            ).lean()
          ).map((r) => String(r._id))
        )
      : null;
    if (matchedIds) {
      existing.sort((a, b) => matchedIds.has(String(b._id)) - matchedIds.has(String(a._id)));
    }

    const voterIds = [...new Set(existing.map((s) => String(s.voterId)))];
    const names = await Voter.find({ _id: { $in: voterIds.slice(0, 50) } }, 'fullName').lean();
    const nameById = new Map(names.map((v) => [String(v._id), v.fullName]));

    return {
      responsesToArchive: existing.length,
      votersAffected: voterIds.length,
      entriesNoResponses,
      ...(matchedIds
        ? {
            matchedResponses: existing.filter((s) => matchedIds.has(String(s._id))).length,
            matchedVoters: new Set(
              existing.filter((s) => matchedIds.has(String(s._id))).map((s) => String(s.voterId))
            ).size,
          }
        : {}),
      manifest: existing.slice(0, 50).map((s) => ({
        voterId: String(s.voterId),
        voterName: nameById.get(String(s.voterId)) || 'Unknown voter',
        submittedAt: s.submittedAt,
        answerCount: (s.answers || []).length,
        ...(matchedIds ? { matchedFilter: matchedIds.has(String(s._id)) } : {}),
      })),
      manifestTruncated: existing.length > 50,
      manifestTotal: existing.length,
    };
  }

  const voters = await eligibleVotersFor(campaign._id, householdIds);
  // Two maps, deliberately: `onFile` answers "is there anybody at this address at all" and
  // `votersByDoor` answers "who may we record". Collapsing them would report a door whose only
  // voter is do-not-contact as "nobody on file", which is both false and already explained by
  // votersDncExcluded — the same fact counted twice under the wrong name.
  const onFile = new Set(voters.map((v) => String(v.householdId)));
  const votersByDoor = new Map();
  let votersDncExcluded = 0;
  for (const v of voters) {
    if (v.doNotContact?.flagged) {
      votersDncExcluded += 1;
      continue;
    }
    const k = String(v.householdId);
    if (!votersByDoor.has(k)) votersByDoor.set(k, []);
    votersByDoor.get(k).push(v);
  }

  // Which (voter, pass) slots are already taken by a real answer.
  const allVoterIds = voters.map((v) => v._id);
  const passIds = [...new Set(rows.map((r) => (r.passId ? String(r.passId) : null)))];
  const answered = await SurveyResponse.find(
    {
      voterId: { $in: allVoterIds },
      passId: { $in: passIds.map((p) => (p ? new mongoose.Types.ObjectId(p) : null)) },
    },
    'voterId passId'
  ).lean();
  const answeredKeys = new Set(answered.map((s) => `${s.voterId}|${s.passId ?? 'null'}`));

  let votersEligible = 0;
  let votersAlreadyAnswered = 0;
  let doorsNoVoters = 0;
  let doorsAllAlreadyAnswered = 0;
  let responsesToCreate = 0;
  const samples = [];

  // Rows at the SAME (door, pass) — two canvassers overlapping — are walked in order, and a slot
  // claimed by the first is already-answered for the second. That mirrors exactly what the field
  // produces in the same situation; it must be counted, not hidden.
  const claimed = new Set(answeredKeys);
  for (const row of rows) {
    const list = votersByDoor.get(String(row.householdId)) || [];
    if (!list.length) {
      if (!onFile.has(String(row.householdId))) doorsNoVoters += 1;
      else doorsAllAlreadyAnswered += 1; // everyone here is DNC or already answered
      continue;
    }
    const pass = row.passId ? String(row.passId) : 'null';
    let created = 0;
    for (const v of list) {
      votersEligible += 1;
      const key = `${v._id}|${pass}`;
      if (claimed.has(key)) {
        votersAlreadyAnswered += 1;
        if (samples.length < SAMPLE_CAP) {
          samples.push({ voterId: v._id, voterName: v.fullName, reason: 'already_answered' });
        }
        continue;
      }
      claimed.add(key);
      created += 1;
    }
    if (!created) doorsAllAlreadyAnswered += 1;
    responsesToCreate += created;
  }

  return {
    votersEligible,
    votersDncExcluded,
    votersAlreadyAnswered,
    doorsNoVoters,
    doorsAllAlreadyAnswered,
    responsesToCreate,
    samples,
    samplesTruncated: votersAlreadyAnswered > samples.length,
    samplesTotal: votersAlreadyAnswered,
  };
}

// ---------------------------------------------------------------------------
// Building one response
// ---------------------------------------------------------------------------

/**
 * A desk-entered SurveyResponse for one voter, off the activity row being converted.
 *
 * Every field except the answers describes the ORIGINAL KNOCK and is copied verbatim. Two of those
 * copies are load-bearing enough to name:
 *   • passId/turfId/effortId come off the ROW. Never call resolveAttribution here — it resolves
 *     against currently-ACTIVE passes, so it would re-home a months-old knock into today's round.
 *   • coordinatorId comes off the ROW. This is not the restamp SurveyResponse.js forbids; it is
 *     the same freeze the field path performs when it writes one resolved value to both ledgers.
 *     Calling coordinatorForWrite here would stamp the door with the ADMIN's crew.
 * editedBy/editedAt stay null: this response was authored, not edited.
 */
const buildResponse = ({ row, voter, campaign, template, answers, note, runId, byUserId, at }) => ({
  organizationId: campaign.organizationId,
  campaignId: campaign._id,
  voterId: voter._id,
  householdId: row.householdId,
  userId: row.userId,
  surveyTemplateId: template._id,
  surveyTemplateVersion: template.version,
  answers,
  note: note ?? null,
  location: row.location,
  distanceFromHouseMeters: row.distanceFromHouseMeters ?? null,
  submittedAt: row.timestamp,
  syncedAt: at,
  wasOfflineSubmission: !!row.wasOfflineSubmission,
  passId: row.passId ?? null,
  turfId: row.turfId ?? null,
  effortId: row.effortId ?? null,
  coordinatorId: row.coordinatorId ?? null,
  editedBy: null,
  editedAt: null,
  deskEntry: { runId, byUserId, at, source: 'converted_outcome', fromOutcome: row.actionType },
});

/** Normalize an answer set against the template, exactly as the field submit path would. */
export const normalizeForConversion = (template, answers) =>
  normalizeAndFilterAnswers(template, answers || [], { dropHidden: true, rebuildAnswerText: true });

// ---------------------------------------------------------------------------
// The forward conversion, one chunk of rows at a time
// ---------------------------------------------------------------------------

const addSample = (acc, voter, reason) => {
  acc.samplesTotal += 1;
  if (acc.samples.length < SAMPLE_CAP) {
    acc.samples.push({ voterId: voter._id, voterName: voter.fullName, reason });
  } else {
    acc.samplesTruncated = true;
  }
};

/**
 * Convert one chunk of door-outcome rows into Surveyed.
 *
 * `answersFor(voter, row)` returns { answers, note } to record, or null to skip that voter —
 * that one seam is what lets bulk (one set for everyone), single (per-voter tabs) and the queue
 * (per-door entry) share this whole function.
 */
async function convertChunkToSurvey(ctx, rows, answersFor) {
  const { campaign, template, runId, byUserId, at, acc, touched } = ctx;
  const doorIds = [...new Set(rows.map((r) => String(r.householdId)))].map(
    (s) => new mongoose.Types.ObjectId(s)
  );

  const voters = await eligibleVotersFor(campaign._id, doorIds);
  const onFile = new Set(voters.map((v) => String(v.householdId))); // see computeSurveyImpact
  const votersByDoor = new Map();
  for (const v of voters) {
    if (v.doNotContact?.flagged) {
      addSample(acc, v, 'dnc');
      acc.votersSkippedDnc += 1;
      continue;
    }
    const k = String(v.householdId);
    if (!votersByDoor.has(k)) votersByDoor.set(k, []);
    votersByDoor.get(k).push(v);
  }

  const passIds = [...new Set(rows.map((r) => (r.passId ? String(r.passId) : null)))].map((p) =>
    p ? new mongoose.Types.ObjectId(p) : null
  );
  const existing = await SurveyResponse.find(
    { voterId: { $in: voters.map((v) => v._id) }, passId: { $in: passIds } },
    'voterId passId deskEntry'
  ).lean();
  // A slot this very run already filled (a stall redelivery re-running its own work) is NOT a
  // field skip. Counting it as one would inflate "already answered" with our own inserts.
  const mine = new Set();
  const theirs = new Set();
  for (const s of existing) {
    const key = `${s.voterId}|${s.passId ?? 'null'}`;
    if (s.deskEntry && String(s.deskEntry.runId) === String(runId)) mine.add(key);
    else theirs.add(key);
  }

  const docs = [];
  const perRowVoters = new Map(); // rowId → { created: [voterId], answered: [voterId] }
  const claimed = new Set([...mine, ...theirs]);

  for (const row of rows) {
    const list = votersByDoor.get(String(row.householdId)) || [];
    const bucket = { created: [], answered: [] };
    perRowVoters.set(String(row._id), bucket);
    if (!list.length) {
      if (!onFile.has(String(row.householdId))) acc.doorsNoVoters += 1;
      else acc.doorsAllAlreadyAnswered += 1;
      continue;
    }
    const pass = row.passId ? String(row.passId) : 'null';
    for (const voter of list) {
      const key = `${voter._id}|${pass}`;
      if (mine.has(key)) {
        // Ours from a previous delivery — already correct, and it still names the row's voter.
        bucket.created.push(voter._id);
        continue;
      }
      if (claimed.has(key)) {
        bucket.answered.push(voter._id);
        if (theirs.has(key)) {
          acc.votersSkippedAlreadyAnswered += 1;
          addSample(acc, voter, 'already_answered');
        }
        continue;
      }
      const plan = answersFor(voter, row);
      if (!plan) continue; // explicitly deselected in the single/queue composer
      claimed.add(key);
      bucket.created.push(voter._id);
      docs.push(
        buildResponse({
          row,
          voter,
          campaign,
          template,
          answers: normalizeForConversion(template, plan.answers),
          note: plan.note,
          runId,
          byUserId,
          at,
        })
      );
    }
    if (!bucket.created.length) acc.doorsAllAlreadyAnswered += 1;
  }

  // ---- 1. responses FIRST (see the header: this order is what makes a crash self-healing) ----
  if (docs.length) {
    try {
      const inserted = await SurveyResponse.insertMany(docs, { ordered: false });
      acc.responsesCreated += inserted.length;
    } catch (e) {
      // ordered:false keeps going past a duplicate; Mongoose hands back what landed. Only a race —
      // every refused document a duplicate — is skipped: anything else throws, including a failure of
      // the whole command, which the driver reports with NO write errors at all — counting that as
      // "nothing refused" stamped the entries Surveyed over answers never written (round 6).
      const errs = Array.isArray(e?.writeErrors) ? e.writeErrors : e?.writeErrors ? [e.writeErrors] : [];
      const dupes = errs.filter((w) => (w?.err?.code ?? w?.code) === 11000);
      if (!errs.length || dupes.length !== errs.length || e?.result?.getWriteConcernError?.()) throw e; // a real failure, not a race
      acc.responsesCreated += e?.insertedDocs?.length ?? 0;
      acc.votersSkippedAlreadyAnswered += dupes.length;
    }
  }

  // ---- 2. then the stamp, CAS'd so a redelivery is a natural no-op ----
  const ops = rows.map((row) => {
    const bucket = perRowVoters.get(String(row._id)) || { created: [], answered: [] };
    // The row names ONE voter but a door can have several: prefer a voter this run recorded, else
    // one who already had an answer for this pass. Sorted by _id, so a redelivery picks the same
    // one. Null only when the door produced no responses at all — activities.js then renders the
    // knock without an answer join, which is the honest reading.
    const voterId = bucket.created[0] || bucket.answered[0] || null;
    return {
      updateOne: {
        filter: { _id: row._id, reclassified: { $exists: false } },
        update: [
          {
            $set: {
              reclassified: {
                from: '$actionType',
                at,
                byUserId,
                runId,
                kind: 'to_survey',
                voterIdWas: '$voterId',
              },
              actionType: 'survey_submitted',
              voterId,
            },
          },
        ],
      },
    };
  });
  if (ops.length) {
    const res = await CanvassActivity.bulkWrite(ops, { ordered: false });
    acc.entriesConverted += res.modifiedCount || 0;
  }

  for (const bucket of perRowVoters.values()) touched.voterIds.push(...bucket.created);
  touched.doorIds.push(...doorIds);
}

// ---------------------------------------------------------------------------
// The reverse conversion
// ---------------------------------------------------------------------------

/**
 * Convert one chunk of Surveyed rows back to a door outcome, archiving the answers.
 *
 * SCOPE: {householdId, passId, userId} — only the converting row's OWN canvasser's responses. This
 * is the desk version of what re-dispositioning a door already does in the field (canvass.js
 * deletes on exactly that triple), and the fraud case is precisely where it matters: undoing
 * canvasser A's faked knock must not destroy canvasser B's real answers at the same address.
 *
 * We ARCHIVE where the field path DELETES, and that divergence is deliberate: there, a canvasser
 * is correcting themselves seconds later and the data destroyed is their own, just superseded.
 * Here an admin is removing what a canvasser submitted as final, potentially months later, in an
 * investigation where the removed content IS the evidence.
 */
async function convertChunkFromSurvey(ctx, rows, to) {
  const { runId, byUserId, at, acc, touched } = ctx;

  // One clause for the chunk's doors and rounds, its own visits kept by doorKey — the review's own read
  // (round 9: one $or branch per row was slow on a big crew, and the shape a MongoDB 7.0 query-engine bug
  // answers short — a survey missed here stayed live under the entry the chunk turned Not home).
  const keys = new Set(rows.map((r) => doorKey(r)));
  const responses = rows.length ? (await SurveyResponse.find(visitsClause(rows)).lean()).filter((s) => keys.has(doorKey(s))) : [];

  // The visits this chunk strikes, on record before anything changes: Restore holds every kept copy
  // of their answers to the strike while this conversion stands (restoreGuard.js).
  const strike = rows.length
    ? await ConversionStrike.create({
        runId,
        campaignId: ctx.campaign._id,
        organizationId: ctx.campaign.organizationId,
        visitKeys: [...new Set(rows.map((r) => doorKey(r)))],
        entryIds: rows.map((r) => r._id),
        at: new Date(),
      })
    : null;
  if (responses.length) {
    await archiveOverwrittenResponses(responses, { byUserId, via: 'outcome_convert', conversionRunId: runId });
    // ...each only while it still holds the submission read (round 9: a profile Restore swapped in between
    // was deleted with it — archiveOverwrite.js deleteUnlessReplaced).
    acc.responsesArchived += await deleteUnlessReplaced(responses);
    touched.voterIds.push(...responses.map((r) => r.voterId));
  }

  const hasResponse = new Set(responses.map((r) => doorKey(r)));
  for (const row of rows) {
    if (!hasResponse.has(doorKey(row))) {
      acc.entriesNoResponses += 1;
    }
  }

  const ops = rows.map((row) => ({
    updateOne: {
      filter: { _id: row._id, reclassified: { $exists: false } },
      update: [
        {
          $set: {
            reclassified: {
              from: '$actionType',
              at,
              byUserId,
              runId,
              kind: 'from_survey',
              voterIdWas: '$voterId',
            },
            actionType: to,
            // A door outcome carries no voter. Revert puts it back from voterIdWas.
            voterId: null,
          },
        },
      ],
    },
  }));
  if (ops.length) {
    const res = await CanvassActivity.bulkWrite(ops, { ordered: false });
    acc.entriesConverted += res.modifiedCount || 0;
  }
  if (strike) await ConversionStrike.updateOne({ _id: strike._id }, { $set: { doneAt: new Date() } });
  touched.doorIds.push(...rows.map((r) => r.householdId));
}

// ---------------------------------------------------------------------------
// Running a whole conversion
// ---------------------------------------------------------------------------

// Per-chunk counters. `touched` lives on ctx instead, because it accumulates across the WHOLE run
// (settle() needs every door and voter at the end) while these are folded into the run doc and
// reset after each chunk.
const COUNT_KEYS = [
  'entriesConverted',
  'responsesCreated',
  'responsesArchived',
  'votersSkippedAlreadyAnswered',
  'votersSkippedDnc',
  'doorsNoVoters',
  'doorsAllAlreadyAnswered',
  'entriesNoResponses',
];

const freshAcc = () => {
  const acc = { samples: [], samplesTruncated: false, samplesTotal: 0 };
  for (const k of COUNT_KEYS) acc[k] = 0;
  return acc;
};

const mergeCounts = (run, acc) => {
  for (const k of COUNT_KEYS) run.counts[k] = (run.counts[k] || 0) + acc[k];
  const room = SAMPLE_CAP - run.samples.length;
  if (room > 0) run.samples.push(...acc.samples.slice(0, room));
  run.samplesTotal += acc.samplesTotal;
  if (acc.samplesTruncated || run.samplesTotal > run.samples.length) run.samplesTruncated = true;
};

const newCtx = ({ campaign, template, run }) => ({
  campaign,
  template,
  runId: run._id,
  byUserId: run.byUserId,
  at: new Date(),
  acc: freshAcc(),
  touched: { doorIds: [], voterIds: [] },
});

/**
 * Settle everything downstream of the row writes. Shared by the job, the per-door sync path and
 * revert, because forgetting one of these is how a door stops recoloring on phones or an invoice
 * stops reconciling.
 */
async function settle({ campaign, doorIds, voterIds }) {
  const doors = [...new Set(doorIds.map(String))].map((s) => new mongoose.Types.ObjectId(s));
  // timestamps:true inside this is what pushes recolored pins to phones via /mobile/changes.
  await recomputeHouseholdStatusesBatched(doors, campaign.type);
  if (voterIds.length) await recomputeSurveyStatusesBatched(voterIds);
  // A full recompute rather than a delta bump: this is the "rare admin bulk op" tier, and it is
  // idempotent, which a bump is not — so a redelivered job can safely run it again.
  await recomputeCampaignStats(campaign._id);
}

/** The one non-idempotent write, CAS'd so a stall redelivery can't double it. */
async function bumpPlatformOnce(run, campaign) {
  const claim = await SurveyConversionRun.updateOne(
    { _id: run._id, liveBumped: { $ne: true } },
    { $set: { liveBumped: true } }
  );
  if (claim.modifiedCount !== 1) return;

  const opts = { orgId: campaign.organizationId };
  const sign = run.direction === 'to_survey' ? 1 : -1;
  const responses = run.direction === 'to_survey' ? run.counts.responsesCreated : run.counts.responsesArchived;
  if (responses) await bumpLive('surveyResponses', sign * responses, opts);

  // doorsKnocked only moves when the OTHER side of the pair isn't a knock — i.e. `restricted`.
  // Every other door outcome and survey_submitted are all already knocks.
  const nonKnock = run.sources.filter((s) => !KNOCK_ACTIONS.includes(s)).length > 0;
  const targetIsKnock = KNOCK_ACTIONS.includes(run.to);
  if (nonKnock && targetIsKnock && run.counts.entriesConverted) {
    await bumpLive('doorsKnocked', run.counts.entriesConverted, opts);
  }
}

const historyRow = (run, campaign, { swap = false } = {}) =>
  CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field: 'surveyConversion',
    fromValue: swap ? run.to : run.sources.length === 1 ? run.sources[0] : 'mixed',
    toValue: swap ? (run.sources.length === 1 ? run.sources[0] : 'mixed') : run.to,
    byUserId: run.byUserId,
    source: 'survey_conversion',
  });

// A campaign or organization being deleted stops a conversion for good, before each batch: it reads
// Stopped, and its delete cascade waits out the batch in flight before it sweeps. Whatever a writer
// here wrote after that is swept with the tenant's however it ends (sweptAfter on each export below;
// lateWriteSweep.js, round 3).
const tenantOf = (run) => ({ campaignId: run.campaignId, organizationId: run.organizationId });
export const TENANT_DELETING_ERROR = 'The campaign or organization is being deleted, so this change stopped.';

/**
 * Execute a run to completion. Called by the worker for `mode: 'bulk'`, and re-entrant: it
 * re-reads its own work set each pass, and convertibleMatch already excludes stamped rows, so a
 * redelivered or resumed job naturally skips everything it finished.
 */
async function executeRun({ run, campaign, onProgress }) {
  const template =
    run.direction === 'to_survey'
      ? await SurveyTemplate.findById(run.surveyTemplateId).lean()
      : null;
  if (run.direction === 'to_survey' && !template) throw new Error('Survey template no longer exists');

  const pending = await CanvassActivity.find(
    {
      ...convertibleMatch(campaign._id, null, CONVERTIBLE_SOURCES),
      actionType: { $in: SOURCES_FOR(run.direction) },
      _id: { $in: run.selection.actionIds },
    },
    { householdId: 1, actionType: 1, userId: 1, passId: 1, turfId: 1, effortId: 1, coordinatorId: 1, location: 1, distanceFromHouseMeters: 1, timestamp: 1, wasOfflineSubmission: 1, voterId: 1 }
  ).lean();

  const ctx = newCtx({ campaign, template, run });
  const answersFor = () => ({ answers: run.answers, note: run.note });

  // Doors done, never entries: a door holds an entry per round and canvasser, and counting entries read
  // "12 of 9 doors" (2026-10-21). A door is through once its last pending entry is; one with none
  // pending — finished by an earlier delivery, or with nothing to change — counts from the start.
  const lastEntryAt = new Map();
  pending.forEach((e, k) => lastEntryAt.set(String(e.householdId), k));
  const lastAts = [...lastEntryAt.values()].sort((a, b) => a - b);
  const total = run.progress?.doorsTotal || lastEntryAt.size;
  const doneBefore = Math.max(0, total - lastEntryAt.size);
  let through = 0;
  let done = Math.min(total, doneBefore);

  for (let i = 0; i < pending.length; i += CHUNK) {
    if (await deletionRequested(tenantOf(run))) {
      run.status = 'failed';
      run.error = TENANT_DELETING_ERROR;
      await run.save();
      return run;
    }
    const chunk = pending.slice(i, i + CHUNK);
    if (run.direction === 'to_survey') await convertChunkToSurvey(ctx, chunk, answersFor);
    else await convertChunkFromSurvey(ctx, chunk, run.to);

    while (through < lastAts.length && lastAts[through] < i + chunk.length) through += 1;
    done = Math.min(total, doneBefore + through);
    mergeCounts(run, ctx.acc);
    ctx.acc = freshAcc();

    run.progress = {
      phase: 'converting',
      pct: total ? Math.min(99, Math.round((done / total) * 100)) : 100,
      doorsDone: done,
      doorsTotal: total,
    };
    await run.save();
    if (onProgress) await onProgress(run);
  }

  run.progress = { phase: 'recomputing', pct: 99, doorsDone: done, doorsTotal: total };
  await run.save();

  // Settle EVERYTHING this run has stamped, not just this pass's doors. A resumed or redelivered
  // job only converts what the dead attempt left (stamped rows are out of convertibleMatch), so
  // `touched` misses the doors that attempt finished — and they were never settled, because the
  // settle is here at the end. The stamps are the run's own record; the recompute is idempotent.
  const [stampedDoors, runVoters] = await Promise.all([
    CanvassActivity.distinct('householdId', { 'reclassified.runId': run._id }),
    run.direction === 'to_survey'
      ? SurveyResponse.distinct('voterId', { 'deskEntry.runId': run._id })
      : SurveyResponseArchive.distinct('voterId', { conversionRunId: run._id }),
  ]);
  await settle({
    campaign,
    doorIds: [...ctx.touched.doorIds, ...stampedDoors],
    voterIds: [...ctx.touched.voterIds, ...runVoters],
  });
  await bumpPlatformOnce(run, campaign);
  await historyRow(run, campaign);

  run.status = 'completed';
  run.completedAt = new Date();
  run.progress = { phase: null, pct: 100, doorsDone: done, doorsTotal: total };
  await run.save();
  return run;
}

/**
 * Apply ONE door synchronously — the single-fix path and every step of the queue walkthrough.
 *
 * `voterPlans` is { [voterId]: { answers, note } | null }; a voter absent from it, or mapped to
 * null, is left alone. That is how per-voter tabs and per-voter skip checkboxes both work.
 */
async function applyDoor({ run, campaign, actionId, voterPlans = {} }) {
  const row = await CanvassActivity.findOne(
    {
      ...convertibleMatch(campaign._id, null, CONVERTIBLE_SOURCES),
      actionType: { $in: SOURCES_FOR(run.direction) },
      _id: actionId,
    },
    { householdId: 1, actionType: 1, userId: 1, passId: 1, turfId: 1, effortId: 1, coordinatorId: 1, location: 1, distanceFromHouseMeters: 1, timestamp: 1, wasOfflineSubmission: 1, voterId: 1 }
  ).lean();
  // Already converted by an earlier step, or no longer in scope — a no-op, not an error, so a
  // double-tapped "Save & next" can't 500.
  if (!row) return { applied: false };

  const template =
    run.direction === 'to_survey' ? await SurveyTemplate.findById(run.surveyTemplateId).lean() : null;
  if (run.direction === 'to_survey' && !template) throw new Error('Survey template no longer exists');

  const ctx = newCtx({ campaign, template, run });
  const answersFor = (voter) => {
    const plan = voterPlans[String(voter._id)];
    return plan ? { answers: plan.answers, note: plan.note ?? null } : null;
  };

  if (run.direction === 'to_survey') await convertChunkToSurvey(ctx, [row], answersFor);
  else await convertChunkFromSurvey(ctx, [row], run.to);

  mergeCounts(run, ctx.acc);
  if (!run.sources.includes(row.actionType)) run.sources.push(row.actionType);
  run.progress = {
    phase: 'converting',
    pct: run.progress?.doorsTotal
      ? Math.min(99, Math.round(((run.progress.doorsDone + 1) / run.progress.doorsTotal) * 100))
      : 0,
    doorsDone: (run.progress?.doorsDone || 0) + 1,
    doorsTotal: run.progress?.doorsTotal || 1,
  };
  await run.save();

  await settle({ campaign, doorIds: ctx.touched.doorIds, voterIds: ctx.touched.voterIds });
  return { applied: true, counts: run.counts };
}

/**
 * Close a queue session: settle the platform counter and write the one history row. `{ run, busy }`:
 * busy while one of its doors is still saving.
 *
 * CLAIMED, never saved from a read: two Closes at once each wrote a History row, and a Close landing
 * while a step saved let an Undo read the stamps before the step wrote its own (round 4). Only the
 * Close that claims the session writes its row.
 */
async function closeRun({ run, campaign }) {
  const closed = await SurveyConversionRun.findOneAndUpdate(
    { _id: run._id, status: 'open', ...NO_FRESH_STEP() },
    [{ $set: { status: 'completed', completedAt: '$$NOW', 'progress.phase': null, 'progress.pct': 100 } }],
    { new: true }
  );
  if (!closed) {
    const now = await SurveyConversionRun.findById(run._id);
    return { run: now || run, busy: !!now && now.status === 'open' };
  }
  // A session that recorded nothing gets no history row and no counter bump — "opened a walkthrough
  // and changed your mind" is not a campaign event.
  const didAnything = closed.counts.entriesConverted || closed.counts.responsesCreated || closed.counts.responsesArchived;
  if (didAnything) {
    await bumpPlatformOnce(closed, campaign);
    await historyRow(closed, campaign);
  }
  return { run: closed, busy: false };
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

// An undo of a run this size or smaller runs inline, inside its request (the page shows the result
// at once); anything larger is a job, the same size of work as the run going forward.
export const INLINE_REVERT_MAX_ENTRIES = 500;
export const STOPPED_UNDO_ERROR = 'The undo stopped before it finished.';
export const STOPPED_CONVERSION_ERROR = 'The conversion stopped before it finished.';

// A conversion reading busy — pending, running or reverting — that nothing is working on any more.
// Every step that moves a run into one of those leaves it to someone: its request (a create, a Pick
// up, an Undo that claims the run and checks again; an inline undo), or its job. Each gives the run
// back if it fails — but those give-backs are database writes too, and when one failed with the step
// before it (two database failures in a row, as in a failover), the run stayed busy with nobody on it:
// Working or Undoing for good, and every change on the campaign refused behind it, since one change
// runs at a time (code review round 9). Likewise an inline undo that died with its request (a dyno
// restart), and a job Redis lost. Read this long after its last write with no live job, it is settled:
// back to where it can be picked up or undone again. Ten minutes is far past any request, and a job
// still queued or running is alive however long it has waited.
const STALLED_MS = 10 * 60 * 1000;
const LIVE_JOB_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);
const BUSY = ['pending', 'running', 'reverting'];

const jobAlive = async (jobId) => {
  if (!jobId) return false;
  try {
    const job = await queueOp(getQueue(QUEUE_NAMES.OUTCOME_CONVERT).getJob(jobId), 2000);
    if (!job) return false;
    return LIVE_JOB_STATES.has(await queueOp(job.getState(), 2000));
  } catch {
    return true; // the queue can't be asked: still busy, the safe direction
  }
};

/**
 * A busy run nobody is working on, settled. A conversion going forward reads `failed` (Pick up or
 * Undo — what it changed is correct either way). An undo that began — its job or its inline request
 * claimed it (`revertClaimedAt`) — reads `revert_failed` (Retry undo; the undo is re-entrant). One
 * claimed but never begun goes back to what it was before the claim (`revertFrom`), so a change the
 * admin kept stands as it did, never reading as an undo begun (restoreGuard.js lifts a strike once its
 * undo begins). An inline-sized undo has no job to ask about. Takes a doc or a lean row.
 */
export const settleStalledConversion = async (run) => {
  if (!BUSY.includes(run.status)) return run;
  if (!run.updatedAt || Date.now() - new Date(run.updatedAt).getTime() < STALLED_MS) return run;
  const inline = run.status === 'reverting' && (run.counts?.entriesConverted || 0) <= INLINE_REVERT_MAX_ENTRIES;
  if (!inline && (await jobAlive(run.queueJobId))) return run;
  let to;
  if (run.status !== 'reverting') to = { status: 'failed', error: STOPPED_CONVERSION_ERROR };
  // A claim from before `revertFrom` existed (2026-10-20) can't say what it was: as before, a stopped undo.
  else if (run.revertClaimedAt || !run.revertFrom?.status) to = { status: 'revert_failed', error: STOPPED_UNDO_ERROR };
  else to = { status: run.revertFrom.status, error: run.revertFrom.error ?? null };
  const res = await SurveyConversionRun.updateOne(
    { _id: run._id, status: run.status, updatedAt: run.updatedAt },
    { $set: { status: to.status, error: to.error, queueJobId: null } }
  );
  if (res.modifiedCount === 1) {
    run.status = to.status;
    run.error = to.error;
    run.queueJobId = null;
  }
  return run;
};

/** Settle a campaign's busy conversions nobody is working on; true when it found one to look at (read again). */
export const settleStalledConversions = async (campaignId, { exceptConversionId = null } = {}) => {
  const runs = await SurveyConversionRun.find(
    {
      campaignId,
      ...(exceptConversionId ? { _id: { $ne: exceptConversionId } } : {}),
      status: { $in: BUSY },
      updatedAt: { $lt: new Date(Date.now() - STALLED_MS) },
    },
    { status: 1, updatedAt: 1, queueJobId: 1, revertClaimedAt: 1, revertFrom: 1, counts: 1 }
  ).lean();
  for (const run of runs) await settleStalledConversion(run);
  return runs.length > 0;
};

// The surveys holding these copies' {voterId, passId} slots, keyed `voterId|passId` — read by voter, a
// batch at a time, as the unknock undo reads them: one `$or` clause per slot spent 87 s planning the
// query at 50,000, past the worker's socket timeout, so the undo could never finish (round 7). Only the
// copies' own rounds, and only the slots asked for, are kept: every round's surveys of every voter, answers
// and all, ran the worker out of memory at the cap (round 8).
const HOLDERS_PER_READ = 500;
const HOLDER_FIELDS = 'voterId passId userId submittedAt answers editedBy editedAt note';
const holdersBySlot = async (docs) => {
  const wanted = new Set(docs.map((d) => `${d.voterId}|${d.passId ?? 'null'}`));
  const passIds = [...new Map(docs.map((d) => [String(d.passId ?? null), d.passId ?? null])).values()];
  const voterIds = [...new Set(docs.map((d) => String(d.voterId)))].map((id) => new mongoose.Types.ObjectId(id));
  const out = new Map();
  for (let i = 0; i < voterIds.length; i += HOLDERS_PER_READ) {
    for (const r of await SurveyResponse.find({ voterId: { $in: voterIds.slice(i, i + HOLDERS_PER_READ) }, passId: { $in: passIds } }, HOLDER_FIELDS).lean()) {
      const key = `${r.voterId}|${r.passId ?? 'null'}`;
      if (wanted.has(key)) out.set(key, r);
    }
  }
  return out;
};

// The visits (doorKey) of a conversion's own entries still on file: any still stamped with the run,
// and those its strike records name by id that carry no stamp and read Surveyed — flipped back by an
// earlier attempt of this undo, or never flipped (a step that stopped after taking the answers). One
// another change has stamped since is that change's, not this one's: counting it put this undo's
// answers back under a door the later conversion says was Not home (round 4). `surveyed` keeps only
// entries that read Surveyed again — back after the undo flipped them.
const entriesOnFile = async (run, { surveyed = false } = {}) => {
  const entryIds = (await ConversionStrike.find({ runId: run._id }, { entryIds: 1 }).lean()).flatMap((r) => r.entryIds || []);
  const rows = await CanvassActivity.find(
    {
      $or: [
        { 'reclassified.runId': run._id },
        ...(entryIds.length ? [{ _id: { $in: entryIds }, reclassified: { $exists: false }, actionType: 'survey_submitted' }] : []),
      ],
      ...(surveyed ? { actionType: 'survey_submitted' } : {}),
    },
    { householdId: 1, passId: 1, userId: 1 }
  ).lean();
  return new Set(rows.map((r) => doorKey(r)));
};

/**
 * Undo a run — stamp-driven, so it is exact even for a job that only half finished.
 *
 * Forward runs delete exactly the responses THEY created (deskEntry.runId), never a field response
 * that happened to sit at the same door. Reverse runs put their archived responses back — unless
 * the {voterId, passId} slot was refilled by a later field submit, in which case the field wins and
 * the archive row stays put, counted in responsesNotRestored.
 *
 * RE-ENTRANT, so an undo that stops part-way is finished by undoing again (`revert_failed` → Retry
 * undo), never by resuming — resume runs the conversion FORWARD and re-applied it. The stamps are
 * the undo's only record of what to put back, so the write that consumes them goes LAST: answers
 * first, then the entries flip back (still stamped), then the doors and voters settle, and only then
 * do the stamps come off. An attempt that dies anywhere leaves its doors stamped, so the retry finds
 * and settles every one. Lifting the stamps WITH the flip, as this once did, left a retry nothing to
 * settle: those doors and voters kept reading the conversion. Stamped-but-flipped rows are out of
 * every correction's scope (convertibleMatch) until the retry finishes, which is the safe direction.
 */
// An undo's progress, on its own run doc (the forward run saves its progress the same way).
const undoProgress = async (run, { phase = 'reverting', pct, peopleDone, peopleTotal }) => {
  run.progress = {
    phase,
    pct,
    doorsDone: run.progress?.doorsDone || 0,
    doorsTotal: run.progress?.doorsTotal || 0,
    ...(peopleTotal ? { peopleDone, peopleTotal } : {}),
  };
  await run.save();
};

async function revertRun({ run, campaign }) {
  if (await deletionRequested(tenantOf(run))) {
    run.status = 'revert_failed';
    run.error = TENANT_DELETING_ERROR;
    await run.save();
    return run;
  }
  run.status = 'reverting';
  run.error = null;
  run.progress = { phase: 'reverting', pct: 0, doorsDone: 0, doorsTotal: run.counts.doorsTargeted };
  await run.save();

  const stamp = { 'reclassified.runId': run._id };
  const doorRows = await CanvassActivity.aggregate([{ $match: stamp }, { $group: { _id: '$householdId' } }]);
  // ...and every door its strike records name: a step that stopped after taking a door's answers and
  // before flipping its entry left a door (and its voters) no stamp leads back to, still reading the
  // answers it no longer had (round 4).
  const struckDoors = (await ConversionStrike.find({ runId: run._id }, { visitKeys: 1 }).lean()).flatMap((r) => (r.visitKeys || []).map((k) => k.split('|')[0]));
  const doorIds = [...new Set([...doorRows.map((r) => String(r._id)), ...struckDoors])].map((id) => new mongoose.Types.ObjectId(id));

  const voterIds = [];

  if (run.direction === 'to_survey') {
    const created = await SurveyResponse.find({ 'deskEntry.runId': run._id }, 'voterId').lean();
    voterIds.push(...created.map((r) => r.voterId));
    await SurveyResponse.deleteMany({ 'deskEntry.runId': run._id });
  } else {
    let notRestored = 0;
    // Answers go back only into a visit whose entry this undo brings back — one of the run's
    // converted entries still on file (stamped, or flipped back by an earlier attempt). The canvasser
    // re-recording the door since deleted it, and putting the answers back there counted a survey
    // under a door that says otherwise (round 3).
    const comingBack = await entriesOnFile(run);

    const cannotRestore = (doc) => {
      notRestored += 1;
      if (run.samples.length < SAMPLE_CAP) {
        run.samples.push({ voterId: doc.voterId, voterName: null, reason: 'not_restored' });
      }
    };

    // The SAME submission (same canvasser, same moment) already holds the slot: an earlier
    // attempt of this undo put it back and died before clearing the archive copy. It is restored,
    // not blocked — counting it "not restored" would blame a field answer that doesn't exist.
    // Same content too, never just the same submission: another path (a profile Restore of a
    // different copy, a replayed submit) can put the same submission back with DIFFERENT answers, and
    // deleting this copy then lost the only record of its version (code review 2026-10-19).
    const sameSubmission = (holder, doc) => {
      const snap = snapshotFromArchive(doc);
      return (
        !!holder &&
        String(holder.userId) === String(doc.userId) &&
        !!holder.submittedAt &&
        !!doc.submittedAt &&
        new Date(holder.submittedAt).getTime() === new Date(doc.submittedAt).getTime() &&
        fingerprint(holder) === fingerprint(snap) &&
        (holder.note ?? null) === (snap.note ?? null)
      );
    };
    // A page of voters at a time — their copies, the surveys holding their slots, their fences — never every
    // copy of the run at once: a voter's copies are all on one page, so a slot's copies are judged together
    // (round 9: 50,000 copies of a twelve-question survey ran the worker out of memory before it wrote a
    // thing, and every retry died the same way).
    const copyVoters = await SurveyResponseArchive.distinct('voterId', { conversionRunId: run._id });
    for (let page = 0; page < copyVoters.length; page += UNDO_VOTER_PAGE()) {
      // Where it has got to, for its card: the people whose answers it has put back (2026-10-21 — the bar
      // sat at the start until the undo finished).
      if (page > 0) await undoProgress(run, { pct: Math.min(90, Math.round((page / copyVoters.length) * 90)), peopleDone: page, peopleTotal: copyVoters.length });
      const archived = await SurveyResponseArchive.find({ conversionRunId: run._id, voterId: { $in: copyVoters.slice(page, page + UNDO_VOTER_PAGE()) } }).lean();
      const promoted = [];
      // Whether the slot is free is decided by an explicit READ, not by whether the unique index
      // happens to fire. The {voterId, passId} index is the real guarantee in production, but it is
      // built by a deploy step (autoIndex is off there) — so a data-destroying decision must not
      // depend on it existing. The E11000 catch below stays as belt-and-braces for the race.
      const wanted = archived.map((d) => ({ voterId: d.voterId, passId: d.passId ?? null }));
      const takenByKey = await holdersBySlot(archived);
      // A survey written back keeps the fences of answer-edit runs whose undo reached it meanwhile.
      const fences = await fencesForSlots(campaign._id, wanted);
      const toWrite = [];
      // A second copy of a slot this undo also writes back — a redelivered batch archived the answers
      // twice — judged once the first has landed: the same submission then is a duplicate and goes, and
      // anything else stays on the profile, not put back (round 7: both went into one insert, the second
      // hit the slot's unique index and was listed as a voter whose answers couldn't be put back).
      const twins = [];
      const chosen = new Set();
      const newestFirst = [...archived].sort((x, y) => new Date(y.overwrittenAt || 0) - new Date(x.overwrittenAt || 0));
      for (const doc of newestFirst) {
        const slot = `${doc.voterId}|${doc.passId ?? 'null'}`;
        const holder = takenByKey.get(slot);
        if (sameSubmission(holder, doc)) {
          promoted.push(doc._id);
          voterIds.push(doc.voterId);
          continue;
        }
        // A canvasser answered this voter again in the field after the conversion. Their answer is
        // newer and real — never clobber it. The archive row stays put, and is listed. Likewise a
        // visit whose entry isn't coming back.
        if (holder || !comingBack.has(doorKey(doc))) {
          cannotRestore(doc);
          continue;
        }
        if (chosen.has(slot)) {
          twins.push(doc);
          continue;
        }
        chosen.add(slot);
        toWrite.push(doc);
      }
      // Written back a batch at a time, only from copies this undo holds (claimCopiesForWriteBack — the
      // run's own claim, so a retry takes back what an attempt that failed left): an Erase that landed
      // since the read stays erased (round 5). One raw insert per batch — a claim, a read and a create per
      // survey made a 50,000-survey undo three times slower (round 6) — not re-validated: this puts back
      // rows that were already on file in exactly this shape (the archive keeps verbatim copies —
      // archiveOverwrite.js), and an old row today's schema would refuse must not make the undo fail on
      // every retry. A copy goes only once its survey is read back on file, and the batch's claim is let
      // go however it ends, by this run's token (round 7: a claim whose own read failed, and a landed copy
      // whose delete failed, stayed held ten minutes) — the unknock undo's rule.
      for (let i = 0; i < toWrite.length; i += WRITE_BACK_BATCH) {
        const batch = toWrite.slice(i, i + WRITE_BACK_BATCH);
        const ids = batch.map((d) => d._id);
        const landed = [];
        try {
          const held = await claimCopiesForWriteBack(ids, run._id);
          const heldIds = new Set(held.map((d) => String(d._id)));
          for (const doc of batch) if (!heldIds.has(String(doc._id))) cannotRestore(doc);
          const now = new Date();
          const docs = held.map((d) => ({ ...withFences(snapshotFromArchive(d), fences), _id: new mongoose.Types.ObjectId(), createdAt: now, updatedAt: now }));
          await insertAllowingDuplicates(SurveyResponse.collection, docs);
          const written = await idsOnFile(SurveyResponse.collection, docs.map((x) => x._id));
          held.forEach((d, k) => (written.has(String(docs[k]._id)) ? landed.push(d) : cannotRestore(d)));
          if (landed.length) await SurveyResponseArchive.deleteMany({ _id: { $in: landed.map((d) => d._id) } });
        } finally {
          await releaseCopies(ids, run._id);
        }
        voterIds.push(...landed.map((d) => d.voterId));
      }
      if (twins.length) {
        const now = await holdersBySlot(twins);
        for (const doc of twins) {
          if (sameSubmission(now.get(`${doc.voterId}|${doc.passId ?? 'null'}`), doc)) promoted.push(doc._id);
          else cannotRestore(doc);
        }
      }
      if (promoted.length) await SurveyResponseArchive.deleteMany({ _id: { $in: promoted } });
    }
    run.counts.responsesNotRestored = notRestored;
  }

  // Flip the entries back, KEEPING the stamp — it comes off only after the settle (see above). The doors
  // and campaign numbers settle from here: its card says so.
  await undoProgress(run, { phase: 'recomputing', pct: 95 });
  await CanvassActivity.updateMany(stamp, [
    { $set: { actionType: '$reclassified.from', voterId: '$reclassified.voterIdWas' } },
  ]);

  // Every voter at these doors, not only the ones this attempt touched: a retry cannot see the
  // answers an earlier attempt already deleted or put back, and the recompute is idempotent.
  const votersAtDoors = doorIds.length
    ? await Voter.distinct('_id', { campaignId: campaign._id, householdId: { $in: doorIds } })
    : [];
  await settle({ campaign, doorIds, voterIds: [...voterIds, ...votersAtDoors] });

  // The visits whose entries this undo could NOT put back — the canvasser re-recorded the door
  // since: the strike stands at those visits (restoreGuard.js). Read from what is on file now — the
  // run's own entries back as Surveyed — so a retry after the stamps came off records the same
  // truth. Every strike record gets the field, empty or not.
  const flippedBack = await entriesOnFile(run, { surveyed: true });
  for (const rec of await ConversionStrike.find({ runId: run._id }, { visitKeys: 1 }).lean()) {
    await ConversionStrike.updateOne({ _id: rec._id }, { $set: { notRestoredKeys: rec.visitKeys.filter((k) => !flippedBack.has(k)) } });
  }

  await CanvassActivity.updateMany(stamp, { $unset: { reclassified: '' } });
  await historyRow(run, campaign, { swap: true });

  run.status = 'reverted';
  run.revertedAt = new Date();
  run.progress = { phase: null, pct: 100, doorsDone: doorIds.length, doorsTotal: doorIds.length };
  await run.save();
  return run;
}

// The writers, each swept after on a tenant being deleted (see tenantOf above).
export const executeConversionRun = (args) => sweptAfter(tenantOf(args.run), () => executeRun(args));
export const applyDoorToRun = (args) => sweptAfter(tenantOf(args.run), () => applyDoor(args));
export const closeConversionRun = (args) => sweptAfter(tenantOf(args.run), () => closeRun(args));
export const revertConversionRun = (args) => sweptAfter(tenantOf(args.run), () => revertRun(args));
