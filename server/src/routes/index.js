import { Router } from 'express';
import authRouter from './auth.js';
import adminUsersRouter from './admin/users.js';
import adminImportsRouter from './admin/imports.js';
import adminReportsRouter from './admin/reports.js';
import adminSurveysRouter from './admin/surveys.js';
import adminConfigRouter from './admin/config.js';
import adminHouseholdsRouter from './admin/households.js';
import adminCampaignsRouter from './admin/campaigns.js';
import mobileBootstrapRouter from './mobile/bootstrap.js';
import mobileCanvassRouter from './mobile/canvass.js';
import mobileMeRouter from './mobile/me.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.use('/auth', authRouter);
router.use('/admin/users', adminUsersRouter);
router.use('/admin/imports', adminImportsRouter);
router.use('/admin/reports', adminReportsRouter);
router.use('/admin/surveys', adminSurveysRouter);
router.use('/admin/config', adminConfigRouter);
router.use('/admin/households', adminHouseholdsRouter);
router.use('/admin/campaigns', adminCampaignsRouter);
router.use('/mobile', mobileBootstrapRouter);
router.use('/mobile', mobileCanvassRouter);
router.use('/mobile/me', mobileMeRouter);

export default router;
