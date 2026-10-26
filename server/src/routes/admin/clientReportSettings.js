import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Organization } from '../../models/Organization.js';
import { reportWeekStartsOnOf } from '../../services/reports/reportPeriods.js';

// The organization's report week (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C): the weekday client-report
// weeks start on, which sets the dates New report suggests and the period Next report makes after an
// odd-length report, for every campaign in the organization. ORG-WIDE, so changing it is admin-only, as the
// logo is (routes/admin/branding.js); leads read it — New report says "(set by an admin)". Mounted at
// /admin/client-reports/settings AHEAD of the client-reports router (routes/index.js), so that router's
// `/:id` routes never read `settings` as a report id. Always the ACTIVE organization's (X-Org-Id): there
// is no id in the path to point at another one.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const orgIdOf = (req) => req.activeOrg?._id;
const ensureOrgScoped = (req, res) => {
  if (orgIdOf(req)) return true;
  res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
  return false;
};

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    res.json({ weekStartsOn: reportWeekStartsOnOf(req.activeOrg) });
  } catch (err) {
    next(err);
  }
});

// { weekStartsOn: 0..6 }. Reports already made keep their dates — only what is suggested next changes.
const settingsSchema = z.object({ weekStartsOn: z.number().int().min(0).max(6) });
router.patch('/', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const parsed = settingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Choose the day of the week your report weeks start on.', code: 'INVALID_WEEK_START' });
    }
    const { weekStartsOn } = parsed.data;
    await Organization.updateOne({ _id: orgIdOf(req) }, { $set: { reportWeekStartsOn: weekStartsOn } }, { runValidators: true });
    res.json({ weekStartsOn });
  } catch (err) {
    next(err);
  }
});

export default router;
