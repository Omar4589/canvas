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
    // deletedAt is checked here, not just at login, because our JWT is stateless and lives
    // for 30d (services/auth/tokens.js) — a deleted user holding a valid token would keep
    // recording knocks and reading voter PII for a month. This route loads the user from the
    // DB on every request, so refusing here IS the revocation.
    if (!user || !user.isActive || user.deletedAt) {
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

// The irreversible / authority-granting platform actions: deleting an organization, promoting staff,
// editing canonical voter identity.
//
// `requireSuperAdmin` means "is Doorline staff". This means "is Doorline staff WITH break-glass
// authority" — the distinction that exists so hiring a second person does not hand them an omniscient
// login. A `support` operator can still do the job (metadata dashboard, and voter content through a
// logged, time-boxed grant); they just cannot destroy a customer or make themselves more powerful.
//
// Existing super-admins default to break_glass, so nothing anyone can do today stops working.
export function requireBreakGlass(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Super admin only' });
  if (req.user.platformRole !== 'break_glass') {
    return res.status(403).json({
      error: 'This action requires break-glass authority. Your account has support-level access.',
      code: 'BREAK_GLASS_REQUIRED',
    });
  }
  next();
}

export function requireOrgRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.isSuperAdmin) return next();
    const role = req.activeMembership?.role;
    if (!role || !roles.includes(role)) {
      // Machine-readable so clients can tell "your ROLE is too low here" apart from "your
      // ORG context is invalid" (orgContext.js emits ORG_CONTEXT for that). Mobile uses it
      // to notice a mid-session demotion and re-derive its route from a fresh /auth/me; the
      // web client deliberately does NOT auto-recover on it — a lead calling an admin-only
      // endpoint is a bug to fix, not a reason to eject them from the org. Mirrors
      // passwordGate's code:'PASSWORD_CHANGE_REQUIRED'.
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
    }
    next();
  };
}

export function requireOrgMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.isSuperAdmin) return next();
  if (!req.activeMembership) {
    return res.status(403).json({ error: 'No active org membership', code: 'FORBIDDEN_ROLE' });
  }
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
      if (!ok) return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
      next();
    })
    .catch(next);
}
