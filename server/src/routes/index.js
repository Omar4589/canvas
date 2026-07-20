import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { accessLog } from '../middleware/accessLog.js';
import { blockIfMustChangePassword } from '../middleware/passwordGate.js';
import { requireEntitlement } from '../middleware/entitlement.js';
import authRouter from './auth.js';
import adminMembershipsRouter from './admin/memberships.js';
import adminAssignmentsRouter from './admin/assignments.js';
import adminCampaignHouseholdsRouter from './admin/campaignHouseholds.js';
import adminImportsRouter from './admin/imports.js';
import adminReportsRouter from './admin/reports.js';
import adminSurveysRouter from './admin/surveys.js';
import adminTagsRouter from './admin/tags.js';
import adminConfigRouter from './admin/config.js';
import adminHouseholdsRouter from './admin/households.js';
import adminCampaignsRouter from './admin/campaigns.js';
import adminActivitiesRouter from './admin/activities.js';
import adminQueuesRouter from './admin/queues.js';
import adminTurfsRouter from './admin/turfs.js';
import adminWalkListsRouter from './admin/walklists.js';
import adminVotedRouter from './admin/voted.js';
import adminVotersRouter from './admin/voters.js';
import adminDncRouter from './admin/dnc.js';
import adminPassesRouter from './admin/passes.js';
import adminEffortsRouter from './admin/efforts.js';
import adminSetupStatusRouter from './admin/setupStatus.js';
import adminTurfAssignmentsRouter from './admin/turfAssignments.js';
import adminLeadCrewRouter from './admin/leadCrew.js';
import superAdminOrganizationsRouter from './superAdmin/organizations.js';
import superAdminBillingRouter from './superAdmin/billing.js';
import adminBillingRouter from './admin/billing.js';
import superAdminUsersRouter from './superAdmin/users.js';
import superAdminPersonsRouter from './superAdmin/persons.js';
import superAdminAccessRouter from './superAdmin/access.js';
import superAdminEmailsRouter from './superAdmin/emails.js';
import superAdminImportsRouter from './superAdmin/imports.js';
import superAdminStatementsRouter from './superAdmin/statements.js';
import superAdminPlatformRouter from './superAdmin/platform.js';
import mobileBootstrapRouter from './mobile/bootstrap.js';
import mobileCanvassRouter from './mobile/canvass.js';
import mobileMeRouter from './mobile/me.js';
import mobileVotersRouter from './mobile/voters.js';
import adminClientReportsRouter from './admin/clientReports.js';
import shareRouter from './public/share.js';
import buildStatusRouter from './public/buildStatus.js';
import resendWebhookRouter from './public/resendWebhook.js';
import helpRouter from './help.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.use('/auth', authRouter);

// Public report sharing (no login) — capability token in the URL. Mounted BEFORE the auth gate.
router.use('/share', shareRouter);

// Mobile build currency (no login) — a phone asks "is my installed build current?" and the
// client draws a nag/wall from the answer. Mounted BEFORE the auth gate so the wall can cover
// the login screen; env-driven, see routes/public/buildStatus.js.
router.use('/build-status', buildStatusRouter);

// Resend delivery webhook (no login — Resend calls it; auth = the Svix signature over the raw
// body, which app.js preserves with an express.raw mount on this exact path).
router.use('/webhooks/resend', resendWebhookRouter);

// Help Center content — self-gated (any logged-in member) and intentionally outside the
// password/entitlement gates below, so help is always readable (incl. suspended orgs).
router.use('/help', helpRouter);

// Gate every protected surface for users who owe a password change. Runs before
// the sub-routers (which re-run requireAuth harmlessly). /auth is excluded above
// so change-password / me / logout stay reachable while the flag is set.
router.use(['/super-admin', '/admin', '/mobile'], requireAuth, blockIfMustChangePassword);
// Billing entitlement gate: reads always pass (suspended = read-only), writes
// need an entitled org; super-admin surfaces are exempt (account managers).
router.use(['/admin', '/mobile'], requireEntitlement);

// Vendor-access audit. Records an AccessLog row whenever DOORLINE STAFF successfully read a
// customer's voter content — never for a customer reading their own. Mounted once, here, rather than
// per-route: a per-route hook is one someone forgets on the next route, and an unlogged path into
// customer data is exactly what this exists to prevent. See middleware/accessLog.js for why every
// decision inside it is deferred to res.on('finish').
router.use(['/admin', '/mobile'], accessLog);

router.use('/super-admin/organizations/:orgId/billing', superAdminBillingRouter);
router.use('/super-admin/organizations', superAdminOrganizationsRouter);
router.use('/super-admin/users', superAdminUsersRouter);
router.use('/super-admin/persons', superAdminPersonsRouter);
// Support access grants + the vendor-access audit log + retention health.
router.use('/super-admin/access', superAdminAccessRouter);
router.use('/super-admin/emails', superAdminEmailsRouter);
router.use('/super-admin/imports', superAdminImportsRouter);
// Must stay ABOVE the '/super-admin' catch-all below, or that mount swallows the path.
router.use('/super-admin/billing', superAdminStatementsRouter);
router.use('/super-admin', superAdminPlatformRouter);

router.use('/admin/billing', adminBillingRouter);
router.use('/admin/memberships', adminMembershipsRouter);
router.use('/admin/imports', adminImportsRouter);
router.use('/admin/reports', adminReportsRouter);
router.use('/admin/surveys', adminSurveysRouter);
router.use('/admin/tags', adminTagsRouter);
router.use('/admin/config', adminConfigRouter);
router.use('/admin/households', adminHouseholdsRouter);
router.use('/admin/voters', adminVotersRouter);
// Org-level (not campaign-nested): DNC is an org-wide fact on the Voter, and this router is
// admins-only — the campaign-nested voted.js gate (requireCampaignManager) would admit leads.
router.use('/admin/dnc', adminDncRouter);
router.use('/admin/campaigns', adminCampaignsRouter);
router.use('/admin/campaigns/:campaignId/assignments', adminAssignmentsRouter);
router.use('/admin/campaigns/:campaignId/households', adminCampaignHouseholdsRouter);
router.use('/admin/campaigns/:campaignId/walklists', adminWalkListsRouter);
router.use('/admin/campaigns/:campaignId/voted', adminVotedRouter);
router.use('/admin/campaigns/:campaignId/efforts', adminEffortsRouter);
router.use('/admin/campaigns/:campaignId/passes', adminPassesRouter);
router.use('/admin/campaigns/:campaignId/setup-status', adminSetupStatusRouter);
router.use('/admin/campaigns/:campaignId/crew', adminLeadCrewRouter);
router.use('/admin/campaigns/:campaignId/turfs/:turfId/assignments', adminTurfAssignmentsRouter);
router.use('/admin/campaigns/:campaignId/turfs', adminTurfsRouter);
router.use('/admin/activities', adminActivitiesRouter);
router.use('/admin/client-reports', adminClientReportsRouter);
router.use('/admin/queues', adminQueuesRouter);

router.use('/mobile', mobileBootstrapRouter);
router.use('/mobile', mobileCanvassRouter);
router.use('/mobile', mobileVotersRouter);
router.use('/mobile/me', mobileMeRouter);

export default router;
