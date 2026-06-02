import { Router } from 'express';
import authRouter from './auth.js';
import adminMembershipsRouter from './admin/memberships.js';
import adminAssignmentsRouter from './admin/assignments.js';
import adminImportsRouter from './admin/imports.js';
import adminReportsRouter from './admin/reports.js';
import adminSurveysRouter from './admin/surveys.js';
import adminConfigRouter from './admin/config.js';
import adminHouseholdsRouter from './admin/households.js';
import adminCampaignsRouter from './admin/campaigns.js';
import adminActivitiesRouter from './admin/activities.js';
import adminQueuesRouter from './admin/queues.js';
import adminTurfsRouter from './admin/turfs.js';
import adminWalkListsRouter from './admin/walklists.js';
import adminVotedRouter from './admin/voted.js';
import adminPassesRouter from './admin/passes.js';
import adminTurfAssignmentsRouter from './admin/turfAssignments.js';
import superAdminOrganizationsRouter from './superAdmin/organizations.js';
import superAdminUsersRouter from './superAdmin/users.js';
import superAdminPlatformRouter from './superAdmin/platform.js';
import mobileBootstrapRouter from './mobile/bootstrap.js';
import mobileCanvassRouter from './mobile/canvass.js';
import mobileMeRouter from './mobile/me.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.use('/auth', authRouter);

router.use('/super-admin/organizations', superAdminOrganizationsRouter);
router.use('/super-admin/users', superAdminUsersRouter);
router.use('/super-admin', superAdminPlatformRouter);

router.use('/admin/memberships', adminMembershipsRouter);
router.use('/admin/imports', adminImportsRouter);
router.use('/admin/reports', adminReportsRouter);
router.use('/admin/surveys', adminSurveysRouter);
router.use('/admin/config', adminConfigRouter);
router.use('/admin/households', adminHouseholdsRouter);
router.use('/admin/campaigns', adminCampaignsRouter);
router.use('/admin/campaigns/:campaignId/assignments', adminAssignmentsRouter);
router.use('/admin/campaigns/:campaignId/walklists', adminWalkListsRouter);
router.use('/admin/campaigns/:campaignId/voted', adminVotedRouter);
router.use('/admin/campaigns/:campaignId/passes', adminPassesRouter);
router.use('/admin/campaigns/:campaignId/turfs/:turfId/assignments', adminTurfAssignmentsRouter);
router.use('/admin/campaigns/:campaignId/turfs', adminTurfsRouter);
router.use('/admin/activities', adminActivitiesRouter);
router.use('/admin/queues', adminQueuesRouter);

router.use('/mobile', mobileBootstrapRouter);
router.use('/mobile', mobileCanvassRouter);
router.use('/mobile/me', mobileMeRouter);

export default router;
