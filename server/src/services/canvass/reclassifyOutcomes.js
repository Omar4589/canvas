import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { Household } from '../../models/Household.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import { recomputeHouseholdStatusesBatched } from './status.js';
import { hydrateSurveyEvidence } from './answerScope.js';
import { knocksPipeline, billableDoorsOf, contactRate, connectionRate } from '../reports/aggregations.js';
import { recomputeCampaignStats } from '../reports/campaignCounters.js';

// Rewriting what a door entry SAYS happened — the Door Outcomes page.
//
// Two different acts share this machinery, and the difference matters:
//   • CORRECTION — "the canvasser hit the wrong button; this door was really Refused." The
//     numbers were wrong before, so moving them is the POINT.
//   • FOLDING — "we retired No soliciting; make its history read Not home." The entries were
//     TRUE, so moving a reported number would be fabrication.
// The product doesn't ask which one you meant. Instead every conversion is priced before it
// runs (computeImpact) and the confirm step states the effect in the campaign's own numbers, so
// a fold that would quietly move an invoice is impossible to perform by accident.
//
// WHAT CHANGES: actionType, and door status downstream of it (statusPrecedence maps each outcome
// to its own status). GPS, timestamp, canvasser, pass, turf, effort, coordinator and `replaced`
// are all preserved — this is a re-labelling, never a re-recording. Every run is stamped,
// listed, and revertible.

// The five DOOR outcomes — everything THIS module may convert, in either direction.
//
// Completion actions (`survey_submitted`, `lit_dropped`) are absent and must stay absent HERE, and
// the reason is still true: a surveyed entry owns a real SurveyResponse, so a bare actionType flip
// INTO it fabricates answers that were never given, and a bare flip OUT of it orphans answers that
// were. This module has no answer composer and no archive, so it cannot honestly do either — its
// refusal (validatePair) is precise, not squeamish.
//
// The Surveyed direction IS possible, but only with machinery that pays for what the flip alone
// would destroy: an admin supplying real answers against the door's own template, a `deskEntry`
// stamp on every created row, and archive-not-delete on the way out. That lives in the sibling
// services/canvass/surveyConversion.js. Do not "simplify" it back into here — see that file's
// header for why its write ORDER is the mirror image of runReclassify's.
export const RECLASSIFIABLE_OUTCOMES = Object.freeze([
  'not_home',
  'wrong_address',
  'refused',
  'no_soliciting',
  'restricted',
]);

// Everything the Door Outcomes page's ENTRIES TABLE may list. Wider than what this module
// converts: surveyed rows are selectable so they can be handed to surveyConversion.js.
export const CONVERTIBLE_SOURCES = Object.freeze([...RECLASSIFIABLE_OUTCOMES, 'survey_submitted']);

// Everything the UNKNOCK path may remove — wider than what any path may relabel, and the reason
// is the operation itself. `lit_dropped` is kept out of a RELABEL because a completion action owns
// data a bare actionType flip would fabricate or orphan. A delete fabricates nothing: it strikes
// the whole entry. And a faked lit drop is a billable knock (KNOCK_ACTIONS) that needs no answers
// to invent, so it is the cheapest entry to fake — excluding it would leave lit-drop campaigns
// with no fraud cleanup at all. `note_added` stays out: a note is not a knock, drives no status,
// and an unknocked door may legitimately carry one.
export const UNKNOCKABLE_SOURCES = Object.freeze([...CONVERTIBLE_SOURCES, 'lit_dropped']);

// The three that are interchangeable ARITHMETIC: each is exactly one knock and none is a contact,
// so any conversion among them provably moves nothing — not knocks, not contactRate (numerator is
// surveyed + refused), not connectionRate (surveyed + lit), not billableDoors, and no
// Campaign.stats counter (no key counts these three individually — verified against
// models/Campaign.js). A pair inside this set skips both the impact simulation and the counter
// recompute below, which is also what keeps a whole-outcome fold unbounded.
//
// `refused` and `restricted` are the mirror image: refused IS a contact and restricted is a
// billable non-knock, so any pair touching them moves a reported number. They are allowed —
// a wrong button deserves a real fix — but always priced first, and never silently.
export const RATE_NEUTRAL_OUTCOMES = Object.freeze(['not_home', 'wrong_address', 'no_soliciting']);

// A 'mixed' source (one run spanning several outcomes) is deliberately NOT neutral: the safe
// answer when the origin isn't a single known outcome is to price it and recompute counters.
export const isRateNeutralPair = (from, to) =>
  RATE_NEUTRAL_OUTCOMES.includes(from) && RATE_NEUTRAL_OUTCOMES.includes(to);

// A money-moving conversion is capped: it simulates over the campaign's ledger and recomputes
// counters afterwards, so it is the one path whose cost scales with the SELECTION rather than
// with a stamped-row cursor. 25k is far above any plausible correction and far below anything
// that would threaten the request budget. Rate-neutral folds are deliberately uncapped.
export const RECLASSIFY_MAX_IMPACT_ENTRIES = 25000;

/**
 * Rows a conversion may still touch: never a bulk desk mark, never an already-stamped row.
 *
 * Exported because services/canvass/surveyConversion.js needs the IDENTICAL two provenance rules
 * and must not retype them — a second copy that drifts is how a desk-surveyed row would become
 * eligible for a plain reclassify on top of itself. `outcomes` widens the default set for that
 * caller (it selects surveyed rows); every existing caller omits it and is unchanged.
 */
export const convertibleMatch = (campaignId, actionType, outcomes = RECLASSIFIABLE_OUTCOMES) => ({
  campaignId,
  ...(actionType ? { actionType } : { actionType: { $in: outcomes } }),
  // Desk-authored restricted marks are not field observations: converting one into a knock would
  // invent a walk that never happened, attributed to the admin who made the desk mark. They have
  // their own undo already (unrestrict-bulk / unrestrict-doors).
  via: { $ne: 'bulk' },
  // Provenance stays SINGLE-LEVEL so revert is exact: a row already carrying a stamp is out of
  // scope until its run is reverted.
  reclassified: { $exists: false },
});

/** { entries, doors } for one source outcome — the numbers the confirm step shows. */
export async function countConvertible(campaignId, from) {
  const match = convertibleMatch(campaignId, from);
  const [entries, doorAgg] = await Promise.all([
    CanvassActivity.countDocuments(match),
    CanvassActivity.aggregate([{ $match: match }, { $group: { _id: '$householdId' } }, { $count: 'doors' }]),
  ]);
  return { entries, doors: doorAgg[0]?.doors || 0 };
}

/**
 * The App Customization card's shortcut list: outcomes this campaign has RETIRED that still have
 * history. Deliberately narrower than what the Door Outcomes page offers — the card exists for
 * the "I turned this off, now fold it in" follow-up, and only rate-neutral folds are safe to
 * offer as a one-click action with no impact review.
 */
export async function eligibleSources(campaign) {
  const disabled = new Set(campaign.disabledOutcomes || []);
  const out = {};
  for (const outcome of RATE_NEUTRAL_OUTCOMES) {
    if (!disabled.has(outcome)) continue;
    const counts = await countConvertible(campaign._id, outcome);
    if (counts.entries > 0) out[outcome] = counts;
  }
  return out;
}

/** Card targets: rate-neutral, still switched ON, and not the source itself. */
export function eligibleTargets(campaign, from = null) {
  const disabled = new Set(campaign.disabledOutcomes || []);
  return RATE_NEUTRAL_OUTCOMES.filter((o) => !disabled.has(o) && o !== from);
}

/**
 * Validate a requested pair. Returns null when legal, else { status, body } ready to send.
 *
 * The source no longer has to be switched off (owner ruling 2026-08-16 — the Door Outcomes page
 * is explicit enough on its own; requiring a toggle first made correcting a live campaign's
 * mistyped entry impossible). The TARGET still may not be a retired outcome: moving history INTO
 * something the campaign has stopped recording contradicts the retirement.
 */
export function validatePair(campaign, from, to) {
  if (!RECLASSIFIABLE_OUTCOMES.includes(from) || !RECLASSIFIABLE_OUTCOMES.includes(to)) {
    return {
      status: 400,
      body: {
        error:
          'Only door outcomes can be reclassified. Surveyed and lit-dropped entries carry recorded survey data, so they can never be converted.',
        code: 'OUTCOME_NOT_RECLASSIFIABLE',
      },
    };
  }
  if (from === to) {
    return { status: 400, body: { error: 'Pick two different outcomes.', code: 'OUTCOME_SAME' } };
  }
  if (new Set(campaign.disabledOutcomes || []).has(to)) {
    return {
      status: 400,
      body: {
        error: 'That outcome is switched off for this campaign — pick one canvassers can still record.',
        code: 'TARGET_DISABLED',
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The entries browser
// ---------------------------------------------------------------------------

/**
 * Mongo filter for the page's table and for a filter-scoped run. Every field is optional; the
 * campaign scope and the two provenance rules are not.
 *
 * PURE AND SYNCHRONOUS on purpose — listEntries calls it twice per request (rows+count, then the
 * facet aggregate) and resolveSelection a third time. Everything that needs a DB read or that can
 * be misinterpreted — the civil-date window, id casting, the survey-answer join — is resolved
 * ONCE upstream by services/canvass/entryScope.js and arrives here ready to assign.
 *
 * The `__resolved` throw is that arrangement's enforcement. A future call site that hands this an
 * unresolved wire scope would silently drop its date window and its answer filter and select a
 * WIDER set than the admin saw — which, under "Select all N matching", is a wider WRITE. Failing
 * loudly in a test beats that.
 */
export function buildEntryFilter(campaignId, q = {}, outcomes = RECLASSIFIABLE_OUTCOMES) {
  if (!q.__resolved) {
    throw new Error(
      'buildEntryFilter: q must come from resolveEntryScope() — a raw wire scope would silently ' +
        'drop its date window and its answer filter, widening the selection.'
    );
  }
  const filter = convertibleMatch(campaignId, null, outcomes);
  if (q.outcomes?.length) filter.actionType = { $in: q.outcomes.filter((o) => outcomes.includes(o)) };
  if (q.userId) filter.userId = q.userId;
  if (q.passId) filter.passId = q.passId;
  if (q.effortId) filter.effortId = q.effortId;
  if (q.timestamp) filter.timestamp = q.timestamp;
  // Address search, already resolved to door ids by resolveEntryScope. A present-but-EMPTY
  // array is a search that matched nothing and must select nothing — the $in stays.
  if (q.householdIdIn) filter.householdId = { $in: q.householdIdIn };
  // $and, never a bare key: the answer clause is itself $or-shaped, and resolveSelection owns
  // `_id` for the actionIds narrowing. $and is the only composition where neither can clobber
  // the other (the rule reports.js states for the same clause builders).
  if (q.answerClause) filter.$and = [...(filter.$and || []), q.answerClause];
  return filter;
}

/** One page of entries plus the per-outcome totals for the whole filtered set. */
export async function listEntries(campaignId, q = {}, { skip = 0, limit = 50, outcomes = RECLASSIFIABLE_OUTCOMES, sort = { timestamp: -1, _id: 1 } } = {}) {
  const filter = buildEntryFilter(campaignId, q, outcomes);
  const [rows, total, doorAgg, facets] = await Promise.all([
    CanvassActivity.find(filter, {
      householdId: 1, actionType: 1, userId: 1, timestamp: 1, passId: 1,
    })
      // The `_id` tiebreaker is not decoration: Mongo gives ties no stable order across separate
      // skip/limit queries, and every fixture-shaped ledger is FULL of identical timestamps.
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    CanvassActivity.countDocuments(filter),
    // Distinct DOORS under the FULL filter (chips honored — deliberately not shared with the
    // facet aggregate below, whose $match drops the chips; one $facet serving both would force
    // one of them to lie). Same shape countConvertible uses above.
    CanvassActivity.aggregate([
      { $match: filter },
      { $group: { _id: '$householdId' } },
      { $count: 'doors' },
    ]),
    CanvassActivity.aggregate([
      // Facet counts ignore the outcome chips (you need to see what ELSE is there to pick it),
      // but honor every other filter — the spread carries the resolved date window and the
      // answer clause through untouched, which is why they live ON q.
      { $match: buildEntryFilter(campaignId, { ...q, outcomes: [] }, outcomes) },
      { $group: { _id: '$actionType', n: { $sum: 1 } } },
    ]),
  ]);

  const [doors, surveyByRow] = await Promise.all([
    Household.find(
      { _id: { $in: [...new Set(rows.map((r) => String(r.householdId)))] } },
      { addressLine1: 1, unit: 1, city: 1 }
    ).lean(),
    // Who answered at each surveyed row's visit, and (under an answer filter) who matched —
    // page-bounded, skipped when the page holds no surveyed rows. See answerScope.js.
    hydrateSurveyEvidence(rows, q),
  ]);
  const doorById = new Map(doors.map((d) => [String(d._id), d]));
  const facetCounts = Object.fromEntries(facets.map((f) => [f._id, f.n]));

  return {
    entries: rows.map((r) => {
      const d = doorById.get(String(r.householdId));
      const survey = surveyByRow.get(String(r._id));
      return {
        id: String(r._id),
        householdId: String(r.householdId),
        address: d ? [d.addressLine1, d.unit ? `#${d.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
        city: d?.city || '',
        actionType: r.actionType,
        userId: r.userId ? String(r.userId) : null,
        passId: r.passId ? String(r.passId) : null,
        timestamp: r.timestamp,
        ...(survey ? { survey } : {}),
      };
    }),
    total,
    doors: doorAgg[0]?.doors || 0,
    facets: facetCounts,
    // What the MATCHING SET is made of — the chips honored when set, every present outcome
    // otherwise. Derived from the facet aggregate at zero extra queries; the client reads the
    // selection's direction off this rather than guessing from which chips are ticked.
    sources: q.outcomes?.length
      ? q.outcomes.filter((o) => facetCounts[o] > 0)
      : Object.keys(facetCounts).filter((k) => facetCounts[k] > 0),
  };
}

/**
 * Turn a request's scope into the exact activity ids a run would touch.
 *
 * `actionIds` may only NARROW the filter — ids outside it are dropped rather than written, the
 * same rule the flag bulk-review uses, so a stale checkbox can never reach a row the admin's
 * current filter doesn't show.
 */
export async function resolveSelection(campaignId, q = {}, actionIds = null, outcomes = RECLASSIFIABLE_OUTCOMES) {
  const filter = buildEntryFilter(campaignId, q, outcomes);
  if (actionIds?.length) {
    filter._id = { $in: actionIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }
  // userId/passId ride along for the survey-conversion caller, whose preview joins each row to
  // its SurveyResponses on the {householdId, passId, userId} triple. Two extra ObjectIds on a
  // capped projection — cheaper than the second resolver that used to exist for their sake.
  const rows = await CanvassActivity.find(filter, { householdId: 1, actionType: 1, userId: 1, passId: 1 }).lean();
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
 * Narrow an already-resolved selection to a path's legal sources, in memory.
 *
 * Provably equal to re-running resolveSelection with the narrower `outcomes` argument — the two
 * filters differ only in the actionType intersect, and every other clause already applied — so
 * the write routes can resolve ONCE against CONVERTIBLE_SOURCES (to see whether the selection
 * spans the surveyed boundary and refuse it honestly) and then narrow without a second query.
 */
export function narrowSelection(sel, outcomes) {
  const rows = sel.rows.filter((r) => outcomes.includes(r.actionType));
  const householdIds = [...new Set(rows.map((r) => String(r.householdId)))];
  return {
    ids: rows.map((r) => r._id),
    rows,
    householdIds: householdIds.map((h) => new mongoose.Types.ObjectId(h)),
    entries: rows.length,
    doors: householdIds.length,
    sources: [...new Set(rows.map((r) => r.actionType))],
  };
}

/**
 * Does this selection straddle the surveyed / not-surveyed boundary?
 *
 * The one mix the two write paths cannot honestly serve: a plain reclassify would silently drop
 * the surveyed rows and a survey conversion would silently drop the others, so the action bar
 * would say 12 while the run writes 10. The routes refuse it (SELECTION_SPANS_DIRECTIONS)
 * instead. A selection spanning several DOOR outcomes is a different, fully supported thing —
 * runReclassify records from:'mixed' and stamps each row's own origin.
 */
export const selectionSpansDirections = (sel) =>
  sel.sources.includes('survey_submitted') && sel.sources.length > 1;

// ---------------------------------------------------------------------------
// Pricing a conversion
// ---------------------------------------------------------------------------

const totalsOf = (row, billRestricted) => ({
  knocks: row?.knocks || 0,
  billableDoors: billableDoorsOf(row || {}, billRestricted),
  restrictedDoors: row?.restrictedDoors || 0,
  contactRate: contactRate(row || {}),
  connectionRate: connectionRate(row || {}),
});

/**
 * What this conversion would do to the campaign's reported numbers.
 *
 * The "after" figures come out of the SAME knocksPipeline that produces the "before" ones, with
 * a `$set` ahead of it rewriting actionType for exactly the selected rows — a simulation through
 * the production aggregation rather than a parallel formula that could drift from it. The int
 * test asserts the previewed "after" equals the real totals once the run lands, so a divergence
 * fails the build instead of quietly misinforming an admin.
 *
 * Skipped entirely for a rate-neutral pair: the answer is provably "nothing moves", and running
 * a full-ledger simulation to rediscover that would put a scan in front of the common fold.
 */
export async function computeImpact({ campaign, ids, to, billRestricted }) {
  const campaignId = campaign._id;
  const opts = { includeRestricted: true };
  const [beforeRow] = await CanvassActivity.aggregate(knocksPipeline({ campaignId }, opts));
  const [afterRow] = await CanvassActivity.aggregate([
    { $match: { campaignId } },
    { $set: { actionType: { $cond: [{ $in: ['$_id', ids] }, to, '$actionType'] } } },
    ...knocksPipeline({ campaignId }, opts),
  ]);
  const before = totalsOf(beforeRow, billRestricted);
  const after = totalsOf(afterRow, billRestricted);
  return {
    before,
    after,
    moves: Object.keys(before).some((k) => before[k] !== after[k]),
  };
}

// ---------------------------------------------------------------------------
// Running and reverting
// ---------------------------------------------------------------------------

// Stamps THIS module owns. Survey conversions stamp the same field with kind 'to_survey' /
// 'from_survey' and are undone by their own module, which also has to put the answers back — so
// both the sweep and the revert below say so explicitly. Run ids can't collide (they're
// ObjectIds), so this is legibility, not a live bug being fixed.
const OUTCOME_RUN_MATCH = (runId) => ({
  'reclassified.runId': runId,
  'reclassified.kind': { $in: [null, 'outcome'] },
});

/** Households touched by a run, read off the stamp (the run's own record of what it changed). */
async function householdsOfRun(runId) {
  const rows = await CanvassActivity.aggregate([
    { $match: OUTCOME_RUN_MATCH(runId) },
    { $group: { _id: '$householdId' } },
  ]);
  return rows.map((r) => r._id);
}

/**
 * Convert a selection to `to`.
 *
 * Pass `ids` for a scoped run (the Door Outcomes page) or `from` alone for a whole-outcome fold
 * (the App Customization card) — the fold stays id-free so it is unbounded.
 *
 * ORDER: rows are stamped FIRST, then the ReclassifyRun row is written — the same rule
 * CampaignChange follows in routes/admin/campaigns.js ("a row here must mean this change
 * landed"). The runId is minted up front so the stamp can carry it. The narrow failure window is
 * deliberate and the safe direction: a run doc that fails to insert leaves correctly-converted
 * rows that simply aren't listed (and still carry `from`, so nothing is lost), whereas writing
 * the run first would offer a Revert for a conversion that never happened.
 */
export async function runReclassify({ campaign, from, to, ids = null, byUserId, selection = null, scopeSummary = null }) {
  const runId = new mongoose.Types.ObjectId();
  const scoped = Array.isArray(ids);
  const match = scoped
    ? { ...convertibleMatch(campaign._id, null), _id: { $in: ids } }
    : convertibleMatch(campaign._id, from);

  // Counted BEFORE the write: afterwards the rows no longer match `from`.
  const doorIds = scoped
    ? null
    : (await CanvassActivity.aggregate([{ $match: match }, { $group: { _id: '$householdId' } }])).map((r) => r._id);
  const entries = scoped ? ids.length : await CanvassActivity.countDocuments(match);

  // `from` is per-ROW on a scoped run: a mixed selection (some not-home, some refused) is one
  // run, and each row remembers its own origin so revert restores every one of them correctly.
  await CanvassActivity.updateMany(match, [
    {
      $set: {
        // `kind` is written explicitly: an aggregation-pipeline $set bypasses Mongoose defaults,
        // so relying on the schema's default 'outcome' would store no field at all.
        reclassified: {
          from: '$actionType',
          at: new Date(),
          byUserId: byUserId || null,
          runId,
          kind: 'outcome',
        },
        actionType: to,
      },
    },
  ]);

  const affected = scoped ? await householdsOfRun(runId) : doorIds;

  const run = await ReclassifyRun.create({
    _id: runId,
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    from,
    to,
    count: entries,
    doorCount: affected.length,
    byUserId: byUserId || null,
    // What produced this run — the validated wire scope plus its frozen human line, so the run
    // list can tell a narrow scoped correction from a whole-campaign fold.
    ...(selection ? { selection } : {}),
    ...(scopeSummary ? { scopeSummary } : {}),
  });

  await CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field: 'outcomeReclassify',
    fromValue: from,
    toValue: to,
    byUserId: byUserId || null,
    source: 'outcome_reclassify',
  });

  await recomputeHouseholdStatusesBatched(affected, campaign.type);
  // Only a money-moving pair can shift a denormalized counter; a rate-neutral fold provably
  // cannot, and re-aggregating the whole ledger to confirm that would be the slowest part of
  // the common case.
  if (!isRateNeutralPair(from, to)) await recomputeCampaignStats(campaign._id);
  return run;
}

/**
 * Undo one run: restore each stamped row's original actionType and drop the stamp.
 *
 * Exact by construction — only rows this run stamped carry its runId, and each carries the
 * outcome IT had, so a mixed selection reverts correctly. Household ids are collected BEFORE
 * the unset, because the stamp is what identifies them.
 */
export async function revertReclassify({ campaign, run, byUserId }) {
  const householdIds = await householdsOfRun(run._id);

  await CanvassActivity.updateMany(OUTCOME_RUN_MATCH(run._id), [
    { $set: { actionType: '$reclassified.from' } },
    { $unset: 'reclassified' },
  ]);

  run.revertedAt = new Date();
  await run.save();

  // Swapped on purpose: the feed reads left-to-right, so a revert says to → from.
  await CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field: 'outcomeReclassify',
    fromValue: run.to,
    toValue: run.from,
    byUserId: byUserId || null,
    source: 'outcome_reclassify',
  });

  await recomputeHouseholdStatusesBatched(householdIds, campaign.type);
  if (!isRateNeutralPair(run.from, run.to)) await recomputeCampaignStats(campaign._id);
  return run;
}
