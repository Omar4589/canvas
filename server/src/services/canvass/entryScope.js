import mongoose from 'mongoose';
import { zonedDayRange } from '../../utils/timezone.js';
import { Household } from '../../models/Household.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { resolveAnswerScope } from './answerScope.js';

// Address search: how many DOORS a search may resolve to before it refuses to stand in for a
// write scope. Env-overridable at call time (the answerScopeCap pattern) so the truncation path
// is testable without ten thousand fixtures.
export const ADDRESS_SEARCH_MAX_DOORS = 10000;
export const addressSearchCap = () => Number(process.env.ADDRESS_SEARCH_MAX_DOORS) || ADDRESS_SEARCH_MAX_DOORS;

const escapeRegExp = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ONE translation from a wire scope (routes/admin/campaigns.js `entryScopeSchema`) into the
// `q` object every Door Outcomes filter builder takes.
//
// It exists because this page's whole safety model is "the filter you SEE is the scope that gets
// WRITTEN": under "Select all N matching" the client deliberately sends no ids, so the server
// re-resolves the selection from the scope alone — at dry-run time and again at write time. Any
// place where two pieces of code independently interpret that scope is a place where the table
// and the write can quietly disagree. There used to be two such places (buildEntryFilter and
// surveyConversion's resolveConversion), and they had already drifted: one read `q.from`, the
// other `scope.dateFrom`, with the route hand-translating between them.
//
// So: every route resolves ONCE, here, at the boundary. Everything that can go wrong — parsing a
// civil date into an instant, casting ids, and (later) running the survey-answer join — happens
// in this function and nowhere else. `buildEntryFilter` becomes a pure, synchronous assembler
// that is handed values it cannot misinterpret, and it THROWS on an unresolved scope so a future
// call site that forgets is a failing test rather than a silent over-write.

/** A refusal a route can send verbatim. Carries the HTTP status and the client-facing code. */
export class ScopeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ScopeError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Send a ScopeError as this router's standard { error, code } refusal. Returns false for anything
 * else, so a catch block reads `if (!sendScopeError(res, err)) next(err);`.
 *
 * Explicit rather than taught to the shared error middleware: that handler would have to forward
 * `err.code` for EVERY error, and Mongo's own errors carry numeric `code`s (E11000 and friends)
 * that have no business on a wire this page's clients switch on.
 */
export function sendScopeError(res, err) {
  if (!(err instanceof ScopeError)) return false;
  res.status(err.status).json({ error: err.message, code: err.code });
  return true;
}

const oid = (v) => (v ? new mongoose.Types.ObjectId(String(v)) : null);

/** Does this scope filter by survey answer at all? */
export const hasAnswerFilter = (scope = {}) =>
  !!(scope.answerFilters?.length || scope.answerTagFilters?.length);

/**
 * Does this scope narrow by anything OTHER than the outcome chips and the answers?
 *
 * The gate for the answer filter (see answerScope.js). The outcome chips deliberately don't
 * count: they only touch CanvassActivity, so they cannot bound the SurveyResponse read the gate
 * exists to bound.
 */
export const hasOtherNarrowing = (scope = {}) =>
  !!(scope.userId || scope.passId || scope.effortId || scope.dateFrom || scope.dateTo || scope.search);

/**
 * Resolve a validated wire scope against one campaign. Async because an answer filter costs a
 * SurveyResponse read; call it exactly once per request.
 *
 * Throws ScopeError for every refusal, so all four routes refuse identically.
 */
export async function resolveEntryScope(campaign, scope = {}) {
  // Date-only 'YYYY-MM-DD' days in, half-open [start(dateFrom), start(dateTo + 1)) out, resolved
  // in the CAMPAIGN's timezone — the contract every other dated surface in the console speaks
  // (docs/DATE_FILTERS.md). Never `new Date(ymd)`: that is UTC midnight, which both shifts the
  // window by the campaign's offset and, paired with an inclusive $lte, drops the whole `dateTo`
  // day — so a single-day preset like "Yesterday" resolved to a ZERO-WIDTH window.
  //
  // `campaign.timeZone` is always set (Campaign.js defaults it) and loadForReclassify hands the
  // routes a full non-lean document, so this needs no extra read and no anchorTz middleware —
  // that one is registered on the reports router only, and would resolve UTC here.
  const window = zonedDayRange(scope.dateFrom || null, scope.dateTo || null, campaign.timeZone);
  const timestamp = window.$gte || window.$lt ? window : null;

  let outcomes = scope.outcomes?.length ? [...scope.outcomes] : null;
  let answerClause = null;
  let answerScope = null;
  let answerMatch = null;

  // Address search resolves HERE, like the answer filter, because a search NARROWS — and
  // anything that narrows the table must narrow the write, or "Select all N matching" rewrites
  // rows the admin never saw. Matched against the display fields, never normalizedAddress: that
  // one is an uppercase pipe-joined dedupe key ('A1|A2|CITY|ST|ZIP5') no typed text can hit.
  let householdIdIn = null;
  let searchScope = null;
  if (scope.search) {
    const rx = new RegExp(escapeRegExp(scope.search), 'i');
    const cap = addressSearchCap();
    const doors = await Household.find(
      { campaignId: campaign._id, $or: [{ addressLine1: rx }, { city: rx }, { zipCode: rx }] },
      { _id: 1 }
    )
      .limit(cap + 1)
      .lean();
    const truncated = doors.length > cap;
    // Kept even when truncated: the TABLE may browse a capped set (the count reads as a lower
    // bound); the write routes refuse a truncated scope unless the admin ticked explicit rows.
    householdIdIn = (truncated ? doors.slice(0, cap) : doors).map((d) => d._id);
    searchScope = { matchedDoors: householdIdIn.length, truncated, cap };
  }

  if (hasAnswerFilter(scope)) {
    // The gate. A speed bump, not the safety (the cap in answerScope.js is the hard bound), but
    // it keeps the common case index-served: without any other narrowing the clause scans every
    // response in the campaign, twice per page load.
    if (!hasOtherNarrowing(scope)) {
      throw new ScopeError(
        400,
        'ANSWER_FILTER_NEEDS_NARROWING',
        'Filtering by survey answer also needs a canvasser, round, walk list, date range or address search — pick one of those first.'
      );
    }
    // A survey answer only ever exists on a Surveyed entry, so a non-Surveyed chip beside an
    // answer filter is a contradiction, not a combination.
    if (outcomes && !(outcomes.length === 1 && outcomes[0] === 'survey_submitted')) {
      throw new ScopeError(
        400,
        'ANSWER_FILTER_REQUIRES_SURVEYED',
        'A survey-answer filter only describes Surveyed entries — clear the other outcome chips.'
      );
    }
    // The RESPONSE's template, from the wire (falling back to the campaign default), never the
    // door's current effective template: question keys and option ids are slugs unique only
    // within one template, and a campaign that swapped surveys keeps the old responses under
    // the old id.
    const templateId = scope.surveyTemplateId || campaign.surveyTemplateId;
    const template = templateId
      ? await SurveyTemplate.findOne({ _id: templateId, organizationId: campaign.organizationId }).lean()
      : null;
    if (!template) {
      throw new ScopeError(
        400,
        'ANSWER_FILTER_NEEDS_TEMPLATE',
        'Pick which survey these answers were recorded under.'
      );
    }
    const resolved = await resolveAnswerScope({ campaign, template, scope, timestamp, householdIdIn });
    answerClause = resolved.clause;
    answerScope = {
      surveyTemplateId: String(template._id),
      responses: resolved.responses,
      doors: resolved.doors,
      truncated: resolved.truncated,
      cap: resolved.cap,
    };
    answerMatch = resolved.responseAnd;
    // Forced, not merely validated: the triple clause constrains (passId, userId, householdId)
    // but NOT actionType, so without this it would also match a door-outcome row at the same
    // triple. In practice none exists — the submit path deletes every replaceable action for
    // the triple before writing the survey row — but that invariant belongs to another module,
    // and leaning on it silently is the coupling this file exists to remove.
    outcomes = ['survey_submitted'];
  }

  return Object.freeze({
    __resolved: true,
    outcomes,
    userId: oid(scope.userId),
    passId: oid(scope.passId),
    effortId: oid(scope.effortId),
    timestamp,
    answerClause,
    // Wire metadata (answerScope, shipped by the GET) and the internal response-side clauses
    // (answerMatch, never shipped) are deliberately separate fields — one is for people, the
    // other is Mongo syntax.
    answerScope,
    answerMatch,
    // Address search, resolved to door ids. An EMPTY array means "matched nothing" and must
    // stay an empty $in — never a vanished filter.
    householdIdIn,
    searchScope,
    // The exact validated wire object, for freezing onto a run record.
    raw: scope,
  });
}
