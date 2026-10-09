// FbTime Partner API client — the ONLY file that talks to the provider.
//
// Read-only by contract (FbTimeApp/docs/PARTNER_API.md) except one write:
// PUT /doors, the door counts (services/fbtime/doorPush.js). Reads: /ping,
// /people, /shifts. Node's global fetch + AbortController with try/finally
// clearTimeout — the Geocodio provider's shape
// (services/import/geocode/geocodioProvider.js), no new dependency, no retry
// wrapper (callers mark-and-continue, like geocodeService).
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
  constructor(message, { code = null, status = null, detail = null } = {}) {
    super(message);
    this.name = 'FbtimeApiError';
    this.code = code;
    this.status = status;
    // The provider's machine detail beside the code — PUT /doors names the
    // offending userId / date / malformed ids on a 400 VALIDATION.
    this.detail = detail;
  }
}

// A WRITE from anywhere but production may only reach a loopback server. A
// developer's copy of Doorline can read hours from the real FbTime with a dev key,
// but must never write door counts into it: the provider has no staging tenant,
// and a laptop's seeded knocks would window-replace a customer's real page. The
// hostname is WHATWG's form ("[::1]" with brackets; "127.1" normalises to
// 127.0.0.1; "localhost@evil.com" resolves to evil.com).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const writeAllowed = (base) => {
  if (process.env.NODE_ENV === 'production') return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(base).hostname);
  } catch {
    return false;
  }
};

let testFake = null;
/** Install (or clear, with null) the in-process fake for `fbt_test_` keys. */
export const setFbtimeFake = (handler) => {
  testFake = handler;
};

const baseUrl = () => process.env.FBTIME_API_BASE || DEFAULT_BASE;

const request = async ({ apiKey, path, params = {}, timeoutMs, method = 'GET', body }) => {
  if (!apiKey) throw new FbtimeApiError('FbTime API key is missing', { code: 'KEY_MALFORMED' });

  if (apiKey.startsWith(TEST_KEY_PREFIX)) {
    if (!testFake) {
      throw new Error('fbt_test_ key used but no fake installed — call setFbtimeFake() first');
    }
    // The fake mirrors the real contract: return a body object, or throw an
    // FbtimeApiError. Anything else it throws propagates as-is.
    return testFake({ apiKey, path, params, method, body });
  }

  // On the NETWORK path only — after the test seam, so tests (which run with
  // NODE_ENV unset) never meet it.
  if (method !== 'GET' && !writeAllowed(baseUrl())) {
    throw new FbtimeApiError('Refusing to write to FbTime from a non-production server', {
      code: 'LAPTOP_GUARD',
    });
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
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
      let errBody = null;
      let text = '';
      try {
        text = await res.text();
        errBody = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      // The body's machine detail rides along (PUT /doors names the offending
      // userId / date / malformed ids) — everything except the prose and the code.
      const detail = errBody && typeof errBody === 'object' ? { ...errBody } : {};
      delete detail.message;
      delete detail.code;
      throw new FbtimeApiError(
        errBody?.message || `FbTime HTTP ${res.status}: ${text.slice(0, 200)}`,
        { code: errBody?.code || null, status: res.status, detail: Object.keys(detail).length ? detail : null }
      );
    }

    // AWAITED inside the try, so the abort timer also covers reading the body: a
    // returned (unawaited) promise would escape the finally, and a body that stalls
    // after the headers would wait for undici's 5-minute default — on the one-at-a-
    // time maintenance queue.
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Which FbTime organization does this key read, what may the key do
 * (key.scopes), and what does the server support (top-level `features`).
 * `timeoutMs` bounds a ping on a request path, well under Heroku's 30s router limit.
 */
export const ping = ({ apiKey, timeoutMs } = {}) => request({ apiKey, path: '/ping', timeoutMs });

/**
 * THE ONE WRITE: window-replace door counts for the listed FbTime people
 * (PUT /doors, scope doors:write). `body` is { startDate, endDate, userIds,
 * counts } — plus the explicit-clear flag on an admin's clear. Returns the
 * provider's summary { window, applied, unchanged, cleared, replacedTyped,
 * unknownUserIds }.
 */
export const putDoors = ({ apiKey, body, timeoutMs }) =>
  request({ apiKey, path: '/doors', method: 'PUT', body, timeoutMs });

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
 *
 * `timeoutMs` is optional and PER REQUEST, not per call: the default (30s,
 * FBTIME_TIMEOUT_MS) is right for the background cron, but an interactive route
 * paging a wide window must bound itself well under Heroku's 30s router limit.
 */
export const getShifts = async (
  { apiKey, startDate, endDate, timeZone, timeoutMs },
  { retried = false } = {}
) => {
  const shifts = [];
  const limit = 1000;
  let expectedTotal = null;
  for (let page = 1; ; page += 1) {
    const body = await request({
      apiKey,
      path: '/shifts',
      params: { startDate, endDate, timeZone, page, limit },
      timeoutMs,
    });
    const total = body.pagination?.total ?? null;
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal && !retried) {
      return getShifts({ apiKey, startDate, endDate, timeZone, timeoutMs }, { retried: true });
    }
    shifts.push(...(body.shifts || []));
    const totalPages = body.pagination?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return shifts;
};
