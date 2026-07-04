import { verifyToken } from '../services/auth/tokens.js';
import { User } from '../models/User.js';
import { canManageCampaign } from '../services/authz/campaignManagement.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Super admin only' });
  next();
}

export function requireOrgRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.isSuperAdmin) return next();
    const role = req.activeMembership?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

export function requireOrgMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.isSuperAdmin) return next();
  if (!req.activeMembership) return res.status(403).json({ error: 'No active org membership' });
  next();
}

// Gate a campaign-nested route on management authority for req.params.campaignId:
// super/org-admin always pass; a team lead passes only for a campaign they were
// granted. Runs AFTER orgContext (needs req.activeMembership/activeOrg) and, on
// the campaign routers, BEFORE loadCampaign (which still enforces org ownership).
export function requireCampaignManager(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  Promise.resolve(canManageCampaign(req, req.params.campaignId))
    .then((ok) => {
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
      next();
    })
    .catch(next);
}
