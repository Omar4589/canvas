import { classifyResource, isAuditExempt, recordAccess } from '../services/access/supportAccess.js';

// Writes an AccessLog row whenever DOORLINE STAFF read a customer's voter content.
//
// Not for customers reading their own data — that is not vendor access, and logging it would bury the
// one signal this exists to produce: "did anybody at Doorline look at my voter file, and why?"
//
// Runs after orgContext (which sets req.activeOrg and req.supportGrant) and before the routers. It is
// mounted once, in app.js, rather than sprinkled per-route — a per-route call is one someone forgets
// to add to the next route, and the gap would be invisible.
// Mounted CENTRALLY (routes/index.js), before the routers — but every decision is deferred to
// `res.on('finish')`. That is deliberate and load-bearing: each admin router runs its own
// `orgContext` internally, so at mount time `req.activeOrg` is not set yet. By the time the response
// finishes, orgContext has populated the same `req` object, and we can see exactly which org was
// entered and under which grant.
//
// Mounting once beats calling it per-route: a per-route hook is one somebody forgets to add to the
// next route, and that gap would be silent — an unlogged path into customer data is precisely the
// thing this exists to make impossible.
// How many bytes does this chunk contribute to the response? res.end(chunk, cb) passes the callback
// where the encoding goes, so a function there means "no encoding".
function chunkBytes(chunk, encoding) {
  if (chunk == null) return 0;
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined);
  }
  return chunk.length || 0;
}

// Row count for a JSON payload: the payload itself if it's an array, else the largest top-level array
// (the app's list shapes are { voters: [...] }, { jobs: [...] }, …). No array = a single-record read;
// null means "unknown", never zero.
function countJsonRows(body) {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    let max = null;
    for (const v of Object.values(body)) {
      if (Array.isArray(v)) max = Math.max(max ?? 0, v.length);
    }
    return max;
  }
  return null;
}

export function accessLog(req, res, next) {
  // Magnitude capture: one AccessLog row per request is honest about WHO and WHAT KIND, but it can't
  // tell a one-voter peek from a 4,000-row export. So we count the response as it leaves — rows from
  // the JSON/CSV shape, bytes from the raw chunks. The wrap is UNCONDITIONAL: whether this request is
  // vendor access is unknowable until finish (orgContext runs inside the routers), and counting is
  // O(1) per chunk. These wrappers sit downstream of compression()'s own res patches (it mounts
  // earlier in app.js), so the tally is the uncompressed payload — "how much voter data left", not
  // how well it gzipped. Content-Length can't do this job: compression strips that header on any
  // response over 1KB, i.e. on exactly the bulk exports the signal exists to catch.
  let bytes = 0;
  let rows = null;
  const origWrite = res.write;
  const origEnd = res.end;
  const origJson = res.json;
  res.write = function (chunk, encoding, cb) {
    bytes += chunkBytes(chunk, encoding);
    return origWrite.call(this, chunk, encoding, cb);
  };
  res.end = function (chunk, encoding, cb) {
    bytes += chunkBytes(chunk, encoding);
    // CSV exports send one joined string with a header line and no trailing newline, so the data-row
    // count is simply the newline count. Only when no JSON count already landed.
    if (rows == null && typeof chunk === 'string' &&
        String(res.getHeader('content-type') || '').includes('text/csv')) {
      let n = 0;
      for (let i = chunk.indexOf('\n'); i !== -1; i = chunk.indexOf('\n', i + 1)) n += 1;
      rows = n;
    }
    return origEnd.call(this, chunk, encoding, cb);
  };
  res.json = function (body) {
    rows = countJsonRows(body);
    return origJson.call(this, body);
  };

  // Every decision is deferred to res.on('finish'): each admin router runs its OWN orgContext
  // internally, so at mount time req.supportGrant / req.activeOrg are not set yet. By finish time they
  // are, and we know exactly which org was entered and under which grant. We attach the hook to EVERY
  // request and decide at the end — the old code decided up front whether a path "looked like" voter
  // content and skipped the hook otherwise, which is how three dead prefixes silently disabled logging
  // for the CSV export. Deciding at the end, defaulting to log, cannot rot the same way.
  res.on('finish', () => {
    // Keyed on the GRANT, not on `isSuperAdmin`. That distinction is load-bearing.
    //
    // orgContext only issues a grant when the caller has NO membership in the org — the exact
    // definition of vendor access. So req.supportGrant is present precisely when someone is reaching
    // into a customer's data from outside, and absent when they are a member doing their own work.
    // Keying on isSuperAdmin instead would log a super-admin's ordinary work in their OWN org as vendor
    // intrusion — a trail that records normal work as snooping tells you nothing about actual snooping.
    if (!req.supportGrant || !req.activeOrg) return;
    // Only successful requests. A 403 (no grant) or a 404 is an attempt, not an access.
    if (res.statusCode >= 400) return;

    // FAIL CLOSED: log this vendor access unless the path is an explicit non-content exemption. Strip
    // the /api mount and the query string first. originalUrl, NOT req.path — Express strips the mount
    // prefix, so req.path would be '/voters', not '/admin/voters'.
    const fullPath = req.originalUrl.split('?')[0].replace(/^\/api/, '');
    if (isAuditExempt(fullPath)) return;
    const resource = classifyResource(fullPath);

    // The route TEMPLATE where we have it, so the audit log doesn't itself become a list of voter ids.
    // This middleware runs above the routers, so req.route is usually unset by finish time; fall back
    // to the method + resource class rather than recording the raw id-bearing path.
    const route = req.route?.path ? (req.baseUrl || '') + req.route.path : `${req.method} ${resource}`;

    recordAccess({
      actorUserId: req.user._id,
      organizationId: req.activeOrg._id,
      grantId: req.supportGrant._id,
      method: req.method,
      route,
      resource,
      rows,
      bytes: bytes || null,
    });
  });

  next();
}
