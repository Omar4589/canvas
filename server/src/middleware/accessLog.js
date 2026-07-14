import { voterContentResource, recordAccess } from '../services/access/supportAccess.js';

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
export function accessLog(req, res, next) {
  // originalUrl, NOT req.path. Express strips the mount prefix: mounted at ['/admin','/mobile'],
  // `req.path` here is '/voters', not '/admin/voters', so a prefix match on req.path silently never
  // fires and every access goes unlogged. That is a failure mode with no symptom — the app works
  // perfectly and the audit trail is simply empty — which is exactly the class of bug this whole
  // workstream exists to eliminate. Strip the /api mount and the query string.
  const fullPath = req.originalUrl.split('?')[0].replace(/^\/api/, '');
  const resource = voterContentResource(fullPath);
  if (!resource) return next();

  res.on('finish', () => {
    // Keyed on the GRANT, not on `isSuperAdmin`. That distinction is load-bearing.
    //
    // orgContext only issues a grant when the caller has NO membership in the org — which is the exact
    // definition of vendor access. So `req.supportGrant` is present precisely when someone is reaching
    // into a customer's data from outside, and absent when they are a member doing their own work.
    //
    // Keying on `isSuperAdmin` instead would log a super-admin's ordinary work in their OWN
    // organization as vendor intrusion. An audit trail that records normal work as snooping tells you
    // nothing about actual snooping — it is worse than no trail, because it looks like one.
    if (!req.supportGrant || !req.activeOrg) return;
    // Only successful reads. A 403 (no grant) or a 404 is an attempt, not an access.
    if (res.statusCode >= 400) return;

    // The route TEMPLATE where we have it, so the audit log doesn't itself become a list of voter ids
    // — the opposite of what an audit log should be. This middleware runs above the routers, so
    // req.route is usually unset by finish time; fall back to the mount + the resource class rather
    // than recording the raw id-bearing path.
    const route = req.route?.path
      ? (req.baseUrl || '') + req.route.path
      : `${req.method} ${resource}`;

    recordAccess({
      actorUserId: req.user._id,
      organizationId: req.activeOrg._id,
      grantId: req.supportGrant._id,
      method: req.method,
      route,
      resource,
    });
  });

  next();
}
