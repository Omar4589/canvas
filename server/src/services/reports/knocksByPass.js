import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import {
  KNOCK_ACTIONS,
  BILLABLE_WITH_RESTRICTED,
  NOT_BULK,
  knocksPipeline,
  billableDoorsOf,
  connectionRate,
  contactRate,
  withTeam,
} from './aggregations.js';
import { billRestrictedFor } from './billRestricted.js';
import { hydrateCanvassers } from './canvasserIdentity.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// The req-free core of the per-round (knocks-by-pass) report. Extracted from
// routes/admin/reports.js so the JSON route, the invoice CSV route, and the Export Center's
// knocks-by-round file all compute through ONE pipeline — Σ(rounds) === totals holds by
// construction only while every consumer goes through here. reports.js keeps a thin
// buildKnocksByPass(req) adapter; behavior of the two existing routes is unchanged.
//
// Every pipeline runs `knocksPipeline` with the same includeRestricted and the same
// billableDoorsOf policy on both the per-round and total sides. A billable knock is one
// distinct (householdId, passId). "New homes reached" (coverageGained) = households whose
// FIRST-EVER campaign knock landed in that round; the scan is deliberately campaign-lifetime
// and effort-unscoped (CanvassActivity.effortId is stamped at knock time and never restamped,
// so an effort-scoped scan would call a force-claimed, previously-worked door "new").
//
// `timestampRange` is the pre-resolved { $gte / $lt } window over `timestamp` (built by the
// caller in the ANCHOR timezone — parseDateRange on the route, zonedDayRange in the worker).
// The SURVEY side reuses the same window against `submittedAt` — the response ledger's own
// clock, exactly as /campaign-rollup and /canvassers window it. Applying `timestampRange` to
// `timestamp` on SurveyResponse would match nothing (no such field) and report a silent zero.
//
// `team` is a teamMatch-shaped clause (routes build it via crewFilter; the Export Center's
// full-backup passes nothing) — merged via withTeam, never spread, and applied only to the
// ACTIVITY pipelines: the Pass/Effort metadata rows stay campaign-wide so a crew that never
// worked round 3 still shows a real zero row, same as the effort filter behaves.
export async function buildKnocksByPassData({
  organizationId,
  campaignId,
  effortId = null,
  timestampRange = null,
  groupByCanvasser = false,
  team = null,
}) {
  const cFilter = { organizationId: oid(organizationId), campaignId: oid(campaignId) };
  if (effortId) cFilter.effortId = oid(effortId);
  const windowed = timestampRange ? { timestamp: timestampRange } : {};
  const match = withTeam({ ...cFilter, ...windowed }, team);
  // The response-unit ledger. Same org/campaign/effort scope and the same crew clause — only
  // the date FIELD differs (see the note above). effortId is denormalized onto SurveyResponse,
  // so cFilter scopes it without a join, exactly as it does for CanvassActivity.
  const surveyMatch = withTeam(
    { ...cFilter, ...(timestampRange ? { submittedAt: timestampRange } : {}) },
    team
  );

  // Org-scope the metadata lookups too — the activity aggregates are org-scoped via cFilter,
  // but without organizationId here a foreign campaignId would still leak another org's
  // walk-list/round names and dates as zero-knock rows.
  const passFilter = { organizationId: cFilter.organizationId, campaignId: cFilter.campaignId };
  if (cFilter.effortId) passFilter.effortId = cFilter.effortId;

  // Does this campaign invoice restricted doors? The pipelines below ALWAYS gather them
  // (so `restrictedDoors` reports what exists, consistently with /overview and the rollup);
  // this flag only decides what gets presented as the billable figure, via billableDoorsOf.
  const billRestricted = await billRestrictedFor(cFilter.organizationId, cFilter.campaignId);
  const knockOpts = { includeRestricted: true };

  const [perPass, totalRows, firstKnockRows, surveysPerPass, passes, efforts] = await Promise.all([
    CanvassActivity.aggregate(knocksPipeline(match, { ...knockOpts, byPass: true })),
    CanvassActivity.aggregate(knocksPipeline(match, knockOpts)),
    CanvassActivity.aggregate([
      // The first-ever determination stays CAMPAIGN-WIDE even under a crew filter — "new" means
      // new to the campaign, not new to the crew. The crew clause is applied AFTER the per-house
      // group, against the first knock's own stamp: a door counts for a crew iff the campaign's
      // first-ever knock on it was that crew's. The $first accumulators below deliberately carry
      // teamMatch's field names (coordinatorId, userId) so the clause applies verbatim — casts
      // matter here, this is an uncast aggregation context.
      {
        $match: {
          organizationId: cFilter.organizationId,
          campaignId: cFilter.campaignId,
          actionType: { $in: KNOCK_ACTIONS },
        },
      },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: '$householdId',
          firstAt: { $first: '$timestamp' },
          firstPassId: { $first: '$passId' },
          coordinatorId: { $first: { $ifNull: ['$coordinatorId', null] } },
          userId: { $first: '$userId' },
        },
      },
      ...(team && Object.keys(team).length ? [{ $match: team }] : []),
      ...(windowed.timestamp ? [{ $match: { firstAt: windowed.timestamp } }] : []),
      { $group: { _id: '$firstPassId', coverageGained: { $sum: 1 } } },
    ]),
    // Surveys taken (response ROWS) per round — the third survey unit, beside the door-unit
    // `surveyedKnocks` the same table already shows. A bare {$sum: 1} is the whole definition:
    // SurveyResponse is unique on {voterId, passId}, so one row IS one form, and every row
    // carries exactly one passId. That makes Σ(rounds) === totals hold by construction, the
    // way `knocks` does — and it is the reason a DISTINCT-VOTER column could never live here
    // (a voter surveyed in two rounds belongs to both, so the rows could not partition).
    SurveyResponse.aggregate([
      { $match: surveyMatch },
      { $group: { _id: '$passId', surveysTaken: { $sum: 1 } } },
    ]),
    Pass.find(passFilter, 'roundNumber name status effortId activatedAt archivedAt').lean(),
    Effort.find({ organizationId: cFilter.organizationId, campaignId: cFilter.campaignId }, 'name').lean(),
  ]);

  const effortName = new Map(efforts.map((e) => [String(e._id), e.name]));
  const passById = new Map(passes.map((p) => [String(p._id), p]));
  const countsByPass = new Map(perPass.map((r) => [String(r._id), r]));
  const coverageByPass = new Map(firstKnockRows.map((r) => [String(r._id), r.coverageGained]));
  const surveysByPass = new Map(surveysPerPass.map((r) => [String(r._id), r.surveysTaken]));

  // Row set = every round of the campaign/effort (even 0-knock ones — "R2 active, no
  // knocks yet" is real information) + any agg bucket without a Pass doc (legacy
  // passId:null, or a knock whose pass was deleted).
  //
  // The SURVEY buckets are unioned in too, not just the knock ones. A response whose paired
  // survey_submitted row was deleted (a re-disposition cleans up only the submitting user's
  // activity rows) would otherwise land in a bucket the table never renders — and since
  // totals.surveysTaken is the sum of the DISPLAYED rows, those forms would vanish from the
  // total while still existing. Unioning keeps Σ(rounds) === the true count.
  const rowKeys = new Set([
    ...passes.map((p) => String(p._id)),
    ...perPass.map((r) => String(r._id)),
    ...surveysPerPass.map((r) => String(r._id)),
  ]);
  const shapeRow = (key) => {
    const p = passById.get(key) || null;
    const k = countsByPass.get(key) || {
      knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0, noSolicitingKnocks: 0, billableDoors: 0, restrictedDoors: 0,
    };
    const legacy = key === 'null' || key === 'undefined';
    return {
      passId: legacy ? null : key,
      effortId: p ? String(p.effortId) : null,
      effortName: p ? effortName.get(String(p.effortId)) || null : null,
      roundNumber: p ? p.roundNumber : null,
      roundName: p ? p.name : null,
      roundLabel: p ? `Pass ${p.roundNumber} · ${p.name}` : 'Legacy / no pass',
      status: p ? p.status : null,
      activatedAt: p?.activatedAt || null,
      archivedAt: p?.archivedAt || null,
      knocks: k.knocks,
      surveyedKnocks: k.surveyedKnocks,
      // The response unit — "Surveys taken". NEVER interchangeable with surveyedKnocks above
      // (doors) or with a distinct-voter count: one door can survey several voters, and one
      // voter can be surveyed again in a later round. See docs/METRICS.md's three-units box.
      surveysTaken: surveysByPass.get(key) || 0,
      litKnocks: k.litKnocks,
      refusedKnocks: k.refusedKnocks,
      noSolicitingKnocks: k.noSolicitingKnocks,
      // Equal to `knocks` unless this campaign invoices restricted doors. Rates below are
      // deliberately built from `knocks` in BOTH cases — a locked gate answered nobody.
      billableDoors: billableDoorsOf(k, billRestricted),
      // Always the true count, billed or not, so the UI can offer the opt-in when it's > 0.
      restrictedDoors: k.restrictedDoors,
      connectionRate: connectionRate(k),
      contactRate: contactRate(k),
      coverageGained: coverageByPass.get(key) || 0,
    };
  };
  const rounds = [...rowKeys].map(shapeRow).sort(
    (a, b) =>
      (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
      (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)
  );

  const t = totalRows[0] || {
    knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0, noSolicitingKnocks: 0, billableDoors: 0, restrictedDoors: 0,
  };
  const totals = {
    knocks: t.knocks,
    surveyedKnocks: t.surveyedKnocks,
    litKnocks: t.litKnocks,
    refusedKnocks: t.refusedKnocks,
    noSolicitingKnocks: t.noSolicitingKnocks,
    // Same pipeline, same (household, pass) dedup as the per-round rows above, and the same
    // policy helper — so Σ(rounds.billableDoors) === totals.billableDoors by construction,
    // exactly like knocks.
    billableDoors: billableDoorsOf(t, billRestricted),
    restrictedDoors: t.restrictedDoors,
    connectionRate: connectionRate(t),
    contactRate: contactRate(t),
    // Sum the DISPLAYED rows, not every first-knock bucket — the scan is deliberately
    // effort-unscoped (see above), so under ?effortId other efforts' buckets exist but
    // aren't shown, and the TOTAL must stay the sum of the table.
    coverageGained: rounds.reduce((s, r) => s + r.coverageGained, 0),
    // Also summed from the displayed rows, for the same reason — and safe to do so because
    // rowKeys unions the survey buckets, so no bucket can exist without a row to carry it.
    // This is the per-round breakdown of /campaign-rollup's `surveysSubmitted` under the same
    // window, effort and crew, so the two surfaces reconcile.
    surveysTaken: rounds.reduce((s, r) => s + r.surveysTaken, 0),
  };

  let byCanvasser;
  let crossCanvasserDoors;
  if (groupByCanvasser) {
    const flag = (action) => ({ $max: { $cond: [{ $eq: ['$actionType', action] }, 1, 0] } });
    // Mirrors knocksPipeline's action set and hasKnock fold, one dimension wider (per user), so a
    // per-canvasser export and the round totals it breaks down count the same doors. NOT_BULK is
    // already applied campaign-wide here, so nothing extra is needed to keep desk marks out.
    const [userRows, nonBulkPerPass, surveysPerUser] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: { ...match, ...NOT_BULK, actionType: { $in: BILLABLE_WITH_RESTRICTED } } },
        {
          $group: {
            _id: { householdId: '$householdId', passId: '$passId', userId: '$userId' },
            hasKnock: { $max: { $cond: [{ $in: ['$actionType', KNOCK_ACTIONS] }, 1, 0] } },
            hasSurvey: flag('survey_submitted'),
            hasLit: flag('lit_dropped'),
            hasRefused: flag('refused'),
            hasNoSoliciting: flag('no_soliciting'),
          },
        },
        {
          $group: {
            _id: { passId: '$_id.passId', userId: '$_id.userId' },
            knocks: { $sum: '$hasKnock' },
            billableDoors: { $sum: 1 },
            restrictedDoors: { $sum: { $cond: [{ $eq: ['$hasKnock', 0] }, 1, 0] } },
            surveyedKnocks: { $sum: '$hasSurvey' },
            litKnocks: { $sum: '$hasLit' },
            refusedKnocks: { $sum: '$hasRefused' },
            noSolicitingKnocks: { $sum: '$hasNoSoliciting' },
          },
        },
      ]),
      // The cross-canvasser over-claim baseline. MUST carry the same includeRestricted as the
      // per-user rows above: comparing a restricted-inclusive per-user sum against a
      // knocks-only round total would report phantom overlap on every restricted door.
      CanvassActivity.aggregate(knocksPipeline({ ...match, ...NOT_BULK }, { ...knockOpts, byPass: true })),
      // Surveys taken per (round, canvasser). Unlike the DOOR columns beside it this needs no
      // over-claim correction and gets no crossCanvasser subtraction: a response carries exactly
      // one userId, so Σ(canvassers) === the round's surveysTaken exactly. NOT_BULK has no
      // analogue here either — a desk bulk-mark writes activity rows, never a SurveyResponse.
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        { $group: { _id: { passId: '$passId', userId: '$userId' }, surveysTaken: { $sum: 1 } } },
      ]),
    ]);
    const surveysByUserPass = new Map(
      surveysPerUser.map((r) => [`${String(r._id.passId)}|${String(r._id.userId)}`, r.surveysTaken])
    );
    const userMap = await hydrateCanvassers(
      userRows.filter((r) => r._id.userId != null).map((r) => String(r._id.userId)),
      cFilter.organizationId,
    );
    byCanvasser = userRows
      .filter((r) => r._id.userId != null)
      .map((r) => {
        const key = String(r._id.passId);
        const p = passById.get(key) || null;
        const info = userMap.get(String(r._id.userId)) || {};
        return {
          passId: p ? key : null,
          roundNumber: p ? p.roundNumber : null,
          roundName: p ? p.name : null,
          roundLabel: p ? `Pass ${p.roundNumber} · ${p.name}` : 'Legacy / no pass',
          effortName: p ? effortName.get(String(p.effortId)) || null : null,
          userId: String(r._id.userId),
          firstName: info.firstName || '',
          lastName: info.lastName || '',
          email: info.email || '',
          status: info.status || 'deleted',
          knocks: r.knocks,
          surveyedKnocks: r.surveyedKnocks,
          // Keyed off the RAW passId (not the `p ? key : null` display value above) so the
          // legacy no-pass bucket still finds its responses.
          surveysTaken: surveysByUserPass.get(`${key}|${String(r._id.userId)}`) || 0,
          litKnocks: r.litKnocks,
          refusedKnocks: r.refusedKnocks,
          noSolicitingKnocks: r.noSolicitingKnocks,
          billableDoors: billableDoorsOf(r, billRestricted),
          restrictedDoors: r.restrictedDoors,
          connectionRate: connectionRate(r),
          contactRate: contactRate(r),
        };
      })
      .sort(
        (a, b) =>
          (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
          (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity) ||
          b.billableDoors - a.billableDoors
      );
    // Both sides of the over-claim subtraction go through the SAME policy helper, so the
    // comparison stays apples-to-apples whether or not restricted doors are being billed.
    const nonBulkByPass = new Map(
      nonBulkPerPass.map((r) => [String(r._id), billableDoorsOf(r, billRestricted)])
    );
    const sumByPass = new Map();
    for (const r of byCanvasser) {
      const key = r.passId ?? 'null';
      sumByPass.set(key, (sumByPass.get(key) || 0) + r.billableDoors);
    }
    crossCanvasserDoors = 0;
    for (const [key, sum] of sumByPass) {
      crossCanvasserDoors += Math.max(0, sum - (nonBulkByPass.get(key) || 0));
    }
  }

  return { cFilter, rounds, totals, byCanvasser, crossCanvasserDoors, billRestricted };
}
