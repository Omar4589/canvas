import { setFbtimeFake, FbtimeApiError } from '../../src/services/fbtime/client.js';

// The in-process FbTime Partner API, for tests. A key prefixed `fbt_test_`
// routes here instead of the network (services/fbtime/client.js) — the
// mailer's test-transport idea, adapted. Install per-test with the responses
// you want; uninstall in after() so one file's fake can never answer another
// file's requests.
//
//   installFbtimeFake({
//     ping: { ok: true, organization: { id: 'org1', name: 'Fox Bryant' }, ... },
//     people: [{ id: 'p1', firstName: 'Maria', ... }],   // served in one page
//     shifts: [{ id: 's1', userId: 'p1', clockIn: ..., 
//               project: { id: 'pr1', name: 'Ward 5 Field' } }],  // array → one page
//       (`project` rides every real shift row — PARTNER_API.md — and the fake
//        passes rows through verbatim, so supplying it is all a test needs to do.)
//     error: { code: 'KEY_REVOKED', status: 401 },       // every call throws this
//   })
//
// Handlers can be values or functions of ({ apiKey, path, params, method, body });
// functions let a test vary the response per call (e.g. second pull drops a shift).
//
// PUT /doors is modelled by a board (createDoorsBoard below; fbtimeBoard() reads it):
//     knownPersonIds: [P1, P2],          // others come back in unknownUserIds
//     doorsBefore: ({ body, call }) => { throw … },  // refuse before writing (4xx/5xx)
//     doorsAfter:  ({ body, res }) => { throw … },   // write lands, then the answer is lost
// A `shifts` handler may also return a FULL response object ({ shifts,
// pagination, ... }) to script pagination — the total-drift re-pull test needs
// to lie about pagination.total between pages, which an array cannot.

let calls = [];
let board = null;

export const fbtimeCalls = () => calls;
export const fbtimeBoard = () => board;

// ── PUT /doors — FbTime's doors-per-hour board, modelled ──────────────────────
//
// The contract (FbTimeApp/docs/PARTNER_API.md, "Doorline decides"): window-replace per
// LISTED person — a day with a count shows Doorline's number (a number typed there is
// filed away and counted in replacedTyped; replacedTypedChanged only when it differed);
// a reported day with no count is cleared — an explicit clear (restoreTyped:true) brings
// the filed-away typed number back (or removes the row), any other clear leaves an
// "emptied" marker; days Doorline never reported, and unlisted people, are untouched.
// Persons outside the org come back in unknownUserIds. Validation mirrors the contract:
// anything else is a 400 VALIDATION that writes nothing.
const ymd = (d) => d.toISOString().slice(0, 10);
const addDaysYmd = (s, n) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const createDoorsBoard = ({ knownPersonIds = null, now = null } = {}) => {
  const cells = new Map(); // "pid|date" → { reportedDoors, typedDoors, replacedTypedDoors, emptied }
  const known = knownPersonIds ? new Set(knownPersonIds.map((p) => String(p).toLowerCase())) : null;
  const invalid = (message) => {
    throw new FbtimeApiError(message, { code: 'VALIDATION', status: 400, detail: { field: message } });
  };

  const validate = (body) => {
    if (!body || typeof body !== 'object') invalid('body');
    const allowed = new Set(['startDate', 'endDate', 'userIds', 'counts', 'restoreTyped']);
    for (const k of Object.keys(body)) if (!allowed.has(k)) invalid(`unknown field ${k}`);
    const { startDate, endDate, userIds, counts } = body;
    const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDaysYmd(s, 0) === s;
    if (!isDay(startDate) || !isDay(endDate) || endDate < startDate) invalid('window');
    if (daysBetween(startDate, endDate) + 1 > 120) invalid('window too long');
    const today = ymd(now ? new Date(now) : new Date()); // a test's injected 'now', like runDoorStep's
    if (endDate > addDaysYmd(today, 1)) invalid('endDate after tomorrow');
    if (startDate < addDaysYmd(today, -730)) invalid('startDate more than 2 years back');
    if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 500) invalid('userIds');
    const ids = userIds.map((u) => String(u).toLowerCase());
    if (ids.some((u) => !/^[0-9a-f]{24}$/.test(u)) || new Set(ids).size !== ids.length) invalid('userIds');
    if (!Array.isArray(counts)) invalid('counts');
    const seen = new Set();
    for (const c of counts) {
      if (!c || Object.keys(c).some((k) => !['userId', 'date', 'doors'].includes(k))) invalid('count fields');
      const pid = String(c.userId).toLowerCase();
      if (!ids.includes(pid)) invalid('count for an unlisted user');
      if (!isDay(c.date) || c.date < startDate || c.date > endDate) invalid('count date');
      if (!Number.isInteger(c.doors) || c.doors < 0 || c.doors > 2000) invalid('doors');
      const key = `${pid}|${c.date}`;
      if (seen.has(key)) invalid('two counts for one person-day');
      seen.add(key);
    }
    if (body.restoreTyped !== undefined && typeof body.restoreTyped !== 'boolean') invalid('restoreTyped');
    return ids;
  };

  const put = (body) => {
    const ids = validate(body);
    const out = { applied: 0, unchanged: 0, cleared: 0, replacedTyped: 0, replacedTypedChanged: 0, restoredTyped: 0 };
    const unknownUserIds = [];
    const countOf = new Map(body.counts.map((c) => [`${String(c.userId).toLowerCase()}|${c.date}`, c.doors]));
    for (const pid of ids) {
      if (known && !known.has(pid)) {
        unknownUserIds.push(pid);
        continue;
      }
      for (let d = body.startDate; d <= body.endDate; d = addDaysYmd(d, 1)) {
        const key = `${pid}|${d}`;
        const cell = cells.get(key);
        const n = countOf.get(key);
        if (n !== undefined) {
          if (cell && cell.reportedDoors === n && !cell.emptied) {
            out.unchanged += 1;
            continue;
          }
          const next = cell || { reportedDoors: null, typedDoors: null, replacedTypedDoors: null, emptied: false, otherDoors: 0 };
          if (next.typedDoors !== null) {
            out.replacedTyped += 1;
            if (next.typedDoors !== n) out.replacedTypedChanged += 1;
            next.replacedTypedDoors = next.typedDoors;
            next.typedDoors = null;
          }
          next.reportedDoors = n;
          next.emptied = false;
          cells.set(key, next);
          out.applied += 1;
        } else if (cell && (cell.reportedDoors !== null || (cell.emptied && body.restoreTyped === true))) {
          out.cleared += 1;
          if (body.restoreTyped === true) {
            // Other doors (typed in FbTime for doors Doorline can't know) are never touched: a
            // row is deleted only when nothing else is left on it.
            if (cell.replacedTypedDoors !== null) {
              cells.set(key, { reportedDoors: null, typedDoors: cell.replacedTypedDoors, replacedTypedDoors: null, emptied: false, otherDoors: cell.otherDoors || 0 });
              out.restoredTyped += 1;
            } else if (cell.otherDoors) {
              cells.set(key, { reportedDoors: null, typedDoors: null, replacedTypedDoors: null, emptied: false, otherDoors: cell.otherDoors });
            } else {
              cells.delete(key);
            }
          } else {
            cell.reportedDoors = null;
            cell.emptied = true;
          }
        }
      }
    }
    return { window: { startDate: body.startDate, endDate: body.endDate }, ...out, unknownUserIds };
  };

  return {
    put,
    cells,
    cell: (pid, date) => cells.get(`${String(pid).toLowerCase()}|${date}`) || null,
    // What FbTime's page shows and counts for that person-day: the reported number wins over a
    // typed one, and other doors are added to either.
    shown: (pid, date) => {
      const c = cells.get(`${String(pid).toLowerCase()}|${date}`);
      if (!c) return null;
      const base = c.reportedDoors ?? c.typedDoors;
      if (base === null && !c.otherDoors) return null;
      return (base ?? 0) + (c.otherDoors || 0);
    },
    // Someone typing FbTime's "other doors" for a day — allowed locked or not; a report or a
    // clear never touches it.
    other: (pid, date, doors) => {
      const key = `${String(pid).toLowerCase()}|${date}`;
      const c = cells.get(key) || { reportedDoors: null, typedDoors: null, replacedTypedDoors: null, emptied: false, otherDoors: 0 };
      c.otherDoors = doors;
      cells.set(key, c);
    },
    // Someone typing a number on FbTime's page. A reported day is locked while a door-count
    // key is live (409 DOORS_FROM_INTEGRATION).
    type: (pid, date, doors, { keyLive = true } = {}) => {
      const key = `${String(pid).toLowerCase()}|${date}`;
      const c = cells.get(key) || { reportedDoors: null, typedDoors: null, replacedTypedDoors: null, emptied: false, otherDoors: 0 };
      if (c.reportedDoors !== null && keyLive) throw new Error('DOORS_FROM_INTEGRATION');
      c.typedDoors = doors;
      if (!keyLive) c.reportedDoors = null;
      c.emptied = false;
      cells.set(key, c);
    },
    // Every reported cell, as { "pid|date": doors } — the test's view of what Doorline sent.
    reported: () => {
      const out = {};
      for (const [k, c] of cells) if (c.reportedDoors !== null) out[k] = c.reportedDoors;
      return out;
    },
  };
};

export const installFbtimeFake = (config = {}) => {
  calls = [];
  board = config.board || createDoorsBoard({ knownPersonIds: config.knownPersonIds || null, now: config.now || null });
  setFbtimeFake(({ apiKey, path, params, method = 'GET', body }) => {
    calls.push({ apiKey, path, params, method, body });

    if (config.error) {
      const { code = null, status = null, message } = config.error;
      throw new FbtimeApiError(message || `test fake: ${code || 'error'}`, { code, status });
    }

    const resolve = (v) => (typeof v === 'function' ? v({ apiKey, path, params, method, body }) : v);

    if (path === '/doors' && method === 'PUT') {
      // doorsBefore may throw (nothing written: a 4xx/5xx); doorsAfter may throw AFTER the
      // write landed (a stalled write Doorline gave up on — the confirm pass's reason).
      // Both may be async (a test changing the database mid-run); `call` counts PUTs only.
      const call = calls.filter((c) => c.path === '/doors' && c.method === 'PUT').length;
      return (async () => {
        if (config.doorsBefore) await config.doorsBefore({ apiKey, body, board, call });
        const res = board.put(body);
        if (config.doorsAfter) await config.doorsAfter({ apiKey, body, board, call, res });
        return res;
      })();
    }

    if (path === '/ping') {
      return resolve(
        config.ping ?? {
          ok: true,
          organization: { id: 'fbtorg000000000000000001', name: 'Test FbTime Org' },
          key: { name: 'Doorline (test)', prefix: 'fbt_test_', scopes: ['timesheets:read', 'roster:read'] },
          serverTime: new Date().toISOString(),
          apiVersion: 1,
        }
      );
    }
    if (path === '/people') {
      const people = resolve(config.people) ?? [];
      return {
        people,
        pagination: { page: 1, limit: 500, total: people.length, totalPages: 1 },
      };
    }
    if (path === '/shifts') {
      const v = resolve(config.shifts) ?? [];
      if (!Array.isArray(v)) return v; // full response object — scripted pagination
      return {
        shifts: v,
        range: { startDate: params.startDate, endDate: params.endDate, timeZone: params.timeZone },
        pagination: { page: 1, limit: Number(params.limit) || 500, total: v.length, totalPages: 1 },
        generatedAt: new Date().toISOString(),
      };
    }
    throw new FbtimeApiError('test fake: unknown path ' + path, { code: 'NOT_FOUND', status: 404 });
  });
};

export const uninstallFbtimeFake = () => {
  calls = [];
  board = null;
  setFbtimeFake(null);
};

// A ping answering for a key that may write door counts, on an FbTime that applies
// "Doorline decides" — the precondition of every door-count send.
export const doorsPing = (orgId = 'f0000000000000000000000d', name = 'Fake FbTime Org', extra = {}) => ({
  ok: true,
  organization: { id: orgId, name },
  key: { name: 'Doorline (test)', prefix: 'fbt_test_ab', scopes: ['timesheets:read', 'roster:read', 'doors:write'] },
  features: ['doors:reported-wins'],
  serverTime: new Date().toISOString(),
  apiVersion: 1,
  ...extra,
});
