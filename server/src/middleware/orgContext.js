import mongoose from 'mongoose';
import { Membership } from '../models/Membership.js';
import { Organization } from '../models/Organization.js';

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
        return res.status(400).json({ error: 'Invalid X-Org-Id' });
      }
      const org = await Organization.findById(orgIdRaw);
      if (!org || !org.isActive) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      if (req.user.isSuperAdmin) {
        req.activeOrg = org;
        return next();
      }
      const membership = await Membership.findOne({
        userId: req.user._id,
        organizationId: org._id,
        isActive: true,
      });
      if (!membership) {
        return res.status(403).json({ error: 'Not a member of this organization' });
      }
      req.activeOrg = org;
      req.activeMembership = membership;
      return next();
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
      if (org && org.isActive) {
        req.activeOrg = org;
        req.activeMembership = memberships[0];
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
