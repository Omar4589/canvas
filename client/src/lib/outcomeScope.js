// The Door Outcomes page's filter scope — ONE object, two encodings.
//
// The page's safety model is "the filter you SEE is the scope that gets WRITTEN": under
// "Select all N matching" the client sends no ids, so the server re-resolves the selection from
// the scope alone, at dry-run time and again at write time. The page used to hold two
// hand-kept-parallel literals over the same state (a `scope` memo for the POST bodies and a `qs`
// memo for the GET), which is exactly how a filter gets honoured by the table and dropped by the
// write. Now `buildScope` is the only place filter state becomes a wire scope, and the query
// string is DERIVED from that object — it cannot carry a key the scope lacks, or lack one it
// carries.
//
// Wire names are the server's `entryScopeSchema` names verbatim. The date keys are
// dateFrom/dateTo, never from/to — those two name the OUTCOMES on the reclassify body.

/** Page filter state → the wire scope object. Empty keys omitted so the query key stays stable. */
export const buildScope = ({
  outcomes = [],
  userId = '',
  passId = '',
  effortId = '',
  dateRange = null,
  search = '',
  surveyTemplateId = '',
  answerFilters = [],
  answerTagFilters = [],
} = {}) => {
  const scope = {};
  if (outcomes.length) scope.outcomes = outcomes;
  if (userId) scope.userId = userId;
  if (passId) scope.passId = passId;
  if (effortId) scope.effortId = effortId;
  if (dateRange?.from) scope.dateFrom = dateRange.from;
  if (dateRange?.to) scope.dateTo = dateRange.to;
  if (search && search.trim()) scope.search = search.trim();
  if (answerFilters.length || answerTagFilters.length) {
    if (surveyTemplateId) scope.surveyTemplateId = surveyTemplateId;
    if (answerFilters.length) scope.answerFilters = answerFilters;
    if (answerTagFilters.length) scope.answerTagFilters = answerTagFilters;
  }
  return scope;
};

/**
 * The GET's query string, derived FROM the scope — never rebuilt from page state beside it.
 * Scalars pass through; `outcomes` joins on commas (the server splits); the two structured
 * answer arrays ride as JSON, which the server parses back through the same zod schema.
 */
export const scopeToSearchParams = (scope = {}) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(scope)) {
    if (v == null) continue;
    if (k === 'outcomes') sp.set(k, v.join(','));
    else if (typeof v === 'object') sp.set(k, JSON.stringify(v));
    else sp.set(k, String(v));
  }
  return sp;
};

/** Does this scope filter by survey answer at all? Mirrors the server predicate in entryScope.js. */
export const hasAnswerFilter = (scope = {}) =>
  !!(scope.answerFilters?.length || scope.answerTagFilters?.length);

/**
 * Does this scope narrow by anything OTHER than the outcome chips and the answers?
 * The client half of the answer-filter gate; the server copy is the enforcer, this one is only
 * the affordance. The chips deliberately don't count — they can't bound the response read.
 */
export const hasOtherNarrowing = (scope = {}) =>
  !!(scope.userId || scope.passId || scope.effortId || scope.dateFrom || scope.dateTo || scope.search);

export const scopeIsEmpty = (scope = {}) => Object.keys(scope).length === 0;
