// FbTime Partner API client — the ONLY file that talks to the provider.
//
// Read-only by contract (FbTimeApp/docs/PARTNER_API.md, frozen): /ping, /people,
// /hours. Node's global fetch + AbortController with try/finally clearTimeout —
// the Geocodio provider's shape (services/import/geocode/geocodioProvider.js),
// no new dependency, no retry wrapper (callers mark-and-continue, like
// geocodeService).
//
// THE KEY NEVER APPEARS ANYWHERE. Not in logs, not in thrown messages, not in
// query strings — it travels only in the Authorization header. The displayable
// part is the prefix the provider itself shows (fbt_live_xxxxxxxx), and callers
// already hold that separately.
//
// TEST SEAM (the mailer's test-transport idea, adapted): a key prefixed
// `fbt_test_` never touches the network — it routes to an in-process fake
// installed via setFbtimeFake() (server/test/support/fbtimeFake.js). A test key
// with no fake installed throws loudly rather than silently succeeding. Real
// keys (`fbt_live_`) go to FBTIME_API_BASE.

const DEFAULT_BASE = 'https://fbtime-199ba8f23541.herokuapp.com/api/partner/v1';

const TEST_KEY_PREFIX = 'fbt_test_';

// The provider's machine codes, surfaced as FbtimeApiError.code so callers
// branch on `code`, never on message text. Anything without a parseable code
// (network failure, timeout, 5xx) gets code null and is TRANSIENT by
// convention — sync keeps the connection 'connected' and retries next run.
export const FATAL_CODES = new Set(['KEY_REVOKED', 'KEY_EXPIRED', 'KEY_INVALID', 'ORG_INACTIVE']);

export class FbtimeApiError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = 'FbtimeApiError';
    this.code = code;
    this.status = status;
  }
}

let testFake = null;
/** Install (or clear, with null) the in-process fake for `fbt_test_` keys. */
export const setFbtimeFake = (handler) => {
  testFake = handler;
};

const baseUrl = () => process.env.FBTIME_API_BASE || DEFAULT_BASE;

const request = async ({ apiKey, path, params = {}, timeoutMs }) => {
  if (!apiKey) throw new FbtimeApiError('FbTime API key is missing', { code: 'KEY_MALFORMED' });

  if (apiKey.startsWith(TEST_KEY_PREFIX)) {
    if (!testFake) {
      throw new Error('fbt_test_ key used but no fake installed — call setFbtimeFake() first');
    }
    // The fake mirrors the real contract: return a body object, or throw an
    // FbtimeApiError. Anything else it throws propagates as-is.
    return testFake({ apiKey, path, params });
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${baseUrl()}${path}${qs.size ? `?${qs}` : ''}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? Number(process.env.FBTIME_TIMEOUT_MS || 30000));
  try {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      });
    } catch (err) {
      // Abort/network — transient, no code. The key must not ride into the
      // message, and err.message here never contains it (the URL carries none).
      throw new FbtimeApiError(`FbTime request failed: ${err.message}`, {});
    }

    if (!res.ok) {
      // The contract 4xxs carry { message, code }. Parse for the code; fall
      // back to a bounded text slice for 5xx/HTML so the error still says
      // something without becoming a novel.
      let body = null;
      let text = '';
      try {
        text = await res.text();
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      throw new FbtimeApiError(
        body?.message || `FbTime HTTP ${res.status}: ${text.slice(0, 200)}`,
        { code: body?.code || null, status: res.status }
      );
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Which FbTime organization does this key read, and what may it do. */
export const ping = ({ apiKey }) => request({ apiKey, path: '/ping' });

/**
 * The full roster, paged to exhaustion. Sorted by _id on the provider side —
 * a correctness requirement of theirs (a rename must not move somebody between
 * pages mid-sync) that pagination here simply inherits.
 *
 * includeInactive defaults true: the mapping screen and any backfill need the
 * people who worked last season, not just today's roster.
 */
export const listAllPeople = async ({ apiKey, includeInactive = true } = {}) => {
  const people = [];
  const limit = 500;
  for (let page = 1; ; page += 1) {
    const body = await request({
      apiKey,
      path: '/people',
      params: { page, limit, includeInactive: includeInactive ? 'true' : undefined },
    });
    people.push(...(body.people || []));
    const totalPages = body.pagination?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return people;
};

/**
 * Every shift in [startDate, endDate], individually, paged to exhaustion.
 * `timeZone` only DEFINES THE WINDOW (the provider collapses the range to a
 * pair of UTC instants on clockIn) — day bucketing happens on OUR side, at
 * read time, in each report's own anchor zone. That is why this integration
 * pulls /shifts and not /hours: a pre-bucketed day total can only ever be
 * right for one zone, and an org can run campaigns in several.
 *
 * The provider sorts by clockIn — a MUTABLE field, unlike /people's by-_id
 * ordering — so a mid-pull edit can shuffle rows between pages. The response's
 * pagination.total is the tell: if it moves between pages of one pull, the set
 * changed under us, so re-pull once from the top. A second drift is accepted
 * as-is — the next 15-minute sync heals it, and looping until quiescence would
 * let an actively-edited org starve its own sync.
 */
export const getShifts = async ({ apiKey, startDate, endDate, timeZone }, { retried = false } = {}) => {
  const shifts = [];
  const limit = 1000;
  let expectedTotal = null;
  for (let page = 1; ; page += 1) {
    const body = await request({
      apiKey,
      path: '/shifts',
      params: { startDate, endDate, timeZone, page, limit },
    });
    const total = body.pagination?.total ?? null;
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal && !retried) {
      return getShifts({ apiKey, startDate, endDate, timeZone }, { retried: true });
    }
    shifts.push(...(body.shifts || []));
    const totalPages = body.pagination?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return shifts;
};
