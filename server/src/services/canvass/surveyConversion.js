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
import { recomputeCampaignStats } from '../reports/campaignCounters.js';
import { KNOCK_ACTIONS } from '../reports/aggregations.js';
import { normalizeAndFilterAnswers } from '../surveys/normalizeAnswers.js';
import { effectiveSurveyTemplatesForDoors } from '../surveys/effectiveTemplate.js';
import { archiveOverwrittenResponses, snapshotFromArchive } from '../surveys/archiveOverwrite.js';
import { bumpLive } from '../platform/platformStats.js';
import {
  RECLASSIFIABLE_OUTCOMES,
  CONVERTIBLE_SOURCES,
  convertibleMatch,
} from './reclassifyOutcomes.js';

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

// One conversion may create at most this many SurveyResponse rows. Separate from the reclassify
// entry cap because the cost here scales with VOTERS, not entries: 25k doors at ~2 voters each is
// already 50k document writes plus a counter recompute.
export const SURVEY_CONVERT_MAX_RESPONSES = 50000;

// A single door applied synchronously (the single-fix and queue-step paths) must not outlive the
// router's budget, so one pathological address can't hang the request.
export const MAX_VOTERS_PER_DOOR_SYNC = 50;

// Activity rows per chunk. Smaller than status.js's 500 because each row here fans out to a voter
// read and a response insert rather than a single field write.
const CHUNK = 200;

// Named examples behind the skip counts. An admin acts on names; the totals alone are unusable.
const SAMPLE_CAP = 200;

/** Rows convertible in each direction. Surveyed is the only legal source going backwards. */
const SOURCES_FOR = (direction) => (direction === 'to_survey' ? RECLASSIFIABLE_OUTCOMES : ['survey_submitted']);

const err = (status, code, error) => ({ status, body: { error, code } });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the campaign and the requested direction. Returns null when legal, else { status, body }.
 * The per-door template check lives in resolveConversion, which needs the selection to run it.
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
  if (new Set(campaign.disabledOutcomes || []).has(to)) {
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

/**
 * Turn a scope + optional actionIds into the exact rows, doors and (forward) template a run
 * would use.
 *
 * `actionIds` may only NARROW — the same rule resolveSelection enforces for the plain reclassify,
 * so a stale checkbox can never reach a row the admin's current filter doesn't show. Rows are
 * additionally constrained to the direction's legal sources: ticking a Not-home row and asking to
 * convert it OUT of Surveyed silently selects nothing rather than doing something surprising.
 */
export async function resolveConversion({ campaign, scope = {}, actionIds = null, direction }) {
  const filter = {
    ...convertibleMatch(campaign._id, null, CONVERTIBLE_SOURCES),
    actionType: { $in: SOURCES_FOR(direction) },
  };
  if (scope.outcomes?.length) {
    const wanted = scope.outcomes.filter((o) => SOURCES_FOR(direction).includes(o));
    filter.actionType = { $in: wanted };
  }
  if (scope.userId) filter.userId = new mongoose.Types.ObjectId(String(scope.userId));
  if (scope.passId) filter.passId = new mongoose.Types.ObjectId(String(scope.passId));
  if (scope.effortId) filter.effortId = new mongoose.Types.ObjectId(String(scope.effortId));
  if (scope.dateFrom || scope.dateTo) {
    filter.timestamp = {};
    if (scope.dateFrom) filter.timestamp.$gte = new Date(scope.dateFrom);
    if (scope.dateTo) filter.timestamp.$lte = new Date(scope.dateTo);
  }
  if (actionIds?.length) {
    filter._id = { $in: actionIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }

  const rows = await CanvassActivity.find(filter, {
    householdId: 1,
    actionType: 1,
    userId: 1,
    passId: 1,
  }).lean();

  const householdIds = [...new Set(rows.map((r) => String(r.householdId)))];
  return {
    ids: rows.map((r) => r._id),
    rows,
    householdIds: householdIds.map((s) => new mongoose.Types.ObjectId(s)),
    entries: rows.length,
    doors: householdIds.length,
    sources: [...new Set(rows.map((r) => r.actionType))],
  };
}

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
export async function computeSurveyImpact({ campaign, rows, direction }) {
  const householdIds = [...new Set(rows.map((r) => String(r.householdId)))].map(
    (s) => new mongoose.Types.ObjectId(s)
  );

  if (direction === 'from_survey') {
    const or = rows.map((r) => ({
      householdId: r.householdId,
      passId: r.passId ?? null,
      userId: r.userId,
    }));
    const existing = or.length
      ? await SurveyResponse.find({ $or: or }, 'voterId householdId passId userId submittedAt answers')
          .limit(SURVEY_CONVERT_MAX_RESPONSES + 1)
          .lean()
      : [];
    const byRow = new Set(existing.map((s) => `${s.householdId}|${s.passId ?? 'null'}|${s.userId}`));
    const entriesNoResponses = rows.filter(
      (r) => !byRow.has(`${r.householdId}|${r.passId ?? 'null'}|${r.userId}`)
    ).length;

    const voterIds = [...new Set(existing.map((s) => String(s.voterId)))];
    const names = await Voter.find({ _id: { $in: voterIds.slice(0, 50) } }, 'fullName').lean();
    const nameById = new Map(names.map((v) => [String(v._id), v.fullName]));

    return {
      responsesToArchive: existing.length,
      votersAffected: voterIds.length,
      entriesNoResponses,
      manifest: existing.slice(0, 50).map((s) => ({
        voterId: String(s.voterId),
        voterName: nameById.get(String(s.voterId)) || 'Unknown voter',
        submittedAt: s.submittedAt,
        answerCount: (s.answers || []).length,
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
      // ordered:false keeps going past a duplicate; Mongoose hands back what landed.
      const landed = e?.insertedDocs?.length ?? 0;
      acc.responsesCreated += landed;
      const dupes = (e?.writeErrors || []).filter((w) => (w?.err?.code ?? w?.code) === 11000);
      if (dupes.length !== (e?.writeErrors || []).length) throw e; // a real failure, not a race
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

  const or = rows.map((r) => ({
    householdId: r.householdId,
    passId: r.passId ?? null,
    userId: r.userId,
  }));
  const responses = or.length ? await SurveyResponse.find({ $or: or }).lean() : [];

  if (responses.length) {
    await archiveOverwrittenResponses(responses, { byUserId, via: 'outcome_convert', conversionRunId: runId });
    const res = await SurveyResponse.deleteMany({ _id: { $in: responses.map((r) => r._id) } });
    acc.responsesArchived += res.deletedCount || 0;
    touched.voterIds.push(...responses.map((r) => r.voterId));
  }

  const hasResponse = new Set(responses.map((r) => `${r.householdId}|${r.passId ?? 'null'}|${r.userId}`));
  for (const row of rows) {
    if (!hasResponse.has(`${row.householdId}|${row.passId ?? 'null'}|${row.userId}`)) {
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

/**
 * Execute a run to completion. Called by the worker for `mode: 'bulk'`, and re-entrant: it
 * re-reads its own work set each pass, and convertibleMatch already excludes stamped rows, so a
 * redelivered or resumed job naturally skips everything it finished.
 */
export async function executeConversionRun({ run, campaign, onProgress }) {
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

  const total = run.progress?.doorsTotal || pending.length;
  let done = run.progress?.doorsDone || 0;

  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    if (run.direction === 'to_survey') await convertChunkToSurvey(ctx, chunk, answersFor);
    else await convertChunkFromSurvey(ctx, chunk, run.to);

    done += chunk.length;
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

  await settle({ campaign, doorIds: ctx.touched.doorIds, voterIds: ctx.touched.voterIds });
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
export async function applyDoorToRun({ run, campaign, actionId, voterPlans = {} }) {
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

/** Close a queue session: settle the platform counter and write the one history row. */
export async function closeConversionRun({ run, campaign }) {
  if (run.status === 'open') {
    await bumpPlatformOnce(run, campaign);
    await historyRow(run, campaign);
    run.status = 'completed';
    run.completedAt = new Date();
    run.progress = {
      phase: null,
      pct: 100,
      doorsDone: run.progress?.doorsDone || 0,
      doorsTotal: run.progress?.doorsTotal || 0,
    };
    await run.save();
  }
  return run;
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

/**
 * Undo a run — stamp-driven, so it is exact even for a job that only half finished.
 *
 * Forward runs delete exactly the responses THEY created (deskEntry.runId), never a field response
 * that happened to sit at the same door. Reverse runs put their archived responses back — unless
 * the {voterId, passId} slot was refilled by a later field submit, in which case the field wins and
 * the archive row stays put, counted in responsesNotRestored.
 */
export async function revertConversionRun({ run, campaign }) {
  run.status = 'reverting';
  run.progress = { phase: 'reverting', pct: 0, doorsDone: 0, doorsTotal: run.counts.doorsTargeted };
  await run.save();

  const stamp = { 'reclassified.runId': run._id };
  const doorRows = await CanvassActivity.aggregate([{ $match: stamp }, { $group: { _id: '$householdId' } }]);
  const doorIds = doorRows.map((r) => r._id);

  const voterIds = [];

  if (run.direction === 'to_survey') {
    const created = await SurveyResponse.find({ 'deskEntry.runId': run._id }, 'voterId').lean();
    voterIds.push(...created.map((r) => r.voterId));
    await SurveyResponse.deleteMany({ 'deskEntry.runId': run._id });
  } else {
    const archived = await SurveyResponseArchive.find({ conversionRunId: run._id }).lean();
    let notRestored = 0;
    const promoted = [];
    // Whether the slot is free is decided by an explicit READ, not by whether the unique index
    // happens to fire. The {voterId, passId} index is the real guarantee in production, but it is
    // built by a deploy step (autoIndex is off there) — so a data-destroying decision must not
    // depend on it existing. The E11000 catch below stays as belt-and-braces for the race.
    const wanted = archived.map((d) => ({ voterId: d.voterId, passId: d.passId ?? null }));
    const taken = wanted.length ? await SurveyResponse.find({ $or: wanted }, 'voterId passId').lean() : [];
    const takenKeys = new Set(taken.map((r) => `${r.voterId}|${r.passId ?? 'null'}`));

    const cannotRestore = (doc) => {
      notRestored += 1;
      if (run.samples.length < SAMPLE_CAP) {
        run.samples.push({ voterId: doc.voterId, voterName: null, reason: 'not_restored' });
      }
    };

    for (const doc of archived) {
      // A canvasser answered this voter again in the field after the conversion. Their answer is
      // newer and real — never clobber it. The archive row stays put, and is listed.
      if (takenKeys.has(`${doc.voterId}|${doc.passId ?? 'null'}`)) {
        cannotRestore(doc);
        continue;
      }
      const snapshot = snapshotFromArchive(doc);
      try {
        await SurveyResponse.create(snapshot);
        promoted.push(doc._id);
        voterIds.push(doc.voterId);
      } catch (e) {
        if (e?.code !== 11000) throw e;
        cannotRestore(doc);
      }
    }
    if (promoted.length) await SurveyResponseArchive.deleteMany({ _id: { $in: promoted } });
    run.counts.responsesNotRestored = notRestored;
  }

  await CanvassActivity.updateMany(stamp, [
    { $set: { actionType: '$reclassified.from', voterId: '$reclassified.voterIdWas' } },
    { $unset: 'reclassified' },
  ]);

  await settle({ campaign, doorIds, voterIds });
  await historyRow(run, campaign, { swap: true });

  run.status = 'reverted';
  run.revertedAt = new Date();
  run.progress = { phase: null, pct: 100, doorsDone: doorIds.length, doorsTotal: doorIds.length };
  await run.save();
  return run;
}
