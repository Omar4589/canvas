import mongoose from 'mongoose';
import { Membership } from '../models/Membership.js';
import { Organization } from '../models/Organization.js';
import { activeGrant } from '../services/access/supportAccess.js';

/**
 * Reads X-Org-Id header and attaches:
 *   - req.activeOrg (Organization doc)
 *   - req.activeMembership (Membership doc; null for super_admin without explicit membership)
 *
 * Behavior:
 *   - Non-super-admin without header AND with exactly one active membership: auto-pick it.
 *   - Non-super-admin without header and 0 or 2+ memberships: req.activeOrg = null (downstream gates may 403).
 *   - Non-super-admin with header but no matching active membership: 403.
 *   - Super admin with header: validate org exists; no membership required.
 *   - Super admin without header: req.activeOrg = null (allowed; some endpoints may require it).
 */
export async function orgContext(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  req.activeOrg = null;
  req.activeMembership = null;

  const headerVal = req.headers['x-org-id'] || req.headers['X-Org-Id'];
  const orgIdRaw = Array.isArray(headerVal) ? headerVal[0] : headerVal;

  try {
    if (orgIdRaw) {
      if (!mongoose.isValidObjectId(orgIdRaw)) {
        return res.status(400).json({ error: 'Invalid X-Org-Id', code: 'ORG_CONTEXT' });
      }
      const org = await Organization.findById(orgIdRaw);
      // A mid-delete organization reads as GONE here, and this is the single chokepoint that walls
      // the entire tenant: every /admin and /mobile router mounts this middleware, so one check
      // stops reads, writes and canvassing against a tenant whose rows are being destroyed under
      // it. 404 + ORG_CONTEXT is deliberate and load-bearing — the already-shipped mobile bundle
      // recovers on {400,403,404} + (code ORG_CONTEXT | a known error string), and 'Organization
      // not found' is in that string set, so this is recognized twice over and routes the user to
      // the org picker. A NEW code would match neither and dead-end every screen on a Retry button
      // that can never succeed. `reason` is purely additive for the newer clients.
      // Note this sits ABOVE the staff branches below on purpose: platform staff must not enter an
      // org mid-cascade either — they would read half-destroyed data and their AccessLog rows
      // would name an org that is about to stop existing. Break-glass keeps the super-admin list
      // and detail surfaces, neither of which routes through here.
      if (!org || !org.isActive || org.deletion?.requestedAt) {
        return res.status(404).json({
          error: 'Organization not found',
          code: 'ORG_CONTEXT',
          ...(org?.deletion?.requestedAt ? { reason: 'deleting' } : {}),
        });
      }
      // ── Platform staff entering a customer organization. ───────────────────────────────────────
      //
      // This used to be three lines: `if (req.user.isSuperAdmin) { req.activeOrg = org; return next(); }`
      // — set the org, skip the membership check, and every /admin/* route downstream would happily
      // scope its queries to it. Combined with an org switcher that listed every organization on the
      // platform, that meant any staff member could read any customer's entire voter file, survey
      // answers, notes and GPS trails, leaving no record anywhere that they had.
      //
      // Now it requires a live SupportAccessGrant: time-boxed, carrying a typed reason, and with every
      // read of voter content written to AccessLog. The access is not removed — it is made
      // attributable. "No god mode" means no *unlogged* mode.
      // MEMBERSHIP IS CHECKED FIRST, AND THAT ORDER IS THE WHOLE POINT.
      //
      // "Vendor access" means reaching into an organization you are NOT a member of. A super-admin who
      // is also the genuine admin of an org is not a vendor there — they are a member, doing their job.
      // There are exactly TWO non-vendor cases: a real membership, and a Doorline-owned org marked
      // `isInternal` (the branch below the membership check). Everywhere this comment says "customer
      // organization" it means an org WITHOUT that flag.
      //
      // The first cut of this gate tested `isSuperAdmin` before looking for a membership, and returned
      // unconditionally. So a platform super-admin who was also the admin of their own organization got
      // a 403 on their OWN account, and would have had to grant themselves "support access", with a
      // typed reason, to use it. Worse: their ordinary admin work would then have been written to
      // AccessLog as vendor intrusion — poisoning the exact audit trail this exists to produce. A log
      // that records normal work as snooping tells you nothing about actual snooping.
      const membership = await Membership.findOne({
        userId: req.user._id,
        organizationId: org._id,
        isActive: true,
      });
      if (membership) {
        req.activeOrg = org;
        req.activeMembership = membership;
        return next(); // a member is a member — no grant, and nothing to audit
      }

      // ── Doorline-owned INTERNAL org: staff enter freely, as members. ─────────────────────────
      // The grant-and-audit machinery below exists to protect CUSTOMER data. Organization.isInternal
      // is born-immutable (models/Organization.js), settable only at break-glass creation or by the
      // internal-orgs migration, and its billing status is locked to 'internal' — so an org in this
      // branch holds only Doorline's own synthetic data, and there is no API path that can move a
      // customer org into it. Staff therefore get exactly the member branch's semantics: activeOrg
      // set, NO req.supportGrant — which is precisely why the vendor write-blocks (VENDOR_READ_ONLY)
      // and middleware/accessLog.js stay silent, the same way they do for a real member.
      if (req.user.isSuperAdmin && org.isInternal) {
        req.activeOrg = org;
        req.internalOrgAccess = true; // observability only — nothing gates on this
        return next();
      }

      // No membership. If they are platform staff, THIS is vendor access, and it needs a grant.
      //
      // It used to be three lines: `if (req.user.isSuperAdmin) { req.activeOrg = org; return next(); }`
      // — set the org, skip every check, and each /admin/* route downstream would happily scope its
      // queries to it. Combined with an org switcher that listed every organization on the platform,
      // any staff member could read any customer's entire voter file, survey answers, notes and GPS
      // trails, leaving no record anywhere that they had.
      //
      // Now: time-boxed, carrying a typed reason, and every read of voter content written to AccessLog.
      // The access is not removed — it is made attributable. "No god mode" means no *unlogged* mode.
      if (req.user.isSuperAdmin) {
        const grant = await activeGrant(req.user._id, org._id);
        if (!grant) {
          return res.status(403).json({
            error:
              'Entering a customer organization requires a support access grant. Start one with a ' +
              'reason — it is time-limited and every request that touches voter data is logged.',
            code: 'SUPPORT_ACCESS_REQUIRED',
            organizationId: String(org._id),
            organizationName: org.name,
          });
        }
        req.activeOrg = org;
        req.supportGrant = grant; // middleware/accessLog.js keys off this
        return next();
      }

      // Neither a member nor staff. The caller sent an X-Org-Id for an org they're not (or are no
      // longer) in. Tagged so BOTH clients self-heal identically: drop the stale activeOrgId and route
      // to the org picker. mobile/lib/api.js already matches this case by its error STRING
      // (ORG_CONTEXT_ERRORS); the code makes it explicit and lets the web client do the same without
      // string-matching.
      return res
        .status(403)
        .json({ error: 'Not a member of this organization', code: 'ORG_CONTEXT' });
    }

    if (req.user.isSuperAdmin) {
      return next();
    }

    const memberships = await Membership.find({
      userId: req.user._id,
      isActive: true,
    });
    if (memberships.length === 1) {
      const org = await Organization.findById(memberships[0].organizationId);
      // Same wall as the explicit-header path above: a single-org user whose only org is being
      // deleted resolves to no active org, and the downstream gates answer exactly as they
      // already do for a deactivated one.
      if (org && org.isActive && !org.deletion?.requestedAt) {
        req.activeOrg = org;
        req.activeMembership = memberships[0];
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
