// Help Center content API — read-only, available to ANY logged-in member of an org
// (canvasser / lead / admin / super). Deliberately mounted OUTSIDE the billing
// entitlement gate so a suspended org can still read help. Content is filtered to the
// caller's role (loadHelp.js AUDIENCE_FOR_ROLE). Both the web console and the mobile app
// hit this same `/api/help` surface.
import { Router } from 'express';
import { requireAuth, requireOrgMember } from '../middleware/auth.js';
import { orgContext } from '../middleware/orgContext.js';
import { helpIndexForRole, helpFaqForRole, helpArticle } from '../services/help/loadHelp.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

function roleFor(req) {
  if (req.user?.isSuperAdmin) return 'super';
  return req.activeMembership?.role || 'canvasser';
}

// Metadata for every non-FAQ article the caller may see (guided lessons, guides, page
// guides) — bodies omitted so the client can search/list instantly, then fetch one.
router.get('/index', (req, res) => {
  const role = roleFor(req);
  res.json({ role, articles: helpIndexForRole(role) });
});

// Full FAQ entries (with rendered blocks) — short answers shown inline, no per-item fetch.
router.get('/faq', (req, res) => {
  res.json({ faq: helpFaqForRole(roleFor(req)) });
});

// One full article (with blocks). 404 if it doesn't exist OR is outside the caller's role.
router.get('/articles/:slug', (req, res) => {
  const article = helpArticle(req.params.slug, roleFor(req));
  if (!article) return res.status(404).json({ error: 'Help article not found' });
  res.json({ article });
});

export default router;
